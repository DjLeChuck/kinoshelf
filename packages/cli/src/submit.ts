import { resolve } from 'node:path';
import { describeError, type Translate } from '@kinoshelf/i18n';
import { CliError } from './errors.js';

/** A hook must not hold up the download client that runs it: give up rather than wait. */
const TIMEOUT_MS = 15_000;

export interface SubmitDeps {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly io: { out(line: string): void; err(line: string): void };
  /** Replaced in tests. */
  readonly fetch?: typeof fetch;
}

export interface SubmitOptions {
  readonly url?: string;
  readonly apply?: boolean;
  readonly json?: boolean;
}

/**
 * `kinoshelf submit <path>`: queues a file or folder on a running server, which is what a
 * download client's "on completion" hook wants. The address and the key come from the
 * environment (`KINOSHELF_URL`, `KINOSHELF_API_KEY`), so a command typed in the container works
 * with the variables the server already has and a secret never sits in a client's command line.
 * Exit 0 when queued, 1 when the server could not be reached or refused, 2 for bad usage.
 */
export async function runSubmit(
  path: string,
  options: SubmitOptions,
  context: { readonly t: Translate; readonly deps: SubmitDeps },
): Promise<number> {
  const { t, deps } = context;
  // With --json a script reads the code and its parameters, never translated text.
  const fail = (info: { code: string; params?: Record<string, string | number> }): number => {
    if (options.json) {
      deps.io.out(JSON.stringify({ error: info }, null, 2));
    } else {
      deps.io.err(describeError(t, info));
    }
    return 1;
  };
  const apiKey = (deps.env.KINOSHELF_API_KEY ?? '').trim();
  if (apiKey === '') {
    throw new CliError('submit.no-api-key');
  }
  // A variable set to blank (`KINOSHELF_URL=`) counts as unset.
  const set = (value: string | undefined): string | undefined =>
    value?.trim() === '' ? undefined : value?.trim();
  const base = (
    options.url ??
    set(deps.env.KINOSHELF_URL) ??
    `http://localhost:${set(deps.env.KINOSHELF_PORT) ?? '8484'}`
  ).replace(/\/+$/, '');
  const target = resolve(path);

  let response: Response;
  try {
    response = await (deps.fetch ?? fetch)(`${base}/api/jobs`, {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ path: target, apply: options.apply === true }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    return fail({ code: 'submit.unreachable', params: { url: base } });
  }

  if (!response.ok) {
    const body = (await response.json().catch(() => undefined)) as
      { error?: { code?: string; params?: Record<string, string | number> } } | undefined;
    const code = body?.error?.code;
    return fail(
      code
        ? { code, ...(body.error?.params && { params: body.error.params }) }
        : { code: 'submit.rejected', params: { status: response.status } },
    );
  }

  // A proxy or another service at that address may answer 200 with anything.
  const job = (await response.json().catch(() => undefined)) as { id?: unknown } | undefined;
  if (typeof job?.id !== 'string') {
    return fail({ code: 'submit.not-kinoshelf', params: { url: base } });
  }
  deps.io.out(
    options.json
      ? JSON.stringify(job, null, 2)
      : t('submit.queued', { path: target, id: job.id, url: base }),
  );
  return 0;
}
