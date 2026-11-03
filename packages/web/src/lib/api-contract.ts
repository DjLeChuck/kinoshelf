// Compile-time only: the types the web writes by hand must accept what the server says it sends
// (`api-schema.d.ts`, generated from the server's schemas). A field that changes or goes missing
// on the server side breaks `svelte-check` here instead of a page at run time. Nothing is
// exported or run.
import type { paths } from './api-schema.js';
import type { Arrival, ArrivalPage } from './arrivals.js';
import type { Activity, JobDetail } from './history.js';
import type { Settings } from './settings.js';
import type { Library } from './libraries.js';
import type { ItemDetail, ItemsPage, Show, ShowDetail } from './library-items.js';

type Json<R> = R extends { content: { 'application/json': infer B } } ? B : never;
/** The 200 body of `GET path`. */
type Got<P extends keyof paths> = paths[P] extends { get: { responses: { 200: infer R } } }
  ? Json<R>
  : never;

// `never` (a path that is not there, a response without a body) fits anything: refuse it.
type Fits<Sent, Read> = [Sent] extends [never] ? false : [Sent] extends [Read] ? true : false;
type Expect<T extends true> = T;

export type Contract = [
  Expect<Fits<Got<'/api/arrivals'>, ArrivalPage>>,
  Expect<Fits<Got<'/api/arrivals'>['items'][number], Arrival>>,
  Expect<Fits<Got<'/api/libraries'>[number], Library>>,
  Expect<Fits<Got<'/api/jobs/{id}'>, JobDetail>>,
  Expect<Fits<Got<'/api/settings'>, Settings>>,
  Expect<Fits<Got<'/api/history'>['items'][number], Activity>>,
  Expect<Fits<Got<'/api/libraries/{id}/items'>, ItemsPage>>,
  Expect<Fits<Got<'/api/libraries/{id}/items/{itemId}'>, ItemDetail>>,
  Expect<Fits<Got<'/api/libraries/{id}/shows'>['items'][number], Show>>,
  Expect<Fits<Got<'/api/libraries/{id}/shows/{tmdbId}'>, ShowDetail>>,
];
