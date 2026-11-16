import type { Config, LibraryConfig } from '@kinoshelf/core';
import type { FastifyInstance } from 'fastify';
import { ApiError } from './api-error.js';
import { COLLECTION_IMAGE_TYPES } from './collection-images.js';
import type { CollectionScreen } from './collection-screen.js';
import type { SendTask, SendTasks } from './collection-tasks.js';
import type { EventBus } from './events.js';
import { errorInfo, errorSchema } from './schemas.js';

export interface CollectionRoutesContext {
  readonly config: () => Config;
  readonly screen: CollectionScreen;
  readonly sends: SendTasks;
  readonly events: EventBus;
}

const storedImageSchema = {
  type: 'object',
  nullable: true,
  required: ['type', 'format', 'hash', 'source', 'chosenAt'],
  properties: {
    type: { type: 'string', enum: [...COLLECTION_IMAGE_TYPES] },
    format: { type: 'string', enum: ['jpeg', 'png'] },
    hash: { type: 'string', description: 'SHA-256 of the image.' },
    source: {
      type: 'object',
      required: ['type', 'url', 'language', 'label'],
      properties: {
        type: { type: 'string', enum: ['tmdb', 'film', 'url'] },
        url: { type: 'string', nullable: true },
        language: { type: 'string', nullable: true },
        label: { type: 'string', nullable: true, description: 'The movie’s title for `film`.' },
      },
    },
    chosenAt: { type: 'string' },
  },
} as const;

const serverStateSchema = {
  type: 'object',
  required: ['state', 'at', 'message'],
  properties: {
    state: { type: 'string', enum: ['default', 'pending', 'sent', 'missing', 'error'] },
    at: { type: 'string', nullable: true },
    message: { type: 'string', nullable: true },
  },
} as const;

const perType = (schema: object): object => ({
  type: 'object',
  required: [...COLLECTION_IMAGE_TYPES],
  properties: Object.fromEntries(COLLECTION_IMAGE_TYPES.map((type) => [type, schema])),
});

const listSchema = {
  type: 'object',
  required: ['servers', 'pending', 'collections'],
  properties: {
    servers: { type: 'array', items: { type: 'string', enum: ['plex', 'jellyfin'] } },
    pending: { type: 'integer', description: 'Collections with an image to send.' },
    collections: {
      type: 'array',
      items: {
        type: 'object',
        required: [
          'key',
          'name',
          'custom',
          'tmdbId',
          'held',
          'total',
          'films',
          'images',
          'tmdbImages',
          'servers',
          'status',
        ],
        properties: {
          key: { type: 'string', description: '`tmdb:<id>` or `custom:<normalized name>`.' },
          name: { type: 'string' },
          custom: { type: 'boolean' },
          tmdbId: { type: 'integer', nullable: true },
          held: { type: 'integer', description: 'Movies of it the library holds.' },
          total: { type: 'integer', nullable: true, description: 'Movies TMDB lists.' },
          films: {
            type: 'array',
            items: {
              type: 'object',
              required: ['tmdbId', 'title', 'year', 'present', 'itemId'],
              properties: {
                tmdbId: { type: 'integer', nullable: true },
                title: { type: 'string' },
                year: { type: 'integer', nullable: true },
                present: { type: 'boolean' },
                itemId: { type: 'string', nullable: true },
              },
            },
          },
          images: perType(storedImageSchema),
          tmdbImages: {
            type: 'object',
            required: ['poster', 'fanart'],
            properties: {
              poster: { type: 'string', nullable: true },
              fanart: { type: 'string', nullable: true },
            },
          },
          servers: {
            type: 'array',
            description: 'Only the servers that are set up.',
            items: {
              type: 'object',
              required: ['kind', 'states'],
              properties: {
                kind: { type: 'string', enum: ['plex', 'jellyfin'] },
                states: perType(serverStateSchema),
              },
            },
          },
          status: {
            type: 'string',
            enum: ['pending', 'error', 'missing', 'sent', 'chosen', 'default'],
          },
        },
      },
    },
  },
} as const;

const candidateSchema = {
  type: 'object',
  required: ['path', 'language', 'width', 'height', 'rating', 'votes'],
  properties: {
    path: { type: 'string' },
    language: { type: 'string', nullable: true },
    width: { type: 'integer' },
    height: { type: 'integer' },
    rating: { type: 'number', nullable: true },
    votes: { type: 'integer' },
  },
} as const;

const listingSchema = {
  type: 'object',
  required: ['tmdb', 'films'],
  properties: {
    tmdb: { ...perType({ type: 'array', items: candidateSchema }), nullable: true },
    films: {
      type: 'array',
      items: {
        type: 'object',
        required: ['itemId', 'title', 'year', 'poster', 'fanart'],
        properties: {
          itemId: { type: 'string' },
          title: { type: 'string' },
          year: { type: 'integer', nullable: true },
          poster: { type: 'boolean' },
          fanart: { type: 'boolean' },
        },
      },
    },
  },
} as const;

const sendTaskSchema = {
  type: 'object',
  required: ['status', 'done', 'total', 'current', 'outcomes', 'error'],
  properties: {
    status: { type: 'string', enum: ['running', 'done', 'failed'] },
    done: { type: 'integer' },
    total: { type: 'integer' },
    current: { type: 'string', nullable: true },
    outcomes: {
      type: 'array',
      items: {
        type: 'object',
        required: ['key', 'name', 'sent', 'missing', 'failures'],
        properties: {
          key: { type: 'string' },
          name: { type: 'string' },
          sent: { type: 'integer' },
          missing: { type: 'integer' },
          failures: {
            type: 'array',
            items: {
              type: 'object',
              required: ['server', 'type', 'error'],
              properties: {
                server: { type: 'string', enum: ['plex', 'jellyfin'] },
                type: { type: 'string', enum: [...COLLECTION_IMAGE_TYPES] },
                error: { type: 'string' },
              },
            },
          },
        },
      },
    },
    error: { ...errorInfo, nullable: true },
  },
} as const;

const params = {
  type: 'object',
  properties: { id: { type: 'string' }, key: { type: 'string' } },
} as const;
const typeParams = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    key: { type: 'string' },
    type: { type: 'string', enum: [...COLLECTION_IMAGE_TYPES] },
  },
} as const;

const presentTask = (task: SendTask) => ({ ...task });

/**
 * The Collections screen of a movie library: the collections as they stand, the image chosen for
 * each, what the media servers hold, and the send to them (a background task, like an undo).
 */
export function registerCollectionRoutes(api: FastifyInstance, ctx: CollectionRoutesContext): void {
  const { screen, sends, events } = ctx;

  const library = (id: string): LibraryConfig => {
    const found = ctx.config().libraries?.find((candidate) => candidate.id === id);
    if (found?.type === undefined) {
      throw new ApiError(found ? 409 : 404, found ? 'library.not-typed' : 'library.not-found');
    }
    return found;
  };

  api.get<{ Params: { id: string } }>(
    '/api/libraries/:id/collections',
    {
      schema: {
        summary: 'The collections of a movie library, with their images and where they stand',
        description:
          'The effective collections (the owner’s choices taken in): TMDB’s `tmdb:<id>` and the ' +
          'owner’s own `custom:<name>`, each with the movies it holds and TMDB lists, the image chosen ' +
          'for its poster and background, and for each media server that is set up the state of ' +
          'each image: `default` (nothing chosen), `pending` (to send, or changed since), `sent`, ' +
          '`missing` (the server has no such collection yet) or `error`. 409 ' +
          '`library.no-collections` for a library that writes no NFO.',
        params,
        response: { 200: listSchema, 401: errorSchema, 404: errorSchema, 409: errorSchema },
      },
    },
    (request) => screen.list(library(request.params.id)),
  );

  api.get<{ Params: { id: string; key: string } }>(
    '/api/libraries/:id/collections/:key/images',
    {
      schema: {
        summary: 'The images one can choose from for a collection',
        description:
          'TMDB’s posters and backgrounds in every language (`null` for the owner’s own collection, ' +
          'which TMDB does not know) and the poster and background in place for each movie of it ' +
          'the library holds.',
        params,
        response: {
          200: listingSchema,
          401: errorSchema,
          404: errorSchema,
          409: errorSchema,
        },
      },
    },
    (request) => screen.listing(library(request.params.id), request.params.key),
  );

  api.get<{ Params: { id: string; key: string; type: 'poster' | 'fanart' } }>(
    '/api/libraries/:id/collections/:key/images/:type/file',
    {
      schema: {
        summary: 'The image chosen for a collection',
        params: typeParams,
        response: {
          200: { type: 'string', format: 'binary' },
          401: errorSchema,
          404: errorSchema,
          409: errorSchema,
        },
      },
    },
    async (request, reply) => {
      const { bytes, format } = await screen.file(
        library(request.params.id),
        request.params.key,
        request.params.type,
      );
      return reply
        .header('content-type', format === 'png' ? 'image/png' : 'image/jpeg')
        .header('cache-control', 'private, no-cache')
        .header('x-content-type-options', 'nosniff')
        .send(bytes);
    },
  );

  api.put<{
    Params: { id: string; key: string; type: 'poster' | 'fanart' };
    Body: { source: 'tmdb' | 'film' | 'url'; value: string };
  }>(
    '/api/libraries/:id/collections/:key/images/:type',
    {
      schema: {
        summary: 'Chooses the image of a collection',
        description:
          '`source` `tmdb` with one of the provider’s paths (`GET …/images`), `film` with the ' +
          '`itemId` of one of the collection’s movies (its own image), or `url` with an address ' +
          '(fetched by the server under the same limits as a movie’s image). The image is downloaded ' +
          'and kept in Kinoshelf’s data; every server where it was sent becomes `pending`. Nothing ' +
          'is sent to a server here.',
        params: typeParams,
        body: {
          type: 'object',
          required: ['source', 'value'],
          additionalProperties: false,
          properties: {
            source: { type: 'string', enum: ['tmdb', 'film', 'url'] },
            value: { type: 'string', minLength: 1, maxLength: 2048 },
          },
        },
        response: {
          204: { type: 'null' },
          401: errorSchema,
          404: errorSchema,
          409: errorSchema,
          422: errorSchema,
          502: errorSchema,
        },
      },
    },
    async (request, reply) => {
      await screen.choose(library(request.params.id), request.params.key, request.params.type, {
        source: request.body.source,
        value: request.body.value,
      });
      events.emit('jobs');
      return reply.code(204).send();
    },
  );

  api.delete<{ Params: { id: string; key: string; type: 'poster' | 'fanart' } }>(
    '/api/libraries/:id/collections/:key/images/:type',
    {
      schema: {
        summary: 'Drops the choice made for a collection’s image',
        description:
          'Back to no choice. The server keeps the last image it was sent: Kinoshelf cannot take it back.',
        params: typeParams,
        response: { 204: { type: 'null' }, 401: errorSchema, 404: errorSchema, 409: errorSchema },
      },
    },
    async (request, reply) => {
      await screen.unchoose(library(request.params.id), request.params.key, request.params.type);
      events.emit('jobs');
      return reply.code(204).send();
    },
  );

  api.post<{ Params: { id: string }; Body: { keys?: string[] } }>(
    '/api/libraries/:id/collections/send',
    {
      schema: {
        summary: 'Sends the images chosen for collections to the media servers',
        description:
          'Starts the send and answers 202 at once; `GET` of the same path follows it (the ' +
          '`progress` event announces each step). Sends what is `pending`, `missing` or `error` for ' +
          'the collections named in `keys`, or all of them. A collection a server does not have yet ' +
          'becomes `missing` and is sent when the server creates it. 409 `collection.send-in-progress`.',
        params,
        body: {
          type: 'object',
          additionalProperties: false,
          properties: {
            keys: { type: 'array', minItems: 1, maxItems: 5000, items: { type: 'string' } },
          },
        },
        response: { 202: sendTaskSchema, 401: errorSchema, 404: errorSchema, 409: errorSchema },
      },
    },
    (request, reply) => {
      const lib = library(request.params.id);
      if (sends.isRunning(lib.id)) {
        throw new ApiError(409, 'collection.send-in-progress');
      }
      // Checked before the answer: a library with no collections is a 409, not a failed task.
      screen.list(lib);
      const task = sends.start(lib.id, (onProgress) =>
        screen.send(lib, request.body.keys, onProgress),
      );
      return reply.code(202).send(presentTask(task));
    },
  );

  api.get<{ Params: { id: string } }>(
    '/api/libraries/:id/collections/send',
    {
      schema: {
        summary: 'The latest send of collection images',
        params,
        response: {
          200: {
            type: 'object',
            required: ['send'],
            properties: { send: { ...sendTaskSchema, nullable: true } },
          },
          401: errorSchema,
          404: errorSchema,
        },
      },
    },
    (request) => {
      const lib = library(request.params.id);
      const task = sends.of(lib.id);
      return { send: task ? presentTask(task) : null };
    },
  );

  api.post<{ Params: { id: string; key: string }; Body: { name: string; dryRun?: boolean } }>(
    '/api/libraries/:id/collections/:key/rename',
    {
      schema: {
        summary: 'Renames an owner’s own collection on all its movies',
        description:
          'Changes the name of the override of every movie of a `custom:` collection and writes their ' +
          'NFO again (one per version in a multi-version movie), keeping the image chosen. `dryRun` ' +
          'only counts the NFO. 409 `collection.not-custom` for a collection of TMDB’s.',
        params,
        body: {
          type: 'object',
          required: ['name'],
          additionalProperties: false,
          properties: {
            name: { type: 'string', minLength: 1, maxLength: 200 },
            dryRun: { type: 'boolean' },
          },
        },
        response: {
          200: {
            type: 'object',
            required: ['key', 'movies', 'rewritten', 'unchanged', 'kept', 'missing', 'batchId'],
            properties: {
              key: { type: 'string', description: 'The collection’s key under its new name.' },
              movies: { type: 'integer' },
              rewritten: {
                type: 'integer',
                description: 'NFO written (or to write, for a dry run).',
              },
              unchanged: { type: 'integer' },
              kept: { type: 'integer', description: 'NFO edited since: left as they are.' },
              missing: { type: 'integer' },
              batchId: { type: 'string', nullable: true },
            },
          },
          401: errorSchema,
          404: errorSchema,
          409: errorSchema,
          422: errorSchema,
          502: errorSchema,
        },
      },
    },
    async (request) => {
      const result = await screen.rename(
        library(request.params.id),
        request.params.key,
        request.body.name,
        request.body.dryRun ?? false,
      );
      if (result.batchId !== null) {
        events.emit('history');
      }
      events.emit('jobs');
      return result;
    },
  );
}
