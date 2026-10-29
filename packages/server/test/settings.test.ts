import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { loadConfig } from '@kinoshelf/core';
import { afterEach, describe, expect, it } from 'vitest';
import { isValidApiKey } from '../src/auth.js';
import { presentSettings } from '../src/settings.js';
import { isValidSession } from '../src/sessions.js';
import { cleanup, harness, makeDir, put, type Harness } from './harness.js';

afterEach(cleanup);

interface SettingsBody {
  tmdb: { configured: boolean; source: string | null; language: string | null };
  locale: string | null;
  plex: { url: string; section: number | null; tokenConfigured: boolean } | null;
  jellyfin: { url: string; tokenConfigured: boolean } | null;
  webhooks: { id: string; target: string; format: string; on: string[]; headerNames: string[] }[];
  processing: { profile: string | null; mode: string | null; threshold: number | null };
  apiKey: { source: string | null };
}

async function withConfig(yaml: string, overrides: Parameters<typeof harness>[0] = {}) {
  const configDir = await makeDir();
  await put(join(configDir, 'config.yaml'), yaml);
  const h = await harness({ configDir, config: await loadConfig(configDir), ...overrides });
  const file = (): Promise<string> => readFile(join(configDir, 'config.yaml'), 'utf8');
  const get = async (): Promise<SettingsBody> =>
    (await h.request('GET', '/api/settings')).json<SettingsBody>();
  const patch = (payload: object) =>
    h.app.inject({
      method: 'PATCH',
      url: '/api/settings',
      headers: { authorization: `Bearer ${h.apiKey}` },
      payload,
    });
  return { ...h, configDir, file, get, patch };
}

describe('GET /api/settings', () => {
  it('reports what is set and never the secrets', async () => {
    const h = await withConfig(`
apiKey:
  tmdb: tmdb-secret
  plex: plex-secret
notify:
  plex:
    url: http://plex:32400
  webhooks:
    - url: https://discord.com/api/webhooks/123/very-secret-token
      format: discord
      headers: { Authorization: Bearer hush }
`);
    const response = await h.request('GET', '/api/settings');
    expect(response.body).not.toMatch(/tmdb-secret|plex-secret|very-secret-token|hush/);
    const body = response.json<SettingsBody>();
    expect(body.tmdb).toEqual({ configured: true, source: 'file', language: null });
    expect(body.plex).toMatchObject({ url: 'http://plex:32400', tokenConfigured: true });
    expect(body.jellyfin).toBeNull();
    expect(body.webhooks).toEqual([
      {
        id: expect.stringMatching(/^[0-9a-f]{12}$/) as string,
        target: 'https://discord.com/…',
        format: 'discord',
        on: ['transferred', 'failed'],
        headerNames: ['Authorization'],
      },
    ]);
    expect(body.apiKey.source).toBe('database');
  });

  it('says the TMDB key comes from the environment, which wins', async () => {
    const h = await withConfig('apiKey:\n  tmdb: from-file\n', { env: { TMDB_API_KEY: 'k' } });
    expect((await h.get()).tmdb.source).toBe('env');
  });

  it('is empty without a config file', async () => {
    const h = await harness();
    const body = (await h.request('GET', '/api/settings')).json<SettingsBody>();
    expect(body).toMatchObject({ tmdb: { configured: false }, plex: null, webhooks: [] });
  });
});

describe('presentSettings', () => {
  // The response schema also strips unknown fields; this guards the presenter itself, so a leak
  // is caught here and not only hidden by the schema.
  it('holds no secret, whatever the configuration contains', () => {
    const secrets = ['tmdb-s', 'plex-s', 'jelly-s', 'hook-path-s', 'header-value-s', 'query-s'];
    const shown = JSON.stringify(
      presentSettings(
        {
          apiKey: { tmdb: 'tmdb-s', plex: 'plex-s', jellyfin: 'jelly-s' },
          notify: {
            plex: { url: 'http://plex:32400' },
            jellyfin: { url: 'http://jelly:8096' },
            webhooks: [
              {
                url: 'https://gotify.example/message?token=query-s&x=hook-path-s',
                headers: { Authorization: 'header-value-s' },
              },
            ],
          },
        },
        { TMDB_API_KEY: 'tmdb-s' },
      ),
    );
    for (const secret of secrets) {
      expect(shown).not.toContain(secret);
    }
    expect(shown).toContain('Authorization');
  });
});

describe('PATCH /api/settings', () => {
  it('creates config.yaml when the server started without one', async () => {
    const configDir = await makeDir();
    const h = await harness({ configDir, config: { destination: '/media' } });
    const response = await h.app.inject({
      method: 'PATCH',
      url: '/api/settings',
      headers: { authorization: `Bearer ${h.apiKey}` },
      payload: { processing: { mode: null, threshold: 90 } },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json<SettingsBody>().processing.threshold).toBe(90);
  });

  it('unsets a value restricted to a list of choices (the form sends null for an empty field)', async () => {
    const h = await withConfig('destination: /media\nmode: copy\nlocale: en\n');
    const response = await h.patch({
      locale: null,
      processing: { profile: null, mode: null, threshold: null },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json<SettingsBody>()).toMatchObject({
      locale: null,
      processing: { mode: null, threshold: null },
    });
    expect(await h.file()).not.toMatch(/mode:|locale:/);
  });

  it('writes config.yaml in place, keeping the comments, and applies it at once', async () => {
    const h = await withConfig('# mine\nmode: copy # seeds\nlocale: en\n');
    const response = await h.patch({
      locale: 'fr',
      tmdb: { apiKey: 'new-key', language: 'fr-FR' },
      processing: { mode: 'hardlink', threshold: 90 },
    });
    expect(response.statusCode).toBe(200);
    expect(response.body).not.toContain('new-key');
    expect(response.json<SettingsBody>()).toMatchObject({
      locale: 'fr',
      tmdb: { configured: true, language: 'fr-FR' },
      processing: { mode: 'hardlink', threshold: 90 },
    });
    expect(await h.file()).toBe(
      '# mine\nmode: hardlink # seeds\nlocale: fr\napiKey:\n  tmdb: new-key\nmetadataLanguage: fr-FR\nthreshold: 90\n',
    );
  });

  it('removes a value with null, and leaves what is not named alone', async () => {
    const h = await withConfig('mode: copy\nthreshold: 80\napiKey:\n  tmdb: k\n');
    await h.patch({ processing: { threshold: null } });
    expect(await h.file()).toBe('mode: copy\napiKey:\n  tmdb: k\n');
  });

  it('refuses an invalid value without writing', async () => {
    const h = await withConfig('mode: copy\n');
    const response = await h.patch({ processing: { threshold: 120 } });
    expect(response.statusCode).toBe(400);
    expect(await h.file()).toBe('mode: copy\n');

    const rejected = await h.patch({ plex: { url: 'not a url' } });
    expect(rejected.statusCode).toBe(400);
    expect(await h.file()).toBe('mode: copy\n');
  });

  it('keeps the token of Plex when only its URL changes, and sets a new one', async () => {
    const h = await withConfig(
      'apiKey:\n  plex: old\nnotify:\n  plex:\n    url: http://a:32400\n    section: 2\n',
    );
    await h.patch({ plex: { url: 'http://b:32400' } });
    expect(await h.file()).toBe(
      'apiKey:\n  plex: old\nnotify:\n  plex:\n    url: http://b:32400\n    section: 2\n',
    );
    await h.patch({ plex: { url: 'http://b:32400', token: 'new', section: null } });
    expect(await h.file()).toBe(
      'apiKey:\n  plex: new\nnotify:\n  plex:\n    url: http://b:32400\n',
    );
  });

  it('merges with the file as it is on disk, not as the server started', async () => {
    const h = await withConfig('apiKey:\n  plex: t\nnotify:\n  plex:\n    url: http://a:32400\n');
    // Edited by hand after the server started.
    await put(
      join(h.configDir, 'config.yaml'),
      '# added by hand\napiKey:\n  plex: t\nnotify:\n  plex:\n    url: http://a:32400\n    section: 3\n',
    );
    await h.patch({ plex: { url: 'http://b:32400' } });
    expect(await h.file()).toBe(
      '# added by hand\napiKey:\n  plex: t\nnotify:\n  plex:\n    url: http://b:32400\n    section: 3\n',
    );
  });

  it('removes a media server with its token', async () => {
    const h = await withConfig(
      'locale: en\napiKey:\n  jellyfin: j\nnotify:\n  jellyfin:\n    url: http://j:8096\n',
    );
    const body = (await h.patch({ jellyfin: null })).json<SettingsBody>();
    expect(body.jellyfin).toBeNull();
    expect(await h.file()).toBe('locale: en\n');
  });

  it('names an existing webhook by its id to keep its secret URL', async () => {
    const h = await withConfig(
      'notify:\n  webhooks:\n    - url: https://ntfy.sh/secret-topic\n      format: ntfy\n',
    );
    const [existing] = (await h.get()).webhooks;
    await h.patch({
      webhooks: [{ id: existing?.id, on: ['failed'] }, { url: 'https://example.org/hook' }],
    });
    expect(await h.file()).toBe(
      'notify:\n  webhooks:\n    - url: https://ntfy.sh/secret-topic\n      format: ntfy\n      on:\n        - failed\n    - url: https://example.org/hook\n',
    );
    await h.patch({ webhooks: [] });
    expect(await h.file()).toBe('{}\n');
  });

  it('refuses an unknown webhook id and a new one without a URL', async () => {
    const h = await withConfig('locale: en\n');
    const unknown = await h.patch({ webhooks: [{ id: 'nope' }] });
    expect(unknown.statusCode).toBe(404);
    expect(unknown.json()).toMatchObject({ error: { code: 'settings.webhook-not-found' } });
    const missing = await h.patch({ webhooks: [{ format: 'ntfy' }] });
    expect(missing.statusCode).toBe(400);
    expect(missing.json()).toMatchObject({ error: { code: 'settings.webhook-url-required' } });
    expect(await h.file()).toBe('locale: en\n');
  });

  it('rebuilds the notifier, so a new target is reached without a restart', async () => {
    const h = await withConfig('locale: en\n');
    expect(h.app.notifier.targets.webhooks).toBe(0);
    await h.patch({ webhooks: [{ url: 'https://example.org/hook' }] });
    expect(h.app.notifier.targets.webhooks).toBe(1);
  });

  it('lets the processor see a changed setting on its next job', async () => {
    const h = await withConfig('locale: en\n');
    await h.patch({ processing: { destination: '/elsewhere' } });
    // The analysis of a new job reads the live config: the plan's root is the new destination.
    const source = await makeDir();
    await put(join(source, 'Dune.2021.mkv'));
    const job = (await h.request('POST', '/api/jobs', { path: source })).json<{ id: string }>();
    await h.app.jobs.idle();
    const entries = (await h.request('GET', `/api/jobs/${job.id}/entries`)).json<
      { destination: string | null }[]
    >();
    expect(entries[0]?.destination).toMatch(/^\/elsewhere\//);
  });

  it('serializes concurrent edits, so none is lost', async () => {
    const h = await withConfig('locale: en\n');
    await Promise.all([
      h.patch({ processing: { mode: 'move' } }),
      h.patch({ processing: { threshold: 70 } }),
      h.patch({ tmdb: { language: 'fr' } }),
    ]);
    expect(await h.file()).toMatch(/mode: move/);
    expect(await h.file()).toMatch(/threshold: 70/);
    expect(await h.file()).toMatch(/metadataLanguage: fr/);
  });

  it('tells the watchers of the stream that settings changed', async () => {
    const h = await withConfig('locale: en\n');
    const seen: string[] = [];
    // The bus is internal: the stream route is the public face, covered in events.test.ts.
    const base = await h.app.listen({ host: '127.0.0.1', port: 0 });
    const response = await fetch(`${base}/api/events`, {
      headers: { authorization: `Bearer ${h.apiKey}` },
    });
    const reader = response.body?.getReader();
    await reader?.read();
    await h.patch({ locale: 'fr' });
    const chunk = await reader?.read();
    seen.push(new TextDecoder().decode(chunk?.value as Uint8Array));
    await reader?.cancel();
    expect(seen.join('')).toContain('event: settings');
  });
});

describe('POST /api/settings/api-key', () => {
  const signedIn = async (h: Harness) => {
    const response = await h.app.inject({
      method: 'POST',
      url: '/api/session',
      payload: { apiKey: h.apiKey },
    });
    return String(response.headers['set-cookie']).split(';')[0] ?? '';
  };

  it('returns a new key once, and the old one stops working', async () => {
    const h = await harness();
    const response = await h.request('POST', '/api/settings/api-key');
    const { apiKey } = response.json<{ apiKey: string }>();
    expect(apiKey).toMatch(/^ks_/);
    expect(isValidApiKey(h.database, apiKey)).toBe(true);
    expect(isValidApiKey(h.database, h.apiKey)).toBe(false);
    expect((await h.request('GET', '/api/jobs')).statusCode).toBe(401);
  });

  it('keeps the browser signed in, with a fresh session', async () => {
    const h = await harness();
    const cookie = await signedIn(h);
    const response = await h.app.inject({
      method: 'POST',
      url: '/api/settings/api-key',
      headers: { cookie },
    });
    expect(response.statusCode).toBe(200);
    const fresh = String(response.headers['set-cookie']).split(';')[0]?.split('=')[1] ?? '';
    expect(isValidSession(h.database, fresh)).toBe(true);
    expect(isValidSession(h.database, cookie.split('=')[1] ?? '')).toBe(false);
  });

  it('is refused while the key comes from the environment', async () => {
    const h = await harness({ env: { KINOSHELF_API_KEY: 'x'.repeat(40) } });
    const response = await h.request('POST', '/api/settings/api-key');
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: { code: 'settings.api-key-from-env' } });
    expect((await h.request('GET', '/api/settings')).json<SettingsBody>().apiKey.source).toBe(
      'env',
    );
  });
});

describe('POST /api/settings/tmdb/test', () => {
  it('searches with the key in use', async () => {
    const h = await harness();
    const response = await h.request('POST', '/api/settings/tmdb/test');
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
  });

  it('reports a missing key with its code', async () => {
    const h = await harness({ realProvider: true });
    const response = await h.request('POST', '/api/settings/tmdb/test');
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ error: { code: 'config.tmdb-key-missing' } });
  });
});
