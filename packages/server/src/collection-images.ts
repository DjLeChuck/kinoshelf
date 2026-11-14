import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Database } from '@kinoshelf/core';
import { ApiError } from './api-error.js';
import type { ImageFormat } from './custom-image.js';
import type { CollectionImageType, MediaServerKind } from './notify/collection-images.js';

export const COLLECTION_IMAGE_TYPES = [
  'poster',
  'fanart',
] as const satisfies readonly CollectionImageType[];

/** Where a choice came from, so the page can say it (and a rename or a refresh keeps it). */
export interface ImageSource {
  /** `tmdb`: one of the collection's images; `film`: a movie's own; `url`: an address. */
  readonly type: 'tmdb' | 'film' | 'url';
  readonly url: string | null;
  /** ISO 639-1 of a TMDB image; `null` for no text, or another source. */
  readonly language: string | null;
  /** The movie's title for a `film`. */
  readonly label: string | null;
}

export interface StoredImage {
  readonly type: CollectionImageType;
  readonly format: ImageFormat;
  /** SHA-256 of the bytes: a server's image is up to date when it was sent with this one. */
  readonly hash: string;
  readonly source: ImageSource;
  readonly chosenAt: string;
}

/**
 * - `default`: no choice in Kinoshelf, the server keeps its own image.
 * - `pending`: chosen and not sent yet, or changed since it was (another hash).
 * - `sent`, with its date.
 * - `missing`: the server has not created the collection yet.
 * - `error`: the last send failed, with what the server said.
 */
export type SyncState = 'default' | 'pending' | 'sent' | 'missing' | 'error';

/** What is stored of a send: no row yet means nothing was tried. */
export interface SyncRow {
  readonly state: 'sent' | 'missing' | 'error';
  readonly hash: string | null;
  readonly at: string | null;
  readonly message: string | null;
}

export interface ServerState {
  readonly state: SyncState;
  readonly at: string | null;
  readonly message: string | null;
}

/**
 * The state of one image on one server, from the image chosen and what the last send left. An image
 * sent with another hash than today's was changed since: it is to send again.
 */
export function syncState(
  image: Pick<StoredImage, 'hash'> | undefined,
  row: SyncRow | undefined,
): ServerState {
  if (image === undefined) {
    return { state: 'default', at: null, message: null };
  }
  if (row === undefined || (row.state === 'sent' && row.hash !== image.hash)) {
    return { state: 'pending', at: null, message: null };
  }
  return { state: row.state, at: row.at, message: row.message };
}

interface ImageRow {
  key: string;
  type: CollectionImageType;
  file: string;
  format: ImageFormat;
  hash: string;
  source: ImageSource['type'];
  source_url: string | null;
  source_language: string | null;
  source_label: string | null;
  chosen_at: string;
}

interface SyncRecord {
  key: string;
  type: CollectionImageType;
  server: MediaServerKind;
  state: SyncRow['state'];
  hash: string | null;
  at: string | null;
  message: string | null;
}

const storedOf = (row: ImageRow): StoredImage => ({
  type: row.type,
  format: row.format,
  hash: row.hash,
  source: {
    type: row.source,
    url: row.source_url,
    language: row.source_language,
    label: row.source_label,
  },
  chosenAt: row.chosen_at,
});

/**
 * The images the owner chose for collections, and how each stands on each media server. The files
 * live in Kinoshelf's data (never in a movie's folder: a collection has none), named at random so
 * that renaming a collection moves rows only. A later write for Kodi's "Movie Set Information
 * Folder" reads them from here too.
 */
export class CollectionImageStore {
  constructor(
    private readonly database: Database,
    private readonly dir: string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Every chosen image of a library, by collection. */
  all(libraryId: string): Map<string, Partial<Record<CollectionImageType, StoredImage>>> {
    const rows = this.database
      .prepare<[string], ImageRow>('SELECT * FROM collection_images WHERE library_id = ?')
      .all(libraryId);
    const byKey = new Map<string, Partial<Record<CollectionImageType, StoredImage>>>();
    for (const row of rows) {
      byKey.set(row.key, { ...byKey.get(row.key), [row.type]: storedOf(row) });
    }
    return byKey;
  }

  get(libraryId: string, key: string, type: CollectionImageType): StoredImage | undefined {
    const row = this.row(libraryId, key, type);
    return row && storedOf(row);
  }

  /** Every send's trace of a library, by collection, type and server. */
  syncRows(libraryId: string): Map<string, SyncRecord[]> {
    const records = this.database
      .prepare<[string], SyncRecord>(
        'SELECT key, type, server, state, hash, at, message FROM collection_sync WHERE library_id = ?',
      )
      .all(libraryId);
    const byKey = new Map<string, SyncRecord[]>();
    for (const record of records) {
      byKey.set(record.key, [...(byKey.get(record.key) ?? []), record]);
    }
    return byKey;
  }

  /** Keeps the image and makes it the choice; what a failed send left is forgotten. */
  async choose(
    libraryId: string,
    key: string,
    type: CollectionImageType,
    image: { bytes: Uint8Array; format: ImageFormat },
    source: ImageSource,
  ): Promise<StoredImage> {
    const previous = this.row(libraryId, key, type);
    const file = `${randomUUID()}.${image.format === 'png' ? 'png' : 'jpg'}`;
    await mkdir(this.dir, { recursive: true });
    await writeFile(join(this.dir, file), image.bytes);
    const hash = createHash('sha256').update(image.bytes).digest('hex');
    this.database.transaction(() => {
      this.database
        .prepare(
          `INSERT INTO collection_images
             (library_id, key, type, file, format, hash, source, source_url, source_language,
              source_label, chosen_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (library_id, key, type) DO UPDATE SET file = excluded.file,
             format = excluded.format, hash = excluded.hash, source = excluded.source,
             source_url = excluded.source_url, source_language = excluded.source_language,
             source_label = excluded.source_label, chosen_at = excluded.chosen_at`,
        )
        .run(
          libraryId,
          key,
          type,
          file,
          image.format,
          hash,
          source.type,
          source.url,
          source.language,
          source.label,
          this.now().toISOString(),
        );
      this.database
        .prepare(
          `DELETE FROM collection_sync
           WHERE library_id = ? AND key = ? AND type = ? AND state = 'error'`,
        )
        .run(libraryId, key, type);
    })();
    if (previous) {
      await rm(join(this.dir, previous.file), { force: true });
    }
    return storedOf(this.row(libraryId, key, type) as ImageRow);
  }

  /** Back to the server's own image: the choice is dropped (the server keeps what it was sent). */
  async remove(libraryId: string, key: string, type: CollectionImageType): Promise<void> {
    const previous = this.row(libraryId, key, type);
    if (!previous) {
      return;
    }
    this.database.transaction(() => {
      this.database
        .prepare('DELETE FROM collection_images WHERE library_id = ? AND key = ? AND type = ?')
        .run(libraryId, key, type);
      this.database
        .prepare('DELETE FROM collection_sync WHERE library_id = ? AND key = ? AND type = ?')
        .run(libraryId, key, type);
    })();
    await rm(join(this.dir, previous.file), { force: true });
  }

  async read(
    libraryId: string,
    key: string,
    type: CollectionImageType,
  ): Promise<{ bytes: Buffer; format: ImageFormat }> {
    const row = this.row(libraryId, key, type);
    const bytes = row && (await readFile(join(this.dir, row.file)).catch(() => undefined));
    if (!row || !bytes) {
      throw new ApiError(404, 'image.not-found');
    }
    return { bytes, format: row.format };
  }

  setSync(
    libraryId: string,
    key: string,
    type: CollectionImageType,
    server: MediaServerKind,
    row: SyncRow,
  ): void {
    this.database
      .prepare(
        `INSERT INTO collection_sync (library_id, key, type, server, state, hash, at, message)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (library_id, key, type, server) DO UPDATE SET state = excluded.state,
           hash = excluded.hash, at = excluded.at, message = excluded.message`,
      )
      .run(libraryId, key, type, server, row.state, row.hash, row.at, row.message);
  }

  /** The server created the collection: what said it was missing no longer holds. */
  clearMissing(libraryId: string, key: string, server: MediaServerKind): void {
    this.database
      .prepare(
        `DELETE FROM collection_sync
         WHERE library_id = ? AND key = ? AND server = ? AND state = 'missing'`,
      )
      .run(libraryId, key, server);
  }

  remoteId(libraryId: string, key: string, server: MediaServerKind): string | undefined {
    return this.database
      .prepare<[string, string, string], { remote_id: string }>(
        'SELECT remote_id FROM collection_remote WHERE library_id = ? AND key = ? AND server = ?',
      )
      .get(libraryId, key, server)?.remote_id;
  }

  setRemoteId(
    libraryId: string,
    key: string,
    server: MediaServerKind,
    remoteId: string | undefined,
  ): void {
    if (remoteId === undefined) {
      this.database
        .prepare('DELETE FROM collection_remote WHERE library_id = ? AND key = ? AND server = ?')
        .run(libraryId, key, server);
      return;
    }
    this.database
      .prepare(
        `INSERT INTO collection_remote (library_id, key, server, remote_id) VALUES (?, ?, ?, ?)
         ON CONFLICT (library_id, key, server) DO UPDATE SET remote_id = excluded.remote_id`,
      )
      .run(libraryId, key, server, remoteId);
  }

  /**
   * A custom collection took another name: the choice follows it. What was sent does not: the
   * servers will create a collection under the new name, which has none of it yet.
   */
  rename(libraryId: string, from: string, to: string): void {
    if (from === to) {
      return;
    }
    this.database.transaction(() => {
      // A collection already under the new name keeps its own images: the owner built it.
      this.database
        .prepare('UPDATE OR IGNORE collection_images SET key = ? WHERE library_id = ? AND key = ?')
        .run(to, libraryId, from);
      for (const table of ['collection_images', 'collection_sync', 'collection_remote']) {
        this.database
          .prepare(`DELETE FROM ${table} WHERE library_id = ? AND key = ?`)
          .run(libraryId, from);
      }
      for (const table of ['collection_sync', 'collection_remote']) {
        this.database
          .prepare(`DELETE FROM ${table} WHERE library_id = ? AND key = ?`)
          .run(libraryId, to);
      }
    })();
  }

  private row(libraryId: string, key: string, type: CollectionImageType): ImageRow | undefined {
    return this.database
      .prepare<[string, string, string], ImageRow>(
        'SELECT * FROM collection_images WHERE library_id = ? AND key = ? AND type = ?',
      )
      .get(libraryId, key, type);
  }
}
