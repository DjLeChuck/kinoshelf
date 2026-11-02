import { execFile } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { errnoCode } from '@kinoshelf/core';
import type { LibraryItemStore } from './library-items.js';

/** What `ffprobe` tells of a video, plus the file's size and date, which tell when to look again. */
export interface Probe {
  /** Codec of the first video stream, e.g. `hevc`. */
  readonly video: string | null;
  /** Codec and layout of the first audio stream, e.g. `eac3 5.1`. */
  readonly audio: string | null;
  readonly size: number;
  /** Modification time, in whole milliseconds. */
  readonly mtime: number;
}

/**
 * Reads a file. Rejects when the file cannot be read, with `unavailable` set when `ffprobe` itself
 * is not there (nothing was learned, so nothing should be remembered).
 */
export type Prober = (path: string) => Promise<Probe>;

export class ProbeUnavailableError extends Error {
  constructor() {
    super('ffprobe is not installed');
  }
}

interface Stream {
  codec_type?: string;
  codec_name?: string;
  channels?: number;
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
    ...file,
  };
}

const TIMEOUT_MS = 30_000;

export const ffprobe: Prober = async (path) => {
  const info = await stat(path);
  const output = await new Promise<string>((resolve, reject) => {
    execFile(
      'ffprobe',
      ['-v', 'error', '-print_format', 'json', '-show_streams', '--', path],
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
  return summarize(output, { size: info.size, mtime: Math.floor(info.mtimeMs) });
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
      const probe = await prober(path);
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
