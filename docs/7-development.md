# Development

## Setup

With Nix: `nix develop` (or direnv). Otherwise: Node.js 26 and pnpm.

```sh
pnpm install
pnpm typecheck && pnpm lint && pnpm test
```

## Running from the sources

Build once, then call the compiled entry points:

```sh
pnpm build
node packages/cli/dist/main.js scan <folder>
node packages/server/dist/main.js
```

`make dev-server` builds and starts the server. To work on the UI, start the server
(`make dev-server`) and `make dev-web`, which proxies the API to it.

## Tests

- `pnpm test` includes the matching corpus.
- `pnpm test:e2e` tests the web UI in a real browser with Playwright, against the real server and a
  fake TMDB. The Nix shell provides the browsers; elsewhere run
  `pnpm --filter @kinoshelf/e2e exec playwright install chromium` once.

## Makefile

`make help` lists the targets, `make check` runs the whole pre-merge suite.

## Packages

| Package          | Role                                                    |
| ---------------- | ------------------------------------------------------- |
| `core`           | parse, match, plan, execute, journal, NFO, profiles     |
| `providers/tmdb` | the TMDB metadata provider                              |
| `cli`            | the `kinoshelf` command                                 |
| `server`         | the REST API and the web UI host                        |
| `web`            | the Svelte web UI                                       |
| `i18n`           | French and English catalogs                             |
| `corpus`         | real release names replayed offline against the matcher |
| `e2e`            | Playwright tests                                        |
| `image`          | what the Docker image ships (server, CLI, web UI)       |

## Trying Plex and Jellyfin locally

`dev/players` is a small flake of its own that runs both players in Docker (`make players-up`,
`make players-down`; or `nix run ./dev/players -- up|down|logs|status [jellyfin|plex]`). Their state
lives in `.work/players` and their media folder is `.work/media` (`movies/`, `series/`), mounted
read-only at `/media`. Point two libraries of Kinoshelf at `.work/media/movies` and
`.work/media/series`, then add `/media/movies` and `/media/series` as libraries in the players.

- `make players-seed` fills `.work/media/arrivals` with two-second clips named like real releases
  (movies, two qualities of one, a bilingual title, a series, a few the matcher cannot tell, one
  nobody can identify). Add that folder as an arrival folder pointing at the two libraries; it
  shares their filesystem, so a hardlink works. Running it again only adds what is missing.
- Jellyfin: <http://localhost:8096>. Plex: <http://localhost:32400/web> (host network; set
  `PLEX_CLAIM` from <https://plex.tv/claim> to claim the server at the first start).
- For the notifications, Kinoshelf's "Path in Kinoshelf" is `.work/media/…` as the server sees it,
  and the player's side is `/media/…`.

## Conventions

See [AGENTS.md](../AGENTS.md). In short: everything in English, Conventional Commits, every
user-facing string in both the `fr` and `en` catalogs, and nothing touches the disk without a
validated plan.
