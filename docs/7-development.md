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

## Standalone binary

`make sea` builds `packages/sea/dist/kinoshelf` and its `ffprobe` (`scripts/build-ffprobe.sh`, a
static build of FFmpeg's, which needs a compiler: the Nix shell `ffprobe` brings one). `make sea-run`
starts it on a throwaway config, `make test-sea` runs the e2e suite against it, and
`make sea-archive VERSION=…` and `make smoke-sea VERSION=…` pack the release archive and start it in
clean Debian and Ubuntu containers. The release workflow does the same per platform on a tag. The
Docker image is built from the same bundle (`make docker-build`).

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
| `sea`            | the standalone binary (Node single executable)          |

## Trying Plex, Jellyfin and Kodi locally

`dev/players` is a small flake of its own that runs the players: Jellyfin and Plex in Docker, Kodi
from Nix (`make players-up`, `make players-down`; or
`nix run ./dev/players -- up|down|logs|status [jellyfin|plex|kodi]`, no player named means all
three). Their state lives in `.work/players` and their media folder is `.work/media` (`movies/`,
`series/`), mounted read-only at `/media` for the Docker ones. Point two libraries of Kinoshelf at
`.work/media/movies` and `.work/media/series`, then add `/media/movies` and `/media/series` as
libraries in Jellyfin and Plex.

- `make players-seed` fills `.work/media/arrivals` with two-second clips named like real releases
  (movies, two qualities of one, a bilingual title, series, one in two qualities, a few the matcher
  cannot tell, one nobody can identify). Add that folder as an arrival folder pointing at the two
  libraries; it shares their filesystem, so a hardlink works. Running it again only adds what is
  missing.
- Jellyfin: <http://localhost:8096>. Plex: <http://localhost:32400/web> (host network; set
  `PLEX_CLAIM` from <https://plex.tv/claim> to claim the server at the first start).
- Kodi: <http://localhost:6080/vnc.html?autoconnect=true&resize=scale>. It has no maintained Docker
  image, so it runs from nixpkgs (21.3) on a virtual screen that noVNC shows in the browser; its
  JSON-RPC is on <http://localhost:8080/jsonrpc> (`kodi` / `kodi`), for scripts. Its two sources
  are `.work/media/movies` (one movie per folder) and `.work/media/series`, both read from the NFO
  only, and it scans them at each start (`nix run ./dev/players -- up kodi` again, or "Update
  library" in Kodi, after Kinoshelf has moved files). Its logs: `… -- logs kodi`. That setup is
  written once: delete `.work/players/kodi` to start over. The screen is 1920x1080; set
  `KODI_RESOLUTION=2560x1440` (after a `down`) for another size.
- For the notifications, Kinoshelf's "Path in Kinoshelf" is `.work/media/…` as the server sees it,
  and the player's side is `/media/…`.

## Conventions

See [AGENTS.md](../AGENTS.md). In short: everything in English, Conventional Commits, every
user-facing string in both the `fr` and `en` catalogs, and nothing touches the disk without a
validated plan.
