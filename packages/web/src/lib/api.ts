/** An error answered by the API (`{ error: { code, params } }`), or the lack of any answer. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly params: Record<string, string | number> = {},
  ) {
    super(code);
  }
}

/** The code of a request that never got an answer (server down, offline). */
export const NETWORK_ERROR = 'network';

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

let onUnauthorized: () => void = () => undefined;

/** Called when the API refuses the session, so the UI can go back to the sign-in page. */
export function setUnauthorizedHandler(handler: () => void): void {
  onUnauthorized = handler;
}

interface ErrorBody {
  error?: { code?: string; params?: Record<string, string | number> };
}

/**
 * One JSON request. The session is an HttpOnly cookie, so there is nothing to attach: the browser
 * sends it. `fetcher` is injectable for tests.
 */
export async function request<T>(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  url: string,
  body?: unknown,
  fetcher: Fetch = (input, init) => fetch(input, init),
): Promise<T> {
  let response: Response;
  try {
    response = await fetcher(url, {
      method,
      credentials: 'same-origin',
      headers: {
        accept: 'application/json',
        ...(body !== undefined && { 'content-type': 'application/json' }),
      },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    });
  } catch {
    throw new ApiError(0, NETWORK_ERROR);
  }

  if (response.status === 204) {
    return undefined as T;
  }
  const text = await response.text();
  let parsed: unknown;
  try {
    parsed = text === '' ? undefined : JSON.parse(text);
  } catch {
    throw new ApiError(response.status, 'request.rejected', { detail: `HTTP ${response.status}` });
  }
  if (!response.ok) {
    const { error } = (parsed ?? {}) as ErrorBody;
    // A reply without our error envelope (a proxy with no upstream, say) still has to fill `{detail}`.
    const failure = error?.code
      ? new ApiError(response.status, error.code, error.params)
      : new ApiError(response.status, 'request.rejected', { detail: `HTTP ${response.status}` });
    // Signing in is the one request allowed to answer 401 without ending a session.
    if (response.status === 401 && url !== '/api/session') {
      onUnauthorized();
    }
    throw failure;
  }
  return parsed as T;
}

export const api = {
  get: <T>(url: string) => request<T>('GET', url),
  post: <T>(url: string, body?: unknown) => request<T>('POST', url, body),
  patch: <T>(url: string, body?: unknown) => request<T>('PATCH', url, body),
  delete: <T>(url: string) => request<T>('DELETE', url),
};
