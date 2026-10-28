import { existsSync, readFileSync } from 'node:fs';

const fixtureUrl = (name: string): URL => new URL(`./fixtures/${name}`, import.meta.url);

export const hasFixture = (name: string): boolean => existsSync(fixtureUrl(name));

export function fixture(name: string): string {
  return readFileSync(fixtureUrl(name), 'utf8');
}

export function fixtureJson(name: string): unknown {
  return JSON.parse(fixture(name));
}

export interface RecordedRequest {
  readonly url: URL;
  readonly headers: Headers;
}

export type Route = (url: URL) => Response | undefined;

/** A fetch double: routes by URL, records every request. Unrouted URLs answer 500. */
export function fakeFetch(routes: readonly Route[]) {
  const requests: RecordedRequest[] = [];
  const impl: typeof fetch = (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input);
    requests.push({ url, headers: new Headers(init?.headers) });
    for (const route of routes) {
      const response = route(url);
      if (response) {
        return Promise.resolve(response);
      }
    }
    return Promise.resolve(new Response('unrouted', { status: 500 }));
  };
  return { fetch: impl, requests };
}

export const json = (body: string, status = 200): Response =>
  new Response(body, { status, headers: { 'content-type': 'application/json' } });

export const at = (pathname: string, respond: () => Response): Route => {
  return (url) => (url.pathname === pathname ? respond() : undefined);
};

/** Answers with `<prefix>-<id>.json` when recorded, 404 otherwise (as TMDB does). */
const byId = (pattern: RegExp, prefix: string): Route => {
  return (url) => {
    const id = pattern.exec(url.pathname)?.[1];
    if (id === undefined) {
      return undefined;
    }
    const name = `${prefix}-${id}.json`;
    return hasFixture(name) ? json(fixture(name)) : json('{"success":false,"status_code":34}', 404);
  };
};

/** Routes serving the recorded fixtures. */
export const tmdbRoutes: Route[] = [
  at('/3/search/movie', () => json(fixture('search-movie-dune-2021.json'))),
  byId(/^\/3\/movie\/(\d+)\/alternative_titles$/, 'alt-titles-movie'),
  at('/3/search/tv', () => json(fixture('search-tv-the-bear-2022.json'))),
  byId(/^\/3\/tv\/(\d+)\/alternative_titles$/, 'alt-titles-tv'),
  at('/3/tv/136315/season/3', () => json(fixture('season-136315-3.json'))),
  at('/3/tv/136315/season/99', () => json(fixture('season-136315-99.json'), 404)),
];
