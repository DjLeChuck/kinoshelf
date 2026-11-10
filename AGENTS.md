# AGENTS.md

Kinoshelf: self-hosted web app (MIT) that identifies video files already on disk (movies, series),
renames them for a media player (Plex, Jellyfin) and writes their metadata (NFO, artwork).

## Where we are

The core, the CLI, the matching corpus, the REST server, the notifications and the multi-arch Docker
image are done, and so is getting downloads in (see "Getting downloads in" below). The web UI has three
entries: Libraries, History and Settings. A welcome shows at `/` on the first
launch (`GET`/`PATCH /api/onboarding`, server migration 009) and the app then opens on Libraries. The
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
`with-id`) puts `{tmdb-<id>}` in the movie and series folders and the movie file, or nothing;
`metadata: none | nfo` (default `none`) writes Kodi NFO and artwork, or nothing. They are set globally
(`naming`/`metadata` in `config.yaml`), per typed library, or by `--naming`/`--metadata` in the CLI.
No combination belongs to a player: Plex's default agents read `none` (`with-id` or `no-id`), and
Plex's NFO agent and Jellyfin both read `nfo`, whose `<uniqueid type="tmdb">` makes the id in the name
a safety net (Jellyfin's documentation recommends it, but `no-id`/`nfo` was checked on a Jellyfin
instance and works, as on Plex's NFO agent). `loadProfileFile`/`parseProfile` (custom YAML) stay in the core but are wired
nowhere: a custom profile file is to be discussed again.

- **One layout for both players**, as close as they allow, so one library reads the same under either and
  switching costs next to no renaming: the same id tag (`{tmdb-<id>}`), NFO files (`movie.nfo`,
  `tvshow.nfo`, `<file>.nfo`), image names (`poster.jpg`, `background.jpg`, `logo.png`, a season's
  `season01-poster.jpg` in the show's folder, `season-specials-poster.jpg` for season 0), `Season 01`
  folders and episode names (`Show (2022) - s01e01`, ranges joined with `-e`: a `s01e04-e05` file gave
  two episodes in each player). Before adding a rule, look for a name both players read and use it;
  make it specific only when there is none, after checking both documentations (and Jellyfin's code,
  which reads more than it documents), and say why in `build.ts`.

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
  (as Jellyfin; no season NFO, Plex ignores it), `poster.jpg`, `background.jpg`, `logo.png` and a season
  poster `season01-poster.jpg` in the show's folder, or `season-specials-poster.jpg` for season 0 (the
  artwork's `specialsName`). A season's poster is a show-level file, written with `tvshow.nfo` (so a
  partial selection hands it, like the other show files, to any chosen episode of the show).
  Plex documents `Season01.jpg` instead, but the agent reads Kodi's name too (checked on PMS 1.43.5:
  with only `season01-poster.jpg` on the disk, the season took it) (`no-id`/`nfo`: no id in the names, since the NFO carries
  `<uniqueid type="tmdb">`).
- Jellyfin (`with-id`/`nfo`): `{tmdb-<id>}` (the same as Plex's; Jellyfin's documentation gives `[tmdbid-<id>]`, its code reads `tmdb` as an alias and any of brackets, parentheses or braces) in the movie and series folders and in the movie file (the file
  must start with its folder's name), `SxxExx` episodes, `movie.nfo`, `tvshow.nfo`, `<file>.nfo`,
  `poster.jpg`, `background.jpg` and `logo.png`. A season's poster is Kodi's `seasonNN-poster.jpg` in the show
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
  episodes name, 1 and up the others (`AnalysisEntry.cluster`, `job_entries.release`/`cluster`,
  migrations 016 and 017). Each cluster is matched and validated as a whole; the UI lists the other
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
  `plex.unreachable`. **The state is in the database** (`plex_auth`, migration 026: a secret that
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

## History

One list for what Kinoshelf did (`GET /api/history`, `History.activity`): a **batch** is a line
(`GET /api/batches/{id}` for its files and `POST .../undo`), and a **job** is one only while it has no
batch: waiting, running, or failed. A job that made a batch is folded into it (the batch's detail embeds
the job: cause, frozen settings, "Send again"). A batch made by the CLI has no job.

- **Hidden is not deleted.** A job that finished and moved nothing (an analysis whose files wait in
  Arrivals, or sit in an organized library) is `routine`: left out of the default view, listed with
  `?all=true` (the "Show every analysis" box), and still in the database until the daily purge
  (`purge.ts`) forgets it. The journal is never purged, so any batch stays undoable.
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
  probe read (`picture`, server migration 028; `resolutionOfItem`), so a list never reads the disk. The probe
  (`hdr`, `audioLanguages`, `subtitleLanguages`, server migration 025) fills the details of each
  version; the list reads them from the snapshot (`file`: `null` until probed) and never probes.
  Languages are ISO 639-2 as the file tags them, shown short (`fre` gives `FR`), an unknown code as is.
- **The web** (`LibraryView`, `ShowsTree`, `ItemPanel`, `EpisodePanel`, `CoverageMatrix`,
  `VersionBadges`, `SlotBadges`): one line per work with a chevron when there are several versions;
  `GET .../shows/:tmdbId` gives one episode per number with its `versions[]` and the `nfo`
  `{expected, present}` tallies. The episode panel reads the episode, not each file: one **Thumbnail**
  block and one **NFO** block (a status for all the versions, and one "Generate the missing NFO" that is
  Refresh for every version lacking it), then a card per version that keeps only what is the file's own
  (name, codecs, "Rename", "Add the version to the name"). `canNameVersion` is false when the name
  already ends with ` - <size>`.

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
  nor sends the video back to the queue. A `.nfo` beside a video travels with it as a sidecar and
  wins over the generated one, unless Kinoshelf wrote it and nobody touched it since
  (`madeByUs`, from the journal's size and date) and the plan writes the NFO of the video's new place:
  an episode matched again to another show would otherwise carry the old show's text along. A movie written flat (no folder) gets no fixed-name file
  (`movie.nfo`, `poster.jpg`, `logo.png`), which every movie would share.
- **Show-level files** (`tvshow.nfo`, the show's poster, fanart and logo, a season's poster) come with
  every episode, marked `shared`; the planner keeps the first one of the batch (`shareCompanions`).
  Running only some items (`selectItems`, the server's `prepare`) hands them from an episode left out
  to a chosen one whose video lies in the same folder, so a partial selection still writes them.
- **Journal and undo**: entries have a `kind` (`transfer`, `generated`, `downloaded`;
  `core:002-journal-kind`). Each entry keeps the destination's size and date as written
  (`identity`, `core:003-journal-identity`): a file that differs since (a poster the user replaced, an
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
- **The logo** (`kind: logo`, `logo.png` with `metadata: nfo`): TMDB's `images` come with the
  details request (`append_to_response`; `include_image_language` is the metadata language, then English,
  then textless), so no extra call. `pickLogo` (`providers/tmdb`) takes the metadata language first, then
  English, then a textless one, the best voted of each (PNG or JPEG only) as `Details.logoPath`. A work
  with none in those languages (a Chinese-only series) costs one more request, `/images` with no
  language filter (the one the dialog uses, so cached once), and takes a textless logo or, last, one in
  any language: a foreign logo beats none, and the dialog can replace it. A work with none at all writes nothing, and a movie written flat gets none (every movie would claim the same file).
  TMDB serves logos in widths of its own, with no `w780`: the profile loader refuses any `size` but
  `original`. It is tracked like the poster and fanart (`logo` of the items and of the shows, server
  migration 024, `library.writes.logo` for the column): a work missing only its logo is `incomplete`,
  so "Refresh" writes it, and it is under `missing-artwork`. Rows from before the migration have
  `null` until the next scan (a show's, until its files are looked at again).
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
    (`fs-ops.ts`) is the only primitive that overwrites, called by `replaceImage` and by undo alone;
    the planner, the executor and `writeAtomic` still refuse to. The old file goes to
    `<config>/replaced/` (journal entry `replaced`, migration `core:005-journal-backup`), and undo restores
    it unless the file changed since (`undo.destination-changed`). Backup and restore keep the file's
    date, or the journal's identity check would fail on the second undo. The NFO is not rewritten: it
    names no image.
  - **No image library**: JPEG and PNG only, read from the bytes, dimensions from the headers, WebP
    refused. The format must be the one the profile writes (`poster.jpg` JPEG, `logo.png` PNG), else 422
    `image.format-mismatch`; the list offers only compatible candidates.
  - **An address (`source: "url"`) is fetched by the server** (`custom-image.ts`): http(s), three
    redirections, 15 s, 20 MB. Addresses on the local network are refused by default
    (`allowLocalImageUrls` in `config.yaml`, Settings › Processing; no variable, so no 409). The check
    is on the **resolved IP at connection time** (`lookup` of `http.request`, not `fetch`) and at every
    redirection. `POST .../images/preview` downloads the same way, for the dialog, and keeps nothing;
    it answers with the image as a `data:` address, the only foreign thing the page's policy allows.
    Every image is downloaded before any is written: one failure changes nothing.
- **An episode's thumbnail** (`kind: episode-thumb`, `<video>.jpg` beside the video, one per version): TMDB's
  `still_path` (`EpisodeInfo.stillPath`, already in the season request, so no extra call) downloaded at its
  `original` size, TMDB having no `w780` for stills. Plex's NFO agent and Jellyfin both read the bare
  `<file>.jpg` (checked by hand on both; Jellyfin's documentation only gives `<file>-thumb.jpg`, Plex's
  could not be read). Without it Plex showed a black square and Jellyfin the season's image. An
  episode with no still on TMDB gets none. **Tracked per file** like the NFO (`thumb` of `library_items`,
  server migration 027, `CompanionKind` `thumb`): an episode whose planned plan still holds the
  download is `incomplete` (so "Refresh" writes it) and under `missing-artwork`. An episode TMDB has
  no still for plans nothing, so it reads as there, as a work without a logo does. The files tell
  the thumbnail from a season poster by the profile's names (`isEpisodeThumb`), not by a stem. The
  web shows it in the tree's "Thumbnail" column (`writes.thumb`, an episode's versions together) and
  in the episode panel, as **one image for the episode**, never per version; a show or a season
  carries no total. Players pick the version's own `<file>.jpg` (Jellyfin changes it with the
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
  `unavailableImages` in `companions.ts`, `library_items.unavailable`, server migration 029): the
  planner lists the poster, fanart or logo the profile writes that the details give no path for,
  except one already on the disk (a logo added by hand is simply there). The flag stays as it was
  (nothing is missing, so the item is not `incomplete`), and the list and the page draw a plain
  uncoloured dash with "not available on TMDB". **Movies**: the item's flag stays as it was. **Shows**:
  every episode row carries the show-folder images TMDB lacks (same planner check, the disk first), the
  show's `unavailable` is their union (`.../shows`), and the list draws a dash where `SeriesFiles` found no
  file (`lacksOnTmdb`; a file on the disk wins). `missing-show-files` (`?incomplete=true`, the count)
  leaves such an image out, since no refresh could write it. A season's poster and an episode's thumbnail
  are not covered. Rows from before the migration have none until the next scan.
- Not done: no collection overview, no episode `uniqueid`, no `<fileinfo>` (the player reads the file).

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

- `libraryOverrides(lib, libraries)` feeds `resolveSettings`; a job carries `library_id` (server
  migration 010) and keeps its `PlanSettings`. Deleting a library only forgets it: its queued jobs
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
  stored on the file (`job_entries.destination_library_id`, migration 013), not on the job, and the
  file is planned, executed and written to the snapshot with **that library's profile and root**
  (the mode stays the folder's). A job whose files go to several libraries is executed as one plan
  per library under one batch. Nothing is remembered about a work: `libraryId` is for that file (and
  the release mates that follow it), and the next arrival of the same work takes its folder's `into`
  again (`work_destinations` was dropped, server migration 018). Once a job is stored,
  `Service.planArrivals` plans each file matched with confidence again for the library it goes to
  (the analysis used the global profile); a file left unmatched keeps waiting.
- **The router reads the query** (`lib/router.svelte.ts`: `router.path` is the path alone, `router.query` the
  `?query`, `router.setQuery` changes it in place, with no history entry). The state filter of a library and of
  Arrivals is `?state=…` (`oneOf` drops a value the filter does not know). The open tree of a series is too: `?open=<tmdb ids>` for the
  shows and `?seasons=<tmdb id>:<season>,…` for the seasons (`listOf`/`listParam`).
- **Events** (`GET /api/events`): the payload-less topics are `jobs` (queued, started, ended), `progress`, `arrivals` (files waiting for a human changed:
  match, ignore, cancel, a job ending), `history`, `settings`, and `ready` on each (re)connection.
- **Snapshot** (`library_items`, server migration 012, `library-items.ts`): what a typed library holds,
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
- **Series** (`completeness.ts`, server migration 014): a row of a series library carries `season`,
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
  a season's poster are looked for **on the disk** by `SeriesFiles` (`series-files.ts`, server migration
  015 `series_files`, disposable) once a series library's rows change (scan, transfer, undo, startup), in
  one go for the burst, then emit `history`: `GET .../shows` gives `nfo`/`poster`/`fanart`/`logo` per show and
  `GET .../shows/:tmdbId` a `poster` per season, `null` when the profile writes no such file, when no video
  of the show is in place yet (its folder is unknown) or before it was looked at. The planner cannot say it:
  it leaves out what exists, and keeps a show-level file on one episode only (`shareCompanions`). `missing-show-files` is a tree filter (it counts shows, like `missing-episodes`): `GET .../shows?incomplete=true`
  keeps the shows lacking a file of their own or a season poster. **A series library's tabs count shows**
  (`counts(libraryId, series)`) and always show the tree: `GET .../shows?state=rename|missing-nfo|missing-artwork`
  keeps the shows holding a file of that state. The exception is `review` and `unrecognized`: those files belong
  to no show, so their tabs list only the "To validate" node and count it as the node does (`groups`: a release's
  episodes once). A movie library counts files.
- **Scan one folder again** (`POST /api/libraries/:id/rescan`, body `{ path }`, server migration 023
  `jobs.rescan`): a movie's folder, a show's or a season's, from the movie page, the show panel and the
  season row. The path must be strictly inside the source (422 `library.outside`; a file loose in the
  source is read alone). The job is read as a scan of the source would read it (`parserRoot` keeps the
  show's and the library's folder names in the parser's paths) and, when it ends, `LibraryItemStore.replace`
  swaps only the rows under that path, probes kept. It shares the guard of a whole scan
  (`library.scan-in-progress`, both ways) and `lastScan`, so its progress and failure show as a scan's.
  TMDB is asked as for any scan (one search per release, seasons cached), nothing more. The web builds
  the path from the files it knows (`rescanPath`): a show whose files lie loose in the source has none,
  and no button. "Send again" of a failed one goes through the same route (`resendRequest`).
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
  `watched_files` (migration 008, keyed by path, size and date). `pollSeconds > 0` replaces events
  for network shares; if events cannot be had it falls back to a minute-long poll and logs it.
- A manual **Check now** (`POST /api/watch/scan`, which skips the settling time but never an
  incomplete suffix); the web button is at the top of the Arrivals tab, disabled when nothing is watched.

Backlog, not built: reading completion from the client's own API (qBittorrent, Transmission), which
would need one plugin per client. Watching the raw download folder stays out by design.

## CLI and i18n

- `kinoshelf scan <source>` (read-only report), `process <path>` (dry run unless `--apply`),
  `undo` (dry run unless `--apply`). `--json` prints codes and parameters, never translated text.
  Exit codes: 0 ok, 1 a run or an operation failed, 2 bad usage.
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
(`strictTypeChecked`), Prettier, SQLite (better-sqlite3 + Drizzle), Fastify, Svelte 5.

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
