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

## Releasing

Update `CHANGELOG.md` (the version's section is the text of the GitHub release), set the same version in
every `package.json`, commit as `chore: release X.Y.Z`, then tag `vX.Y.Z` and push the tag. The workflows build the
binaries and the Docker image and publish the release. Try a `vX.Y.Z-rc.1` tag first after changing them: a tag with
a dash is a pre-release and leaves `latest` alone.

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
- Kodi 22 (release candidate): `make players-kodi22-up` / `players-kodi22-down`. nixpkgs only has Kodi
  21, so Kodi 22 is built from source (`dev/players/kodi22.nix`): a first build takes 30 minutes or
  more, then it is cached. It runs alone (it takes the same display and ports as Kodi 21, so stop
  that one first) and keeps its own state in `.work/players/kodi22`, since its database is not the
  one of Kodi 21.
- For the notifications, Kinoshelf's "Path in Kinoshelf" is `.work/media/…` as the server sees it,
  and the player's side is `/media/…`.

## Documentation

`README.md` and `docs/` are plain Markdown with relative links, so GitHub shows them as they are. They
are also built into a static site with [VitePress](https://vitepress.dev) (`docs/.vitepress/`, the
navigation and the theme; `docs/index.md`, the home page):

```sh
make docs-dev       # live reload on http://localhost:5173
make docs-build     # the site, in docs/.vitepress/dist (a broken link fails the build)
make docs-preview   # build, then serve it as published on http://localhost:4173
```

The `Docs` workflow publishes it to GitHub Pages (run by hand for now: Settings › Pages › Source must
be "GitHub Actions"; it serves from `/kinoshelf/`, set by `DOCS_BASE`).

Rules that keep both renderings working:

- Pages are numbered in reading order on disk (`0-installation` to `9-development`); the site drops the
  numbers (`/installation`) through `rewrites` in the config, which also holds the sidebar: a new page
  is added there and to the README's table.
- No front matter (except the home page), one H1 per page, relative links to the `.md` files.
- A heading does not start with a digit: VitePress prefixes its anchor with an underscore, GitHub does not.
- A screenshot comes in two themes, `name.png` (dark) and `name-light.png`, embedded as a pair with
  the `#gh-dark-mode-only` and `#gh-light-mode-only` fragments, which GitHub and the site both honour:

  ```md
  ![Alt](images/name.png#gh-dark-mode-only)
  ![Alt](images/name-light.png#gh-light-mode-only)
  ```

Keep the pages in step with the code: a user-visible feature, setting, environment variable, command or
route is documented in the same change, and the French and English catalogs get the same keys.

## Conventions

See [AGENTS.md](https://github.com/DjLeChuck/kinoshelf/blob/main/AGENTS.md). In short: everything in English, Conventional Commits, every
user-facing string in both the `fr` and `en` catalogs, and nothing touches the disk without a
validated plan.
