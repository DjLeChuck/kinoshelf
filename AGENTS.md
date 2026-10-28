# AGENTS.md

Kinoshelf: self-hosted web app (MIT) that identifies video files already on disk (movies, series),
renames them for a media player (Plex, Jellyfin) and writes their metadata (NFO, artwork).

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

## Architecture

A headless **core** holds all the logic; the server, the web UI and the CLI are only clients.
Everything depending on a service or a player is a plugin behind an interface.

```
packages/core              parsing (Parser), matching/score, planning, execution, journal/undo, profiles
packages/providers/tmdb    MetadataProvider for TMDB, SQLite cache
packages/cli               kinoshelf scan | process <path> | undo
packages/server            (v0.2) Fastify REST API, job queue, folder watcher, SSE
packages/web               (v0.3) Svelte 5 UI
profiles/*.yaml            declarative output profiles; the core contains no player-specific rule
```

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
- `ParsedMedia.knownIds` (ids found in names) is a hint, not a truth: the matcher boosts a candidate
  whose id matches but keeps the type, title and season/episode guards. Looking a work up by id
  (`getMovie`/`getSeries`) is planned later, to verify ids the text search does not return.
- Each user provides their own TMDB key; none is ever embedded. Put it in `.env` (git-ignored) as
  `TMDB_API_KEY`; never read or print it. `pnpm test:live` runs the contract tests against the
  real API.

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
- Matching corpus: real release names + expected match, run in CI.
