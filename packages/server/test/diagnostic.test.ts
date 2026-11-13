import { inflateRawSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import { diagnosticFilename } from '../src/diagnostic.js';
import { zip } from '../src/zip.js';
import { cleanup, harness, librariesAt, makeDir } from './harness.js';

afterEach(cleanup);

/** Reads the archive through its central directory, as any unzip tool does. */
function unzip(archive: Buffer): Map<string, string> {
  const end = archive.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = archive.readUInt16LE(end + 10);
  let cursor = archive.readUInt32LE(end + 16);
  const files = new Map<string, string>();
  for (let i = 0; i < count; i++) {
    expect(archive.readUInt32LE(cursor)).toBe(0x02014b50);
    const packed = archive.readUInt32LE(cursor + 20);
    const nameLength = archive.readUInt16LE(cursor + 28);
    const local = archive.readUInt32LE(cursor + 42);
    const name = archive.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8');
    const start = local + 30 + archive.readUInt16LE(local + 26) + archive.readUInt16LE(local + 28);
    files.set(name, inflateRawSync(archive.subarray(start, start + packed)).toString('utf8'));
    cursor += 46 + nameLength;
  }
  return files;
}

describe('zip', () => {
  it('makes an archive any reader can open, names in UTF-8 included', () => {
    const files = [
      { name: 'a.txt', data: Buffer.from('hello hello hello hello') },
      { name: 'dossier/é.json', data: Buffer.from('{}') },
      { name: 'empty', data: Buffer.alloc(0) },
    ];
    expect(unzip(zip(files))).toEqual(
      new Map([
        ['a.txt', 'hello hello hello hello'],
        ['dossier/é.json', '{}'],
        ['empty', ''],
      ]),
    );
  });
});

describe('diagnosticFilename', () => {
  it('carries the date and the minute', () => {
    expect(diagnosticFilename(new Date('2026-11-13T09:05:42Z'))).toBe(
      'kinoshelf-diagnostic-20261113-0905.zip',
    );
  });
});

describe('the diagnostic archive', () => {
  async function secretive() {
    return harness({
      config: {
        libraries: [...librariesAt(await makeDir())],
        apiKey: { tmdb: 'TMDBSECRET1234', plex: 'PLEXSECRET5678' },
        notify: { webhooks: [{ url: 'https://hooks.example.com/SECRETPATH?token=WEBHOOKSECRET' }] },
      },
    });
  }

  it('carries the configuration, the health and the logs, and not one secret', async () => {
    const h = await secretive();
    const response = await h.app.inject({
      method: 'GET',
      url: '/api/diagnostic/archive',
      headers: { authorization: `Bearer ${h.apiKey}` },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toBe('application/zip');
    expect(response.headers['content-disposition']).toMatch(
      /^attachment; filename="kinoshelf-diagnostic-\d{8}-\d{4}\.zip"$/,
    );

    const files = unzip(response.rawPayload);
    expect([...files.keys()]).toEqual([
      'summary.json',
      'config.json',
      'health.json',
      'tmdb-usage.json',
      'logs.ndjson',
    ]);
    expect(JSON.parse(files.get('summary.json') ?? '')).toMatchObject({
      kinoshelf: expect.any(String) as string,
    });
    expect(JSON.parse(files.get('config.json') ?? '')).toMatchObject({
      settings: { tmdb: { configured: true }, plex: null },
      libraries: [{ id: 'films' }, { id: 'shows' }],
    });
    expect(JSON.parse(files.get('health.json') ?? '')).toHaveProperty('queue');

    const everything = [...files.values()].join('\n');
    for (const secret of [
      'TMDBSECRET1234',
      'PLEXSECRET5678',
      'SECRETPATH',
      'WEBHOOKSECRET',
      h.apiKey,
    ]) {
      expect(everything).not.toContain(secret);
    }
  });

  it('is behind the key, like the rest', async () => {
    const h = await secretive();
    expect((await h.app.inject({ method: 'GET', url: '/api/diagnostic/archive' })).statusCode).toBe(
      401,
    );
    expect((await h.app.inject({ method: 'GET', url: '/api/diagnostic' })).statusCode).toBe(401);
  });
});

describe('GET /api/diagnostic', () => {
  it('gives the versions to copy and the configuration the archive carries', async () => {
    const h = await harness({ config: { libraries: [...librariesAt(await makeDir())] } });
    const body = (await h.request('GET', '/api/diagnostic')).json<{
      summary: { node: string };
      config: { libraries: unknown[] };
      logLines: number;
    }>();
    expect(body.summary.node).toBe(process.version);
    expect(body.config.libraries).toHaveLength(2);
    expect(body.logLines).toBe(2000);
  });
});
