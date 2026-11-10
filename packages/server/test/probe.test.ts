import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { promisify } from 'node:util';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { migrated } from '../src/database.js';
import { LibraryItemStore, type LibraryItem } from '../src/library-items.js';
import {
  ffprobe,
  hasHdr10Plus,
  ProbeQueue,
  ProbeUnavailableError,
  probePictureSize,
  sizeFromStreams,
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
      hdr: null,
      audioLanguages: [],
      subtitleLanguages: [],
      picture: null,
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

describe('summarize: HDR and languages', () => {
  const read = (...streams: object[]) =>
    summarize(JSON.stringify({ streams }), { size: 1, mtime: 2 });
  const video = (extra: object) => ({ codec_type: 'video', codec_name: 'hevc', ...extra });

  it('tells PQ from HLG from SDR by the transfer characteristics', () => {
    expect(read(video({ color_transfer: 'smpte2084' })).hdr).toBe('hdr10');
    expect(read(video({ color_transfer: 'arib-std-b67' })).hdr).toBe('hlg');
    expect(read(video({ color_transfer: 'bt709' })).hdr).toBeNull();
    expect(read(video({})).hdr).toBeNull();
  });

  it('prefers Dolby Vision, then HDR10+, over the HDR10 base layer', () => {
    const base = { color_transfer: 'smpte2084' };
    expect(
      read(video({ ...base, side_data_list: [{ side_data_type: 'DOVI configuration record' }] }))
        .hdr,
    ).toBe('dolby-vision');
    expect(
      read(
        video({
          ...base,
          side_data_list: [{ side_data_type: 'HDR Dynamic Metadata SMPTE2094-40 (HDR10+)' }],
        }),
      ).hdr,
    ).toBe('hdr10-plus');
  });

  it('lists the languages of every audio and subtitle track once, leaving out the undetermined', () => {
    const probe = read(
      video({}),
      { codec_type: 'audio', codec_name: 'eac3', tags: { language: 'fre' } },
      { codec_type: 'audio', codec_name: 'aac', tags: { language: 'eng' } },
      { codec_type: 'audio', codec_name: 'aac', tags: { language: 'FRE' } },
      { codec_type: 'audio', codec_name: 'aac' },
      { codec_type: 'subtitle', codec_name: 'subrip', tags: { language: 'eng' } },
      { codec_type: 'subtitle', codec_name: 'subrip', tags: { language: 'und' } },
    );
    expect(probe.audioLanguages).toEqual(['fre', 'eng']);
    expect(probe.subtitleLanguages).toEqual(['eng']);
  });
});

// Captured with ffprobe 8 from the clips the Kodi wiki's Samples page links to.
describe('real streams of the Kodi samples', () => {
  it('reads Dolby Vision with an HLG base from the stream (an iPhone clip)', () => {
    const json = JSON.stringify({
      streams: [
        {
          codec_type: 'video',
          codec_name: 'hevc',
          color_transfer: 'arib-std-b67',
          side_data_list: [
            { side_data_type: 'DOVI configuration record', dv_profile: 8, dv_level: 10 },
            { side_data_type: 'Ambient viewing environment' },
          ],
        },
      ],
    });
    expect(summarize(json, { size: 1, mtime: 2 }).hdr).toBe('dolby-vision');
  });

  it('finds HDR10+ in the first frame, not in the stream (the WebM project clip)', () => {
    const stream = {
      codec_type: 'video',
      codec_name: 'vp9',
      color_transfer: 'smpte2084',
      side_data_list: [
        { side_data_type: 'Content light level metadata' },
        { side_data_type: 'Mastering display metadata' },
      ],
    };
    expect(summarize(JSON.stringify({ streams: [stream] }), { size: 1, mtime: 2 }).hdr).toBe(
      'hdr10',
    );
    const frame = (...types: string[]) =>
      JSON.stringify({
        frames: [{ side_data_list: types.map((side_data_type) => ({ side_data_type })) }],
      });
    expect(
      hasHdr10Plus(
        frame(
          'Mastering display metadata',
          'Content light level metadata',
          'HDR Dynamic Metadata SMPTE2094-40 (HDR10+)',
        ),
      ),
    ).toBe(true);
    expect(hasHdr10Plus(frame('Mastering display metadata'))).toBe(false);
    expect(hasHdr10Plus('{}')).toBe(false);
  });
});

describe('sizeFromStreams', () => {
  const streams = (...list: object[]): string => JSON.stringify({ streams: list });

  it('calls a frame by the size a release name would', () => {
    expect(sizeFromStreams(streams({ codec_type: 'video', width: 3840, height: 1600 }))).toBe(
      '2160p',
    );
    expect(sizeFromStreams(streams({ codec_type: 'video', width: 1920, height: 800 }))).toBe(
      '1080p',
    );
  });

  it('stores the picture size of the first video stream', () => {
    const out = JSON.stringify({
      streams: [{ codec_type: 'video', width: 1920, height: 800 }, { codec_type: 'audio' }],
    });
    expect(summarize(out, { size: 1, mtime: 1 }).picture).toBe('1080p');
    expect(
      summarize(JSON.stringify({ streams: [{ codec_type: 'audio' }] }), { size: 1, mtime: 1 })
        .picture,
    ).toBeNull();
  });

  it('reads the video stream, not the audio one', () => {
    expect(
      sizeFromStreams(
        streams({ codec_type: 'audio' }, { codec_type: 'video', width: 1280, height: 720 }),
      ),
    ).toBe('720p');
  });

  it('has nothing to say of a file with no frame', () => {
    expect(sizeFromStreams(streams({ codec_type: 'audio' }))).toBeUndefined();
    expect(sizeFromStreams(streams())).toBeUndefined();
  });
});

describe('probePictureSize', () => {
  it('reads a real file, made with ffmpeg', async () => {
    const dir = await makeDir();
    const clip = join(dir, 'clip.mkv');
    await promisify(execFile)('ffmpeg', [
      '-v',
      'error',
      '-f',
      'lavfi',
      '-i',
      'testsrc=duration=1:size=1920x800:rate=5',
      '-c:v',
      'mpeg4',
      clip,
    ]);
    expect(await probePictureSize(clip)).toBe('1080p');
  });

  it('says nothing of a file that is not a video, or is not there', async () => {
    const dir = await makeDir();
    expect(await probePictureSize(await put(join(dir, 'notes.mkv'), 'text'))).toBeUndefined();
    expect(await probePictureSize(join(dir, 'missing.mkv'))).toBeUndefined();
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
      '-metadata:s:a:0',
      'language=fre',
      clip,
    ]);
    const probe = await ffprobe(clip);
    expect(probe).toMatchObject({
      video: 'mpeg4',
      audio: 'ac3 1.0',
      hdr: null,
      audioLanguages: ['fre'],
      subtitleLanguages: [],
      // The frame is 64x64: its width is what pictureSize reads, as a release name would call it.
      picture: '480p',
    });
    expect(probe.size).toBeGreaterThan(0);
  });

  it('sees the HDR of a real file', async () => {
    const dir = await makeDir();
    const clip = join(dir, 'hdr.mkv');
    await promisify(execFile)('ffmpeg', [
      '-v',
      'error',
      '-f',
      'lavfi',
      '-i',
      'testsrc=duration=1:size=64x64:rate=5',
      '-vf',
      'setparams=color_primaries=bt2020:color_trc=smpte2084:colorspace=bt2020nc',
      '-c:v',
      'libx265',
      '-x265-params',
      'log-level=error',
      clip,
    ]);
    expect(await ffprobe(clip)).toMatchObject({ video: 'hevc', hdr: 'hdr10' });
  });

  it('rejects a file that is not a video', async () => {
    const file = await put(join(await makeDir(), 'notes.mkv'), 'not a video');
    await expect(ffprobe(file)).rejects.toThrow();
    await expect(ffprobe(file)).rejects.not.toBeInstanceOf(ProbeUnavailableError);
  });
});

const EMPTY: Probe = {
  video: null,
  audio: null,
  hdr: null,
  audioLanguages: [],
  subtitleLanguages: [],
  picture: null,
  size: 0,
  mtime: 0,
};

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
  logo: null,
  thumb: null,
  entryId: null,
  scanJobId: null,
  scannedAt: 'now',
  picture: null,
});

function queue(options: { prober?: Prober; busy?: () => boolean } = {}) {
  const store = new LibraryItemStore(migrated(new Database(':memory:')));
  const calls: string[] = [];
  const prober: Prober =
    options.prober ??
    (() =>
      Promise.resolve({
        video: 'h264',
        audio: 'aac 2.0',
        hdr: null,
        audioLanguages: [],
        subtitleLanguages: [],
        picture: null,
        size: 1,
        mtime: 1,
      }));
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
      prober: () => {
        busy = true; // a scan was queued while this file was being read
        return Promise.resolve({ ...EMPTY, video: 'h264', size: 1, mtime: 1 });
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
        return { ...EMPTY, video: 'h264', size: info.size, mtime: Math.floor(info.mtimeMs) };
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

  it('reads again, after a scan, a file replaced under the same name, and only that one', async () => {
    const dir = await makeDir();
    const a = await put(join(dir, 'a.mkv'), 'one');
    const b = await put(join(dir, 'b.mkv'), 'two');
    const { stat } = await import('node:fs/promises');
    const { store, probes, calls } = queue({
      prober: async (path) => {
        const info = await stat(path);
        return {
          ...EMPTY,
          video: `read ${String(calls.length)}`,
          size: info.size,
          mtime: Math.floor(info.mtimeMs),
        };
      },
    });
    store.replace('films', [item(a), item(b)]);
    probes.refresh('films');
    await probes.idle();
    expect(calls).toHaveLength(2);

    await put(a, 'another, longer release');
    store.replace('films', [item(a), item(b)]);
    // The scan alone cannot tell: the old specs are still there.
    expect(store.probeOf('films', a)?.video).toBe('read 1');
    probes.refresh('films');
    await probes.idle();
    expect(calls.filter((path) => path === a)).toHaveLength(2);
    expect(calls.filter((path) => path === b)).toHaveLength(1);
    expect(store.probeOf('films', a)?.size).toBe('another, longer release'.length);
  });

  it('stores the HDR and the languages, and gives them back', async () => {
    const dir = await makeDir();
    const a = await put(join(dir, 'a.mkv'));
    const { store, probes } = queue({
      prober: () =>
        Promise.resolve({
          video: 'hevc',
          audio: 'eac3 5.1',
          hdr: 'dolby-vision',
          audioLanguages: ['fre', 'eng'],
          subtitleLanguages: ['fre'],
          picture: '1080p',
          size: 1,
          mtime: 1,
        }),
    });
    store.replace('films', [item(a)]);
    await probes.now('films', a);

    store.replace('films', [item(a)]);
    expect(store.probeOf('films', a)).toMatchObject({
      hdr: 'dolby-vision',
      audioLanguages: ['fre', 'eng'],
      subtitleLanguages: ['fre'],
      picture: '1080p',
    });
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
