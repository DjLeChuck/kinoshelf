import { isAbsolute } from 'node:path';
import type { Config } from '@kinoshelf/core';
import { createTranslator, detectLocale } from '@kinoshelf/i18n';
import { Notifier } from './notify/notifier.js';
import type { RefreshTarget } from './notify/plex.js';

export interface NotifyCommandContext {
  readonly config: Config;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly out: (line: string) => void;
  readonly err: (line: string) => void;
  /** Printed to `err` on a bad command line (translated by the caller). */
  readonly usage: string;
  /** Replaced in tests. */
  readonly fetch?: typeof fetch;
}

/**
 * `kinoshelf-server notify …`: checks, from inside the container and with the real config.yaml
 * (keys and path mappings included), what a transfer would do to the media servers. The output is
 * JSON, so it carries codes and values rather than text to translate. Exit 0 when it worked, 1
 * when a target failed or nothing was refreshed, 2 for a bad command line.
 */
export async function runNotifyCommand(
  args: readonly string[],
  context: NotifyCommandContext,
): Promise<number> {
  const [command, ...rest] = args;
  if (command !== 'test' && command !== 'refresh') {
    context.err(context.usage);
    return 2;
  }
  const parsed = command === 'refresh' ? parseRefresh(rest) : undefined;
  if (command === 'refresh' && !parsed) {
    context.err(context.usage);
    return 2;
  }

  // What a dry run held back, with the path and query only: no address, no header.
  const wouldSend: { method: string; path: string; body?: string }[] = [];
  const base = context.fetch ?? fetch;
  const dryFetch: typeof fetch = (input, init) => {
    const method = init?.method ?? 'GET';
    const url = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
    );
    // A refresh is the one thing that changes anything (Plex's is a GET too).
    if (method === 'GET' && !url.pathname.includes('/refresh')) {
      return base(input, init);
    }
    wouldSend.push({
      method,
      path: decodeURIComponent(url.pathname + url.search),
      ...(typeof init?.body === 'string' && { body: init.body }),
    });
    return Promise.resolve(new Response(null, { status: 204 }));
  };

  const notifier = new Notifier({
    config: context.config,
    translate: createTranslator(detectLocale(undefined, context.config.locale, context.env)),
    log: {
      info: () => undefined,
      warn: (message) => {
        context.err(`warn: ${message}`);
      },
      error: (error) => {
        context.err(`error: ${error instanceof Error ? error.message : String(error)}`);
      },
    },
    // A check must answer at once: no waiting for retries to learn that a target is down.
    delivery: { fetch: parsed?.dryRun ? dryFetch : base, delays: [] },
  });

  const { webhooks, plex, jellyfin } = notifier.targets;
  if (command === 'test' ? webhooks + Number(plex) + Number(jellyfin) === 0 : !plex && !jellyfin) {
    context.out(JSON.stringify({ error: { code: 'notify.nothing-configured' } }, null, 2));
    return 1;
  }

  if (command === 'test') {
    const results = await notifier.test();
    context.out(JSON.stringify(results, null, 2));
    return results.every((result) => result.ok) ? 0 : 1;
  }

  const reports = await notifier.refreshPaths([
    { path: parsed?.path ?? '', kind: parsed?.kind ?? 'movie' },
  ]);
  // In a dry run nothing was refreshed: the count says what would be, so it is not called "refreshed".
  const shown = parsed?.dryRun
    ? Object.fromEntries(
        Object.entries(reports).map(([server, { refreshed, skipped, failed }]) => [
          server,
          { wouldRefresh: refreshed, skipped, failed },
        ]),
      )
    : reports;
  context.out(JSON.stringify({ dryRun: parsed?.dryRun ?? false, ...shown, wouldSend }, null, 2));
  // Refreshing nothing is a failure here: a skipped path is a wrong mapping, which a script of
  // yours should notice, not a success.
  return Object.values(reports).every(
    (report) => report.refreshed > 0 && report.failed.length === 0,
  )
    ? 0
    : 1;
}

function parseRefresh(args: readonly string[]): (RefreshTarget & { dryRun: boolean }) | undefined {
  let path: string | undefined;
  let kind: RefreshTarget['kind'] = 'movie';
  let dryRun = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? '';
    if (arg === '--dry-run') {
      dryRun = true;
    } else if (arg === '--kind') {
      const value = args[++i];
      if (value !== 'movie' && value !== 'series') {
        return undefined;
      }
      kind = value;
    } else if (!arg.startsWith('-') && path === undefined) {
      path = arg;
    } else {
      return undefined;
    }
  }
  return path !== undefined && isAbsolute(path) ? { path, kind, dryRun } : undefined;
}
