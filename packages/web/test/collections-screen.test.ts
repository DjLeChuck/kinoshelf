import { createTranslator } from '@kinoshelf/i18n';
import { describe, expect, it } from 'vitest';
import {
  canSend,
  collectionImageUrl,
  collectionsViewUrl,
  completenessOf,
  filterCounts,
  isIncomplete,
  matchesFilter,
  sendSummary,
  serverStatus,
  serversToSend,
  viewOf,
  type CollectionCard,
  type ServerState,
  type SyncState,
} from '../src/lib/collections.js';

const state = (value: SyncState, over: Partial<ServerState> = {}): ServerState => ({
  state: value,
  at: null,
  message: null,
  ...over,
});

const card = (over: Partial<CollectionCard> = {}): CollectionCard => ({
  key: 'tmdb:1',
  name: 'Dragons - Saga',
  custom: false,
  tmdbId: 1,
  held: 2,
  total: 3,
  films: [],
  images: { poster: null, fanart: null },
  servers: [
    { kind: 'plex', states: { poster: state('default'), fanart: state('default') } },
    { kind: 'jellyfin', states: { poster: state('default'), fanart: state('default') } },
  ],
  status: 'default',
  ...over,
});

const pendingOn = (...kinds: ('plex' | 'jellyfin')[]): CollectionCard['servers'] =>
  (['plex', 'jellyfin'] as const).map((kind) => ({
    kind,
    states: {
      poster: state(kinds.includes(kind) ? 'pending' : 'sent'),
      fanart: state('default'),
    },
  }));

describe('the pill of completeness', () => {
  it('is green when the library holds the whole collection, orange when it holds part', () => {
    expect(completenessOf(card({ held: 3, total: 3 }))).toMatchObject({ kind: 'ok', text: '3/3' });
    expect(completenessOf(card({ held: 1, total: 3 }))).toMatchObject({
      kind: 'warn',
      text: '1/3',
    });
  });

  it('is neutral with the count of movies for the owner’s own collection', () => {
    expect(completenessOf(card({ custom: true, total: null, held: 4 }))).toEqual({
      kind: 'neutral',
      custom: true,
      text: '4',
    });
  });
});

describe('the filters above the grid', () => {
  const cards = [
    card({ key: 'tmdb:1', held: 3, total: 3 }),
    card({ key: 'tmdb:2', held: 1, total: 3, status: 'pending' }),
    card({ key: 'custom:marvel', custom: true, total: null, held: 5 }),
  ];

  it('tells an incomplete collection, which only TMDB’s can be', () => {
    expect(isIncomplete(cards[1] as CollectionCard)).toBe(true);
    expect(isIncomplete(cards[0] as CollectionCard)).toBe(false);
    expect(isIncomplete(cards[2] as CollectionCard)).toBe(false);
  });

  it('counts each filter', () => {
    expect(filterCounts(cards)).toEqual({ all: 3, incomplete: 1, custom: 1, pending: 1 });
  });

  it('keeps the cards of a filter', () => {
    const keys = (filter: Parameters<typeof matchesFilter>[1]) =>
      cards.filter((one) => matchesFilter(one, filter)).map((one) => one.key);
    expect(keys('all')).toHaveLength(3);
    expect(keys('incomplete')).toEqual(['tmdb:2']);
    expect(keys('custom')).toEqual(['custom:marvel']);
    expect(keys('pending')).toEqual(['tmdb:2']);
  });
});

describe('what is left to send', () => {
  it('names the servers where an image is pending, or failed last time', () => {
    expect(serversToSend(card({ servers: pendingOn('plex', 'jellyfin') }))).toEqual([
      'plex',
      'jellyfin',
    ]);
    expect(serversToSend(card({ servers: pendingOn('jellyfin') }))).toEqual(['jellyfin']);
    expect(serversToSend(card({ servers: pendingOn() }))).toEqual([]);
    expect(
      serversToSend(
        card({
          servers: [{ kind: 'plex', states: { poster: state('error'), fanart: state('default') } }],
        }),
      ),
    ).toEqual(['plex']);
  });

  it('is nothing to send when every image is sent or not chosen', () => {
    expect(canSend(card({ servers: pendingOn() }))).toBe(false);
    expect(canSend(card({ servers: pendingOn('plex') }))).toBe(true);
  });

  it('can be sent again when a server lacked the collection: it may have created it since', () => {
    const lacking = card({
      servers: [{ kind: 'plex', states: { poster: state('missing'), fanart: state('default') } }],
    });
    expect(canSend(lacking)).toBe(true);
    expect(serversToSend(lacking)).toEqual(['plex']);
  });

  it('shows one state per server: the worst of its poster and background', () => {
    expect(serverStatus({ poster: state('sent'), fanart: state('pending') }).state).toBe('pending');
    expect(
      serverStatus({ poster: state('error', { message: 'HTTP 400' }), fanart: state('sent') }),
    ).toMatchObject({ state: 'error', message: 'HTTP 400' });
    expect(serverStatus({ poster: state('default'), fanart: state('default') }).state).toBe(
      'default',
    );
  });
});

describe('the result of a send', () => {
  const t = createTranslator('fr');
  const failing = (name: string) => ({
    key: name,
    name,
    sent: 0,
    missing: 1,
    failures: [
      {
        server: 'plex' as const,
        type: 'poster' as const,
        error: 'no movie library holds the folder',
      },
    ],
  });

  it('is one line when everything went through', () => {
    expect(sendSummary([{ key: 'a', name: 'A', sent: 2, missing: 0, failures: [] }], t)).toEqual({
      level: 'ok',
      lines: ['2 envois réussis'],
    });
  });

  it('keeps totals apart from causes, each cause once whatever the collections it touched', () => {
    const summary = sendSummary(
      [
        { key: 'a', name: 'A', sent: 1, missing: 0, failures: [] },
        failing('B'),
        failing('C'),
        { ...failing('C'), failures: [...failing('C').failures, ...failing('C').failures] },
      ],
      t,
    );
    expect(summary.level).toBe('danger');
    expect(summary.lines).toEqual([
      '1 envoi réussi · 3 collections pas encore créées sur un serveur (l’image partira dès qu’elle le sera) · 3 collections en échec',
      'Plex : no movie library holds the folder (2 collections)',
    ]);
  });

  it('is a warning when collections only wait for a server', () => {
    const waiting = { key: 'a', name: 'A', sent: 0, missing: 1, failures: [] };
    expect(sendSummary([waiting], t).level).toBe('warn');
  });
});

describe('the address of the screen', () => {
  it('reads the view from the URL, films by default', () => {
    expect(viewOf('collections')).toBe('collections');
    expect(viewOf(null)).toBe('films');
    expect(viewOf('autre')).toBe('films');
  });

  it('opens on a collection when given its key, custom ones included', () => {
    expect(collectionsViewUrl('films')).toBe('/libraries/films?vue=collections');
    expect(collectionsViewUrl('films', 'tmdb:603')).toBe(
      '/libraries/films?vue=collections&collection=tmdb%3A603',
    );
    expect(collectionsViewUrl('films', 'custom:univers marvel')).toBe(
      '/libraries/films?vue=collections&collection=custom%3Aunivers%20marvel',
    );
  });

  it('serves the image chosen, a new hash making a browser ask again', () => {
    expect(collectionImageUrl('films', 'tmdb:603', 'poster', 'abcdef0123456789')).toBe(
      '/api/libraries/films/collections/tmdb%3A603/images/poster/file?v=abcdef012345',
    );
  });
});
