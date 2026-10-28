import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import fastifyStatic from '@fastify/static';
import type { FastifyInstance, FastifyReply } from 'fastify';

/**
 * Where the built web UI is: `KINOSHELF_WEB_DIR`, else the `@kinoshelf/web` package the Docker
 * image ships beside the server, else the sibling package of a checkout. `undefined` means the
 * server only has its API, which is a normal way to run it.
 */
export function findWebRoot(env: Readonly<Record<string, string | undefined>>): string | undefined {
  const candidates = [
    env.KINOSHELF_WEB_DIR,
    (() => {
      try {
        const manifest = createRequire(import.meta.url).resolve('@kinoshelf/web/package.json');
        return join(dirname(manifest), 'dist');
      } catch {
        return undefined;
      }
    })(),
    join(dirname(fileURLToPath(import.meta.url)), '../../web/dist'),
  ];
  return candidates.find(
    (path): path is string => path !== undefined && existsSync(join(path, 'index.html')),
  );
}

/** Hashed build output never changes under its name; the page that names it must be refetched. */
const IMMUTABLE = 'public, max-age=31536000, immutable';

/**
 * Serves the UI and its single-page fallback. Only a path that looks like a page falls back to
 * `index.html`: a missing script or image answers 404, not a page the browser would try to run.
 * `/api` keeps answering JSON errors, so a client never mistakes a wrong URL for the UI.
 */
export async function registerWeb(app: FastifyInstance, root: string): Promise<void> {
  await app.register(fastifyStatic, {
    root,
    wildcard: false,
    index: false,
    // Everything it serves is public; the API is behind the key and the session.
    setHeaders: (response, path) => {
      response.header('x-content-type-options', 'nosniff');
      response.header('cache-control', path.includes('/assets/') ? IMMUTABLE : 'no-cache');
    },
  });

  const page = async (reply: FastifyReply) =>
    reply
      .header('x-frame-options', 'DENY')
      .header('referrer-policy', 'same-origin')
      .sendFile('index.html');

  app.get('/', (_request, reply) => page(reply));

  app.setNotFoundHandler((request, reply) => {
    const { pathname } = new URL(request.url, 'http://localhost');
    const isPage =
      request.method === 'GET' &&
      !pathname.startsWith('/api/') &&
      pathname !== '/health' &&
      extname(pathname) === '';
    if (isPage) {
      return page(reply);
    }
    return reply.code(404).send({ error: { code: 'request.not-found' } });
  });
}
