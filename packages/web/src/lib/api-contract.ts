// Compile-time only: the types the web writes by hand must accept what the server says it sends
// (`api-schema.d.ts`, generated from the server's schemas). A field that changes or goes missing
// on the server side breaks `svelte-check` here instead of a page at run time. Nothing is
// exported or run.
import type { paths } from './api-schema.js';
import type { Arrival, ArrivalPage, Preview } from './arrivals.js';
import type { Activity, BatchDetail, JobDetail, UndoProgress, UndoReport } from './history.js';
import type { AddressPreview, ImageListing } from './images.js';
import type { PlexPin, PlexServer } from './plex.js';
import type { Settings } from './settings.js';
import type { Library } from './libraries.js';
import type { LogPage } from './logs.js';
import type { ItemDetail, ItemsPage, RunReport, Show, ShowDetail } from './library-items.js';

type Json<R> = R extends { content: { 'application/json': infer B } } ? B : never;
/** The 200 body of `GET path`. */
type Got<P extends keyof paths> = paths[P] extends { get: { responses: { 200: infer R } } }
  ? Json<R>
  : never;

// `never` (a path that is not there, a response without a body) fits anything: refuse it.
/** The body of `POST path` answered with `status`. */
type Posted<P extends keyof paths, S extends number> = paths[P] extends {
  post: { responses: infer R };
}
  ? S extends keyof R
    ? Json<R[S]>
    : never
  : never;

type Fits<Sent, Read> = [Sent] extends [never] ? false : [Sent] extends [Read] ? true : false;
type Expect<T extends true> = T;

export type Contract = [
  Expect<Fits<Got<'/api/arrivals'>, ArrivalPage>>,
  Expect<Fits<Got<'/api/arrivals'>['items'][number], Arrival>>,
  Expect<Fits<Got<'/api/libraries'>[number], Library>>,
  Expect<Fits<Got<'/api/jobs/{id}'>, JobDetail>>,
  Expect<Fits<Got<'/api/settings'>, Settings>>,
  Expect<Fits<Posted<'/api/plex/auth', 200>, PlexPin>>,
  Expect<Fits<Got<'/api/plex/servers'>['servers'][number], PlexServer>>,
  Expect<Fits<Got<'/api/history'>['items'][number], Activity>>,
  Expect<Fits<Got<'/api/libraries/{id}/items'>, ItemsPage>>,
  Expect<Fits<Got<'/api/libraries/{id}/items/{itemId}'>, ItemDetail>>,
  Expect<Fits<Got<'/api/libraries/{id}/shows'>['items'][number], Show>>,
  Expect<Fits<Got<'/api/libraries/{id}/shows/{tmdbId}'>, ShowDetail>>,
  Expect<Fits<Got<'/api/libraries/{id}/items/{itemId}/images'>, ImageListing>>,
  Expect<Fits<Got<'/api/libraries/{id}/shows/{tmdbId}/images'>, ImageListing>>,
  Expect<Fits<Posted<'/api/libraries/{id}/items/{itemId}/images/preview', 200>, AddressPreview>>,
  Expect<Fits<Posted<'/api/libraries/{id}/shows/{tmdbId}/images/preview', 200>, AddressPreview>>,
  Expect<Fits<Got<'/api/logs'>, LogPage>>,
  Expect<Fits<Got<'/api/batches/{id}'>, BatchDetail>>,
  Expect<Fits<Got<'/api/batches/{id}/undo'>['progress'], UndoProgress | null>>,
  Expect<Fits<Posted<'/api/libraries/{id}/execute', 200>, RunReport>>,
  Expect<Fits<Posted<'/api/entries/{id}/preview', 200>, Preview>>,
  Expect<Fits<Posted<'/api/batches/{id}/undo', 200>, UndoReport>>,
];
