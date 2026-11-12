import {
  createReadStream,
  createWriteStream,
  mkdirSync,
  openSync,
  renameSync,
  statSync,
} from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import type { WriteStream } from 'node:fs';

export const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

/**
 * Where a line comes from, for the filter of the System page. A line with no `component` is the
 * server's own; `tmdb` and `notify` are named by the code that logs them.
 */
export const LOG_COMPONENTS = [
  'server',
  'http',
  'scan',
  'transfer',
  'watcher',
  'tmdb',
  'notify',
] as const;
export type LogComponent = (typeof LOG_COMPONENTS)[number];

export interface LogEntry {
  /** Grows with each line, so a client can tell what it has not seen. */
  readonly seq: number;
  readonly time: string;
  readonly level: LogLevel;
  readonly component: LogComponent;
  readonly message: string;
  readonly job: string | null;
  /** The structured fields of the line, minus the ones above. */
  readonly data: Record<string, unknown>;
}

export interface LogQuery {
  /** Lines at this level or above. */
  readonly level?: LogLevel;
  readonly component?: string;
  /** Matched against the message, the component and the structured fields, case-insensitively. */
  readonly q?: string;
  /** Only the last minutes. */
  readonly minutes?: number;
  readonly limit: number;
  /** Counts the lines newer than this one, for a view that holds still while lines arrive. */
  readonly after?: number;
}

export interface LogPage {
  /** Newest first. */
  readonly entries: readonly LogEntry[];
  /** Matching lines newer than `after`: 0 without it. */
  readonly newer: number;
  readonly kept: number;
  /** The oldest line kept, when there is one. */
  readonly since: string | null;
  /** What the files hold on the disk; 0 when no folder is set. */
  readonly fileBytes: number;
}

export interface LogStoreOptions {
  /** Where `kinoshelf.log` and its rotations live; unset keeps the lines in memory only. */
  readonly directory?: string;
  /** Lines kept in memory, and read back from the files at start. */
  readonly capacity?: number;
  readonly maxFileBytes?: number;
  /** Files kept, the current one included. */
  readonly files?: number;
  /** Secret values to wipe from every line, read at each write: they change with the settings. */
  readonly secrets?: () => readonly string[];
  /** A copy of each (wiped) line, for the process's output. */
  readonly echo?: (line: string) => void;
}

const RANK: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };
const MASK = '••••';
/** Shorter than this is a word, not a secret: wiping it would eat ordinary text. */
const MIN_SECRET = 6;
const FILE = 'kinoshelf.log';
/** Bursts (a scan, a debug level) count once for the clients that watch. */
const NOTIFY_MS = 500;

/**
 * Wipes secrets from a line before it is kept, shown or downloaded: the values the settings hold,
 * and the shapes that carry one whoever put it there (a key in a query string, a bearer token).
 */
export function scrub(line: string, secrets: readonly string[]): string {
  let text = line;
  for (const secret of secrets) {
    if (secret.length >= MIN_SECRET) {
      text = text.split(secret).join(MASK);
    }
  }
  return text
    .replace(/\b(api_?key|token|x-plex-token)=[^&\s"\\]+/gi, `$1=${MASK}`)
    .replace(/\bBearer [\w.~+/=-]+/g, `Bearer ${MASK}`);
}

function levelOf(value: unknown): LogLevel {
  // pino's numbers: trace 10, debug 20, info 30, warn 40, error 50, fatal 60.
  const n = typeof value === 'number' ? value : 30;
  return n < 30 ? 'debug' : n < 40 ? 'info' : n < 50 ? 'warn' : 'error';
}

function componentOf(value: unknown): LogComponent {
  return LOG_COMPONENTS.find((component) => component === value) ?? 'server';
}

const NOT_DATA = new Set(['level', 'time', 'pid', 'hostname', 'msg', 'component', 'job']);

/** A line pino wrote, or `undefined` for anything else (a stray line of text in the file). */
export function parseLine(line: string, seq: number): LogEntry | undefined {
  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return undefined;
  }
  const object = raw as Record<string, unknown>;
  const time = typeof object.time === 'string' ? object.time : new Date().toISOString();
  const data: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(object)) {
    if (!NOT_DATA.has(key)) {
      data[key] = value;
    }
  }
  return {
    seq,
    time,
    level: levelOf(object.level),
    component: componentOf(object.component),
    message: typeof object.msg === 'string' ? object.msg : '',
    job: typeof object.job === 'string' ? object.job : null,
    data,
  };
}

/**
 * What the server logs, kept where a person can read it: the last lines in memory (the page of the
 * System tab), and a file that rotates in the config folder (the download, and what survives a
 * restart). It is the destination of the server's logger, so every line passes through `write`.
 */
export class LogStore {
  private readonly capacity: number;
  private readonly maxFileBytes: number;
  private readonly files: number;
  private readonly entries: { entry: LogEntry; line: string }[] = [];
  private readonly listeners = new Set<() => void>();
  private seq = 0;
  private stream: WriteStream | undefined;
  private bytes = 0;
  private timer: NodeJS.Timeout | undefined;

  constructor(private readonly options: LogStoreOptions = {}) {
    this.capacity = options.capacity ?? 5000;
    this.maxFileBytes = options.maxFileBytes ?? 10 * 1024 * 1024;
    this.files = options.files ?? 3;
  }

  /** Makes the folder, brings back the last lines of the previous run and opens the file. */
  async open(): Promise<void> {
    const { directory } = this.options;
    if (!directory) {
      return;
    }
    mkdirSync(directory, { recursive: true });
    for (const line of await this.lastLines()) {
      this.keep(line);
    }
    this.openFile();
  }

  /** Pino's destination: one call per line, which ends with a newline. */
  write(chunk: string): void {
    const line = scrub(chunk.replace(/\n$/, ''), this.options.secrets?.() ?? []);
    this.options.echo?.(line);
    if (this.keep(line)) {
      this.append(`${line}\n`);
      this.schedule();
    }
  }

  /** Called, at most twice a second, after lines were written. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  page(query: LogQuery): LogPage {
    const needle = query.q?.trim().toLowerCase();
    const floor = query.minutes === undefined ? 0 : Date.now() - query.minutes * 60_000;
    const minRank = RANK[query.level ?? 'debug'];
    const matching = this.entries.filter(({ entry }) => {
      if (RANK[entry.level] < minRank) {
        return false;
      }
      if (query.component !== undefined && entry.component !== query.component) {
        return false;
      }
      if (floor > 0 && Date.parse(entry.time) < floor) {
        return false;
      }
      if (needle) {
        const text =
          `${entry.message} ${entry.component} ${JSON.stringify(entry.data)}`.toLowerCase();
        return text.includes(needle);
      }
      return true;
    });
    const after = query.after;
    return {
      entries: matching
        .slice(-query.limit)
        .reverse()
        .map(({ entry }) => entry),
      newer: after === undefined ? 0 : matching.filter(({ entry }) => entry.seq > after).length,
      kept: this.entries.length,
      since: this.entries[0]?.entry.time ?? null,
      fileBytes: this.fileBytes(),
    };
  }

  /** Every line kept, oldest first: the files when there are some, else the memory. */
  download(): Readable {
    const { directory } = this.options;
    if (!directory) {
      return Readable.from(this.entries.map(({ line }) => `${line}\n`));
    }
    const paths = this.paths().reverse();
    return Readable.from(
      (async function* () {
        for (const path of paths) {
          try {
            for await (const part of createReadStream(path)) {
              yield part as Buffer;
            }
          } catch (error) {
            // A rotation not reached yet has no file.
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
              throw error;
            }
          }
        }
      })(),
    );
  }

  async close(): Promise<void> {
    clearTimeout(this.timer);
    this.timer = undefined;
    const { stream } = this;
    this.stream = undefined;
    if (stream) {
      await new Promise<void>((resolve) => {
        stream.end(resolve);
      });
    }
  }

  /** Keeps a line in memory when it is one of pino's; false for anything else. */
  private keep(line: string): boolean {
    const entry = parseLine(line, this.seq + 1);
    if (!entry) {
      return false;
    }
    this.seq += 1;
    this.entries.push({ entry, line });
    if (this.entries.length > this.capacity) {
      this.entries.shift();
    }
    return true;
  }

  private schedule(): void {
    if (this.timer || this.listeners.size === 0) {
      return;
    }
    this.timer = setTimeout(() => {
      this.timer = undefined;
      for (const listener of [...this.listeners]) {
        listener();
      }
    }, NOTIFY_MS);
    this.timer.unref();
  }

  /** `kinoshelf.log`, then `.1`, `.2`…: newest first. */
  private paths(): string[] {
    const base = join(this.options.directory ?? '', FILE);
    return [base, ...Array.from({ length: this.files - 1 }, (_, i) => `${base}.${i + 1}`)];
  }

  private fileBytes(): number {
    if (!this.options.directory) {
      return 0;
    }
    let total = 0;
    for (const path of this.paths()) {
      try {
        total += statSync(path).size;
      } catch {
        // Not there yet: nothing to count.
      }
    }
    return total;
  }

  private async lastLines(): Promise<string[]> {
    const found: string[] = [];
    for (const path of this.paths()) {
      let text: string;
      try {
        text = await readFile(path, 'utf8');
      } catch {
        continue;
      }
      found.unshift(...text.split('\n').filter((line) => line !== ''));
      if (found.length >= this.capacity) {
        break;
      }
    }
    return found.slice(-this.capacity);
  }

  private openFile(): void {
    const [path] = this.paths();
    if (path === undefined) {
      return;
    }
    try {
      this.bytes = statSync(path).size;
    } catch {
      this.bytes = 0;
    }
    // Opened now, not on the first write: a rotation right after must find the file to rename.
    let stream: WriteStream;
    try {
      stream = createWriteStream(path, { fd: openSync(path, 'a') });
    } catch (error) {
      process.stderr.write(`Cannot open the log file: ${(error as Error).message}\n`);
      return;
    }
    // A full or read-only disk must not take the server down: the memory keeps working.
    stream.on('error', (error) => {
      process.stderr.write(`Cannot write the log file: ${error.message}\n`);
      if (this.stream === stream) {
        this.stream = undefined;
      }
    });
    this.stream = stream;
  }

  private append(text: string): void {
    if (!this.stream) {
      return;
    }
    this.stream.write(text);
    this.bytes += Buffer.byteLength(text);
    if (this.bytes >= this.maxFileBytes) {
      this.rotate();
    }
  }

  private rotate(): void {
    const paths = this.paths();
    this.stream?.end();
    // The oldest goes; each one moves to the next name, then a new file starts.
    for (let i = paths.length - 1; i > 0; i -= 1) {
      try {
        renameSync(paths[i - 1] ?? '', paths[i] ?? '');
      } catch {
        // A rotation not reached yet has nothing to move.
      }
    }
    this.openFile();
  }
}
