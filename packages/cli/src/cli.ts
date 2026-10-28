import { mkdir, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { Command, CommanderError } from 'commander';
import {
  analyze,
  configDirectory,
  DATABASE_FILE,
  discoverVideos,
  executePlan,
  GuessitParser,
  KinoshelfError,
  loadConfig,
  SqliteJournal,
  undoLastBatch,
  type Config,
  type MetadataProvider,
} from '@kinoshelf/core';
import { SqliteHttpCache, TmdbProvider, type HttpCache } from '@kinoshelf/provider-tmdb';
import { CliError } from './errors.js';
import {
  createTranslator,
  describeError,
  detectLocale,
  isLocale,
  type Locale,
  type Translate,
} from './i18n/index.js';
import { analysisToJson, renderAnalysis, renderBatch, renderUndo } from './render.js';
import { resolveSettings, type CommonOptions } from './settings.js';

export interface Io {
  out(line: string): void;
  err(line: string): void;
  /** Transient progress text; absent when the output is not a terminal. */
  progress?(text: string): void;
}

export interface CliDeps {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly io: Io;
  /** Replaces TMDB, for tests. */
  readonly createProvider?: (options: { language: string; cache: HttpCache }) => MetadataProvider;
}

interface RunOptions extends CommonOptions {
  readonly json?: boolean;
  readonly apply?: boolean;
}

/** Reads `--name value` / `--name=value` from argv before the real parsing. */
function peekOption(argv: readonly string[], name: string): string | undefined {
  for (const [index, arg] of argv.entries()) {
    if (arg === name) {
      return argv[index + 1];
    }
    if (arg.startsWith(`${name}=`)) {
      return arg.slice(name.length + 1);
    }
  }
  return undefined;
}

interface Context {
  readonly t: Translate;
  readonly locale: Locale;
  readonly config: Config;
  readonly configDir: string;
  readonly deps: CliDeps;
}

async function openDatabase(context: Context): Promise<Database.Database> {
  await mkdir(context.configDir, { recursive: true });
  return new Database(join(context.configDir, DATABASE_FILE));
}

function makeProvider(context: Context, language: string, cache: HttpCache): MetadataProvider {
  if (context.deps.createProvider) {
    return context.deps.createProvider({ language, cache });
  }
  const apiKey = (context.deps.env.TMDB_API_KEY ?? context.config.apiKey?.tmdb ?? '').trim();
  if (!apiKey) {
    throw new KinoshelfError('config.tmdb-key-missing', {
      path: join(context.configDir, 'config.yaml'),
    });
  }
  return new TmdbProvider({ apiKey, language, cache });
}

/** `scan` and `process` share everything but the right to write. */
async function runPipeline(
  kind: 'scan' | 'process',
  input: string,
  options: RunOptions,
  context: Context,
): Promise<number> {
  const { t, deps } = context;
  const source = resolve(input);
  let isFile: boolean;
  try {
    isFile = (await stat(source)).isFile();
  } catch {
    throw new KinoshelfError('discover.not-found', { path: source });
  }
  const settings = await resolveSettings(options, context.config, {
    source,
    sourceIsFile: isFile,
    defaultToSource: kind === 'scan',
    locale: context.locale,
  });

  const database = await openDatabase(context);
  try {
    const provider = makeProvider(
      context,
      settings.metadataLanguage,
      new SqliteHttpCache(database),
    );
    const files = await discoverVideos(source);
    const analysis = await analyze(files, {
      parser: new GuessitParser(),
      provider,
      profile: settings.profile,
      destinationRoot: settings.destinations,
      mode: settings.mode,
      ...(settings.threshold !== undefined && { matching: { threshold: settings.threshold } }),
      ...(deps.io.progress &&
        !options.json && {
          onProgress: (done: number, total: number) => deps.io.progress?.(`${done}/${total}`),
        }),
    });
    deps.io.progress?.('');

    const apply = kind === 'process' && options.apply === true;
    const batch = apply
      ? await executePlan(analysis.plan, { journal: new SqliteJournal(database) })
      : undefined;

    if (options.json) {
      deps.io.out(JSON.stringify(analysisToJson(analysis, batch), null, 2));
      return batch && renderBatch(batch, t).failed > 0 ? 1 : 0;
    }

    const render = { t, profile: settings.profile.id, mode: settings.mode };
    for (const line of renderAnalysis(analysis, render)) {
      deps.io.out(line);
    }
    if (batch) {
      deps.io.out('');
      const { lines, failed } = renderBatch(batch, t);
      lines.forEach((line) => {
        deps.io.out(line);
      });
      return failed > 0 ? 1 : 0;
    }
    if (analysis.entries.length > 0) {
      deps.io.out('');
      deps.io.out(t(kind === 'scan' ? 'notice.scan' : 'notice.dry-run'));
    }
    return 0;
  } finally {
    database.close();
  }
}

async function runUndo(options: { apply?: boolean }, context: Context): Promise<number> {
  const { t, deps } = context;
  const database = await openDatabase(context);
  try {
    const dryRun = options.apply !== true;
    const result = await undoLastBatch(new SqliteJournal(database), { dryRun });
    if (!result) {
      deps.io.out(t('undo.nothing'));
      return 0;
    }
    const { lines, failed } = renderUndo(result, t);
    lines.forEach((line) => {
      deps.io.out(line);
    });
    if (dryRun) {
      deps.io.out(t('undo.dry-run'));
    }
    return failed > 0 ? 1 : 0;
  } finally {
    database.close();
  }
}

function buildProgram(context: Context, exit: { code: number }): Command {
  const { t } = context;
  const program = new Command('kinoshelf')
    .description(t('help.description'))
    .option('--lang <fr|en>', t('help.opt.lang'))
    .option('--config-dir <dir>', t('help.opt.config-dir'))
    .exitOverride()
    .configureOutput({
      writeOut: (text) => {
        context.deps.io.out(text.trimEnd());
      },
      writeErr: (text) => {
        context.deps.io.err(text.trimEnd());
      },
    });

  const common = (command: Command): Command =>
    command
      .option('--dest <dir>', t('help.opt.dest'))
      .option('--dest-movies <dir>', t('help.opt.dest-movies'))
      .option('--dest-series <dir>', t('help.opt.dest-series'))
      .option('--profile <profile>', t('help.opt.profile'))
      .option('--mode <mode>', t('help.opt.mode'))
      .option('--threshold <score>', t('help.opt.threshold'))
      .option('--metadata-language <code>', t('help.opt.metadata-language'))
      .option('--json', t('help.opt.json'))
      .exitOverride();

  const act = (task: () => Promise<number>) => async (): Promise<void> => {
    exit.code = await task();
  };

  common(
    program.command('scan').description(t('help.scan')).argument('<source>', t('help.arg.source')),
  ).action((source: string, options: RunOptions) =>
    act(() => runPipeline('scan', source, options, context))(),
  );

  common(
    program
      .command('process')
      .description(t('help.process'))
      .argument('<path>', t('help.arg.path'))
      .option('--apply', t('help.opt.apply')),
  ).action((path: string, options: RunOptions) =>
    act(() => runPipeline('process', path, options, context))(),
  );

  program
    .command('undo')
    .description(t('help.undo'))
    .option('--apply', t('help.opt.apply'))
    .exitOverride()
    .action((options: { apply?: boolean }) => act(() => runUndo(options, context))());

  return program;
}

/** Runs the CLI and returns the exit code: 0 ok, 1 an operation or the run failed, 2 bad usage. */
export async function run(argv: readonly string[], deps: CliDeps): Promise<number> {
  const configDir = configDirectory(peekOption(argv, '--config-dir'), deps.env);
  const flagLocale = peekOption(argv, '--lang');

  let config: Config = {};
  let t = createTranslator(detectLocale(flagLocale, undefined, deps.env));
  try {
    config = await loadConfig(configDir);
  } catch (error) {
    if (error instanceof KinoshelfError) {
      deps.io.err(describeError(t, error.info));
      return 1;
    }
    throw error;
  }

  const locale = detectLocale(flagLocale, config.locale, deps.env);
  t = createTranslator(locale);
  if (flagLocale !== undefined && !isLocale(flagLocale)) {
    deps.io.err(
      describeError(
        t,
        new CliError('config.invalid-value', { value: flagLocale, option: '--lang' }),
      ),
    );
    return 2;
  }

  const exit = { code: 0 };
  const program = buildProgram({ t, locale, config, configDir, deps }, exit);
  try {
    await program.parseAsync([...argv], { from: 'user' });
    return exit.code;
  } catch (error) {
    if (error instanceof CommanderError) {
      return error.exitCode === 0 ? 0 : 2;
    }
    if (error instanceof KinoshelfError) {
      deps.io.err(describeError(t, error.info));
      return 1;
    }
    if (error instanceof CliError) {
      deps.io.err(describeError(t, error));
      return 2;
    }
    throw error;
  }
}
