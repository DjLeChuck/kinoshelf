# AGENTS.md

Kinoshelf: self-hosted web app (MIT) that identifies video files already on disk (movies, series),
renames them for a media player (Plex, Jellyfin) and writes their metadata (NFO, artwork).

## Where we are

v0.1 (core, CLI and matching corpus) and v0.2 (REST server, notifications, multi-arch Docker image)
are done, and so is getting downloads in (see "Getting downloads in" below). The web UI (v0.3) has
a home (a welcome for the first launch, `GET`/`PATCH /api/onboarding`, server migration 009), its
validation queue (at `/queue`), history and settings, with a server-side path picker; the "Movies &
series" and "Libraries & scan" pages are still "coming soon". Validating a file in the queue remembers its
title (aliases). Next is v1.0: the NFO and artwork writers, and the `jellyfin` and `plex-nfo`
profiles.

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
- No automatic fallback when a hardlink is impossible: fail with an explicit error.
- Never overwrite a destination file by default: the operation goes to the validation queue.
  Enforced in layers: the planner flags it, the executor re-checks right before writing, and the
  primitives in `execution/fs-ops.ts` publish with `link` (fails on EEXIST) instead of `rename`
  (silently overwrites). Keep all three; tests cover each layer.
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

Output profiles are declarative YAML in `packages/core/profiles/`, shipped with the core: the core
contains no player-specific rule.

- The parser is [guessit-js](https://github.com/opensubtitles/guessit-js) (LGPL-3.0) behind the
  `Parser` interface. Never modify or vendor it (LGPL/MIT compatibility).
- Profile template syntax: `{title}`, `{year}`, `{tmdb}`, `{season:02}`; `\{` and `\}` are literal
  braces (e.g. Plex: `'{title} ({year}) \{tmdb-{tmdb}\}'`). In profile YAML, templates containing
  a backslash must use **single quotes** (a double-quoted `"\{"` is a YAML error); the profile
  loader must reject that case with a clear error. Verify Plex/Jellyfin conventions against their official documentation before changing a
  profile.
- Profiles shipped: `plex` (id as `{tmdb-<id>}` in movie folder and file, and in the series folder)
  and `plex-no-id` (same layout, no id anywhere: cleaner names, but Plex then matches on title and
  year alone, ambiguous for two works sharing both). The id is optional for Plex, so offering it
  is a second profile rather than a template syntax for optional parts.
- Plex has two modes: the default agents ignore NFO (profile `plex`), the optional "Plex NFO"
  agent (PMS 1.43.1+) reads Kodi-format NFO, `tvshow.nfo`, per-episode `<file>.nfo`,
  `poster.jpg` and `background.jpg` (profile `plex-nfo`, planned for v1.0 with Jellyfin; needs
  `<uniqueid type="tmdb">` in the NFO).
- `ParsedMedia.knownIds` (ids found in names) is a hint, not a truth: a candidate whose id matches
  is boosted only if its type, title, season/episode and year agree. If the id designates a
  candidate yet another one scores higher (`Dune (2021) {tmdb-841}`: 841 is the 1984 film), the
  name contradicts itself and nothing is decided automatically. An id absent from the results
  cannot be verified and is ignored (the provider can look a work up by id, `getMovie`/`getSeries`,
  but only aliases use it so far).
- **Aliases** (`title_aliases`, server migration 007): validating a file in the queue ties its title
  to the chosen work (`Gordon Ramsay Hells Kitchen` → TMDB's `Hell's Kitchen`), unless the user
  declines (`remember: false`). The `Matcher` takes an optional `AliasLookup`: a title it knows is
  read as that work, fetched by id with no search, and scored like any candidate, so a season, an
  episode or a year the work does not have still sends the file to review. A series alias ignores
  the year, a movie one includes it. Files carrying ids (`knownIds`) skip aliases. A validation
  also re-matches the undecided files of the same title. Aliases are listed and forgotten in the
  settings (`GET /api/aliases`, `DELETE /api/aliases/{id}`).
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
  country's, neutral when either side names none. When the number and the year name different films
  (`Part.2` with the year of Part 1) nothing is decided automatically. `ParsedMedia.otherTitles` holds the two halves of a bilingual title
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
- **The welcome page** (`/`, until the setup is left): the TMDB key is tested as soon as it is
  entered and dropped if TMDB refuses it; the last step either analyses a folder once or adds it to
  `watch.folders`. Any job counts as work, so the setup ends even when that job failed: the home page
  then lists the analyses in progress and the failed ones with their cause (`GET /api/jobs`), a
  failure staying until the same path is sent again and does not fail. A job must never fail without
  leaving a trace in the UI.

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
  incomplete suffix) in the queue page, greyed out when no folder is watched.

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

Node.js 22, TypeScript (strict, ESM, NodeNext), pnpm workspaces, Vitest, ESLint
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
