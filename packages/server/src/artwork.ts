import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { open, readFile, stat } from 'node:fs/promises';
import { basename, dirname, extname, join, parse, resolve } from 'node:path';
import {
  buildProfile,
  episodeThumbName,
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

/** A work's three images, and an episode's own (`thumb`, one file per version of the episode). */
export type ImageType = WorkImageKind | 'thumb';

export const IMAGE_TYPES = [
  'poster',
  'fanart',
  'logo',
  'thumb',
] as const satisfies readonly ImageType[];

export interface ImageChoice {
  readonly type: ImageType;
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
  /** The work's own folder: a movie's, a show's (never a season's), an episode's season folder. */
  readonly folder: string;
  /**
   * An episode only: where its image goes for each version, since the picture is one and every
   * file wants its own copy (`<file>.jpg`). Empty for a movie or a show.
   */
  readonly thumbs: readonly string[];
  readonly episode?: { readonly season: number; readonly episode: number };
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
  readonly files: Record<ImageType, string | null>;
  readonly current: Record<ImageType, CurrentImage | null>;
  /** What can be written under the profile's name: a JPEG for a `.jpg`, a PNG for a `.png`. */
  readonly candidates: Record<ImageType, readonly ListedImage[]>;
}

export interface ArtworkDeps {
  readonly config: () => Config;
  readonly journal: Journal;
  readonly items: LibraryItemStore;
  readonly snapshot: LibrarySnapshot;
  /** Where replaced files are kept so that undo can bring them back. */
  readonly backupDir: string;
  readonly listImages: (kind: 'movie' | 'series', tmdbId: number) => Promise<WorkImages | null>;
  readonly listStills: (
    tmdbId: number,
    season: number,
    episode: number,
  ) => Promise<readonly ImageCandidate[] | null>;
  readonly imageUrl: (path: string, size: ImageSize) => string;
  /** Replaces the network for the provider's images, for tests. */
  readonly fetchImage?: ImageFetcher;
  /** The folder of a show's files changed: looked at again. */
  readonly touched: (libraryId: string) => void;
  /** The work's folder changed: the media servers are asked to look at it again. */
  readonly changed?: (folder: { path: string; kind: 'movie' | 'series' }) => void;
}

const listed = (image: ImageCandidate): ListedImage => ({
  path: image.path,
  language: image.language ?? null,
  width: image.width,
  height: image.height,
  rating: image.rating?.value ?? null,
  votes: image.rating?.votes ?? 0,
});

/** One value per image type, computed together. */
async function byType<T>(make: (type: ImageType) => Promise<T>): Promise<Record<ImageType, T>> {
  const entries = await Promise.all(
    IMAGE_TYPES.map(async (type) => [type, await make(type)] as const),
  );
  return Object.fromEntries(entries) as Record<ImageType, T>;
}

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

  /**
   * An episode of a series library: the files that hold it (its versions), each wanting the same
   * picture under its own name. A file holding several episodes is the episode's too.
   */
  episode(library: LibraryConfig, tmdbId: number, season: number, episode: number): ImageTarget {
    const holders = this.deps.items
      .ofShow(library.id, tmdbId)
      .filter(
        (row) =>
          (row.state === 'ok' || row.state === 'incomplete') &&
          row.season === season &&
          row.episode !== null &&
          row.episode <= episode &&
          episode <= (row.episodeEnd ?? row.episode),
      );
    const profile = this.profile(library);
    const thumbs = holders.flatMap((row) => {
      const name = episodeThumbName(profile, parse(row.path).name);
      return name === undefined ? [] : [join(dirname(row.path), name)];
    });
    const [first] = holders;
    if (library.type !== 'series' || !first || thumbs.length === 0) {
      throw new ApiError(409, 'image.not-editable');
    }
    return {
      library,
      profile,
      kind: 'series',
      tmdbId,
      title: first.title,
      year: first.year,
      folder: dirname(first.path),
      thumbs,
      episode: { season, episode },
    };
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
      thumbs: [],
    };
  }

  /** The file the profile writes for a type, `null` when it writes none. */
  fileName(target: ImageTarget, type: ImageType): string | null {
    if (type === 'thumb') {
      const [first] = target.thumbs;
      return first === undefined ? null : basename(first);
    }
    // An episode has no poster, background or logo of its own to change.
    if (target.episode) {
      return null;
    }
    const names = showFileNames(target.profile);
    return (
      (type === 'poster' ? names.poster : type === 'fanart' ? names.fanart : names.logo) ?? null
    );
  }

  /** The files an image of this type is written to: every version's `.jpg` for a thumbnail. */
  private destinations(target: ImageTarget, type: ImageType): readonly string[] {
    if (type === 'thumb') {
      return target.thumbs;
    }
    const name = this.fileName(target, type);
    return name === null ? [] : [join(target.folder, name)];
  }

  /** The offered images of a type: a work's, or an episode's stills. */
  private async offered(target: ImageTarget, type: ImageType): Promise<readonly ImageCandidate[]> {
    if (target.episode) {
      return type === 'thumb'
        ? ((await this.deps.listStills(
            target.tmdbId,
            target.episode.season,
            target.episode.episode,
          )) ?? [])
        : [];
    }
    return type === 'thumb'
      ? []
      : ((await this.deps.listImages(target.kind, target.tmdbId))?.[type] ?? []);
  }

  private sizeOf(target: ImageTarget, type: ImageType): ImageSize {
    const kind = type === 'thumb' ? 'episode-thumb' : type;
    return target.profile.artwork.find((spec) => spec.kind === kind)?.size ?? 'original';
  }

  /** The bytes of the image in place, for the page to show it. */
  async file(
    target: ImageTarget,
    type: ImageType,
  ): Promise<{ bytes: Buffer; format: ImageFormat }> {
    if (this.fileName(target, type) === null) {
      throw new ApiError(409, 'image.not-editable');
    }
    // Every version's copy is the same picture: the first one there stands for them.
    let bytes: Buffer | undefined;
    for (const path of this.destinations(target, type)) {
      bytes = await readFile(path).catch(() => undefined);
      if (bytes) {
        break;
      }
    }
    const format = bytes && sniff(bytes);
    if (!bytes || !format) {
      throw new ApiError(404, 'image.not-found');
    }
    return { bytes, format };
  }

  async list(target: ImageTarget): Promise<ImageListing> {
    const files = Object.fromEntries(
      IMAGE_TYPES.map((type) => [type, this.fileName(target, type)]),
    ) as Record<ImageType, string | null>;
    // Only what can be written under the profile's name: a JPEG for a `.jpg`, a PNG for a `.png`.
    const candidates = await byType(async (type) => {
      const name = files[type];
      const offered = name === null ? [] : await this.offered(target, type);
      return offered.filter((image) => formatOfPath(image.path) === formatOfName(name ?? ''));
    });
    const current = await byType(async (type): Promise<CurrentImage | null> => {
      for (const path of this.destinations(target, type)) {
        const found = await this.currentOf(path, candidates[type]);
        if (found) {
          return found;
        }
      }
      return null;
    });
    return {
      title: target.title,
      year: target.year,
      folder: target.folder,
      files,
      current,
      candidates: await byType((type) => Promise.resolve(candidates[type].map(listed))),
    };
  }

  private async currentOf(
    path: string,
    candidates: readonly ImageCandidate[],
  ): Promise<CurrentImage | null> {
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
  async preview(target: ImageTarget, type: ImageType, address: string): Promise<ImagePreview> {
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
        const offered = await this.offered(target, choice.type);
        if (!offered.some((image) => image.path === choice.value)) {
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
      // One picture, written for each place the type has: an episode's versions all get it.
      for (const destination of this.destinations(target, choice.type)) {
        fetched.push({ destination, data, source });
      }
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
    this.deps.changed?.({ path: target.folder, kind: target.kind });
    return batchId;
  }
}
