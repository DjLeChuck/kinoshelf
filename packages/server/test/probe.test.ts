import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { promisify } from 'node:util';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { migrated } from '../src/database.js';
import { LibraryItemStore, type LibraryItem } from '../src/library-items.js';
import {
  ffprobe,
  ProbeQueue,
  ProbeUnavailableError,
  summarize,
  type Probe,
  type Prober,
} from '../src/probe.js';
import { cleanup, makeDir, put } from './harness.js';

afterEach(cleanup);

describe('summarize', () => {
  it('keeps the first video and audio stream, and names the channel layout', () => {
    const json = JSON.stringify({
      streams: [
        { codec_type: 'audio', codec_name: 'eac3', channels: 6 },
        { codec_type: 'video', codec_name: 'hevc' },
        { codec_type: 'audio', codec_name: 'aac', channels: 2 },
        { codec_type: 'subtitle', codec_name: 'subrip' },
      ],
    });
    expect(summarize(json, { size: 10, mtime: 20 })).toEqual({
      video: 'hevc',
      audio: 'eac3 5.1',
      size: 10,
      mtime: 20,
    });
  });

  it('says nothing of a stream that is not there, and counts unusual layouts', () => {
    expect(summarize('{"streams":[]}', { size: 1, mtime: 2 })).toMatchObject({
      video: null,
      audio: null,
    });
    expect(
      summarize('{"streams":[{"codec_type":"audio","codec_name":"dts","channels":3}]}', {
        size: 1,
        mtime: 2,
      }).audio,
    ).toBe('dts 3ch');
  });
});

describe('ffprobe', () => {
  it('reads a real file, made with ffmpeg', async () => {
    const dir = await makeDir();
    const clip = join(dir, 'clip.mkv');
    await promisify(execFile)('ffmpeg', [
      '-v',
      'error',
      '-f',
      'lavfi',
      '-i',
      'testsrc=duration=1:size=64x64:rate=5',
      '-f',
      'lavfi',
      '-i',
      'sine=duration=1',
      '-c:v',
      'mpeg4',
      '-c:a',
      'ac3',
      clip,
    ]);
    const probe = await ffprobe(clip);
    expect(probe).toMatchObject({ video: 'mpeg4', audio: 'ac3 1.0' });
    expect(probe.size).toBeGreaterThan(0);
  });

  it('rejects a file that is not a video', async () => {
    const file = await put(join(await makeDir(), 'notes.mkv'), 'not a video');
    await expect(ffprobe(file)).rejects.toThrow();
    await expect(ffprobe(file)).rejects.not.toBeInstanceOf(ProbeUnavailableError);
  });
});

const item = (path: string): LibraryItem => ({
  libraryId: 'films',
  path,
  kind: 'movie',
  tmdbId: null,
  title: null,
  year: null,
  season: null,
  episode: null,
  episodeEnd: null,
  state: 'ok',
  nfo: null,
  poster: null,
  fanart: null,
  entryId: null,
  scanJobId: null,
  scannedAt: 'now',
});

function queue(options: { prober?: Prober; busy?: () => boolean } = {}) {
  const store = new LibraryItemStore(migrated(new Database(':memory:')));
  const calls: string[] = [];
  const prober: Prober =
    options.prober ??
    (() => Promise.resolve({ video: 'h264', audio: 'aac 2.0', size: 1, mtime: 1 }));
  const errors: unknown[] = [];
  const probes = new ProbeQueue({
    store,
    prober: (path) => {
      calls.push(path);
      return prober(path);
    },
    busy: options.busy ?? (() => false),
    onError: (error) => errors.push(error),
  });
  return { store, probes, calls, errors };
}

describe('the probe queue', () => {
  it('reads the rows nobody looked at, once, in the background', async () => {
    const dir = await makeDir();
    const a = await put(join(dir, 'a.mkv'));
    const b = await put(join(dir, 'b.mkv'));
    const { store, probes, calls } = queue();
    store.replace('films', [item(a), item(b)]);

    probes.enqueue('films');
    await probes.idle();
    expect(calls.sort()).toEqual([a, b]);
    expect(store.probeOf('films', a)).toMatchObject({ video: 'h264', audio: 'aac 2.0' });

    // Nothing left: a second pass reads nothing.
    probes.enqueue('films');
    await probes.idle();
    expect(calls).toHaveLength(2);
  });

  it('waits while the job queue works, and resumes when told it is idle', async () => {
    const dir = await makeDir();
    const a = await put(join(dir, 'a.mkv'));
    let busy = true;
    const { store, probes, calls } = queue({ busy: () => busy });
    store.replace('films', [item(a)]);

    probes.enqueue('films');
    await probes.idle();
    expect(calls).toEqual([]);
    expect(probes.pending).toBe(1);

    busy = false;
    probes.kick();
    await probes.idle();
    expect(calls).toEqual([a]);
  });

  it('stops after the file in hand when a job arrives', async () => {
    const dir = await makeDir();
    const files = await Promise.all(['a', 'b', 'c'].map((n) => put(join(dir, `${n}.mkv`))));
    let busy = false;
    const { store, probes, calls } = queue({
      busy: () => busy,
      prober: (path) => {
        busy = true; // a scan was queued while this file was being read
        return Promise.resolve({ video: 'h264', audio: null, size: 1, mtime: 1, path } as Probe);
      },
    });
    store.replace('films', files.map(item));
    probes.enqueue('films');
    await probes.idle();
    expect(calls).toHaveLength(1);
    expect(probes.pending).toBe(2);
  });

  it('reads a file on demand, but not again while its size and date are the same', async () => {
    const dir = await makeDir();
    const a = await put(join(dir, 'a.mkv'), 'one');
    const { store, probes, calls } = queue({
      prober: async (path) => {
        const { stat } = await import('node:fs/promises');
        const info = await stat(path);
        return { video: 'h264', audio: null, size: info.size, mtime: Math.floor(info.mtimeMs) };
      },
    });
    store.replace('films', [item(a)]);

    expect(await probes.now('films', a)).toMatchObject({ video: 'h264' });
    expect(calls).toHaveLength(1);
    await probes.now('films', a);
    expect(calls).toHaveLength(1);

    // Another content, another size: it is read again.
    await put(a, 'a longer content');
    await probes.now('films', a);
    expect(calls).toHaveLength(2);
  });

  it('keeps what it learned across the next scan of the library', async () => {
    const dir = await makeDir();
    const a = await put(join(dir, 'a.mkv'));
    const { store, probes } = queue();
    store.replace('films', [item(a)]);
    await probes.now('films', a);

    store.replace('films', [item(a)]);
    expect(store.probeOf('films', a)).toMatchObject({ video: 'h264' });
    expect(store.unprobed('films')).toEqual([]);
  });

  it('remembers nothing when ffprobe is missing, and an empty answer for a file it cannot read', async () => {
    const dir = await makeDir();
    const a = await put(join(dir, 'a.mkv'));
    const b = await put(join(dir, 'b.mkv'));
    const missing = queue({ prober: () => Promise.reject(new ProbeUnavailableError()) });
    missing.store.replace('films', [item(a)]);
    expect(await missing.probes.now('films', a)).toBeUndefined();
    expect(missing.store.unprobed('films')).toEqual([a]);

    const broken = queue({ prober: () => Promise.reject(new Error('invalid data')) });
    broken.store.replace('films', [item(b)]);
    expect(await broken.probes.now('films', b)).toBeUndefined();
    expect(broken.store.unprobed('films')).toEqual([]);
    expect(broken.errors).toHaveLength(1);
  });

  it('forgets a file that left the disk', async () => {
    const { store, probes, calls } = queue();
    store.replace('films', [item('/nonexistent/a.mkv')]);
    expect(await probes.now('films', '/nonexistent/a.mkv')).toBeUndefined();
    expect(calls).toEqual([]);
  });
});
