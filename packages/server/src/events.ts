import type { FastifyInstance } from 'fastify';
import { ApiError } from './api-error.js';

/**
 * What changed, not how: a client refetches the view it shows. Payloads would duplicate the REST
 * shapes and drift from them, and a missed event costs one refetch.
 */
export type EventTopic =
  'jobs' | 'progress' | 'arrivals' | 'history' | 'settings' | 'logs' | 'tmdb';

export type EventListener = (topic: EventTopic) => void;

/** In-process fan-out from the places that write to the clients that watch. */
export class EventBus {
  private readonly listeners = new Set<EventListener>();

  emit(...topics: EventTopic[]): void {
    for (const listener of [...this.listeners]) {
      for (const topic of topics) {
        listener(topic);
      }
    }
  }

  subscribe(listener: EventListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}

/** A comment line keeps proxies from closing an idle stream (they often cut at 30 to 60 s). */
const HEARTBEAT_MS = 20_000;

/**
 * Open streams at most: far more than the tabs of a household, few enough that a script opening
 * streams in a loop cannot exhaust the server's sockets and memory.
 */
const MAX_STREAMS = 64;

/**
 * `GET /api/events`: Server-Sent Events. The browser reconnects by itself, and refetches on each
 * `open`, so nothing missed while disconnected is lost.
 */
export function registerEventRoutes(
  api: FastifyInstance,
  bus: EventBus,
  heartbeatMs = HEARTBEAT_MS,
): () => void {
  const open = new Set<() => void>();
  api.get(
    '/api/events',
    {
      schema: {
        summary: 'Stream of changes (Server-Sent Events)',
        description:
          'Each event is named after what changed (`jobs`, `progress`, `arrivals`, `history`, `settings`, `logs`, `tmdb`) ' +
          'and carries no data: refetch the matching list. `progress` is only where a running analysis ' +
          'is (`GET /api/jobs/{id}`), at most twice a second; `jobs` is a job queued, started or ended; `logs` is lines written, at most twice a second; `tmdb` is TMDB counts written, every few seconds at most. ' +
          'A `ready` event opens the stream.',
        response: {
          200: { type: 'string', description: 'text/event-stream' },
          503: { description: '`events.too-many` while 64 streams are open' },
        },
      },
    },
    (request, reply) => {
      if (open.size >= MAX_STREAMS) {
        // The web asks again later on its own (see `Stream`).
        throw new ApiError(503, 'events.too-many');
      }
      void reply.hijack();
      const { raw } = reply;
      raw.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
        // nginx buffers responses by default, which would hold every event back.
        'x-accel-buffering': 'no',
      });
      raw.write('retry: 3000\nevent: ready\ndata: {}\n\n');

      const unsubscribe = bus.subscribe((topic) => {
        raw.write(`event: ${topic}\ndata: {}\n\n`);
      });
      const timer = setInterval(() => raw.write(': keep-alive\n\n'), heartbeatMs);
      const close = (): void => {
        clearInterval(timer);
        unsubscribe();
        open.delete(close);
        if (!raw.writableEnded) {
          raw.end();
        }
      };
      open.add(close);
      request.raw.on('close', close);
    },
  );

  // An open stream would keep the server from closing: the caller ends them in a `preClose` hook
  // (`onClose` only runs once the connections are gone).
  return () => {
    for (const close of [...open]) {
      close();
    }
  };
}
