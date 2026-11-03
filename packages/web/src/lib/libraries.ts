import { api } from './api.js';
import { baseName } from './paths.js';
import {
  nullIfBlank,
  profileForm,
  profileOf,
  thresholdOf,
  type Mode,
  type ProfileForm,
} from './settings.js';

export type LibraryKind = 'movie' | 'series';
/** The ids of the libraries an arrival folder sends its releases to. */
export interface LibraryInto {
  readonly movie: string;
  readonly series: string;
}

/** What `GET /api/libraries` returns. A field that is `null` follows the global setting. */
export interface Library {
  readonly id: string;
  readonly name: string;
  readonly source: string;
  /** A library organized in place has a type; an arrival folder has `into`. */
  readonly type?: LibraryKind | null;
  readonly into?: LibraryInto | null;
  readonly profile: string | null;
  readonly mode: Mode | null;
  readonly threshold: number | null;
  readonly watch: boolean;
  /** The latest scan of the whole source, whatever became of it. */
  readonly lastScan: {
    readonly jobId: string;
    readonly status: 'queued' | 'running' | 'done' | 'failed';
  } | null;
  /** A scan of the whole source is queued or running. */
  readonly scanning: boolean;
}

/**
 * What `POST`/`PATCH /api/libraries` take; on a PATCH, `null` unsets a field. A library organized
 * in place carries `type` and no `mode`, an arrival folder `into` and no `profile`.
 */
export interface LibraryBody {
  name: string;
  source: string;
  type?: LibraryKind;
  into?: LibraryInto;
  profile?: string | null;
  mode?: Mode | null;
  threshold?: number | null;
  watch?: boolean;
}

/** Everything the libraries pages ask of the server, in one place so a change of contract is too. */
export interface LibraryApi {
  list(): Promise<Library[]>;
  create(body: LibraryBody): Promise<Library>;
  update(id: string, body: Partial<LibraryBody>): Promise<Library>;
  remove(id: string): Promise<void>;
  /** Starts the analysis of the library's source folder; the job id follows it. */
  scan(id: string): Promise<{ readonly id: string }>;
}

export const libraryApi: LibraryApi = {
  list: () => api.get('/api/libraries'),
  create: (body) => api.post('/api/libraries', body),
  update: (id, body) => api.patch(`/api/libraries/${id}`, body),
  remove: (id) => api.delete(`/api/libraries/${id}`),
  scan: (id) => api.post(`/api/libraries/${id}/scan`),
};

// The web does not import the core. `THRESHOLD_DEFAULT` mirrors `DEFAULT_THRESHOLD` (core,
// `matching/config.ts`; a server test holds them equal). The form offers 50 and up, narrower than the
// API's 0 to 100: below 50 a match is a guess, and the config file still allows it.
export const THRESHOLD_MIN = 50;
export const THRESHOLD_MAX = 100;
export const THRESHOLD_DEFAULT = 85;

/** A library organized in place is its own destination; an arrival folder sends elsewhere. */
export type LibraryGroup = 'in-place' | 'arrival';

export const groupOf = (library: Pick<Library, 'type'>): LibraryGroup =>
  library.type ? 'in-place' : 'arrival';

export interface LibraryForm {
  group: LibraryGroup;
  name: string;
  source: string;
  /** In place only. */
  type: LibraryKind;
  /** Arrival only: the ids of the libraries it sends to. */
  into: { movie: string; series: string };
  /** In place only. */
  profile: ProfileForm;
  /** Arrival only; `''` follows the global mode. */
  mode: Mode | '';
  /** Follow the global threshold instead of `threshold`. */
  defaultThreshold: boolean;
  threshold: number;
  watch: boolean;
}

export function libraryForm(
  library: Library | undefined,
  bundled: readonly { readonly id: string }[],
  group: LibraryGroup = library ? groupOf(library) : 'in-place',
  /** Libraries organized in place, to preselect the destinations of a new arrival folder. */
  typed: readonly Library[] = [],
): LibraryForm {
  const first = (kind: LibraryKind): string => typed.find((one) => one.type === kind)?.id ?? '';
  return {
    group,
    name: library?.name ?? '',
    source: library?.source ?? '',
    type: library?.type ?? 'movie',
    into: library?.into ?? { movie: first('movie'), series: first('series') },
    profile: profileForm(library?.profile ?? null, bundled),
    mode: library?.mode ?? '',
    defaultThreshold: library?.threshold == null,
    threshold: library?.threshold ?? THRESHOLD_DEFAULT,
    watch: library?.watch ?? false,
  };
}

/** The last segment of a path: what a library is called when its owner did not name it. */
export const folderName = baseName;

/**
 * What to send; `invalid` names the first thing refused. Only the fields of the library's group
 * are sent, and its `type` only on creation: a library never changes group. A blank field is
 * `null` on a PATCH (it unsets the value) and left out of a POST, where there is nothing to unset.
 */
export function libraryBody(
  form: LibraryForm,
  creating: boolean,
): LibraryBody | { invalid: 'source' | 'into' | 'profile' | 'threshold' } {
  const source = form.source.trim();
  if (!source.startsWith('/')) {
    return { invalid: 'source' };
  }
  const threshold = form.defaultThreshold ? null : thresholdOf(String(form.threshold));
  if (threshold === undefined) {
    return { invalid: 'threshold' };
  }
  const body: LibraryBody = {
    name: nullIfBlank(form.name) ?? folderName(source),
    source,
    threshold,
    watch: form.watch,
  };
  if (form.group === 'in-place') {
    const profile = profileOf(form.profile);
    if (profile === undefined) {
      return { invalid: 'profile' };
    }
    body.profile = profile;
    if (creating) {
      body.type = form.type;
    }
  } else {
    if (form.into.movie === '' || form.into.series === '') {
      return { invalid: 'into' };
    }
    body.into = { ...form.into };
    body.mode = form.mode === '' ? null : form.mode;
  }
  return creating
    ? (Object.fromEntries(
        Object.entries(body).filter(([, value]) => value !== null),
      ) as unknown as LibraryBody)
    : body;
}
