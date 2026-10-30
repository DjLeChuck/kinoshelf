import { KinoshelfError } from '../errors.js';

/** Artwork is a few megabytes at most; anything bigger is not what we asked for. */
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const TIMEOUT_MS = 30_000;

/** Fetches an image's bytes. Injected in tests; `fetchImage` is the default. */
export type ImageFetcher = (url: string) => Promise<Uint8Array>;

/**
 * Downloads an image with the global `fetch`: redirects followed, a 2xx and an `image/*`
 * content type required, a body over {@link MAX_IMAGE_BYTES} refused (read as a stream, so an
 * endless body is cut instead of filling the memory). `credentials: 'omit'` and no headers of ours:
 * a URL from a provider must never receive a key.
 */
export const fetchImage: ImageFetcher = async (url) => {
  let response: Response;
  try {
    response = await fetch(url, {
      redirect: 'follow',
      credentials: 'omit',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    const timedOut = error instanceof Error && error.name === 'TimeoutError';
    throw new KinoshelfError('execute.download-failed', {
      url,
      status: timedOut ? 'timeout' : 'network',
    });
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new KinoshelfError('execute.download-failed', { url, status: response.status });
  }
  const type = response.headers.get('content-type') ?? '';
  if (!/^\s*image\//i.test(type)) {
    await response.body?.cancel().catch(() => undefined);
    throw new KinoshelfError('execute.download-not-image', { url, type: type || 'unknown' });
  }
  const tooLarge = (): KinoshelfError =>
    new KinoshelfError('execute.download-too-large', { url, max: MAX_IMAGE_BYTES });
  const declared = Number(response.headers.get('content-length'));
  if (declared > MAX_IMAGE_BYTES) {
    await response.body?.cancel().catch(() => undefined);
    throw tooLarge();
  }

  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for await (const chunk of (response.body ?? []) as AsyncIterable<Uint8Array>) {
      size += chunk.length;
      if (size > MAX_IMAGE_BYTES) {
        throw tooLarge();
      }
      chunks.push(chunk);
    }
  } catch (error) {
    if (error instanceof KinoshelfError) {
      throw error;
    }
    throw new KinoshelfError('execute.download-failed', { url, status: 'network' });
  }
  return Buffer.concat(chunks);
};
