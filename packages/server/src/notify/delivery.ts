import { redactUrl } from './paths.js';
import type { HttpRequest } from './formats.js';

export interface DeliveryOptions {
  readonly fetch?: typeof fetch;
  /** Replaced in tests, which must not wait. */
  readonly sleep?: (ms: number) => Promise<void>;
  readonly timeoutMs?: number;
  /** Waits between attempts: as many retries as there are delays. */
  readonly delays?: readonly number[];
}

export interface DeliveryResult {
  readonly ok: boolean;
  readonly status?: number;
  readonly attempts: number;
  /** What went wrong, never carrying the URL: it may hold a secret. */
  readonly error?: string;
  /** The body of the answer, for the calls that read one. */
  readonly text?: string;
}

const DEFAULT_TIMEOUT_MS = 10_000;
/** Three attempts: a hiccup passes, a service that is down is not hammered. */
const DEFAULT_DELAYS_MS = [1000, 5000];

const sleepFor = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * Node hides the reason under "fetch failed": the system code (`ECONNREFUSED`, `ENOTFOUND`) when
 * there is one, else the message of the innermost cause (`bad port`).
 */
function reasonOf(error: unknown): string {
  let current: unknown = error;
  let message = error instanceof Error ? error.message : String(error);
  for (let depth = 0; depth < 4 && typeof current === 'object' && current !== null; depth++) {
    if ('code' in current && typeof current.code === 'string') {
      return current.code;
    }
    if (current instanceof Error) {
      message = current.message;
    }
    current =
      'cause' in current
        ? current.cause
        : 'errors' in current && Array.isArray(current.errors)
          ? (current.errors as unknown[])[0]
          : undefined;
  }
  return message;
}

function describeFailure(error: unknown, url: string): string {
  if (error instanceof Error && error.name === 'TimeoutError') {
    return 'timeout';
  }
  return reasonOf(error).split(url).join(redactUrl(url));
}

/**
 * Sends a request and tries again when the other end may recover: no answer, a timeout, a 5xx or
 * a 429. Any other answer is final, and a 4xx is a configuration error that waiting cannot fix.
 */
export async function deliver(
  request: HttpRequest,
  options: DeliveryOptions = {},
): Promise<DeliveryResult> {
  const send = options.fetch ?? fetch;
  const sleep = options.sleep ?? sleepFor;
  const delays = options.delays ?? DEFAULT_DELAYS_MS;

  let last: DeliveryResult = { ok: false, attempts: 0 };
  for (let attempt = 1; attempt <= delays.length + 1; attempt++) {
    try {
      const response = await send(request.url, {
        method: request.method,
        headers: request.headers,
        ...(request.body !== undefined && { body: request.body }),
        signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
      });
      const text = await response.text();
      last = {
        ok: response.ok,
        status: response.status,
        attempts: attempt,
        text,
        ...(!response.ok && { error: `HTTP ${response.status}` }),
      };
      if (response.ok || (response.status < 500 && response.status !== 429)) {
        return last;
      }
    } catch (error) {
      last = { ok: false, attempts: attempt, error: describeFailure(error, request.url) };
    }
    const wait = delays[attempt - 1];
    if (wait !== undefined) {
      await sleep(wait);
    }
  }
  return last;
}
