import { existsSync } from 'node:fs';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ReadableStreamDefaultReader } from 'node:stream/web';
import { afterEach, describe, expect, it } from 'vitest';
import { LogStore, parseLine, scrub } from '../src/logs.js';
import { cleanup, harness, makeDir } from './harness.js';

afterEach(cleanup);

const line = (
  level: number,
  msg: string,
  extra: object = {},
  time = new Date().toISOString(),
): string => `${JSON.stringify({ level, time, msg, ...extra })}\n`;

const WARN = 40;
const INFO = 30;
const DEBUG = 20;
const ERROR = 50;

describe('scrub', () => {
  it('wipes the secret values it is given, wherever they are', () => {
    const text = scrub('key abc123secret and again abc123secret', ['abc123secret']);
    expect(text).toBe('key •••• and again ••••');
  });

  it('leaves a short value alone: it would eat ordinary words', () => {
    expect(scrub('on the road', ['on'])).toBe('on the road');
  });

  it('wipes what carries a secret whoever put it there', () => {
    expect(scrub('GET /x?api_key=hunter22&page=2', [])).toBe('GET /x?api_key=••••&page=2');
    expect(scrub('http://plex/?X-Plex-Token=zzz999 done', [])).toBe(
      'http://plex/?X-Plex-Token=•••• done',
    );
    expect(scrub('Authorization: Bearer abc.def-ghi', [])).toBe('Authorization: Bearer ••••');
  });
});

describe('parseLine', () => {
  it('reads pino’s levels, the component and the job, and keeps the rest as data', () => {
    const entry = parseLine(
      line(WARN, 'slow', { component: 'scan', job: 'j1', ms: 12, pid: 4, hostname: 'h' }),
      7,
    );
    expect(entry).toMatchObject({
      seq: 7,
      level: 'warn',
      component: 'scan',
      message: 'slow',
      job: 'j1',
      data: { ms: 12 },
    });
  });

  it('files a line with no known component under the server', () => {
    expect(parseLine(line(INFO, 'a'), 1)?.component).toBe('server');
    expect(parseLine(line(INFO, 'a', { component: 'mystery' }), 1)?.component).toBe('server');
  });

  it('maps trace to debug and fatal to error', () => {
    expect(parseLine(line(10, 'a'), 1)?.level).toBe('debug');
    expect(parseLine(line(60, 'a'), 1)?.level).toBe('error');
  });

  it('ignores what is not a JSON object', () => {
    expect(parseLine('plain text', 1)).toBeUndefined();
    expect(parseLine('[1,2]', 1)).toBeUndefined();
  });
});

describe('LogStore', () => {
  it('lists newest first, and filters by level, component, text and age', () => {
    const store = new LogStore();
    const old = new Date(Date.now() - 3 * 3_600_000).toISOString();
    store.write(line(INFO, 'started', {}, old));
    store.write(line(DEBUG, 'GET /api/x', { component: 'http' }));
    store.write(line(WARN, 'TMDB slow', { component: 'tmdb', call: 'movie.details' }));
    store.write(line(ERROR, 'gave up', { component: 'tmdb' }));

    const all = store.page({ limit: 10 });
    expect(all.entries.map((e) => e.message)).toEqual([
      'gave up',
      'TMDB slow',
      'GET /api/x',
      'started',
    ]);
    expect(all.kept).toBe(4);
    expect(all.since).toBe(old);

    expect(store.page({ limit: 10, level: 'warn' }).entries).toHaveLength(2);
    expect(store.page({ limit: 10, component: 'http' }).entries).toHaveLength(1);
    // The structured fields are searched too.
    expect(store.page({ limit: 10, q: 'MOVIE.details' }).entries).toHaveLength(1);
    expect(store.page({ limit: 10, minutes: 60 }).entries).toHaveLength(3);
    expect(store.page({ limit: 2 }).entries.map((e) => e.message)).toEqual([
      'gave up',
      'TMDB slow',
    ]);
  });

  it('counts the matching lines newer than the one a client shows', () => {
    const store = new LogStore();
    store.write(line(INFO, 'one'));
    const shown = store.page({ limit: 1 }).entries[0]?.seq ?? 0;
    store.write(line(INFO, 'two'));
    store.write(line(DEBUG, 'three'));
    expect(store.page({ limit: 1, after: shown }).newer).toBe(2);
    expect(store.page({ limit: 1, after: shown, level: 'info' }).newer).toBe(1);
    expect(store.page({ limit: 1 }).newer).toBe(0);
  });

  it('keeps only the last lines in memory', () => {
    const store = new LogStore({ capacity: 3 });
    for (const n of [1, 2, 3, 4, 5]) {
      store.write(line(INFO, `line ${n}`));
    }
    expect(store.page({ limit: 10 }).entries.map((e) => e.message)).toEqual([
      'line 5',
      'line 4',
      'line 3',
    ]);
  });

  it('wipes secrets before keeping, echoing or writing a line', async () => {
    const directory = await makeDir();
    const echoed: string[] = [];
    const store = new LogStore({
      directory,
      secrets: () => ['tmdb-key-123456'],
      echo: (text) => echoed.push(text),
    });
    await store.open();
    store.write(line(INFO, 'using tmdb-key-123456 now'));
    await store.close();
    expect(store.page({ limit: 1 }).entries[0]?.message).toBe('using •••• now');
    expect(echoed[0]).not.toContain('tmdb-key-123456');
    expect(await readFile(join(directory, 'kinoshelf.log'), 'utf8')).not.toContain(
      'tmdb-key-123456',
    );
  });

  it('skips a line that is not pino’s', () => {
    const store = new LogStore();
    store.write('not json\n');
    expect(store.page({ limit: 10 }).kept).toBe(0);
  });

  it('tells its subscribers once for a burst', async () => {
    const store = new LogStore();
    let calls = 0;
    store.subscribe(() => (calls += 1));
    for (let i = 0; i < 20; i++) {
      store.write(line(INFO, `n${i}`));
    }
    await new Promise((resolve) => setTimeout(resolve, 700));
    expect(calls).toBe(1);
  });

  it('rotates the file and drops the oldest past the files kept', async () => {
    const directory = await makeDir();
    const store = new LogStore({ directory, maxFileBytes: 300, files: 3 });
    await store.open();
    for (let i = 1; i <= 40; i++) {
      store.write(line(INFO, `entry number ${String(i).padStart(3, '0')}`));
    }
    await store.close();
    expect((await readdir(directory)).sort()).toEqual([
      'kinoshelf.log',
      'kinoshelf.log.1',
      'kinoshelf.log.2',
    ]);
    expect(existsSync(join(directory, 'kinoshelf.log.3'))).toBe(false);
  });

  it('brings back the last lines after a restart, and downloads oldest first', async () => {
    const directory = await makeDir();
    const first = new LogStore({ directory, maxFileBytes: 300, files: 3 });
    await first.open();
    for (let i = 1; i <= 12; i++) {
      first.write(line(INFO, `entry ${String(i).padStart(2, '0')}`));
    }
    await first.close();

    const second = new LogStore({ directory, maxFileBytes: 300, files: 3 });
    await second.open();
    const back = second.page({ limit: 100 }).entries;
    // Newest first, and the newest is the last one written.
    expect(back[0]?.message).toBe('entry 12');
    expect(back.length).toBeGreaterThan(3);

    second.write(line(INFO, 'after restart'));
    const chunks: Buffer[] = [];
    for await (const chunk of second.download()) {
      chunks.push(Buffer.from(chunk as Buffer));
    }
    const messages = Buffer.concat(chunks)
      .toString('utf8')
      .split('\n')
      .filter((text) => text !== '')
      .map((text) => (JSON.parse(text) as { msg: string }).msg);
    expect(messages.at(-1)).toBe('after restart');
    expect(messages.indexOf('entry 12')).toBe(messages.length - 2);
    await second.close();
  });

  it('survives a log file that cannot be read back', async () => {
    const directory = await makeDir();
    await writeFile(join(directory, 'kinoshelf.log'), 'garbage\n');
    const store = new LogStore({ directory });
    await store.open();
    expect(store.page({ limit: 10 }).kept).toBe(0);
    await store.close();
  });
});

describe('the log routes', () => {
  it('require authentication', async () => {
    const { app } = await harness({ logs: new LogStore() });
    for (const url of ['/api/logs', '/api/logs/download']) {
      expect((await app.inject(url)).statusCode).toBe(401);
    }
    expect((await app.inject({ method: 'PUT', url: '/api/logs/level' })).statusCode).toBe(401);
  });

  it('lists what the server logged, with the secrets wiped', async () => {
    const logs = new LogStore({ secrets: () => ['hunter2-secret'] });
    const { app, request } = await harness({ logs });
    app.log.info({ component: 'notify' }, 'sent with hunter2-secret');
    app.log.warn({ job: 'job-1' }, 'careful');

    const page = (await request('GET', '/api/logs')).json<{
      entries: { message: string; component: string; level: string; job: string | null }[];
      level: string;
    }>();
    expect(page.level).toBe('info');
    expect(page.entries[0]).toMatchObject({ message: 'careful', level: 'warn', job: 'job-1' });
    expect(page.entries[1]).toMatchObject({ message: 'sent with ••••', component: 'notify' });

    const filtered = (await request('GET', '/api/logs?level=warn')).json<{
      entries: unknown[];
    }>();
    expect(filtered.entries).toHaveLength(1);
  });

  it('refuses a filter it does not know', async () => {
    const { request } = await harness({ logs: new LogStore() });
    expect((await request('GET', '/api/logs?level=loud')).statusCode).toBe(400);
    expect((await request('GET', '/api/logs?component=nope')).statusCode).toBe(400);
  });

  it('logs the requests at debug only, and never the reads of the log itself', async () => {
    const logs = new LogStore();
    const { app, request } = await harness({ logs });
    await request('GET', '/api/libraries');
    expect(logs.page({ limit: 50 }).entries.some((e) => e.component === 'http')).toBe(false);

    const changed = await request('PUT', '/api/logs/level', { level: 'debug' });
    expect(changed.json()).toEqual({ level: 'debug' });
    expect(app.log.level).toBe('debug');

    await request('GET', '/api/libraries');
    await request('GET', '/api/logs');
    const http = logs.page({ limit: 50, component: 'http' }).entries;
    expect(http.map((e) => e.message)).toEqual([
      expect.stringMatching(/^GET \/api\/libraries 200 · \d+ ms$/),
    ]);
  });

  it('downloads the log as a file', async () => {
    const directory = await makeDir();
    const logs = new LogStore({ directory });
    await logs.open();
    const { app, request } = await harness({ logs });
    app.log.info('hello file');
    const response = await request('GET', '/api/logs/download');
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-disposition']).toBe('attachment; filename="kinoshelf.log"');
    expect(response.body).toContain('"msg":"hello file"');
    await logs.close();
  });

  it('tells the event stream when lines were written', async () => {
    const logs = new LogStore();
    const h = await harness({ logs });
    const base = await h.app.listen({ host: '127.0.0.1', port: 0 });
    const response = await fetch(`${base}/api/events`, {
      headers: { authorization: `Bearer ${h.apiKey}` },
    });
    const reader = response.body?.getReader() as
      ReadableStreamDefaultReader<Uint8Array> | undefined;
    if (!reader) {
      throw new Error('no body');
    }
    h.app.log.info('something happened');
    const decoder = new TextDecoder();
    let text = '';
    const deadline = Date.now() + 5000;
    while (!text.includes('event: logs') && Date.now() < deadline) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }
      text += decoder.decode(value);
    }
    await reader.cancel();
    expect(text).toContain('event: logs');
  });
});
