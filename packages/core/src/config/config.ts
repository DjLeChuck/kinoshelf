import { constants } from 'node:fs';
import { access, mkdir, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parse } from 'yaml';
import { z } from 'zod';
import { KinoshelfError } from '../errors.js';

const pathMappingSchema = z.strictObject({
  /** A folder as Kinoshelf sees it… */
  from: z.string().min(1),
  /** …and as the media server sees it. */
  to: z.string().min(1),
});

const mediaServerSchema = z.strictObject({
  url: z.url(),
  /** Only when the media server sees the folders under other paths than Kinoshelf. */
  paths: z.array(pathMappingSchema).optional(),
});

const webhookSchema = z.strictObject({
  /** Secrets often live in it (Discord, Gotify's `?token=`): never logged in full. */
  url: z.url(),
  /** `generic` posts Kinoshelf's own JSON; the others speak the service's own format. */
  format: z.enum(['generic', 'gotify', 'ntfy', 'discord']).optional(),
  /** What this target hears about. Default: `transferred` and `failed`. */
  on: z
    .array(z.enum(['transferred', 'failed', 'needs-review']))
    .min(1)
    .optional(),
  headers: z.record(z.string(), z.string()).optional(),
});

const configSchema = z.strictObject({
  /** One key per metadata service, so a second provider adds a key here, not a new setting. */
  apiKey: z
    .strictObject({
      tmdb: z.string().min(1).optional(),
      /** Plex admin token, to refresh a library after a transfer. */
      plex: z.string().min(1).optional(),
      jellyfin: z.string().min(1).optional(),
    })
    .optional(),
  /** Language of the tool itself. */
  locale: z.enum(['en', 'fr']).optional(),
  /** Language of the titles fetched from TMDB, e.g. `fr` or `en-US`. */
  metadataLanguage: z.string().min(2).optional(),
  profile: z.string().min(1).optional(),
  mode: z.enum(['copy', 'hardlink', 'move']).optional(),
  threshold: z.number().min(0).max(100).optional(),
  /** Server: who is told what happened, and which media servers are asked to look again. */
  notify: z
    .strictObject({
      webhooks: z.array(webhookSchema).optional(),
      plex: mediaServerSchema.extend({ section: z.number().int().min(1).optional() }).optional(),
      jellyfin: mediaServerSchema.optional(),
    })
    .optional(),
  /** Server: days after which a finished job, all its files settled, is forgotten. 0 keeps all. */
  retentionDays: z.number().int().min(0).optional(),
  /** One root for everything, or one per kind (Plex asks for separate libraries). */
  destination: z
    .union([
      z.string().min(1),
      z.strictObject({ movies: z.string().min(1), series: z.string().min(1) }),
    ])
    .optional(),
});

export type Config = z.infer<typeof configSchema>;
export type NotifyConfig = NonNullable<Config['notify']>;

export const DATABASE_FILE = 'kinoshelf.sqlite';

/**
 * Creates the config directory if needed and checks that it can be written to. Without this,
 * SQLite reports a bare "unable to open database file", which is all a container shows when
 * its volume belongs to another user than the one the image runs as.
 */
export async function ensureConfigDirectory(dir: string): Promise<void> {
  try {
    await mkdir(dir, { recursive: true });
    await access(dir, constants.W_OK | constants.X_OK);
  } catch {
    throw new KinoshelfError('config.dir-not-writable', {
      path: dir,
      uid: process.getuid?.() ?? 'unknown',
    });
  }
}

/** `--config-dir`, then `KINOSHELF_CONFIG_DIR`, then `$XDG_CONFIG_HOME/kinoshelf`. */
export function configDirectory(
  flag: string | undefined,
  env: Readonly<Record<string, string | undefined>>,
): string {
  return (
    flag ??
    env.KINOSHELF_CONFIG_DIR ??
    join(env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'kinoshelf')
  );
}

/** Reads `config.yaml` from the config directory; a missing file means no configuration. */
export async function loadConfig(directory: string): Promise<Config> {
  const path = join(directory, 'config.yaml');
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return {};
    }
    if (error instanceof Error && 'code' in error && error.code === 'EACCES') {
      throw new KinoshelfError('fs.permission-denied', { path });
    }
    throw error;
  }

  let raw: unknown;
  try {
    raw = parse(text);
  } catch (error) {
    throw new KinoshelfError('config.invalid', {
      path,
      detail: error instanceof Error ? error.message : String(error),
    });
  }

  const result = configSchema.safeParse(raw ?? {});
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new KinoshelfError('config.invalid', {
      path,
      detail: `${issue?.path.join('.') ?? ''} ${issue?.message ?? ''}`.trim(),
    });
  }
  return result.data;
}
