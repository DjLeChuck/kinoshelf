# AGENTS.md

Kinoshelf: self-hosted web app (MIT) that identifies video files already on disk (movies, series),
renames them for a media player (Plex, Jellyfin) and writes their metadata (NFO, artwork).

## Where we are

The core, the CLI, the matching corpus, the REST server, the notifications and the multi-arch Docker
image are done, and so is getting downloads in (see "Getting downloads in" below). The web UI has four
entries: Libraries, History, Settings and System (see "System" below). A welcome shows at `/` on the first
launch (`GET`/`PATCH /api/onboarding`) and the app then opens on Libraries. The
libraries (organized in place, arrival folders) are configured in the Settings, with a server-side
path picker. The Libraries page has a tab per typed library (list read from the snapshot, filters,
scan progress, the page of an item) and an Arrivals tab (`/arrivals`) where a file is validated:
candidate, destination library. A series library reads as a tree (show, season,
episode) with its missing episodes. Items are renamed and refreshed from the page (a preview first). The History merges batches and
jobs in one list (see "History" below). A series is validated as a release, not file by file. A movie or an episode held in several
versions is listed once (see "Versions in the lists" below). The NFO
and artwork writers (`metadata: nfo`) are built (see "NFO and artwork"
below), metadata included for a library that is already organized. No stable release is tagged yet.

Backlog, not built: skipping samples by size (today only by name: `sample.*`, a `Sample` folder);
reading completion from a download client's own API (see "Getting downloads in").

## Golden rules

- **Everything is in English**: code, comments, identifiers, commit messages, PR titles, docs,
  README.
- **Conventional Commits** for every commit (`feat(core): …`, `fix(cli): …`, `chore: …`,
  `test(core): …`, `docs: …`). Scope = package name without the `@kinoshelf/` prefix. Imperative
  mood, subject under 72 characters. Never commit unless asked.
- **Multilingual UI from day one (fr + en)**: no user-facing string hardcoded in logic. The core
  throws/returns typed errors carrying a stable `code` and parameters; translation happens at the
  edges (CLI, server, web) with the `fr` and `en` catalogs. Any new message must be added to both.
- Nothing touches the disk without a validated plan (parse → match → plan → execute).
- **The REST API serves its clients, nothing more**: the web, the CLI (`kinoshelf submit`) and the
  e2e. A route, a parameter or a response field none of them reads is removed, not kept "for the
  API"; tests read the stores (`jobEntries`, `executionOf` in the server's test harness) instead.
- No automatic fallback when a hardlink is impossible: fail with an explicit error.
- Never overwrite a destination file by default: the operation goes to the validation queue.
  Enforced in layers: the planner flags it, the executor re-checks right before writing, and the
  primitives in `execution/fs-ops.ts` publish with `link` (fails on EEXIST) instead of `rename`
  (silently overwrites). Keep all three; tests cover each layer. On a filesystem without
  hardlinks (some SMB, FAT, exFAT mounts) `publish` falls back to a check then `rename`: a file
  created in between is overwritten. Node has no `RENAME_NOREPLACE`; the gap is known and accepted.
- Durable SQLite data (the journal) changes only through `journal/migrations.ts`: append a new
  entry, never edit a shipped one. Disposable data (the TMDB cache) is created on demand.

## Architecture

A headless **core** holds all the logic; the server, the web UI and the CLI are only clients.
Everything depending on a service or a player is a plugin behind an interface.

```
packages/core              parsing (Parser), matching/score, planning, execution, journal/undo, profiles
packages/i18n              fr/en messages (CLI, server, web), error code → text
packages/providers/tmdb    MetadataProvider for TMDB, SQLite cache
packages/cli               kinoshelf scan | process <path> | undo
packages/server            (v0.2) Fastify REST API, job queue, notifications (webhooks, Plex, Jellyfin)
packages/web               (v0.3) Svelte 5 UI
packages/corpus            (private) matching corpus and the scripts that grow it
```

A profile is two axes, built by `buildProfile({ naming, metadata })` (`core/src/profiles/build.ts`): no
bundled YAML, and the core contains no player-specific rule. `naming: with-id | no-id` (default
`no-id`) puts `{tmdb-<id>}` in the movie and series folders and the movie file, or nothing;
`metadata: none | nfo` (default `nfo`) writes Kodi NFO and artwork, or nothing. They are set globally
(`naming`/`metadata` in `config.yaml`), per typed library, or by `--naming`/`--metadata` in the CLI.
No combination belongs to a player: Plex's default agents read `none` (`with-id` or `no-id`), and
Plex's NFO agent, Jellyfin and Kodi all read `nfo`, whose `<uniqueid type="tmdb">` makes the id in the name
a safety net (Jellyfin's documentation recommends it, but `no-id`/`nfo` was checked on a Jellyfin
instance and works, as on Plex's NFO agent). `loadProfileFile`/`parseProfile` (custom YAML) stay in the core but are wired
nowhere: a custom profile file is to be discussed again.

- **One layout for every player** (Plex, Jellyfin, Kodi), as close as they allow, so one library reads the
  same under any and switching costs next to no renaming: the same id tag (`{tmdb-<id>}`), NFO files
  (`movie.nfo`, `tvshow.nfo`, `<file>.nfo`), image names (`poster.jpg`, `fanart.jpg`, `clearlogo.png`, a season's
  `season01-poster.jpg` in the show's folder, `season-specials-poster.jpg` for season 0), `Season 01`
  folders and episode names (`Show (2022) - s01e01`, ranges joined with `-e`: a `s01e04-e05` file gave
  two episodes in each player), the episode thumbnail `<file>-thumb.jpg`. Before adding a rule, look for a
  name every player reads and use it; make it specific only when there is none, after checking their
  documentations (and Jellyfin's and Kodi's code, which read more than they document), and say why in
  `build.ts`. Kodi's names were checked on a real Kodi 21.3 (JSON-RPC, `dev/players`): `background.jpg` and
  `logo.png` are stored under the types `background` and `logo`, which no skin shows, hence `fanart.jpg`
  and `clearlogo.png`, read by Jellyfin and Plex's NFO agent as well (same bytes served as the files);
  `<file>.jpg` is not read, `<file>-thumb.jpg` is by all three. A Kodi movies source must be set to
  "one movie per folder", local information only. **Kodi 21 does not attach versions**: two files of a
  movie, or of an episode, are two entries there, and no name changes that. Kodi 22 attaches movies only
  (never episodes), from `<hasvideoversions>true</hasvideoversions>` in the NFO (tried on 22.0rc2: the shared
  `movie.nfo` is enough, and the other players ignore the tag). **Decided not to write it**: one player, movies
  only, a release candidate, and an existing NFO is never rewritten.

- The parser is [guessit-js](https://github.com/opensubtitles/guessit-js) (LGPL-3.0) behind the
  `Parser` interface. Never modify or vendor it (LGPL/MIT compatibility).
- Profile template syntax: `{title}`, `{year}`, `{tmdb}`, `{season:02}`; `\{` and `\}` are literal
  braces (`'{title} ({year}) \{tmdb-{tmdb}\}'`). Templates containing a backslash must use **single
  quotes** in a profile YAML file (a double-quoted `"\{"` is a YAML error); the loader rejects that
  case with a clear error. Verify Plex/Jellyfin conventions against their official documentation
  before changing the layout.
- `no-id` is cleaner but a player then matches on title and year alone, ambiguous for two works sharing
  both; the id is optional for Plex, hence an axis rather than a template syntax for optional parts.
- Plex has two modes: the default agents ignore NFO (`metadata: none`), the optional "Plex NFO"
  agent (PMS 1.43.1+) reads Kodi-format NFO, `movie.nfo`, `tvshow.nfo`, per-episode `<file>.nfo`
  (as Jellyfin; no season NFO, Plex ignores it), `poster.jpg`, `fanart.jpg`, `clearlogo.png` and a season
  poster `season01-poster.jpg` in the show's folder, or `season-specials-poster.jpg` for season 0 (the
  artwork's `specialsName`). A season's poster is a show-level file, written with `tvshow.nfo` (so a
  partial selection hands it, like the other show files, to any chosen episode of the show).
  Plex documents `Season01.jpg` instead, but the agent reads Kodi's name too (checked on PMS 1.43.5:
  with only `season01-poster.jpg` on the disk, the season took it) (`no-id`/`nfo`: no id in the names, since the NFO carries
  `<uniqueid type="tmdb">`).
- Jellyfin (`with-id`/`nfo`): `{tmdb-<id>}` (the same as Plex's; Jellyfin's documentation gives `[tmdbid-<id>]`, its code reads `tmdb` as an alias and any of brackets, parentheses or braces) in the movie and series folders and in the movie file (the file
  must start with its folder's name), `SxxExx` episodes, `movie.nfo`, `tvshow.nfo`, `<file>.nfo`,
  `poster.jpg`, `fanart.jpg` and `clearlogo.png`. A season's poster is Kodi's `seasonNN-poster.jpg` in the show
  folder (`season-specials-poster.jpg` for season 0), the file the Plex NFO agent reads too: Jellyfin's
  documentation only says a season folder may hold the show's names (a plain `poster.jpg`), but its code
  reads the Kodi name and never Plex's `SeasonNN.jpg` (checked on Jellyfin 12.4: the season took it).
- **Versions of a movie or an episode** (`templates.movieVersion` and `templates.episodeVersion`, both
  `' - {version}'` in every layout; only `{version}` is known to them, and a profile without
  one keeps one file per work). Plex and Jellyfin take several qualities of one movie in **one
  folder**, `<name> - <label>` (Jellyfin: the file starts with its folder's name, id included), and
  Jellyfin's documentation gives the same for an episode in its season folder (`Series Name S01E01 - 1080p.mkv`,
  matched by `SxxExx`, no prefix rule); Plex is taken to work the same way (not verified
  against its documentation, which names only movies). A file that **arrives** is always named with
  its label when its file name gives a picture size (`ParsedMedia.screenSize`, `source`; guessit
  reads `4K` as `2160p`): `Nightbitch (2024) {tmdb-728949} - 2160p.mkv`, `Foundation (2021) - s01e01 - 2160p.mkv`.
  The label (`planning/version.ts`) is the size; files of one work (a movie, or
  one episode: series id, season and episode numbers) in a batch that share it add the source, then
  the release group (the batch takes one level for all of them, so the result does not depend on the
  order); files nothing tells apart are a `duplicate-destination` conflict, never numbered. A file
  **already in its folder** under the profile's name, with or without a label after it, is
  `in-place`: the library is never renamed behind its owner's back. A movie may carry anything after a
  separator, an episode only a label that starts with a size, or any suffix when the bare name is
  another file's (` - The Emperor's Peace` alone is a title, which the profile renames). The label is
  also found by trying finer levels when the name is taken on the disk, unless the file there has the
  **same size** (most likely the same release again: conflict). The folder's `movie.nfo`, poster,
  fanart and logo are written once (the first version; later ones leave them, so undoing a later batch does not
  remove them), while a `{file}.nfo` follows each version. Guessit does not tell WEB-DL from WEBRip
  (`Web`) nor read Remux, so two such files differ by their group or conflict.
- **A size read from the file** (`PlannerOptions.sizeOf`, `AnalyzeOptions.sizeOf`; the server's is
  `probePictureSize`, ffprobe's frame by `pictureSize(width, height)`, the larger of the sizes the
  width and the height read, so a 1920x800 film is 1080p). It is asked only for a file whose name
  says none and which has company: another file of the same work in the batch, a destination already
  taken, or a version of the work beside where it would go. `createPlan` then plans again with what
  it found, so the whole work is told apart together; a file nobody competes with is never read and
  keeps its bare name. The setting `detectPictureSize` (`config.yaml`, "Read the picture size with
  ffprobe" in the settings, **on** by default) turns it off: the size is then given by hand, from the
  page of a movie or an episode (below) or when validating an arrival (`screenSize` in the body of
  `POST /api/entries/{id}/match` and `/preview`, for that file only and kept in its stored plan). A
  missing ffprobe, or a file it cannot read, gives no size and the planner falls back to a conflict.
  The page of a movie or an episode has "Add the version to the name": a dialog whose size menu starts
  from the name's, or "Automatic", and can be changed (`POST /api/libraries/{id}/execute` with
  `version: true` and `screenSize`, which wins over the name, which wins over the file). Not done:
  a batch action in the web.
- `ParsedMedia.knownIds` (ids found in names) is a hint, not a truth: a candidate whose id matches
  is boosted only if its type, title, season/episode and year agree. If the id designates a
  candidate yet another one scores higher (`Dune (2021) {tmdb-841}`: 841 is the 1984 film), the
  name contradicts itself and nothing is decided automatically. An id absent from the results
  cannot be verified and is ignored.
- **Releases**: a series is matched and validated as the folder it came in, not file by file.
  `DiscoveredFile.release` is the folder directly under the scanned root when the root holds releases
  (`discoverVideos(…, { splitReleases })`: a scan of a library's whole source), the scanned folder
  itself otherwise (a path sent by hand or by the watcher), the file alone when given one. In
  `analyze`, the episodes of a release vote on the series title (normalized, first seen wins a tie):
  those that agree go to `Matcher.matchRelease`, which makes **one** search and scores each file on
  those candidates (its season, episode and year still count), choosing the work once on the average
  score; a file that does not fit the choice (a season TMDB lacks) goes to review alone. The vote is
  `voteRelease` (`pipeline/release.ts`): titles at least `SAME_SERIES_SIMILARITY` alike are one series,
  unless both carry a different country (`The.Office.US`/`UK`). It is held again on the episodes left
  out (`clusterRelease`), so a folder holding several series gives **clusters**: 0 is the one most
  episodes name, 1 and up the others (`AnalysisEntry.cluster`, `job_entries.release`/`cluster`). Each cluster is matched and validated as a whole; the UI lists the other
  clusters under the release (`detached`, linked to it). Movies are never grouped. Validating
  (`POST /api/entries/:id/match`) an episode applies the choice to the other pending episodes of its
  cluster (`followers` in the answer); `ignore` does the same. There are
  no aliases and no "remember this title": correct the release once.
- **Path picker** (`GET /api/fs?path=…[&files=yaml]`): the settings browse the server's disk for the
  destination folders and a custom profile, since a browser cannot see it (and in Docker only
  mounted folders exist). It lists sub-folders (and YAML files when asked), names only, hidden
  entries left out, symlinks shown as their target, at most 2000 entries. It is not restricted to
  configured roots, which is what is being chosen: the API key already lets its holder submit any
  path to `POST /api/jobs`. Keep it to names; never return file contents. The Plex/Jellyfin path
  mappings only "Path in Kinoshelf" uses it; the other side is a path on _their_ machine, typed.
- `ParsedMedia.volume` (`Kill.Bill.Vol.2`, `Deathly.Hallows.Part.2`, movies only: guessit's `volume`
  or `part`) is compared with the installment number in a candidate's title (`Volume 2`, `Part II`,
  `Part Two`, `Tome 3`, `2ème partie`, see `matching/installment.ts`): a signed adjustment like the
  country's, neutral when either side names none. A small number closing a movie's title (`Dragons 3`,
  not a year) counts the same when the parser read no marker, against the digits of the candidate's titles.
  When the number and the year name different films
  (`Part.2` with the year of Part 1, `Dragons 3 (2014)` with the year of the second) nothing is decided automatically. `ParsedMedia.otherTitles` holds the two halves of a bilingual title
  glued by a dash (`Anatomy.Of.A.Fall-Anatomie.d.une.chute`), each a further reading of the title
  (best similarity wins); the dash must have two words on each side, so `Spider-Man` is untouched.
  The search itself still uses the whole title.
- `ParsedMedia.country` (`The.Office.US`) is matched against `Candidate.countries` (TMDB gives
  `origin_country` for series only): a bonus on agreement, a penalty when both are known and
  differ, neutral otherwise.
- Each user provides their own TMDB key; none is ever embedded. Put it in `.env` (git-ignored) as
  `TMDB_API_KEY`; never read or print it. `pnpm test:live` runs the contract tests against the
  real API.
- **A variable that overrides a setting is said so in the settings.** `TMDB_API_KEY` and
  `KINOSHELF_API_KEY` win over what the settings could save, so `GET /api/settings` reports their
  `source`, the field is disabled with an explanation, and the API refuses the change with a 409
  (`settings.tmdb-key-from-env`, `settings.api-key-from-env`): a value saved and never used is worse
  than a refusal. Do the same for any new variable that shadows a setting.
  The exception is a **default**: `KINOSHELF_LOCALE` and `KINOSHELF_METADATA_LANGUAGE` only fill in while `locale` /
  `metadataLanguage` is unset (after them: `LANG`, then `en-US`), so no `source` and no 409. `GET /api/settings`
  reports what is in use as `defaults`; the onboarding and the settings preselect it, never the browser's language,
  so a form cannot show a language the server does not use.
- **The first key** (`POST /api/setup/api-key`, while none exists) is only made through a local host
  name (IP, `localhost`, no dot, `.local`/`.lan`/`.home.arpa`/`.internal`, or
  `KINOSHELF_ALLOWED_HOSTS`): a DNS-rebinding page sends its own domain as both `Origin` and `Host`.
- **Signing in to Plex** (`notify/plex-auth.ts`, `plex-session.ts`, `plex-routes.ts`; `PlexSignIn.svelte`): Plex's
  JWT flow, the one its documentation recommends for a new app. The device holds an Ed25519 key
  (`newIdentity`: client id, JWK, RFC 7638 `kid`), registers its public half with
  `POST clients.plex.tv/api/v2/pins`, and the user approves on `app.plex.tv/auth` while the page polls
  `GET /api/plex/auth/:id` (the server signs `deviceJWT`; a PIN other than the one made is refused,
  404 `plex.pin-unknown`). The token lasts 7 days and **renews on demand** (nonce, signed JWT,
  `POST /api/v2/auth/token`): Plex accepts a renewal after expiry, so there is no timer, and
  `PlexSession.token()` renews a day early, one at a time. A media server's 401 renews once and retries
  (`PlexClient.request`). plex.tv refusing the key (401/403/422/498) sets `plexAccount: 'expired'`
  (409 `plex.not-signed-in`); plex.tv being down keeps a still-valid token and is a 502
  `plex.unreachable`. **The state is in the database** (`plex_auth`: a secret that
  changes every week does not belong in a file people edit), shared with `kinoshelf-server notify`
  which reads it too. `signOut` keeps the device identity (a new sign-in is not one more authorized
  device). A token typed in `apiKey.plex` wins in `Notifier.configure`; signing in removes it.
  `KINOSHELF_PLEX_TV_URL` points at a fake plex.tv (the e2e stack, and `test/fake-plex-tv.ts` which
  checks the signatures against the registered key).
- **Exposed server** (`app.ts`, `attempts.ts`, `web.ts`): everything under `/api` needs the key, the
  OpenAPI document included (only `/health` and the sign-in/setup routes are public). An address with
  ten wrong keys in ten minutes gets a 429 (`auth.too-many-attempts`), a right key included: that is
  per `request.ip`, so behind a proxy `KINOSHELF_TRUST_PROXY` must name it, or everyone shares one
  count. `X-Forwarded-*` is believed only from that proxy; the origin and first-key host checks read
  `request.host`. The page's content security policy forbids anything foreign (the e2e `csp` spec
  fails on a violation): never load a script, style or image from another origin.
- **The web's API types** are written by hand and held against the server's: `packages/server/test/api-types.test.ts`
  generates `packages/web/src/lib/api-schema.d.ts` from the route schemas (`UPDATE_API_TYPES=1 pnpm test`
  rewrites it) and `web/src/lib/api-contract.ts` fails `svelte-check` when a hand-written type no longer
  accepts what the server sends. Change a response field on both sides, then regenerate.
- **The welcome page** (`/`, until the setup is left): the TMDB key is tested as soon as it is
  entered and dropped if TMDB refuses it; the destination step creates the first two libraries (a movies folder and a series folder, organized in place), the last step an arrival folder pointing at them (watched, or scanned once). Any job counts as work, so the setup ends even when that job failed: the History
  then lists the analyses in progress and the failed ones with their cause (`GET /api/history`), a
  failure staying until the same path is sent again and does not fail. A job must never fail without
  leaving a trace in the UI.

## System

The System page (`/system`) is where the server is **observed**; the Settings stay where it is configured.
Its tabs are Health (the default, `/system`), Logs (`?tab=logs`), TMDB (`?tab=tmdb`) and Diagnostic (`?tab=diagnostic`);
what is planned in the private notes (maintenance, security) must not show as an empty tab or a "soon" badge before it
is built.

- **The log** (`logs.ts`, `log-routes.ts`; `SystemLogs.svelte`): the destination of Fastify's pino logger. `LogStore`
  keeps the last 5000 lines in memory (what the page lists) and writes `<config>/logs/kinoshelf.log`, rotated at
  10 MB with 3 files kept, read back at start so a restart does not empty the page; `main.ts` also echoes each
  line to stdout (`docker logs`). A line carries a `component` (`server` by default, else named by the code that
  logs it: `http`, `scan`, `transfer`, `watcher`, `tmdb`, `notify`; `app.log.child({ component })`) and optionally a
  `job`. A request is one `http` line at `debug` (never the reads of `/api/logs` or `/api/events`).
- **Secrets are wiped when a line is written** (`scrub`): the values the settings and the environment hold (TMDB,
  API, Plex and Jellyfin keys, webhook addresses and headers, read at each line since the settings change) and the
  shapes that carry one anyway (`api_key=`, `token=`, `X-Plex-Token=`, `Bearer …`). The list, the file and the
  download are all wiped: never log a secret and count on the display to hide it.
- **The level** is `info`, or `KINOSHELF_LOG_LEVEL`, and `PUT /api/logs/level` changes it at once until the next
  restart: it is a way to find a problem, not a setting, so it is not in `config.yaml` (no 409 to explain).
  A `debug` line exists only while the level records it; the page's level filter does not create any.
- **Live view**: the payload-less `logs` event, at most twice a second, makes the page read the list again (a read
  is the last 500 matching lines, newest first). Opening a line pauses the follow (it would be pushed down);
  while paused, `GET /api/logs?after=<seq>&limit=1` only counts `newer`. The filters (`level`, `component`, `q`,
  `period` as minutes) are in the URL, so a link opens the page already filtered.
- **TMDB usage** (`tmdb-usage.ts`, `tmdb-routes.ts`; `SystemTmdb.svelte`): TMDB reports no quota, so `TmdbClient` tells an
  injected `UsageSink` (`providers/tmdb/src/usage.ts`) of each call answered by the cache and each request sent
  (retries included, so one abandoned call is 4), by kind of call (`callKindOf`, from the path) and outcome.
  `TmdbUsage` keeps it in `tmdb_usage` (disposable, created on demand, per hour, kind, outcome and latency bucket,
  forgotten after 30 days in `purge`), written from memory every 5 s, then emits the payload-less `tmdb` event; the
  median is read from the latency buckets (±12 %). A 429, a 5xx, a network failure or a refusal is logged under
  `tmdb` (warn while retried, error when given up) and kept in memory for "Latest errors" (since the start).
  `GET /api/tmdb/usage?period=24h|7d|30d` (chart slots per hour, or per UTC day) and `DELETE /api/tmdb/cache`.
  The tab's period is `?range=` (the logs' `period` is another filter in the same URL).
- **Health** (`health.ts`, `health-report.ts`, `health-routes.ts`; `SystemHealth.svelte`, `lib/health.ts`): eight cards
  (server, ffprobe, database, disk space, queue, folder watching, Plex / Jellyfin, webhooks), each `ok`, `warn`, `danger`
  or `off` (nothing set up: neither good nor wrong), a cause per problem and a link to the Settings section that fixes it.
  **Two reads, on purpose.** `GET /api/health` is the verdict, `{ errors }`, light enough for the badge of the System
  entry (red, `shell.healthErrors`): `Health.problems()` lists **errors only** (database unreadable, a library or watched
  folder unreachable, a Plex sign-in plex.tv refused) and does no `statfs`, no `ffprobe`; `Health.check()` emits the
  payload-less `health` event only when the count changes, and runs every minute (a share that goes away says nothing)
  and on each `settings` event. `GET /api/health/report` is what the page reads (disk space, `ffprobe -version`, the
  database file's size, queue counts) and adds the **warnings** (`ffprobe-missing`, `disk-low` under 5 %,
  `webhook-failing`, `media-refresh-failed`): a warning never turns the badge red. A problem is `{ area, code, params,
severity }`, `area` being its card and `code` translated by the web (`web.health.problem.<code>`).
  Data comes from the modules that own it: `FolderWatcher.status()` (`lastScanAt`, `nextScanAt`, `intervalSeconds`: the
  10-minute safety pass, or `pollSeconds`; per folder `sentLastDay`, the releases sent to the queue in 24 h, counted from
  the jobs since `watched_files` forgets a file once it is moved; also `GET /api/watch`), `Notifier.recent()` (the last 20 deliveries since
  the start, in memory: webhooks with their `attempts`, a Plex or Jellyfin refresh with its `failed` folders) and
  `migrationState` (`schema-info.ts`, read from `schema_migrations`: the count and the last one applied, which on a
  fresh database may be a core one). Plex shows "connected" and whether it was signed in with an account, never an
  expiry date (the token renews on demand).
- **Diagnostic** (`diagnostic.ts`, `diagnostic-routes.ts`, `zip.ts`; `SystemDiagnostic.svelte`): `GET /api/diagnostic/archive`
  builds a zip in memory (`zip.ts`, deflate through `node:zlib`, no dependency): `summary.json` (versions, platform, ffprobe),
  `config.json`, `health.json` (the report), `tmdb-usage.json` (7 days) and `logs.ndjson` (the 2000 newest lines).
  **No secret goes in, and each part is already clean where it is made**: the log by `scrub` when a line is written,
  `config.json` by `presentSettings` (the very function behind `GET /api/settings`: a secret is only said to be set) plus
  the libraries, which hold folders but no secret, the health report by `redactUrl`. Never put the raw `Config`, the
  environment or a request in the archive; a test plants a secret in every place that holds one and searches the whole
  archive for it. File and folder names are in it (the log, the libraries): the page says so. `GET /api/diagnostic` gives
  the versions and the same configuration for the page's preview. The download is a plain link (like the log's), so there
  is no "preparing" state; the issue link opens GitHub's form with the versions in its body.
- **Decided not to build**: a "connection lost" banner on the logs (the event stream does not tell the page it is down). A
  dropped stream reconnects by itself and every view reloads on `ready`; it is not worth an indicator of its own.

## History

One list for what Kinoshelf did (`GET /api/history`, `History.activity`): a **batch** is a line
(`GET /api/batches/{id}` for its files and `POST .../undo`), and a **job** is one only while it has no
batch: waiting, running, or failed. A job that made a batch is folded into it (the batch's detail embeds
the job: cause, frozen settings, "Send again"). A batch made by the CLI has no job.

- **Hidden is not deleted.** A job that finished and moved nothing (an analysis whose files wait in
  Arrivals, or sit in an organized library) is `routine`: left out of the default view, listed with
  `?all=true` (the "Show every analysis" box), and still in the database until the daily purge
  (`purge.ts`) forgets it. The journal is never purged, so any batch stays undoable.
- **An undo says how far it has got** (`ProgressTracker.startUndo`/`undoing`, `undoBatch`'s `onProgress`): in memory
  like a scan's progress, announced by the payload-less `progress` event (twice a second at most), read apart from the
  batch by `GET /api/batches/{id}/undo` (`{ progress: null }` when none runs; the batch itself lists every file, so it
  is not refetched per tick). A check (`dryRun`) reports the same way. A second real undo of a batch already being
  undone is a 409 `batch.undo-in-progress`, and the page, reloaded or opened in another tab, finds the bar and locks
  the buttons. The final steps (pruning folders, the library snapshot) are one "Finishing…" line: they are not counted.
- Nothing scans on its own: a job comes from a click (scan, `POST /api/jobs`), from the watcher (one per
  release found) or from `kinoshelf submit`.
- The selected line is in the path (`/history/<id>`, a batch or a job id); `/jobs/:id` no longer exists.
  A failed scan banner in a library links to its job.
- "Send again" (failed jobs only): the scan of a library's whole source goes through
  `POST /api/libraries/:id/scan` (so the 409 `library.scan-in-progress` guard applies), anything else is
  submitted again with `POST /api/jobs` (`resendRequest`, `lib/history.ts`). It uses today's settings, and
  the job's own, frozen, are shown beside it without being compared.

## Versions in the lists

A library lists a **movie or an episode once**, its files being its `versions` (`versions.ts`,
`presentWork` in `library-routes.ts`); the snapshot keeps one row per file. In `GET .../items`
only a movie identified with a tmdb id is grouped (`WORK_KEY`, in SQL, so paging counts movies); any
other file is an entry of its own, and the episodes of a series are grouped by `.../shows`.

- **The entry's state is the worst of its versions** (`state`, `nfo`, `poster`, `fanart`, `logo`, and an
  episode's `thumb`).
  `shareMovieFiles` makes `movie.nfo` and the images "there for every version or none" when the
  snapshot is written, since the planner puts them on the first version only. `total`, paging and
  `counts` count works, `missing-nfo` included; `multi-version` and `incomplete-versions` are filters
  (`counts` gives 0 for `incomplete-versions` in a movie library).
- **The NFO scope is fixed, not a profile axis**: one `movie.nfo` per movie, one `<file>.nfo` per
  version of an episode (no player reads a shared episode NFO). Kinoshelf never rewrites an NFO that
  exists, so a change of metadata leaves them, and there are no orphans to find.
- **Coverage** (`coverageOf`): the denominator is the distinct episodes held by all the versions
  (`2160p 7/8`), a version absent from a season counts 0 there. A missing episode (no file at all)
  lowers nothing: it is "Missing episodes". A file whose name gives no size is a version only if it
  shares an episode with another file, else it is in no version and not in the total.
- The **resolution is read from the name** (`resolutionOf`, `library-items.ts`), else from the picture the
  probe read (`picture`; `resolutionOfItem`), so a list never reads the disk. The probe
  (`hdr`, `audioLanguages`, `subtitleLanguages`) fills the details of each
  version; the list reads them from the snapshot (`file`: `null` until probed) and never probes.
  Languages are ISO 639-2 as the file tags them, shown short (`fre` gives `FR`), an unknown code as is.
- **The web** (`LibraryView`, `ShowsTree`, `ItemPanel`, `ShowPanel`, `EpisodePanel`, `VersionsSection`,
  `VersionsTable`, `CoverageMatrix`, `MetadataMarks`, `VersionBadges`, `SlotBadges`): one line per work with a chevron
  when there are several versions; `GET .../shows/:tmdbId` gives one episode per number with its `versions[]`, the
  `nfo` `{expected, present}` tallies, TMDB's `overview` and `runtime`, and the show's `known` (episodes TMDB lists,
  specials left out: "25 of 30"). **The three sheets (movie, show, episode) share one skeleton** (`WorkCard`): banner
  (an episode's 16:9 thumbnail), identity, a meta line of editorial facts only (`lib/fiche.ts`: length or counts, genres;
  never a size or a count of versions), the TMDB link, the synopsis, the facts (`.facts`, a 124 px label column
  everywhere; **Path is always a folder**, no File line; Metadata is one line of ticks), then **Versions**: a section
  whose header carries the summary (`Versions · 2 · 31.6 GiB`), a `VersionsTable` for a movie and an episode (one column
  per file, a Status row: "Complete" green or "NFO missing" orange from the file's own NFO) and the `CoverageMatrix`
  grid for a show (neutral grey, orange, dashed: unchanged). An episode has no action: it is analysed and matched
  with its series or season. The episode panel reads the episode, not each file, and a version's `ffprobe` details
  come with each file's own page.

## NFO and artwork

A profile with `nfo` or `artwork` makes the planner add `write-file` (NFO, content built in the
plan) and `download` (image URL) operations after the transfers of an item. Kodi-format NFO is
written by `core/src/nfo/` (a pure function of `MovieDetails`/`SeriesDetails`/`EpisodeInfo`; the
format follows the Kodi wiki's templates, saved pages are not in the repository).

- **The planner stays off the network.** `MetadataLoader` (`pipeline/metadata.ts`, used by `analyze`
  and the server) fetches the details first (one request per work, cached; the season is the
  provider's cached `getSeason`) and hands them to the planner in `PlanInput.details`/`episodes`.
  A profile that writes nothing makes no extra call. An item without details is still renamed.
- **Never overwritten, same as videos.** `write-file` and `download` publish with `link`; an
  existing file is `skipped` (`destination.exists`) in the item's results and never fails the item,
  nor sends the video back to the queue. When the plan writes an item's NFO, a `.nfo` beside the video
  (another tool's, one edited by hand, or one Kinoshelf wrote) does **not** travel with it: it stays where it
  is, never deleted and never overwritten, and Kinoshelf's is the one players read. Two NFO side by side were
  the alternative (a movie's `<video>.nfo` next to `movie.nfo`, and Kodi and Jellyfin read `<video>.nfo` first),
  and the owner's NFO winning would leave a library half-written. Subtitles always travel. Without an NFO
  written (`metadata: none`, a movie written flat) the file is all that is left of what it said and travels as
  before. A folder that keeps such a file is never pruned: `kinoshelf tidy` reports it. Not built: a line in the
  preview saying which NFO stays behind. A movie written flat (no folder) gets no fixed-name file
  (`movie.nfo`, `poster.jpg`, `clearlogo.png`), which every movie would share.
- **Show-level files** (`tvshow.nfo`, the show's poster, fanart and logo, a season's poster) come with
  every episode, marked `shared`; the planner keeps the first one of the batch (`shareCompanions`).
  Running only some items (`selectItems`, the server's `prepare`) hands them from an episode left out
  to a chosen one whose video lies in the same folder, so a partial selection still writes them.
- **Journal and undo**: entries have a `kind` (`transfer`, `generated`, `downloaded`;
  the `kind` column). Each entry keeps the destination's size and date as written
  (`identity`): a file that differs since (a poster the user replaced, an
  NFO edited by hand or by a player) is kept (`undo.destination-changed`), video included; entries
  journaled before carry none and are trusted. Undo deletes what Kinoshelf made, then prunes only the
  directories it created. A copy or hardlink whose original is gone (or replaced) is kept
  (`undo.last-copy`): it is the only one left. An undo that fails partway marks the entries it did
  revert, and a retry leaves them alone. Images come with `ImageSize` (`preview`, `standard`, `original`; `size`
  in the profile, `standard` by default and `original` for a fanart or a logo) through `provider.imageUrl`.
- **A move cleans behind it** (`execution/prune.ts`): after an item's `move`, the folder the video left
  (and its parents, up to but never including the plan's destination root) is removed when everything
  in it is a file Kinoshelf made (`Journal.madeFileIdentity`: a `generated`/`downloaded` entry not
  undone, same size and date). Anything else keeps the folder. The deleted NFO and images are not
  journaled: a refresh writes them again where the profile wants them. Folders outside the
  destination root (arrival folders) are never cleaned.
- **An organized library** gets its missing NFO and images too: an item whose video is already
  where the profile wants it becomes `ready` with only `write-file`/`download` operations (the
  CLI says "already named as the profile wants"). Files already there are left out of the plan
  rather than reported as skipped, so a rescan of a complete library stays `in-place`.
- **The web shows them.** A library item says which of its NFO and images are there (`nfo`, `poster`,
  `fanart`, `logo`, and `thumb` for an episode, of `GET /api/libraries/{id}/items`), a dry run counts them apart from the ones already
  there, and a batch's detail lists what was written
  (`extras` of `GET /api/batches/{id}`, from the journal's `generated` and `downloaded` entries).
- **What the NFO carries beyond the basics.** `<tag>` (TMDB keywords, English, not translated) and
  `<mpaa>` (age rating), both read by Plex and Jellyfin; both come with the details request
  (`append_to_response`), so no extra call. The rating's country follows the metadata language (`fr`
  gives `FR`, `en` gives `US`, `en-GB` gives `GB`), then the US, then the first one TMDB lists
  (`providers/tmdb/src/certification.ts`); a movie takes its theatrical release's. A bare number is
  written with its country (`FR:16`, `FR:-18`), a named one as is (`PG-13`, `TV-MA`): the separator is
  a colon because TMDB sometimes sends `-18`. The format of the prefix is our choice, neither player
  documents one. Left out on purpose: TMM's `<crew>`, `<producer>` and the actor `<profile>` /
  `<tmdbid>`, which neither player's documentation lists.
- **The logo** (`kind: logo`, `clearlogo.png` with `metadata: nfo`): TMDB's `images` come with the
  details request (`append_to_response`; `include_image_language` is the metadata language, then English,
  then textless), so no extra call. `pickLogo` (`providers/tmdb`) takes the metadata language first, then
  English, then a textless one, the best voted of each (PNG or JPEG only) as `Details.logoPath`. A work
  with none in those languages (a Chinese-only series) costs one more request, `/images` with no
  language filter (the one the dialog uses, so cached once), and takes a textless logo or, last, one in
  any language: a foreign logo beats none, and the dialog can replace it. A work with none at all writes nothing, and a movie written flat gets none (every movie would claim the same file).
  TMDB serves logos in widths of its own, with no `w780`: the profile loader refuses any `size` but
  `original`. It is tracked like the poster and fanart (`logo` of the items and of the shows,
  `library.writes.logo` for the column): a work missing only its logo is `incomplete`,
  so "Refresh" writes it, and it is under `missing-artwork`.
- A series NFO also carries `<uniqueid type="tvdb">` (`SeriesDetails.tvdbId`, TMDB's `external_ids`), after
  `tmdb` (the default) and `imdb`; a test holds the tmdb id of the name, `<id>` and the default `<uniqueid>`.
- **Changing an image** (`artwork.ts`, `artwork-routes.ts`; the web's `ImagesDialog`): the poster,
  background and logo of a movie, or of a show (its own folder, never a season's; a season's poster is
  out), and the thumbnail of an episode (below). `GET .../images` lists what TMDB offers in **every language** (`MetadataProvider.listImages`, no
  `include_image_language`, in TMDB's order: the web sorts by the library's language and filters by language) and what is in place; `POST` writes one to three images as one batch.
  The page of a work says whether to offer it (`images` of `GET .../items/:itemId` and `.../shows/:tmdbId`:
  which files are on the disk, `null` when the profile writes none or the work has no folder of its own;
  the list's `poster`/`fanart`/`logo` flags mean "nothing planned is missing" and say nothing of the disk).
  - **A replacement is an explicit, journaled operation, apart from the pipeline.** `replaceAtomic`
    (`fs-ops.ts`) is the only primitive that overwrites, called by `replaceImage`, by undo and by
    `backupAndReplace` (the executor, for the files of a corrected work, see "Libraries and scan": only
    ones Kinoshelf wrote and nobody touched); the planner and `writeAtomic` still refuse to. The old file goes to
    `<config>/replaced/` (journal entry `replaced`, column `backup`), and undo restores
    it unless the file changed since (`undo.destination-changed`). Backup and restore keep the file's
    date, or the journal's identity check would fail on the second undo. The NFO is not rewritten: it
    names no image.
  - **No image library**: JPEG and PNG only, read from the bytes, dimensions from the headers, WebP
    refused. The format must be the one the profile writes (`poster.jpg` JPEG, `clearlogo.png` PNG), else 422
    `image.format-mismatch`; the list offers only compatible candidates.
  - **An address (`source: "url"`) is fetched by the server** (`custom-image.ts`): http(s), three
    redirections, 15 s, 20 MB. Addresses on the local network are refused by default
    (`allowLocalImageUrls` in `config.yaml`, Settings › Processing; no variable, so no 409). The check
    is on the **resolved IP at connection time** (`lookup` of `http.request`, not `fetch`) and at every
    redirection. `POST .../images/preview` downloads the same way, for the dialog, and keeps nothing;
    it answers with the image as a `data:` address, the only foreign thing the page's policy allows.
    Every image is downloaded before any is written: one failure changes nothing.
- **An episode's thumbnail** (`kind: episode-thumb`, `<video>-thumb.jpg` beside the video, one per version): TMDB's
  `still_path` (`EpisodeInfo.stillPath`, already in the season request, so no extra call) downloaded at its
  `original` size, TMDB having no `w780` for stills. Plex's NFO agent, Jellyfin and Kodi all read
  `<file>-thumb.jpg` (checked on all three; Kodi does not read the bare `<file>.jpg`, Jellyfin's
  documentation only gives the `-thumb` name, Plex's could not be read). Without it Plex showed a black
  square and Jellyfin the season's image. An
  episode with no still on TMDB gets none. **Tracked per file** like the NFO (`thumb` of `library_items`,
  `CompanionKind` `thumb`): an episode whose planned plan still holds the
  download is `incomplete` (so "Refresh" writes it) and under `missing-artwork`. An episode TMDB has
  no still for plans nothing, so it reads as there, as a work without a logo does. The files tell
  the thumbnail from a season poster by the profile's names (`isEpisodeThumb`), not by a stem. The
  web shows it in the tree's "Thumbnail" column (`writes.thumb`, an episode's versions together) and
  in the episode panel, as **one image for the episode**, never per version; a show or a season
  carries no total. Players pick the version's own `<file>-thumb.jpg` (Jellyfin changes it with the
  quality being played), so every version gets a copy, and a **single choice** writes them all.
  - **Changing it** (`.../shows/:tmdbId/seasons/:season/episodes/:episode/images`, the same routes as a
    work's, with the type `thumb`, the only one an episode has; its poster, background and logo are
    `null` there): `Artwork.episode` finds the files holding the episode (a multi-episode file is the
    episode's too, with the first one's stills offered) and `apply` writes the one picture to each
    version's `.jpg`, replacing (backup, journal) or creating, as **one batch** so one undo puts all
    back. TMDB's `/tv/{id}/season/{n}/episode/{n}/images` gives the stills (`listEpisodeImages`, the
    provider's, listed only: the dialog downloads through our own server). The dialog takes `kinds`
    (`EPISODE_KINDS`: one tab, so none is drawn); the panel shows the image in place
    (`.../images/thumb/file`, the first copy found) and "Change the image" / "Add an image".
- **An image TMDB has none of is "unavailable", not "present" or "missing"** (`PlanItem.unavailable`,
  `unavailableImages` in `companions.ts`, `library_items.unavailable`): the
  planner lists the poster, fanart or logo the profile writes that the details give no path for,
  except one already on the disk (a logo added by hand is simply there). The flag stays as it was
  (nothing is missing, so the item is not `incomplete`), and the list and the page draw a plain
  uncoloured dash with "not available on TMDB". **Movies**: the item's flag stays as it was. **Shows**:
  every episode row carries the show-folder images TMDB lacks (same planner check, the disk first), the
  show's `unavailable` is their union (`.../shows`), and the list draws a dash where `SeriesFiles` found no
  file (`lacksOnTmdb`; a file on the disk wins). `missing-show-files` (`?incomplete=true`, the count)
  leaves such an image out, since no refresh could write it. A season's poster and an episode's thumbnail
  are not covered.
- Not done: no episode `uniqueid`, no `<fileinfo>` (the player reads the file). A movie's collection is written (see "Collections" below).

## Collections

A movie's **collection** (a saga) exists for a player only through the NFO's `<set>`, so only a movie
library that writes NFO (`metadata: nfo`) has them: with `none` there is no column, filter, sort, panel
section or bulk action (`hasCollections`, `library.collections` of `GET .../items`).

- **Where it comes from, at no extra call.** `/movie/{id}` (already read for the NFO) carries
  `belongs_to_collection`; `MetadataLoader` adds one `/collection/{id}` per saga (overview and `parts`, shared
  by its movies, cached by the provider) and reports it as `LoadedMetadata.collection` (`null`: read, in none, so
  a collection the movie left is forgotten; absent: not read). `analyze`, `Service.planGroup` and `Service.plan`
  record it (`CollectionStore.record`: `collections`, `movie_collections`). Nothing is
  fetched on a listing. A part with no release date or one still to come (a rumoured or planned film)
  is left out of `parts`, hence of the total (`getCollection`): `/collection` gives no status, and the
  library could never hold it. A stored collection takes a part in once a movie of it is read again.
- **The owner's choice is kept apart** (`collection_overrides`, per library and movie): absent is TMDB's, `none`
  is no collection, `custom` is a name with no TMDB id. A scan rewrites TMDB's record and never this table;
  `analyze` takes it through `collectionOverride`, so an NFO written later follows it. `effectiveCollection`
  (core) is the one rule: one `<set>` per movie, since Kodi and Plex's NFO agent read only one.
- **`<set>`**: `<set tmdbcolid="645"><name>…</name><overview>…</overview></set>` for TMDB's, `<set><name>…</name></set>`
  for the owner's, nothing for none. Never the short form `<set>Name</set>`: Plex's agent does not read it.
- **The rows carry it** (`library_items.collection_key|name|total`, refreshed by `regroup`, so every write path
  keeps them right): `t:<id>` or `c:<name>`. What the library holds of a collection is counted when read
  (`HELD`, a movie once whatever its versions), so a film arriving updates the `2/3` with no TMDB call.
- **Changing it rewrites NFO, which is the one exception to "never overwritten"** (`CollectionEditor`,
  `PUT /api/libraries/{id}/collection`, `rewriteNfo`): the NFO is generated whole again, and only if Kinoshelf
  wrote it and nobody touched it since (`madeByUs`), else it is `kept` and the answer says so. The old one goes
  to `<config>/replaced/` and the batch (`replaced` entries) can be undone. Nothing moves. TMDB is read before
  anything changes, so a failure leaves the choice as it was.
- **The web** (`CollectionDialog`, `lib/collections.ts`): the column and the Collection group of the
  Filters panel show once a library has a collection (`?collection=in|out|incomplete|<key>`,
  `?sort=collection` in the URL), filing stays offered in the bar before that. Sorted by collection, a line
  opens each group (`Dragons - Saga · 2 of 3`, then "No collection"). A movie's page holds one fact line (name, the list's pastille, "Show in the list", an Edit / Set button); the edition is `CollectionDialog`, which also serves the bar's "Set the collection…" in multiple mode (nothing preselected, no saga, no preview). Every settled movie can be ticked, not only the ones
  to rename. Collection images are out of scope: no convention is shared by the players.

## List header

A library's list has two rows above it (`ListToolbar`, `ListFilterRow`, `lib/list-filters.ts`, the rules tested
in `list-filters.test.ts`). The **toolbar** is the search box and a Filters button (a non-modal panel: Escape or a
click outside closes it, the focus goes back to the button; a sheet at the foot of the screen on a phone) whose badge
counts the active filters. The panel holds the states with their counts (one at a time, clicking the active one
clears it), "Several versions" and, for movies with collections, the Collection group. The **row below** holds the
chips of the states to handle (only those above 0, "All" always, the chosen one even at 0; "Nothing to handle" when
none), the removable pills of the traits (versions, collection) and the "2 of 5 movies" status. The panel and the
chips are the same filter.

- **The search reads the title and the file's name**, never the folders (`search_key`:
  both folded as `sortKey` does and joined by a newline, written with the row . A series list searches the show's title (`sort`). `sort_key` stays a SQL function for ordering, but a
  search never calls it: a JS call per row was most of its cost.
- **"Several versions" is not a state**: `multi=true` of `GET .../items` and `.../shows` combines with `state`
  (`multi-version` stays a key of `counts`, for its count, but is no longer a value of `state`).
- **Sorting is the column headers'** (`SortButton` in a `<th aria-sort>`): movies by title, year, collection, shows
  by title, year, missing; `sort` and `dir` of both lists, `?sort=&dir=` in the URL with the defaults left out. A
  first click goes up for a title or a collection, down for a year or a count (`FIRST_DIRECTION`, the server's
  `DEFAULT_DIRECTION`: keep them equal). Filters and sort live in the URL, so changing library (a link with no
  query) resets them.

## Libraries and scan

A **library** (`libraries:` in `config.yaml`, edited through `/api/libraries`) is a named `source` of
one of two kinds, told apart by which of `type` / `into` it has (exactly one):

- **Organized in place**: `type: movie | series`. Its source is where the works of that type live,
  so it is also a destination (mode `move` implied, no `mode` allowed). It may set `naming` and `metadata`.
- **Arrival folder**: `into: { movie, series }`, ids of typed libraries. Never a destination: what
  lands in it goes to those libraries, with its own `mode` (default `copy`). No `naming`/`metadata`: it takes
  those of its destination (until the per-library destination is built, the global one).

`threshold` and `watch` are allowed on both. Ids are generated from the name (`libraryId`) and never
change; two libraries cannot share a source (`library.source-taken`); neither a source nor a job
path may be `/`, `/proc`, `/sys` or `/dev` (`fs.system-folder`); the config refuses an `into`
that names a missing library or one of the wrong type (`library.invalid` in the API), and the API
refuses to delete a library an arrival folder points at (`library.in-use`). There is no global
`destination`: `resolveSettings` sends a kind to the first library of its type unless a flag or
`libraryOverrides` says otherwise (`--library <id>` in the CLI, `--dest*` flags win).

- `libraryOverrides(lib, libraries)` feeds `resolveSettings`; a job carries `library_id` and keeps its `PlanSettings`. Deleting a library only forgets it: its queued jobs
  fall back to the defaults. A typed library has one root for both kinds (a stray series in a
  movie library would be laid out in place; the plan shows it).
- **Scan**: `POST /api/libraries/:id/scan` queues a job on the whole source (409
  `library.scan-in-progress`). The scan's files are read from the snapshot below
  (`GET /api/libraries/:id/items`), not from the job. A batch runs through
  `POST /api/plans/:id/execute` with `entries`; only the files to rename are
  selectable, the others go through the arrivals or the review filter.
- **Two lanes** (`runner.ts`): analyses and transfers each run one at a time, and together only when
  they touch no common folder (`overlaps`, from `Service.touches`: the job's path and the destination
  roots of the executable entries). A scan replaces a library's rows as a whole, so one running while
  files move into the library would leave a stale view. Without a verdict, or when it cannot be told,
  they stay serial. The idle hook (probing, completeness) fires only when both lanes are free.
- **Arrivals** (`GET /api/arrivals`, `?state=ready|review|unrecognized`): what the arrival folders (and paths
  sent by hand, which belong to none) hold that needs a human; a library organized in place never
  lands there. `ready` is a file matched with confidence (`to-rename`) that no transfer holds: its job
  was an analysis only (`watch.apply` off) and nothing queued it, so without this state it had no way out
  of the UI. `READY_ENTRY` (`entry-sql.ts`) leaves out a file a queued or running execution holds, so a
  click never stacks the same work. The web's "Transfer" and "Transfer all" are
  `POST /api/plans/{id}/execute` with `entries` (`startPlanned`), with no new match; changing the
  candidate, library or size goes through `match` as before. Each item carries its `release` and `detached`; the web groups them (one line per release,
  the detached listed under it). `POST /api/entries/:id/{match,preview,ignore}` settle a file or its release. **`match` is
  asynchronous** (202 at once, `MatchTracker` in `matches.ts`, in memory): the release is planned in the
  background as **one** `createPlan` (so versions of an episode are told apart together, as in an
  analysis), and `GET /api/entries/:id/match` says `running` (`done`/`total` files, announced by the
  `progress` event), `done` (the file and its `followers`) or `failed` (the cause). One match per release
  at a time, and a file held by a queued or running transfer is not matched, previewed or ignored (409
  `queue.match-in-progress`, `queue.entry-held`). The web follows it in `validate`, reading the state on each `progress` event (`onTopics`, no polling), and keeps the state
  per entry (`validations.svelte.ts`), so a row says "Validating… 3/20" whatever panel is open. The destination of an
  arrival is the library of its kind in the folder's `into` (the first of its type for a path sent
  by hand), unless `libraryId` picks another one of the work's kind (422 `library.wrong-type`): it is
  stored on the file (`job_entries.destination_library_id`), not on the job, and the
  file is planned, executed and written to the snapshot with **that library's profile and root**
  (the mode stays the folder's). A job whose files go to several libraries is executed as one plan
  per library under one batch. Nothing is remembered about a work: `libraryId` is for that file (and
  the release mates that follow it), and the next arrival of the same work takes its folder's `into`
  again (`work_destinations` is gone). Once a job is stored,
  `Service.planArrivals` plans each file matched with confidence again for the library it goes to
  (the analysis used the global profile); a file left unmatched keeps waiting.
- **The router reads the query** (`lib/router.svelte.ts`: `router.path` is the path alone, `router.query` the
  `?query`, `router.setQuery` changes it in place, with no history entry). The state filter of a library and of
  Arrivals is `?state=…` (`oneOf` drops a value the filter does not know). The open tree of a series is too: `?open=<tmdb ids>` for the
  shows and `?seasons=<tmdb id>:<season>,…` for the seasons (`listOf`/`listParam`).
- **Events** (`GET /api/events`): the payload-less topics are `jobs` (queued, started, ended), `progress`, `arrivals` (files waiting for a human changed:
  match, ignore, cancel, a job ending), `history`, `settings`, and `ready` on each (re)connection.
- **Snapshot** (`library_items`, `library-items.ts`): what a typed library holds,
  as its last scan saw it (title, year, tmdb id, state, presence of NFO / poster / fanart / logo / thumb, entry id).
  Replaced as a whole when a scan of the whole source ends, then patched by path after a transfer,
  an undo or a manual match, so listing never reads the disk nor asks TMDB. `GET
/api/libraries/:id/items` lists it (filters `review|rename|unrecognized|missing-nfo|missing-artwork`,
  `q`, paging, counts); `/items/:itemId` adds the work's details and `ffprobe`. An arrival folder
  has no snapshot; what an arrival sends to a typed library is added to that library's rows once
  transferred.
- **The "To validate" node of a series library groups like Arrivals.** The items of `GET .../items` carry
  `release` and `cluster` (filled by that list only, from `job_entries`; `null` elsewhere): `groupSettling`
  (`lib/library-items.ts`) makes one row per release and series, and the panel says how many files the
  choice covers (the preview shows the series' folder, `folder` of `POST /api/entries/{id}/preview`, rather than one episode). Once validated or ignored, a group stays locked ("Transfer started") until a reload no longer lists it.
- **`library_shows`** is the list of shows kept as rows, a cache of `library_items`: one per show, with the
  counts (`rename`, `incomplete`), which states and missing files it holds and whether it has several versions. Every write of
  `LibraryItemStore` names the shows it touches (`changed(library, shows)`; no argument means all) and the next read settles
  them (`settleShows`); a library is rebuilt whole the first time it is read in a process. **A new writer of `library_items`
  must name its shows**, or the list shows stale rows (a test holds it). `series_completeness` and `series_files` are joined at read.
- **`library_works`** is the same for a movie library: one row per list entry (a movie whatever its
  versions, or a file nobody identified), with its lead file's title, year and path, the flags of its files, its collection.
  `regroup` names the works a write touches (`staleWork`) and the next read settles them (`settleWorks`); the whole library is
  rebuilt the first time it is read in a process. **A new writer of `library_items` must call `regroup`** (and name its shows,
  above). Without a search a list reads these flags; with one, a single file must meet every condition, so the files are asked.
  `groups` of `GET .../items` is a validation's count and is read from the files for the `review` and `unrecognized` filters
  only; anywhere else it is `total`.
- **Series** (`completeness.ts`): a row of a series library carries `season`,
  `episode` and `episodeEnd` (a file holding `S01E02E03` is one row, `episode` its first and
  `episodeEnd` its last). `GET /api/libraries/:id/shows` lists one row per work (files nobody identified
  are not shows: they stay under the `review` and `unrecognized` filters, and the tree puts them in a
  "To validate" node at the top), `GET .../shows/:tmdbId` gives it season by season: `present`,
  `missing`, `unaired` or `extra` (a file TMDB does not list). A missing episode is one that has aired
  and no file holds; an episode with no date or a future one is never missing, and the specials
  (season 0) are listed when present and never counted. **The scan never calls TMDB more for it**: the
  count is made when a show is opened (`Completeness.report`, TMDB's cached `getSeason`), and
  otherwise by `Completeness`, a queue like `ProbeQueue` that runs only while no job does and counts
  the shows whose `signature` (the episodes that were there) differs from the stored one
  (`series_completeness`, disposable). Until counted, `missing` is `null` (no badge); a TMDB failure
  leaves it so and the page still lists the files (`determined: false`). `counts['missing-episodes']`
  counts shows, not files, and is not a filter of `GET .../items`: it narrows `.../shows?missing=true`.
  The NFO column of an episode is its own `<file>.nfo`. The show's files (`tvshow.nfo`, poster, fanart, logo) and
  a season's poster are looked for **on the disk** by `SeriesFiles` (`series-files.ts`, `series_files`, disposable) once a series library's rows change (scan, transfer, undo, startup), in
  one go for the burst, then emit `history`: `GET .../shows` gives `nfo`/`poster`/`fanart`/`logo` per show and
  `GET .../shows/:tmdbId` a `poster` per season, `null` when the profile writes no such file, when no video
  of the show is in place yet (its folder is unknown) or before it was looked at. The planner cannot say it:
  it leaves out what exists, and keeps a show-level file on one episode only (`shareCompanions`). `missing-show-files` is a tree filter (it counts shows, like `missing-episodes`): `GET .../shows?incomplete=true`
  keeps the shows lacking a file of their own or a season poster. **A series library's tabs count shows**
  (`counts(libraryId, series)`) and always show the tree: `GET .../shows?state=rename|missing-nfo|missing-artwork`
  keeps the shows holding a file of that state. The exception is `review` and `unrecognized`: those files belong
  to no show, so their tabs list only the "To validate" node and count it as the node does (`groups`: a release's
  episodes once). A movie library counts files.
- **Scan one folder again** (`POST /api/libraries/:id/rescan`, body `{ path }`, `jobs.rescan`): a movie's folder, a show's or a season's, from the movie page, the show panel and the
  season row. The path must be strictly inside the source (422 `library.outside`; a file loose in the
  source is read alone). The job is read as a scan of the source would read it (`parserRoot` keeps the
  show's and the library's folder names in the parser's paths) and, when it ends, `LibraryItemStore.replace`
  swaps only the rows under that path, probes kept. It shares the guard of a whole scan
  (`library.scan-in-progress`, both ways) and `lastScan`, so its progress and failure show as a scan's.
  TMDB is asked as for any scan (one search per release, seasons cached), nothing more. The web builds
  the path from the files it knows (`rescanPath`): a show whose files lie loose in the source has none,
  and no button. "Send again" of a failed one goes through the same route (`resendRequest`).
- **Correcting the work of a folder** (`candidate` in the body of `POST /api/libraries/:id/rescan`, server
  `jobs.candidate`; the web's `RematchButton`, on a movie's page and a show's): the
  same scan of one folder, but `analyze` takes the chosen work as the match of every file of its kind
  (`AnalyzeOptions.forced`: no search; an episode is never forced to a movie) and the candidate must be of
  the library's type (422 `library.wrong-type`). Nothing moves: the rows come back `rename`, named after the
  new work, and the usual "Rename" (preview, batch, undo) does the rest. That rename relies on what exists
  already: a sidecar NFO Kinoshelf wrote does not follow the video (`madeByUs`), and the old folder is pruned
  when only files Kinoshelf made remain. When the video is already where the new work wants it (`no-id`
  naming and the same title, so the folder keeps its name), the NFO and images Kinoshelf wrote for the former
  work are **replaced** (`PlannerOptions.replaces`, set by `analyze` with `forced`; `replace: true` on the
  `write-file`/`download` operation): the old file goes to `<config>/replaced/` (`backupAndReplace`, journal
  entry `replaced`) and undo puts it back, and the executor re-checks `madeByUs` right before writing (a file
  edited since, or one that was never ours, is skipped as taken; so is any without `backupDir`). Such a plan
  leaves the item `incomplete`, so it shows under "Refresh". "Send again" of a failed correction scans
  without the choice (the job's candidate is not in the API).
- **Rename and refresh** (`POST /api/libraries/:id/execute`, body `{ items, dryRun? }`): the items are
  the `id`s of the library's list. The server finds each one's entry and scan job (`entryId`,
  `scan_job_id` of its row), keeps what is still executable, and runs one plan per job under one batch
  (the same machinery as `POST /api/plans/:id/execute`; nothing new is planned). "Rename" is the
  items in state `rename`, "Refresh" those in state `incomplete`: the scan already planned only the
  missing `write-file`/`download` operations for a video that is in place, so refreshing never
  overwrites anything and never re-reads TMDB for what is there. A video in place with any write
  still planned is `incomplete` (`describe`, `library-items.ts`), not only one whose own flags (NFO,
  poster, fanart, logo) are false: the files of a show and its seasons' posters go with its first
  episode and have no flag, and a show lacking only those would otherwise have no box to refresh it.
  A dry run answers 200 with the
  report (entries are the items' `entryId`) and `skipped` (nothing to do: done, never scanned,
  unknown); otherwise 202 with the executions, and the batch shows in the history and can be undone.
  409 `library.nothing-to-do` when nothing is left. The web's "Rename preview" dialog (`RunDialog`)
  is the dry run, then the run. Rows added by an arrival carry no entry: they have nothing to run.
  With `version: true` the chosen movies and episodes are planned again with `applyVersion`,
  named with their label though already in place (a `move` in the same folder, undoable); the size
  is the request's `screenSize` when given, else the one in the stored `parsed` of the scan, so
  without either (an older scan, a name with no size) the file is read with ffprobe when the
  setting is on, else refused
  (409 `library.version-unavailable` when all are, else `skipped`). A dry run changes nothing; the run
  stores the new plans (`commitVersions`) then queues the execution as any other.
- **A stored plan is as old as its analysis.** Two releases of one movie are two jobs planned before
  either moves, so `Service.prepare` plans a movie or an episode again, against the disk as it is,
  when its main destination exists by the time it runs, or when it says no size and another version of
  the work now sits beside it (`refreshed`); one left without a free name waits in Arrivals as a
  `destination-exists` conflict (also when the name is taken between the plan and the write), it is
  not marked failed. Transfers run one at a time, so the second job sees the first.
- **Scan progress** (`progress.ts`): `GET /api/jobs/:id` and the `scan` of
  `GET /api/libraries/:id/items` carry `progress` (`phase` discover|read|identify|plan, `found`, `done`,
  `total`, `current`, `idleSeconds`) while an analysis runs, `null` otherwise. It lives in the
  server's memory (`ProgressTracker`), never in the database: a restart runs the job again from 0.
  `idleSeconds` is the server's clock, so the web can say "still running" past a minute without
  trusting the browser's. Every change emits the payload-less `progress` event, at most twice a second;
  only a view showing a scan listens to it, and reads `GET /api/jobs/:id` alone (`jobs` reloads every list).
  The core reports through `discoverVideos`' `onFound`, and `analyze`'s `onParsing` (names read: synchronous, so
  slices of 20 ms leave the event loop free), `onMatching`, `onProgress` (with the file) and `onPlanning`.
- **ffprobe** (`probe.ts`): `ProbeQueue` fills `video`, `audio`, `size`, `mtime`, `probed_at` in the
  background, only while the job queue is idle (the runner's `idle` hook wakes it), and goes
  over every row of a library (`refresh`) when a scan ends and at startup. A scan keeps the probe of a
  path it sees again, so the size and date are what tell a file replaced under the same name: a row
  whose size and date are unchanged costs one `stat` and is not read again. A page's probe jumps the line. Missing `ffprobe` remembers nothing; a file it cannot read is
  remembered empty. Tests use a fake prober; `probe.test.ts` reads a real clip made with `ffmpeg`.
- The folders the watcher uses are `watchedFolders(config)` (the libraries with `watch: true`),
  read-only in the settings; `watch` keeps only `settleSeconds`, `pollSeconds` and `apply`.

## Getting downloads in

Kinoshelf **never polls a live download folder**: a stalled torrent and a finished one look the same
on disk, so no heuristic (stable size, suffix) is trusted to decide. Three entry points, all ending
in the same job queue:

- `kinoshelf submit <path>` (`packages/cli/src/submit.ts`), meant for a client's on-completion hook:
  `POST /api/jobs` with `KINOSHELF_API_KEY` / `KINOSHELF_URL` from the environment (no key on the
  command line). Recipes per client are in the README.
- `FolderWatcher` (`packages/server/src/watcher.ts`, `watch:` in `config.yaml`, `GET /api/watch`): for
  a folder that **only holds finished downloads**. `fs.watch` (inotify) only wakes a scan; the scan
  judges completeness (every file unchanged for `settleSeconds`, no `.!qB`/`.part`-style suffix) and
  submits a release (a folder under the watched one, or a loose file) once, remembered in
  `watched_files` (keyed by path, size and date). `pollSeconds > 0` replaces events
  for network shares; if events cannot be had it falls back to a minute-long poll and logs it.
- A manual **Check now** (`POST /api/watch/scan`, which skips the settling time but never an
  incomplete suffix); the web button is at the top of the Arrivals tab, disabled when nothing is watched.

Backlog, not built: reading completion from the client's own API (qBittorrent, Transmission), which
would need one plugin per client. Watching the raw download folder stays out by design.

## CLI and i18n

- `kinoshelf scan <source>` (read-only report), `process <path>` (dry run unless `--apply`),
  `undo` (dry run unless `--apply`). `--json` prints codes and parameters, never translated text.
  Exit codes: 0 ok, 1 a run or an operation failed, 2 bad usage.
- `kinoshelf tidy [--library <id>] [--json]` (`core/src/maintenance/tidy-report.ts`) is a **read-only** report on the
  libraries organized in place (never an arrival folder): the folders holding no video at the depth of a work
  (a movie's folder; a show's or a season's in a series library; deeper ones, `Subs` or `Extras`, belong to a work
  that has videos), with what is in them and how many files are neither NFO, image nor subtitle; and, in a movie
  library only, the metadata another tool named after the video (`<video>.nfo`, `-poster`, `-fanart`, `-clearlogo`),
  with the name Kinoshelf writes instead and whether it is already there. A folder with a link or an unreadable part
  below it is skipped (it cannot be called empty of videos). Nothing is removed or renamed yet: the actions (images
  renamed to the profile's names, the rest sent to `<config>/replaced/`, undoable) are to be built from this report.
- Settings: flags over `config.yaml` over defaults. Config dir: `--config-dir`, then
  `KINOSHELF_CONFIG_DIR`, then `$XDG_CONFIG_HOME/kinoshelf`; it also holds `kinoshelf.sqlite`
  (journal and TMDB cache). Default mode is `move` when the destination is the source folder,
  `copy` otherwise. Movies and series may go to separate libraries (`--dest-movies`,
  `--dest-series`), as Plex recommends.
- New user-facing text goes in **both** `packages/i18n/src/en.ts` and `fr.ts` (same keys, same
  `{parameters}`; tests enforce it). The catalogs are shared by the CLI, the server and the web UI. A new core error code goes in `ERROR_CODES`
  (`packages/core/src/error-codes.ts`) and needs an `error.<code>` message: it does not compile
  otherwise.
- guessit-js may return arrays where its types promise scalars (conflicting readings of a folder
  and a file name). `GuessitParser` treats any unexpected type as absent; keep it that way.

## Matching corpus

`packages/corpus` (private) holds real release names with their expected outcome
(`data/corpus.json`: matched to this tmdb id, season and episodes, or `review` when a human must
decide) and replays them offline against recorded TMDB responses (`data/recordings.json`), so CI
needs no key. It runs with `pnpm test` (or `pnpm test:corpus`). Two gates:

- **Zero wrong automatic matches**: a file renamed to the wrong work, or renamed when it needed
  review, always fails. Missing a match (sent to review) is safe and only lowers the rate.
- **The pass rate may not fall below `data/baseline.json`** (a ratchet): raise it when it
  improves; lowering it needs a justification in the PR.

Most entries come from real libraries (marked `from a real library`, paths cut to their last three
segments, which is all the parser reads); French ones carry `"language": "fr"`, as the CLI would
ask TMDB. Real names exposed what invented ones hid, and fixed in the matcher and the parser:
`marginFullGap` set to the weight of one criterion, apostrophe-tolerant title comparison, the part
after a dash in `Title - Subtitle (Year)` read as the rest of the title, a folder name no longer
taken for the show, and bare numbers (`2049`, `116`, a year as a season) no longer read as episodes.
Entries that keep failing on purpose are noted as `known gap` with the reason.

To add a library or investigate a mis-handled name, follow `packages/corpus/README.md`: the
`analyze`, `inspect`, `probe`, `compare`, `select` and `merge` scripts there reproduce the whole
workflow, including the checks that a change regresses nothing.

`pnpm corpus:record` stores only what Kinoshelf reads (search results, alternative titles, season
episodes), which keeps `recordings.json` under a megabyte.

Add an entry whenever a real file is mis-handled, then `pnpm corpus:record` (needs `TMDB_API_KEY`
in `.env`; it fetches only what is not recorded yet, `--refresh` records it all again and rewrites
most of `recordings.json`) and `pnpm corpus:report` to see every verdict with its
score and runner-ups, which is how the weights in `matching/config.ts` get calibrated. Check that a
new entry can fail: break the matcher on purpose and see it go red.

## Stack

Node.js 26, TypeScript (strict, ESM, NodeNext), pnpm workspaces, Vitest, ESLint
(`strictTypeChecked`), Prettier, SQLite (`node:sqlite` behind `core/src/sqlite/database.ts`), Fastify, Svelte 5.

## Environment

NixOS: Node and pnpm come from the flake. Run commands through `nix develop -c <cmd>` (or direnv).
Nix only sees git-tracked files: `git add -N <file>` new files before `nix flake check`.
`flake.nix`: no `flake-utils`; validate with `nixfmt`, `nixd` and `nix flake check`.
TypeScript is pinned to 6.x until typescript-eslint supports 7.

## Commands

```sh
pnpm typecheck      # tsc -b + tsconfig.check.json (includes tests)
pnpm lint
pnpm format         # prettier --write
pnpm test           # builds then runs Vitest
pnpm test:corpus    # matching corpus; a success-rate drop must fail the PR
pnpm test:e2e       # web UI in a real browser (Playwright), against the real server and a fake TMDB
```

Run `pnpm typecheck && pnpm lint && pnpm format:check && pnpm test` before considering work done;
`make check` does the same, and the `Makefile` also wraps the other scripts (`make help` lists them).
`pnpm test:e2e` is separate (it needs a browser: the Nix shell provides it, CI installs
Chromium) and runs in its own CI job; `@playwright/test` is pinned to the version of nixpkgs'
`playwright-driver`, so bump both together.

## Conventions

- Define types/interfaces before implementations; write tests along with the code.
- Comments explain _why_, not _what_; match the surrounding density and naming.
- Commits: one concern each, in distinct commits when a change touches several; ask before
  committing. Before relying on a result, verify it independently; before trusting a new rule,
  break it on purpose and watch a test go red.
