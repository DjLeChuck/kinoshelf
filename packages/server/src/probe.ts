import { execFile } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { errnoCode, pictureSize } from '@kinoshelf/core';
import type { LibraryItemStore } from './library-items.js';

/** Strongest first: a Dolby Vision file often carries an HDR10 base layer too. */
export const HDR_FORMATS = ['dolby-vision', 'hdr10-plus', 'hdr10', 'hlg'] as const;
export type Hdr = (typeof HDR_FORMATS)[number];

/** What `ffprobe` tells of a video, plus the file's size and date, which tell when to look again. */
export interface Probe {
  /** Codec of the first video stream, e.g. `hevc`. */
  readonly video: string | null;
  /** Codec and layout of the first audio stream, e.g. `eac3 5.1`. */
  readonly audio: string | null;
  /** The dynamic range of the first video stream, `null` for SDR. */
  readonly hdr: Hdr | null;
  /** Languages (ISO 639-2, as the file tags them) of the audio tracks, first seen first, each once. */
  readonly audioLanguages: readonly string[];
  /** Same for the subtitle tracks. */
  readonly subtitleLanguages: readonly string[];
  readonly size: number;
  /** Modification time, in whole milliseconds. */
  readonly mtime: number;
}

/**
 * Reads a file. Rejects when the file cannot be read, with `unavailable` set when `ffprobe` itself
 * is not there (nothing was learned, so nothing should be remembered).
 */
/** `stamp` is the size and date the caller just read: the file is not stat-ed a second time. */
export type Prober = (
  path: string,
  stamp?: { readonly size: number; readonly mtimeMs: number },
) => Promise<Probe>;

export class ProbeUnavailableError extends Error {
  constructor() {
    super('ffprobe is not installed');
  }
}

interface Stream {
  codec_type?: string;
  codec_name?: string;
  channels?: number;
  color_transfer?: string;
  tags?: { language?: string };
  side_data_list?: { side_data_type?: string }[];
}

const isHdr10Plus = (type: string): boolean =>
  type.includes('HDR10+') || type.includes('SMPTE2094-40');

/** Whether the first frame ffprobe printed (`-show_frames`) carries HDR10+ dynamic metadata. */
export function hasHdr10Plus(output: string): boolean {
  const { frames = [] } = JSON.parse(output) as {
    frames?: { side_data_list?: { side_data_type?: string }[] }[];
  };
  return frames.some(({ side_data_list = [] }) =>
    side_data_list.some(({ side_data_type = '' }) => isHdr10Plus(side_data_type)),
  );
}

/** `und` and `zxx` say no language; a missing tag says nothing either. */
const languagesOf = (streams: readonly Stream[], type: string): string[] => [
  ...new Set(
    streams
      .filter(({ codec_type }) => codec_type === type)
      .map(({ tags }) => tags?.language?.toLowerCase())
      .filter(
        (language): language is string => !!language && language !== 'und' && language !== 'zxx',
      ),
  ),
];

/**
 * `smpte2084` is PQ (HDR10), `arib-std-b67` is HLG. Dolby Vision travels as side data of the stream
 * (`DOVI configuration record`, checked on an iPhone clip), HDR10+ only in the frames: see
 * `hasHdr10Plus`, which the reader calls on a stream that says `hdr10`.
 */
export function hdrOf(video: Stream | undefined): Hdr | null {
  const sideData = (video?.side_data_list ?? []).map(({ side_data_type = '' }) => side_data_type);
  if (sideData.some((type) => type.includes('DOVI'))) {
    return 'dolby-vision';
  }
  if (sideData.some(isHdr10Plus)) {
    return 'hdr10-plus';
  }
  switch (video?.color_transfer) {
    case 'smpte2084':
      return 'hdr10';
    case 'arib-std-b67':
      return 'hlg';
    default:
      return null;
  }
}

const LAYOUTS: Record<number, string> = { 1: '1.0', 2: '2.0', 6: '5.1', 8: '7.1' };

const layoutOf = (channels: number | undefined): string | undefined =>
  channels === undefined ? undefined : (LAYOUTS[channels] ?? `${String(channels)}ch`);

/** Pure, so the shape of ffprobe's JSON is tested without running it. */
export function summarize(output: string, file: { size: number; mtime: number }): Probe {
  const { streams = [] } = JSON.parse(output) as { streams?: Stream[] };
  const video = streams.find(({ codec_type }) => codec_type === 'video');
  const audio = streams.find(({ codec_type }) => codec_type === 'audio');
  const layout = layoutOf(audio?.channels);
  return {
    video: video?.codec_name ?? null,
    audio: audio?.codec_name
      ? [audio.codec_name, layout].filter((part) => part !== undefined).join(' ')
      : null,
    hdr: hdrOf(video),
    audioLanguages: languagesOf(streams, 'audio'),
    subtitleLanguages: languagesOf(streams, 'subtitle'),
    ...file,
  };
}

const TIMEOUT_MS = 30_000;

/** Pure, so the shape of ffprobe's JSON is tested without running it. */
export function sizeFromStreams(output: string): string | undefined {
  const { streams = [] } = JSON.parse(output) as {
    streams?: { codec_type?: string; width?: number; height?: number }[];
  };
  const video = streams.find(({ codec_type }) => codec_type === 'video');
  return video?.width !== undefined && video.height !== undefined && video.width > 0
    ? pictureSize(video.width, video.height)
    : undefined;
}

/**
 * The picture size of a video (`2160p`), read from its frame. Nothing when ffprobe is missing or
 * cannot read the file: the caller then has no size, which is not an error for it.
 */
export type SizeReader = (path: string) => Promise<string | undefined>;

export const probePictureSize: SizeReader = (path) =>
  new Promise((resolve) => {
    execFile(
      'ffprobe',
      [
        '-v',
        'error',
        '-protocol_whitelist',
        'file',
        '-select_streams',
        'v:0',
        '-show_entries',
        'stream=codec_type,width,height',
        '-print_format',
        'json',
        '--',
        path,
      ],
      { timeout: TIMEOUT_MS, maxBuffer: 1_000_000 },
      (error, stdout) => {
        try {
          resolve(error ? undefined : sizeFromStreams(stdout));
        } catch {
          resolve(undefined);
        }
      },
    );
  });

const run = (args: readonly string[]): Promise<string> =>
  new Promise<string>((resolve, reject) => {
    execFile(
      'ffprobe',
      // A file name is only ever read as a local file, never as a URL or a playlist to follow.
      ['-v', 'error', '-protocol_whitelist', 'file', '-print_format', 'json', ...args],
      { timeout: TIMEOUT_MS, maxBuffer: 4_000_000 },
      (error, stdout) => {
        if (error) {
          reject(errnoCode(error) === 'ENOENT' ? new ProbeUnavailableError() : error);
        } else {
          resolve(stdout);
        }
      },
    );
  });

export const ffprobe: Prober = async (path, stamp) => {
  const info = stamp ?? (await stat(path));
  const probe = summarize(await run(['-show_streams', '--', path]), {
    size: info.size,
    mtime: Math.floor(info.mtimeMs),
  });
  if (probe.hdr !== 'hdr10') {
    return probe;
  }
  // The stream's own data cannot tell HDR10+ from HDR10: its metadata rides on each frame, so the
  // first one is read, which costs a few milliseconds.
  const frame = await run([
    '-select_streams',
    'v:0',
    '-show_frames',
    '-read_intervals',
    '%+#1',
    '-show_entries',
    'frame=side_data_list',
    '--',
    path,
  ]).catch(() => undefined);
  return frame !== undefined && hasHdr10Plus(frame) ? { ...probe, hdr: 'hdr10-plus' } : probe;
};

interface Wanted {
  readonly libraryId: string;
  readonly path: string;
}

export interface ProbeQueueDeps {
  readonly store: LibraryItemStore;
  readonly prober: Prober;
  /** The job queue is working: the disk is not ours. */
  readonly busy: () => boolean;
  readonly onError?: (error: unknown) => void;
}

/**
 * Fills in what `ffprobe` knows of each video of a library, in the background. It works only while
 * no scan or transfer does (reading thousands of files would fight them for the disk) and
 * stops at the next file when one arrives. A probe from a page jumps the line. It lives in memory:
 * on start it is rebuilt from the rows never probed.
 */
export class ProbeQueue {
  private readonly waiting = new Map<string, Wanted>();
  private loop: Promise<void> | undefined;
  private stopped = false;

  constructor(private readonly deps: ProbeQueueDeps) {}

  private static key = ({ libraryId, path }: Wanted): string => `${libraryId}\0${path}`;

  /** Queues the rows of a library that were never probed (or whose file changed, on the way). */
  enqueue(libraryId: string): void {
    for (const path of this.deps.store.unprobed(libraryId)) {
      const wanted = { libraryId, path };
      this.waiting.set(ProbeQueue.key(wanted), wanted);
    }
    this.kick();
  }

  /** After a restart: every library's rows without a probe. */
  rebuild(libraryIds: readonly string[]): void {
    libraryIds.forEach((id) => {
      this.enqueue(id);
    });
  }

  /** Call when the job queue went idle, or a probe was queued. */
  kick(): void {
    if (this.loop || this.stopped || this.deps.busy()) {
      return;
    }
    this.loop = this.drain().finally(() => {
      this.loop = undefined;
    });
  }

  /** Lets the file being read finish, reads no other. */
  async stop(): Promise<void> {
    this.stopped = true;
    await this.idle();
  }

  /** Resolves when the queue is empty or paused. */
  async idle(): Promise<void> {
    while (this.loop) {
      await this.loop;
    }
  }

  get pending(): number {
    return this.waiting.size;
  }

  /**
   * What a page asks for: the file is read now unless the row is already up to date. Returns what
   * is known, `undefined` when nothing could be learned (no `ffprobe`, a damaged file).
   */
  async now(libraryId: string, path: string): Promise<Probe | undefined> {
    this.waiting.delete(ProbeQueue.key({ libraryId, path }));
    return this.probe({ libraryId, path });
  }

  private async drain(): Promise<void> {
    while (!this.stopped && !this.deps.busy()) {
      const next = this.waiting.entries().next();
      if (next.done) {
        return;
      }
      const [key, wanted] = next.value;
      this.waiting.delete(key);
      await this.probe(wanted);
    }
  }

  private async probe({ libraryId, path }: Wanted): Promise<Probe | undefined> {
    const { store, prober } = this.deps;
    try {
      const info = await stat(path);
      const known = store.probeOf(libraryId, path);
      if (known?.probedAt && known.size === info.size && known.mtime === Math.floor(info.mtimeMs)) {
        return known;
      }
      const probe = await prober(path, info);
      store.setProbe(libraryId, path, probe);
      return probe;
    } catch (error) {
      // A missing file left the library since the scan; without ffprobe nothing was learned.
      if (!(error instanceof ProbeUnavailableError) && !isMissing(error)) {
        // A file ffprobe cannot read will not be read better next time: remembered, empty.
        const info = await stat(path).catch(() => undefined);
        if (info) {
          const empty = {
            video: null,
            audio: null,
            hdr: null,
            audioLanguages: [],
            subtitleLanguages: [],
            size: info.size,
            mtime: Math.floor(info.mtimeMs),
          };
          store.setProbe(libraryId, path, empty);
          this.deps.onError?.(error);
          return undefined;
        }
      }
      return undefined;
    }
  }
}

const isMissing = (error: unknown): boolean => errnoCode(error) === 'ENOENT';
