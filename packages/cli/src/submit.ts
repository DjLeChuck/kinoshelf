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
  const apiKey = (deps.env.KINOSHELF_API_KEY ?? '').trim();
  if (apiKey === '') {
    throw new CliError('submit.no-api-key');
  }
  const base = (
    options.url ??
    deps.env.KINOSHELF_URL ??
    `http://localhost:${deps.env.KINOSHELF_PORT ?? '8484'}`
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
    deps.io.err(describeError(t, { code: 'submit.unreachable', params: { url: base } }));
    return 1;
  }

  if (!response.ok) {
    const body = (await response.json().catch(() => undefined)) as
      { error?: { code?: string; params?: Record<string, string | number> } } | undefined;
    const code = body?.error?.code;
    deps.io.err(
      code
        ? describeError(t, { code, params: body.error?.params })
        : describeError(t, { code: 'submit.rejected', params: { status: response.status } }),
    );
    return 1;
  }

  const job = (await response.json()) as { id: string };
  deps.io.out(
    options.json
      ? JSON.stringify(job, null, 2)
      : t('submit.queued', { path: target, id: job.id, url: base }),
  );
  return 0;
}
