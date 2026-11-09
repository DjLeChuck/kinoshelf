import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { open, readFile, stat } from 'node:fs/promises';
import { dirname, extname, join, resolve } from 'node:path';
import {
  buildProfile,
  fetchImage as defaultFetchImage,
  libraryProfile,
  replaceImage,
  showFileNames,
  type Config,
  type ImageCandidate,
  type ImageFetcher,
  type ImageSize,
  type Journal,
  type LibraryConfig,
  type Profile,
  type WorkImageKind,
  type WorkImages,
} from '@kinoshelf/core';
import { ApiError } from './api-error.js';
import { dimensionsOf, fetchCustomImage, type ImageFormat } from './custom-image.js';
import type { LibraryItem, LibraryItemStore, LibrarySnapshot } from './library-items.js';
import { isInside } from './notify/paths.js';

export const IMAGE_TYPES = ['poster', 'fanart', 'logo'] as const satisfies readonly WorkImageKind[];

export interface ImageChoice {
  readonly type: WorkImageKind;
  readonly source: 'tmdb' | 'url';
  /** A provider path (`/abc.jpg`) for `tmdb`, an address for `url`. */
  readonly value: string;
}

/** What a page of a work needs to change its images. */
export interface ImageTarget {
  readonly library: LibraryConfig;
  readonly profile: Profile;
  readonly kind: 'movie' | 'series';
  readonly tmdbId: number;
  readonly title: string | null;
  readonly year: number | null;
  /** The work's own folder: a movie's, a show's (never a season's). */
  readonly folder: string;
}

export interface CurrentImage {
  readonly size: number;
  /** Changes when the file does, so a browser asks again after a replacement. */
  readonly modified: number;
  readonly width: number | null;
  readonly height: number | null;
  /** The provider's path when the image in place is one of the offered ones. */
  readonly path: string | null;
}

/** An offered image as the page reads it: no field is optional, `null` says there is none. */
export interface ListedImage {
  readonly path: string;
  readonly language: string | null;
  readonly width: number;
  readonly height: number;
  readonly rating: number | null;
  readonly votes: number;
}

export interface ImagePreview {
  readonly format: ImageFormat;
  readonly width: number;
  readonly height: number;
  readonly size: number;
  /** The image itself as a `data:` address: the page's policy allows no other origin. */
  readonly data: string;
}

export interface ImageListing {
  readonly title: string | null;
  readonly year: number | null;
  readonly folder: string;
  /** The file written for each type, `null` when the profile writes none (nothing to change). */
  readonly files: Record<WorkImageKind, string | null>;
  readonly current: Record<WorkImageKind, CurrentImage | null>;
  /** What can be written under the profile's name: a JPEG for a `.jpg`, a PNG for a `.png`. */
  readonly candidates: Record<WorkImageKind, readonly ListedImage[]>;
}

export interface ArtworkDeps {
  readonly config: () => Config;
  readonly journal: Journal;
  readonly items: LibraryItemStore;
  readonly snapshot: LibrarySnapshot;
  /** Where replaced files are kept so that undo can bring them back. */
  readonly backupDir: string;
  readonly listImages: (kind: 'movie' | 'series', tmdbId: number) => Promise<WorkImages | null>;
  readonly imageUrl: (path: string, size: ImageSize) => string;
  /** Replaces the network for the provider's images, for tests. */
  readonly fetchImage?: ImageFetcher;
  /** The folder of a show's files changed: looked at again. */
  readonly touched: (libraryId: string) => void;
}

const listed = (image: ImageCandidate): ListedImage => ({
  path: image.path,
  language: image.language ?? null,
  width: image.width,
  height: image.height,
  rating: image.rating?.value ?? null,
  votes: image.rating?.votes ?? 0,
});

const formatOfName = (name: string): ImageFormat =>
  extname(name).toLowerCase() === '.png' ? 'png' : 'jpeg';

const formatOfPath = (path: string): ImageFormat => formatOfName(path);

/** Sniffs the first bytes: what the file says it is, whatever its name. */
const sniff = (bytes: Uint8Array): ImageFormat | undefined =>
  bytes[0] === 0x89 && bytes[1] === 0x50
    ? 'png'
    : bytes[0] === 0xff && bytes[1] === 0xd8
      ? 'jpeg'
      : undefined;

/**
 * Changes the poster, background and logo of a work: lists what the provider offers, and writes
 * what the user chose over the files in place. Everything that writes goes through `replaceImage`,
 * so the change is one journaled batch that can be undone.
 */
export class Artwork {
  constructor(private readonly deps: ArtworkDeps) {}

  /** The work the page is about, or the reason it has no images to change. */
  movie(library: LibraryConfig, item: LibraryItem): ImageTarget {
    if (library.type !== 'movie' || item.kind !== 'movie' || item.tmdbId === null) {
      throw new ApiError(409, 'image.not-editable');
    }
    const folder = dirname(item.path);
    // A movie directly in the library's folder has none of its own: every movie would share the file.
    if (resolve(folder) === resolve(library.source)) {
      throw new ApiError(409, 'image.not-editable');
    }
    return this.target(library, 'movie', item, folder);
  }

  /**
   * Which of the work's images are on the disk, for a page that may offer to change them; `null`
   * when it may not (`find` throws `image.not-editable`). The list's `poster`/`fanart`/`logo` say
   * nothing planned is missing, which a work with no logo to write also is: not what a page needs.
   */
  presence(find: () => ImageTarget): Record<WorkImageKind, boolean> | null {
    let target: ImageTarget;
    try {
      target = find();
    } catch (error) {
      if (error instanceof ApiError && error.code === 'image.not-editable') {
        return null;
      }
      throw error;
    }
    const there = (type: WorkImageKind): boolean => {
      const name = this.fileName(target, type);
      return name !== null && existsSync(join(target.folder, name));
    };
    return { poster: there('poster'), fanart: there('fanart'), logo: there('logo') };
  }

  show(library: LibraryConfig, tmdbId: number): ImageTarget {
    const placed = this.deps.items
      .ofShow(library.id, tmdbId)
      .find((row) => row.state === 'ok' || row.state === 'incomplete');
    if (library.type !== 'series' || !placed) {
      throw new ApiError(409, 'image.not-editable');
    }
    const profile = this.profile(library);
    if (profile.templates.seriesFolder === '') {
      throw new ApiError(409, 'image.not-editable');
    }
    const folder =
      profile.templates.seasonFolder !== '' ? dirname(dirname(placed.path)) : dirname(placed.path);
    return this.target(library, 'series', placed, folder);
  }

  private profile(library: LibraryConfig): Profile {
    return buildProfile(libraryProfile(library, this.deps.config()));
  }

  private target(
    library: LibraryConfig,
    kind: 'movie' | 'series',
    item: LibraryItem,
    folder: string,
  ): ImageTarget {
    if (!isInside(folder, library.source) || resolve(folder) === resolve(library.source)) {
      throw new ApiError(409, 'image.not-editable');
    }
    const profile = this.profile(library);
    // A profile that writes no image (`metadata: none`) leaves nothing to change.
    const names = showFileNames(profile);
    if (!names.poster && !names.fanart && !names.logo) {
      throw new ApiError(409, 'image.not-editable');
    }
    return {
      library,
      profile,
      kind,
      tmdbId: item.tmdbId ?? 0,
      title: item.title,
      year: item.year,
      folder,
    };
  }

  /** The file the profile writes for a type, `null` when it writes none. */
  fileName(target: ImageTarget, type: WorkImageKind): string | null {
    const names = showFileNames(target.profile);
    return (
      (type === 'poster' ? names.poster : type === 'fanart' ? names.fanart : names.logo) ?? null
    );
  }

  private sizeOf(target: ImageTarget, type: WorkImageKind): ImageSize {
    return target.profile.artwork.find((spec) => spec.kind === type)?.size ?? 'original';
  }

  /** The bytes of the image in place, for the page to show it. */
  async file(
    target: ImageTarget,
    type: WorkImageKind,
  ): Promise<{ bytes: Buffer; format: ImageFormat }> {
    const name = this.fileName(target, type);
    if (name === null) {
      throw new ApiError(409, 'image.not-editable');
    }
    const bytes = await readFile(join(target.folder, name)).catch(() => undefined);
    const format = bytes && sniff(bytes);
    if (!bytes || !format) {
      throw new ApiError(404, 'image.not-found');
    }
    return { bytes, format };
  }

  async list(target: ImageTarget): Promise<ImageListing> {
    const offered = await this.deps.listImages(target.kind, target.tmdbId);
    const files = Object.fromEntries(
      IMAGE_TYPES.map((type) => [type, this.fileName(target, type)]),
    ) as Record<WorkImageKind, string | null>;
    const candidatesOf = (type: WorkImageKind): readonly ImageCandidate[] => {
      const name = files[type];
      return name === null
        ? []
        : (offered?.[type] ?? []).filter(
            (image) => formatOfPath(image.path) === formatOfName(name),
          );
    };
    const candidates: Record<WorkImageKind, readonly ImageCandidate[]> = {
      poster: candidatesOf('poster'),
      fanart: candidatesOf('fanart'),
      logo: candidatesOf('logo'),
    };
    const entries = await Promise.all(
      IMAGE_TYPES.map(async (type) => {
        const name = files[type];
        return [
          type,
          name === null ? null : await this.currentOf(target, name, candidates[type]),
        ] as const;
      }),
    );
    return {
      title: target.title,
      year: target.year,
      folder: target.folder,
      files,
      current: Object.fromEntries(entries) as Record<WorkImageKind, CurrentImage | null>,
      candidates: {
        poster: candidates.poster.map(listed),
        fanart: candidates.fanart.map(listed),
        logo: candidates.logo.map(listed),
      },
    };
  }

  private async currentOf(
    target: ImageTarget,
    name: string,
    candidates: readonly ImageCandidate[],
  ): Promise<CurrentImage | null> {
    const path = join(target.folder, name);
    const info = await stat(path).catch(() => null);
    if (!info?.isFile()) {
      return null;
    }
    // A header is enough to read the size: an image can be far larger than what is worth loading.
    const handle = await open(path, 'r');
    let head: Buffer;
    try {
      head = Buffer.alloc(Math.min(info.size, 262_144));
      await handle.read(head, 0, head.length, 0);
    } finally {
      await handle.close();
    }
    const format = sniff(head);
    const size = format && dimensionsOf(head, format);
    const source = this.deps.journal.madeFileSource(path);
    return {
      size: info.size,
      modified: Math.floor(info.mtimeMs),
      width: size ? size.width : null,
      height: size ? size.height : null,
      path: (source && candidates.find((image) => source.endsWith(image.path))?.path) || null,
    };
  }

  /**
   * What an address gives, for the page to show before anything is written: the same download,
   * limits and format check as `apply`, with nothing kept.
   */
  async preview(target: ImageTarget, type: WorkImageKind, address: string): Promise<ImagePreview> {
    const name = this.fileName(target, type);
    if (name === null) {
      throw new ApiError(409, 'image.not-editable');
    }
    const allowLocalNetwork = this.deps.config().allowLocalImageUrls ?? false;
    const image = await fetchCustomImage(address, { allowLocalNetwork });
    const expected = formatOfName(name);
    if (image.format !== expected) {
      throw new ApiError(422, 'image.format-mismatch', {
        found: image.format.toUpperCase(),
        expected: expected.toUpperCase(),
      });
    }
    return {
      format: image.format,
      width: image.width,
      height: image.height,
      size: image.bytes.length,
      data: `data:image/${image.format};base64,${Buffer.from(image.bytes).toString('base64')}`,
    };
  }

  /**
   * Fetches every chosen image first and writes them only when all came: a bad address leaves
   * the work as it was. The writes are one batch, so one undo puts all of them back.
   */
  async apply(target: ImageTarget, choices: readonly ImageChoice[]): Promise<string> {
    const types = new Set(choices.map(({ type }) => type));
    if (choices.length === 0 || types.size !== choices.length) {
      throw new ApiError(400, 'request.invalid');
    }
    const offered = choices.some(({ source }) => source === 'tmdb')
      ? await this.deps.listImages(target.kind, target.tmdbId)
      : null;
    const allowLocalNetwork = this.deps.config().allowLocalImageUrls ?? false;
    const fetchImage = this.deps.fetchImage ?? defaultFetchImage;

    const fetched = [];
    for (const choice of choices) {
      const name = this.fileName(target, choice.type);
      if (name === null) {
        throw new ApiError(409, 'image.not-editable');
      }
      const expected = formatOfName(name);
      let data: Uint8Array;
      let source: string;
      let found: ImageFormat | undefined;
      if (choice.source === 'tmdb') {
        if (!offered?.[choice.type].some((image) => image.path === choice.value)) {
          throw new ApiError(422, 'image.not-offered');
        }
        source = this.deps.imageUrl(choice.value, this.sizeOf(target, choice.type));
        try {
          data = await fetchImage(source);
        } catch {
          throw new ApiError(502, 'image.unavailable');
        }
        found = sniff(data);
      } else {
        const image = await fetchCustomImage(choice.value, { allowLocalNetwork });
        data = image.bytes;
        source = choice.value;
        found = image.format;
      }
      if (found !== expected) {
        throw new ApiError(422, 'image.format-mismatch', {
          found: (found ?? 'unknown').toUpperCase(),
          expected: expected.toUpperCase(),
        });
      }
      fetched.push({ destination: join(target.folder, name), data, source });
    }

    const batchId = randomUUID();
    for (const { destination, data, source } of fetched) {
      await replaceImage({
        journal: this.deps.journal,
        batchId,
        destination,
        data,
        source,
        backupDir: this.deps.backupDir,
      });
      this.deps.snapshot.written(destination);
    }
    this.deps.touched(target.library.id);
    return batchId;
  }
}
