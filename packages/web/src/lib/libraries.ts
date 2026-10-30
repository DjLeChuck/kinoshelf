import { api } from './api.js';
import {
  destinationForm,
  destinationOf,
  nullIfBlank,
  profileForm,
  profileOf,
  thresholdOf,
  type Destination,
  type DestinationForm,
  type Mode,
  type ProfileForm,
} from './settings.js';

/** The four tabs of a scan result, in the order they are shown. */
export type ScanTab = 'rename' | 'conflict' | 'ambiguous' | 'unrecognized' | 'compliant';
export const SCAN_TABS: readonly ScanTab[] = [
  'rename',
  'conflict',
  'ambiguous',
  'unrecognized',
  'compliant',
];
/** Files per tab; `renamed` counts those already transferred, which no tab lists any more. */
export type ScanCounts = Readonly<Record<ScanTab, number>> & { readonly renamed: number };

/** What `GET /api/libraries` returns. A field that is `null` follows the global setting. */
export interface Library {
  readonly id: string;
  readonly name: string;
  readonly source: string;
  readonly destination: string | Destination | null;
  readonly profile: string | null;
  readonly mode: Mode | null;
  readonly threshold: number | null;
  readonly watch: boolean;
  readonly lastScan: {
    readonly jobId: string;
    readonly finishedAt: string | null;
    readonly counts: ScanCounts;
  } | null;
  /** A scan of the whole source is queued or running. */
  readonly scanning: boolean;
}

/** What `POST`/`PATCH /api/libraries` take; on a PATCH, `null` unsets a field. */
export interface LibraryBody {
  name: string;
  source: string;
  destination?: string | Destination | null;
  profile?: string | null;
  mode?: Mode | null;
  threshold?: number | null;
  watch?: boolean;
}

export interface ScanRow {
  readonly id: string;
  /** The file's full path. */
  readonly from: string;
  /** Where it goes (or already is); `null` when nothing is decided. */
  readonly to: string | null;
  readonly score: number | null;
}

export interface ScanPage {
  readonly counts: ScanCounts;
  readonly rows: readonly ScanRow[];
  /** Files in the tab, for paging. */
  readonly total: number;
}

/** What `GET /api/jobs/{id}/files` returns. */
interface ScanFilesBody {
  readonly total: number;
  readonly counts: ScanCounts;
  readonly files: readonly {
    readonly id: string;
    readonly path: string;
    readonly destination: string | null;
    readonly score: number | null;
  }[];
}

/** The dry-run report (`POST /api/plans/{id}/execute`), as far as the page reads it. */
interface DryRunBody {
  readonly items: readonly { readonly results: readonly { readonly status: string }[] }[];
}

export interface ExecuteOutcome {
  /** Files the dry run found a problem with; always 0 for a real run, which is only queued. */
  readonly blocked: number;
}

/** Everything the libraries pages ask of the server, in one place so a change of contract is too. */
export interface LibraryApi {
  list(): Promise<Library[]>;
  create(body: LibraryBody): Promise<Library>;
  update(id: string, body: Partial<LibraryBody>): Promise<Library>;
  remove(id: string): Promise<void>;
  /** Starts the analysis of the library's source folder; the job id follows it. */
  scan(id: string): Promise<{ readonly id: string }>;
  files(jobId: string, tab: ScanTab, offset: number, limit: number): Promise<ScanPage>;
  /** `entries` limits the batch to those files; `dryRun` plans without touching the disk. */
  execute(
    jobId: string,
    options: { entries?: readonly string[]; dryRun: boolean },
  ): Promise<ExecuteOutcome>;
}

export const libraryApi: LibraryApi = {
  list: () => api.get('/api/libraries'),
  create: (body) => api.post('/api/libraries', body),
  update: (id, body) => api.patch(`/api/libraries/${id}`, body),
  remove: (id) => api.delete(`/api/libraries/${id}`),
  scan: (id) => api.post(`/api/libraries/${id}/scan`),
  files: async (jobId, tab, offset, limit) => {
    const body = await api.get<ScanFilesBody>(
      `/api/jobs/${jobId}/files?tab=${tab}&offset=${offset}&limit=${limit}`,
    );
    return {
      counts: body.counts,
      total: body.total,
      rows: body.files.map((file) => ({
        id: file.id,
        from: file.path,
        to: file.destination,
        score: file.score,
      })),
    };
  },
  execute: async (jobId, { entries, dryRun }) => {
    const body = await api.post<DryRunBody | undefined>(`/api/plans/${jobId}/execute`, {
      dryRun,
      ...(entries && { entries }),
    });
    return {
      blocked: dryRun
        ? (body?.items ?? []).filter(({ results }) =>
            results.some(({ status }) => status === 'failed'),
          ).length
        : 0,
    };
  },
};

export const THRESHOLD_MIN = 50;
export const THRESHOLD_MAX = 100;
export const THRESHOLD_DEFAULT = 85;

export interface LibraryForm {
  name: string;
  source: string;
  destination: DestinationForm;
  profile: ProfileForm;
  /** `''` follows the global mode. */
  mode: Mode | '';
  /** Follow the global threshold instead of `threshold`. */
  defaultThreshold: boolean;
  threshold: number;
  watch: boolean;
}

export function libraryForm(
  library: Library | undefined,
  bundled: readonly { readonly id: string }[],
): LibraryForm {
  return {
    name: library?.name ?? '',
    source: library?.source ?? '',
    destination: destinationForm(library?.destination ?? null),
    profile: profileForm(library?.profile ?? null, bundled),
    mode: library?.mode ?? '',
    defaultThreshold: library?.threshold == null,
    threshold: library?.threshold ?? THRESHOLD_DEFAULT,
    watch: library?.watch ?? false,
  };
}

/** The last segment of a path: what a library is called when its owner did not name it. */
export const folderName = (path: string): string => path.split('/').filter(Boolean).pop() ?? path;

/**
 * What to send; `invalid` names the first thing refused. A blank field is `null` on a PATCH (it
 * unsets the value) and left out of a POST, where there is nothing to unset.
 */
export function libraryBody(
  form: LibraryForm,
  creating: boolean,
): LibraryBody | { invalid: 'source' | 'destination' | 'profile' | 'threshold' } {
  const source = form.source.trim();
  if (!source.startsWith('/')) {
    return { invalid: 'source' };
  }
  const destination = destinationOf(form.destination);
  const profile = profileOf(form.profile);
  const threshold = form.defaultThreshold ? null : thresholdOf(String(form.threshold));
  if (destination === undefined) {
    return { invalid: 'destination' };
  }
  if (profile === undefined) {
    return { invalid: 'profile' };
  }
  if (threshold === undefined) {
    return { invalid: 'threshold' };
  }
  const body: LibraryBody = {
    name: nullIfBlank(form.name) ?? folderName(source),
    source,
    destination,
    profile,
    mode: form.mode === '' ? null : form.mode,
    threshold,
    watch: form.watch,
  };
  if (!creating) {
    return body;
  }
  return Object.fromEntries(
    Object.entries(body).filter(([, value]) => value !== null),
  ) as unknown as LibraryBody;
}

/** `/libraries`, `/libraries/new`, `/libraries/<id>`, `/libraries/<id>/scan/<jobId>`. */
export type LibraryRoute =
  | { readonly page: 'list'; readonly id?: undefined }
  | { readonly page: 'new'; readonly id?: undefined }
  | { readonly page: 'edit'; readonly id: string }
  | { readonly page: 'scan'; readonly id: string; readonly jobId: string };

export function libraryRoute(path: string): LibraryRoute | undefined {
  const parts = path.replace(/\/+$/, '').split('/').filter(Boolean);
  if (parts[0] !== 'libraries') {
    return undefined;
  }
  const [, id, scan, jobId, ...rest] = parts;
  if (id === undefined) {
    return { page: 'list' };
  }
  if (scan === undefined) {
    return id === 'new' ? { page: 'new' } : { page: 'edit', id };
  }
  return scan === 'scan' && jobId !== undefined && rest.length === 0 && id !== 'new'
    ? { page: 'scan', id, jobId }
    : undefined;
}

export const libraryPath = (id?: string): string => (id ? `/libraries/${id}` : '/libraries');
export const scanPath = (libraryId: string, jobId: string): string =>
  `/libraries/${libraryId}/scan/${jobId}`;

/** Every file the scan found, handled or not. */
export const countTotal = (counts: ScanCounts): number =>
  SCAN_TABS.reduce((sum, tab) => sum + counts[tab], counts.renamed);
