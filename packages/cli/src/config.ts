import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parse } from 'yaml';
import { z } from 'zod';
import { CliError } from './errors.js';

const configSchema = z.strictObject({
  tmdbApiKey: z.string().min(1).optional(),
  /** Language of the tool itself. */
  locale: z.enum(['en', 'fr']).optional(),
  /** Language of the titles fetched from TMDB, e.g. `fr` or `en-US`. */
  metadataLanguage: z.string().min(2).optional(),
  profile: z.string().min(1).optional(),
  mode: z.enum(['copy', 'hardlink', 'move']).optional(),
  threshold: z.number().min(0).max(100).optional(),
  destination: z.string().min(1).optional(),
  destinationMovies: z.string().min(1).optional(),
  destinationSeries: z.string().min(1).optional(),
});

export type Config = z.infer<typeof configSchema>;

export const DATABASE_FILE = 'kinoshelf.sqlite';

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
    throw error;
  }

  let raw: unknown;
  try {
    raw = parse(text);
  } catch (error) {
    throw new CliError('config.invalid', {
      path,
      detail: error instanceof Error ? error.message : String(error),
    });
  }

  const result = configSchema.safeParse(raw ?? {});
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new CliError('config.invalid', {
      path,
      detail: `${issue?.path.join('.') ?? ''} ${issue?.message ?? ''}`.trim(),
    });
  }
  return result.data;
}
