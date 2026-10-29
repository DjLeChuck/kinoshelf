import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { ApiError } from './api-error.js';
import { errorSchema } from './schemas.js';

const TMDB_IMAGES = 'https://image.tmdb.org/t/p';

/** The widths the UI asks for; anything else would let a client fill the disk with variants. */
export const IMAGE_SIZES = ['w92', 'w154', 'w342'] as const;

/** TMDB's file names are a hash and an extension. Nothing else may reach the path or the URL. */
const FILE = /^[A-Za-z0-9]{1,64}\.(jpg|png)$/;

const MAX_BYTES = 2_000_000;
const TIMEOUT_MS = 10_000;

const TYPES = { jpg: 'image/jpeg', png: 'image/png' } as const;

export interface ImageOptions {
  /** Where fetched images are kept; disposable, like the TMDB cache. */
  readonly cacheDir: string;
  /** Replaces the network, for tests. */
  readonly fetch?: typeof fetch;
}

/**
 * Serves TMDB posters through the server, so the browser never contacts TMDB (its address and
 * what it browses stay private) and an image is downloaded once.
 */
export function registerImageRoutes(api: FastifyInstance, options: ImageOptions): void {
  const get = options.fetch ?? fetch;

  const download = async (size: string, file: string): Promise<Uint8Array> => {
    let response: Response;
    try {
      response = await get(`${TMDB_IMAGES}/${size}/${file}`, {
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      throw new ApiError(502, 'image.unavailable');
    }
    if (response.status === 404) {
      throw new ApiError(404, 'image.not-found');
    }
    const bytes = response.ok ? new Uint8Array(await response.arrayBuffer()) : undefined;
    if (!bytes || bytes.length === 0 || bytes.length > MAX_BYTES) {
      throw new ApiError(502, 'image.unavailable');
    }
    return bytes;
  };

  api.get<{ Params: { size: (typeof IMAGE_SIZES)[number]; file: string } }>(
    '/api/images/:size/:file',
    {
      schema: {
        summary: 'A TMDB poster, fetched once and kept',
        description:
          '`file` is a candidate’s `posterPath` without its leading slash. The browser never ' +
          'contacts TMDB.',
        params: {
          type: 'object',
          required: ['size', 'file'],
          properties: {
            size: { type: 'string', enum: IMAGE_SIZES },
            file: { type: 'string' },
          },
        },
        response: { 200: { type: 'string', format: 'binary' }, 404: errorSchema, 502: errorSchema },
      },
    },
    async (request, reply) => {
      const { size, file } = request.params;
      const extension = /\.(jpg|png)$/.exec(file)?.[1] as keyof typeof TYPES | undefined;
      if (!FILE.test(file) || !extension) {
        throw new ApiError(404, 'image.not-found');
      }
      const path = join(options.cacheDir, size, file);
      let bytes: Uint8Array | undefined = await readFile(path).catch(() => undefined);
      if (!bytes) {
        bytes = await download(size, file);
        // Written under a temporary name: a reader never sees half an image.
        const partial = `${path}.${process.pid}.tmp`;
        await mkdir(dirname(path), { recursive: true });
        await writeFile(partial, bytes);
        await rename(partial, path);
      }
      return reply
        .header('content-type', TYPES[extension])
        .header('cache-control', 'private, max-age=604800, immutable')
        .header('x-content-type-options', 'nosniff')
        .send(bytes);
    },
  );
}
