import { constants } from 'node:fs';
import { access, mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { isMap, parse, parseDocument, type Document } from 'yaml';
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
export const CONFIG_FILE = 'config.yaml';

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

function validate(raw: unknown, path: string): Config {
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

async function readText(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return undefined;
    }
    if (error instanceof Error && 'code' in error && error.code === 'EACCES') {
      throw new KinoshelfError('fs.permission-denied', { path });
    }
    throw error;
  }
}

function parseText(text: string, path: string): Document {
  const document = parseDocument(text);
  const [problem] = document.errors;
  if (problem) {
    throw new KinoshelfError('config.invalid', { path, detail: problem.message });
  }
  return document;
}

/** Reads `config.yaml` from the config directory; a missing file means no configuration. */
export async function loadConfig(directory: string): Promise<Config> {
  const path = join(directory, CONFIG_FILE);
  const text = await readText(path);
  if (text === undefined) {
    return {};
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
  return validate(raw, path);
}

/** One change to `config.yaml`: set the value at `path`, or remove it when `value` is undefined. */
export interface ConfigEdit {
  readonly path: readonly string[];
  readonly value?: unknown;
}

/** A map left empty by a removal is dropped with it, so `apiKey: {}` never lingers. */
function pruneEmptyParents(document: Document, path: readonly string[]): void {
  for (let depth = path.length - 1; depth > 0; depth--) {
    const parent = path.slice(0, depth);
    const node = document.getIn(parent, true);
    if (isMap(node) && node.items.length === 0) {
      document.deleteIn(parent);
    } else {
      return;
    }
  }
}

/**
 * Applies edits to `config.yaml` and returns the resulting configuration. The file is edited as a
 * document, so the comments and the order a person wrote survive. The result is validated before
 * anything is written, and written through a temporary file then `rename`: a crash or an invalid
 * edit never leaves a half-written or broken file, which the server could not start from.
 * The file holds secrets, so a new one is created readable by its owner only.
 */
export async function editConfig(directory: string, edits: readonly ConfigEdit[]): Promise<Config> {
  const path = join(directory, CONFIG_FILE);
  const text = await readText(path);
  const document = parseText(text ?? '', path);
  for (const edit of edits) {
    if (edit.value === undefined) {
      // Nothing to remove from a file that does not exist yet (or lacks the key): a form unsets
      // every field it leaves blank, and `deleteIn` throws on an empty document.
      if (document.hasIn(edit.path)) {
        document.deleteIn(edit.path);
        pruneEmptyParents(document, edit.path);
      }
    } else {
      document.setIn(edit.path, edit.value);
    }
  }
  const config = validate(document.toJS(), path);

  const mode = text === undefined ? 0o600 : (await stat(path)).mode & 0o777;
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, document.toString(), { mode });
  await rename(temporary, path);
  return config;
}
