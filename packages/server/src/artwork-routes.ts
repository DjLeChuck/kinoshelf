import type { Config, LibraryConfig } from '@kinoshelf/core';
import type { FastifyInstance } from 'fastify';
import { ApiError } from './api-error.js';
import { IMAGE_TYPES, type Artwork, type ImageChoice, type ImageTarget } from './artwork.js';
import type { EventBus } from './events.js';
import type { LibraryItemStore } from './library-items.js';
import { errorSchema } from './schemas.js';

export interface ArtworkRoutesContext {
  readonly config: () => Config;
  readonly artwork: Artwork;
  readonly items: LibraryItemStore;
  readonly events: EventBus;
}

const candidateSchema = {
  type: 'object',
  required: ['path', 'language', 'width', 'height', 'rating', 'votes'],
  properties: {
    path: { type: 'string', description: 'The provider’s path, for `GET /api/images`.' },
    language: { type: 'string', nullable: true, description: 'ISO 639-1; `null`: no text.' },
    width: { type: 'integer' },
    height: { type: 'integer' },
    rating: { type: 'number', nullable: true },
    votes: { type: 'integer' },
  },
} as const;

const perType = (schema: object): object => ({
  type: 'object',
  required: [...IMAGE_TYPES],
  properties: Object.fromEntries(IMAGE_TYPES.map((type) => [type, schema])),
});

const listingSchema = {
  type: 'object',
  required: ['title', 'year', 'folder', 'files', 'current', 'candidates'],
  properties: {
    title: { type: 'string', nullable: true },
    year: { type: 'integer', nullable: true },
    folder: { type: 'string' },
    files: perType({ type: 'string', nullable: true }),
    current: perType({
      type: 'object',
      nullable: true,
      required: ['size', 'modified', 'width', 'height', 'path'],
      properties: {
        size: { type: 'integer' },
        modified: { type: 'integer' },
        width: { type: 'integer', nullable: true },
        height: { type: 'integer', nullable: true },
        path: { type: 'string', nullable: true },
      },
    }),
    candidates: perType({ type: 'array', items: candidateSchema }),
  },
} as const;

const bodySchema = {
  type: 'object',
  required: ['images'],
  additionalProperties: false,
  properties: {
    images: {
      type: 'array',
      minItems: 1,
      maxItems: IMAGE_TYPES.length,
      items: {
        type: 'object',
        required: ['type', 'source', 'value'],
        additionalProperties: false,
        properties: {
          type: { type: 'string', enum: [...IMAGE_TYPES] },
          source: { type: 'string', enum: ['tmdb', 'url'] },
          value: { type: 'string', minLength: 1, maxLength: 2048 },
        },
      },
    },
  },
} as const;

/**
 * The images of a movie, of a show and of an episode: what the provider offers and what is in place, the file
 * in place, and the replacement. Both kinds of page share one handler; only how the work is found
 * differs.
 */
export function registerArtworkRoutes(api: FastifyInstance, ctx: ArtworkRoutesContext): void {
  const { artwork, items, events } = ctx;

  const library = (id: string): LibraryConfig => {
    const found = ctx.config().libraries?.find((candidate) => candidate.id === id);
    if (found?.type === undefined) {
      throw new ApiError(found ? 409 : 404, found ? 'library.not-typed' : 'library.not-found');
    }
    return found;
  };

  const routes = [
    {
      path: '/api/libraries/:id/items/:itemId/images',
      what: 'a movie',
      params: { id: { type: 'string' }, itemId: { type: 'string' } },
      find: (params: Record<string, string>): ImageTarget => {
        const lib = library(params.id ?? '');
        const [item] = items.byItemIds(lib.id, [params.itemId ?? '']);
        if (!item) {
          throw new ApiError(404, 'library.item-not-found');
        }
        return artwork.movie(lib, item);
      },
    },
    {
      path: '/api/libraries/:id/shows/:tmdbId/images',
      what: 'a show',
      params: { id: { type: 'string' }, tmdbId: { type: 'integer' } },
      find: (params: Record<string, string>): ImageTarget =>
        artwork.show(library(params.id ?? ''), Number(params.tmdbId)),
    },
    {
      path: '/api/libraries/:id/shows/:tmdbId/seasons/:season/episodes/:episode/images',
      what: 'an episode (its `thumb`, written for every version)',
      params: {
        id: { type: 'string' },
        tmdbId: { type: 'integer' },
        season: { type: 'integer' },
        episode: { type: 'integer' },
      },
      find: (params: Record<string, string>): ImageTarget =>
        artwork.episode(
          library(params.id ?? ''),
          Number(params.tmdbId),
          Number(params.season),
          Number(params.episode),
        ),
    },
  ];

  for (const route of routes) {
    const params = {
      type: 'object',
      properties: route.params,
    } as const;
    const typeParams = {
      type: 'object',
      properties: { ...route.params, type: { type: 'string', enum: [...IMAGE_TYPES] } },
    } as const;

    api.get<{ Params: Record<string, string> }>(
      route.path,
      {
        schema: {
          summary: `The images of ${route.what}`,
          description:
            'What the provider offers (`candidates`, in the metadata language, then English, then ' +
            'with no text; only those that can be written under the profile’s name) and what is in ' +
            'place (`current`, `null` when the file is missing). `files` is the name the profile ' +
            'writes, `null` when it writes none: that image cannot be changed (409 `image.not-editable` ' +
            'when none can).',
          params,
          response: { 200: listingSchema, 401: errorSchema, 404: errorSchema, 409: errorSchema },
        },
      },
      async (request) => artwork.list(route.find(request.params)),
    );

    api.get<{ Params: Record<string, string> }>(
      `${route.path}/:type/file`,
      {
        schema: {
          summary: `The image in place for ${route.what}`,
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
        const { bytes, format } = await artwork.file(
          route.find(request.params),
          request.params.type as (typeof IMAGE_TYPES)[number],
        );
        return reply
          .header('content-type', format === 'png' ? 'image/png' : 'image/jpeg')
          .header('cache-control', 'private, no-cache')
          .header('x-content-type-options', 'nosniff')
          .send(bytes);
      },
    );

    api.post<{
      Params: Record<string, string>;
      Body: { type: (typeof IMAGE_TYPES)[number]; url: string };
    }>(
      `${route.path}/preview`,
      {
        schema: {
          summary: `Previews an image given by address for ${route.what}`,
          description:
            'Downloads the address as `POST` of the images would (same limits, same refusals, ' +
            'including the format of the file the profile writes for `type`) and answers with ' +
            'what was found, the image as a `data:` address included. Nothing is written or kept.',
          params,
          body: {
            type: 'object',
            required: ['type', 'url'],
            additionalProperties: false,
            properties: {
              type: { type: 'string', enum: [...IMAGE_TYPES] },
              url: { type: 'string', minLength: 1, maxLength: 2048 },
            },
          },
          response: {
            200: {
              type: 'object',
              required: ['format', 'width', 'height', 'size', 'data'],
              properties: {
                format: { type: 'string', enum: ['jpeg', 'png'] },
                width: { type: 'integer' },
                height: { type: 'integer' },
                size: { type: 'integer', description: 'Bytes.' },
                data: { type: 'string' },
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
      async (request) =>
        artwork.preview(route.find(request.params), request.body.type, request.body.url),
    );

    api.post<{ Params: Record<string, string>; Body: { images: ImageChoice[] } }>(
      route.path,
      {
        schema: {
          summary: `Replaces images of ${route.what}`,
          description:
            'Each image is `{ type, source, value }`: `tmdb` with one of the provider’s paths ' +
            '(`candidates`), or `url` with an address. Every image is downloaded before any is ' +
            'written, so a bad one changes nothing. The address must be http or https, a JPEG or a ' +
            'PNG of at most 20 MB, in the format of the file the profile writes, and not on the ' +
            'local network unless the settings allow it (422 `image.url-*`). The file in place is ' +
            'kept and the batch can be undone from the history.',
          params,
          body: bodySchema,
          response: {
            200: {
              type: 'object',
              required: ['batchId'],
              properties: { batchId: { type: 'string' } },
            },
            400: errorSchema,
            401: errorSchema,
            404: errorSchema,
            409: errorSchema,
            422: errorSchema,
            502: errorSchema,
          },
        },
      },
      async (request) => {
        const batchId = await artwork.apply(route.find(request.params), request.body.images);
        events.emit('history');
        return { batchId };
      },
    );
  }
}
