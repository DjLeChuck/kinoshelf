# AGENTS.md

Kinoshelf: self-hosted web app (MIT) that identifies video files already on disk (movies, series),
renames them for a media player (Plex, Jellyfin) and writes their metadata (NFO, artwork).

## Where we are

v0.1 (core, CLI and matching corpus) is done; v0.2 (server and Docker) is next.

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
packages/server            (v0.2) Fastify REST API, job queue, folder watcher, SSE
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
- Plex has two modes: the default agents ignore NFO (profile `plex`), the optional "Plex NFO"
  agent (PMS 1.43.1+) reads Kodi-format NFO, `tvshow.nfo`, per-episode `<file>.nfo`,
  `poster.jpg` and `background.jpg` (profile `plex-nfo`, planned for v1.0 with Jellyfin; needs
  `<uniqueid type="tmdb">` in the NFO).
- `ParsedMedia.knownIds` (ids found in names) is a hint, not a truth: a candidate whose id matches
  is boosted only if its type, title, season/episode and year agree. If the id designates a
  candidate yet another one scores higher (`Dune (2021) {tmdb-841}`: 841 is the 1984 film), the
  name contradicts itself and nothing is decided automatically. An id absent from the results
  cannot be verified and is ignored; looking a work up by id (`getMovie`/`getSeries`) is planned
  later.
- `ParsedMedia.country` (`The.Office.US`) is matched against `Candidate.countries` (TMDB gives
  `origin_country` for series only): a bonus on agreement, a penalty when both are known and
  differ, neutral otherwise.
- Each user provides their own TMDB key; none is ever embedded. Put it in `.env` (git-ignored) as
  `TMDB_API_KEY`; never read or print it. `pnpm test:live` runs the contract tests against the
  real API.

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
in `.env`; it rewrites `recordings.json`) and `pnpm corpus:report` to see every verdict with its
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
```

Run `pnpm typecheck && pnpm lint && pnpm format:check && pnpm test` before considering work done.

## Conventions

- Define types/interfaces before implementations; write tests along with the code.
- Comments explain _why_, not _what_; match the surrounding density and naming.
- Commits: one concern each, in distinct commits when a change touches several; ask before
  committing. Before relying on a result, verify it independently; before trusting a new rule,
  break it on purpose and watch a test go red.
