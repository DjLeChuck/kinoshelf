<h1 align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="packages/web/src/assets/kinoshelf-logo.svg">
    <img alt="Kinoshelf" src="packages/web/src/assets/kinoshelf-logo-light.svg" width="280">
  </picture>
</h1>

<p align="center">
  <a href="https://github.com/DjLeChuck/kinoshelf/actions/workflows/ci.yml">
    <img alt="CI" src="https://github.com/DjLeChuck/kinoshelf/actions/workflows/ci.yml/badge.svg">
  </a>
</p>

Identifies video files (movies, series) **already on disk**, renames them to match your player's
conventions (Plex, Jellyfin) and writes their metadata (NFO, artwork). A web-native equivalent of
tinyMediaManager and a companion to Radarr/Sonarr: it never downloads anything.

> **Status: v0.3**: the headless core, the CLI, the REST server, the Docker image and the web UI
> (validation queue, history, settings) work. There is no folder watcher yet: a script or a
> scheduled call submits the files (see [Server](#server)). Browsing the library, scanning a whole
> library from the browser and several libraries are planned (the UI shows them as “coming soon”).

## Usage (v0.1, from source)

```sh
export TMDB_API_KEY=...            # your own key, from themoviedb.org
kinoshelf scan ~/Downloads --dest-movies /media/Movies --dest-series /media/TV
kinoshelf process ~/Downloads --dest-movies /media/Movies --dest-series /media/TV            # dry run
kinoshelf process ~/Downloads --dest-movies /media/Movies --dest-series /media/TV --apply
kinoshelf undo --apply             # revert the last batch
```

Nothing is written without `--apply`, an existing file is never overwritten, and a failed
hardlink is reported instead of silently copying. Settings can live in
`~/.config/kinoshelf/config.yaml`. The tool speaks French or English (`--lang fr|en`, or your
locale).

## Server

`kinoshelf-server` is a REST API over the same core as the CLI: a post-download script makes one
HTTP call instead of running a tool. The API is published as OpenAPI at `/api/openapi.json`;
`GET /health` is public, everything under `/api` needs the API key as `Authorization: Bearer <key>`.
On a first launch with no key, the web UI's sign-in page can create it for you (shown once, then you
sign in with it); the commands below do the same without a browser.

```sh
kinoshelf-server api-key create        # prints a key once (it replaces the previous one)
# or set KINOSHELF_API_KEY (32 characters at least) in the environment

curl -X POST localhost:8484/api/jobs -H "Authorization: Bearer $KEY" \
  -H 'content-type: application/json' -d '{"path": "/media/downloads/Dune.2021.1080p.mkv", "apply": true}'
```

A job analyzes a file or a folder (parse, match, plan). Without `apply` nothing is written: read
the result with `GET /api/jobs/{id}/entries`, then run `POST /api/plans/{id}/execute` (with
`{"dryRun": true}` to see what would be done). With `apply`, the files matched with confidence are
transferred in one batch and the others wait in the validation queue (`GET /api/queue`), where
`POST /api/queue/{id}/match` picks a candidate found with `GET /api/search` and remembers the file's
title, so later scans (and the files already waiting under that title) match it alone. Every batch can be
undone with `POST /api/batches/{id}/undo`. Transfers are queued, survive a crash and resume at the
next start.

| Setting             | Where                                                              |
| ------------------- | ------------------------------------------------------------------ |
| `TMDB_API_KEY`      | environment, or `apiKey.tmdb` in `config.yaml`                     |
| `KINOSHELF_API_KEY` | environment (otherwise `api-key create`)                           |
| `KINOSHELF_HOST`    | address to listen on (default `0.0.0.0`)                           |
| `KINOSHELF_PORT`    | port (default `8484`)                                              |
| config directory    | `KINOSHELF_CONFIG_DIR`; holds `config.yaml` and `kinoshelf.sqlite` |
| `KINOSHELF_WEB_DIR` | built web UI to serve (found by itself in the Docker image)        |

`profile` is a shipped id or the path of your own YAML file:

- `plex`: names for Plex's default agents, with the TMDB id as `{tmdb-<id>}`; `plex-no-id` is the
  same layout without it, which leaves Plex matching on title and year alone. Neither writes
  metadata files: Plex fetches its own.
- `jellyfin`: names with `[tmdbid-<id>]`, plus a Kodi-format NFO (`movie.nfo`, `tvshow.nfo`, one
  per episode) and `poster.jpg` / `fanart.jpg` next to the videos.
- `plex-nfo`: for Plex's optional "Plex NFO" agents (Plex Media Server 1.43.1 or later): the same
  layout as `plex-no-id`, with NFO, `poster.jpg` and `background.jpg`.

Metadata files are never overwritten (one already there is left as it is and reported), and `undo`
removes the ones a batch wrote.

`config.yaml` is the one source of the other settings (`destination`, `profile`, `mode`,
`threshold`, `locale`, `metadataLanguage`, `retentionDays`) and of the notifications:

```yaml
destination: { movies: /media/Movies, series: /media/TV }
notify:
  plex: { url: 'http://plex:32400' } # token in apiKey.plex
  jellyfin: { url: 'http://jellyfin:8096' } # key in apiKey.jellyfin
  webhooks:
    - { url: 'https://ntfy.sh/my-topic', format: ntfy, on: [transferred, failed, needs-review] }
```

To reach TMDB through a proxy (or a fake one in tests), set `KINOSHELF_TMDB_URL` (default
`https://api.themoviedb.org`) and `KINOSHELF_TMDB_IMAGES_URL` (default `https://image.tmdb.org/t/p`).

After a transfer, Plex or Jellyfin is asked to refresh only the libraries concerned, and each
webhook (`generic`, `gotify`, `ntfy`, `discord`) is told what happened. If the media server sees
the folders under other paths, map them with `paths: [{ from, to }]`. Check the setup without
starting the server: `kinoshelf-server notify test`.

### Getting downloads in

Kinoshelf never polls a download folder: a file that stopped growing may be a finished download or
a dead torrent, and the disk cannot tell. Three ways instead, from the most to the least precise.

**1. Let the client say it is done.** Run `kinoshelf submit <path>` (or `POST /api/jobs`) from the
client's "on completion" hook. It reads `KINOSHELF_API_KEY` and `KINOSHELF_URL` (default
`http://localhost:8484`) from the environment, so a secret never sits in a command line; `--apply`
also transfers what is matched with confidence.

| Client       | Where                                                  | Command                                                                                                |
| ------------ | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| qBittorrent  | Options › Downloads › Run external program on finished | `kinoshelf submit "%F"`                                                                                |
| Transmission | `script-torrent-done-filename` (a script)              | `kinoshelf submit "$TR_TORRENT_DIR/$TR_TORRENT_NAME"`                                                  |
| Deluge       | Execute plugin, event _Torrent Complete_               | `kinoshelf submit "$3/$2"` (save path, torrent name)                                                   |
| SABnzbd      | post-processing script                                 | `kinoshelf submit "$1"` (final folder)                                                                 |
| rTorrent     | `.rtorrent.rc`                                         | `method.set_key = event.download.finished,kinoshelf,"execute.throw.bg=kinoshelf,submit,$d.base_path="` |

When the client runs elsewhere (another container), it has no `kinoshelf` command: make the same
call with `curl -fsS -X POST http://kinoshelf:8484/api/jobs -H "Authorization: Bearer $KEY" -H
'content-type: application/json' -d '{"path": "/downloads/Dune.2021.mkv"}'`. Either way **the path
is read by Kinoshelf**: mount the downloads at the same path in both containers.

**2. Watch the folder downloads end up in, with the incomplete ones kept elsewhere.** This only
works if your client writes unfinished downloads **outside** the watched folder, which it does not
do by default: enable qBittorrent's "Keep incomplete torrents in" (or Transmission's incomplete
folder) and set it to a different folder than "Save files to location" (Transmission's download
folder). A download moves to the final folder only once it is complete, and that final folder is the
one to watch. Without this, a stalled torrent and a finished one look the same in it.

```yaml
watch:
  folders: [/downloads/complete]
  settleSeconds: 30 # a release is submitted once none of its files changed for this long
  pollSeconds: 0 # 0 listens for changes (no disk reads); 120 scans every 2 minutes
  apply: false # true also transfers what is matched with confidence
```

The kernel's change notifications only wake a scan, which then decides whether a release is
complete: all its files stable, none still named `.!qB`, `.part` and the like. A release is
submitted once; a file that is replaced is submitted again. Network shares (NFS, SMB) announce no
change, so give them a `pollSeconds`. What is already in the folder when watching starts is
submitted too. Prefer the `hardlink` or `copy` mode: `move` takes the file from under its torrent.

**3. Ask by hand.** The validation queue has a **Check now** button that scans the watched folders
without waiting for files to settle (`POST /api/watch/scan`, `GET /api/watch`). It is greyed out
while no folder is watched.

## Web UI

The server also serves a web UI on the same port (`http://localhost:8484`), in French or English
(follows your browser, switchable in the header), with a dark and a light theme. Sign in with the
API key: the browser keeps a session cookie for 7 days, so the key itself is not stored.

- **Home** (`/`). On a new install, a four-step welcome (TMDB key, Plex or Jellyfin, destination
  folder, first files), each step ticking itself once the configuration says so; the server
  remembers what you skipped. Afterwards, what needs you (the queue, a failed batch), the latest
  batches and which services are configured.
- **Queue** (`/queue`). The files Kinoshelf could not place with confidence, with their TMDB candidates and
  score, a manual search, and the destination path a choice would give. **Validate** transfers the
  file, **Ignore** sets it aside. Nothing is moved until you validate, and an existing file is never
  overwritten.
- **History.** Every transfer as a batch, with each file. **Undo** shows what would be restored,
  then asks for confirmation; a file moved or replaced since is left alone.
- **Settings.** The TMDB key, languages, output profile, file mode, threshold, destination folders,
  Plex, Jellyfin, webhooks (with a test) and the API key. They are saved in `config.yaml` and apply
  at once, without a restart. Secrets are never shown again.

The screens update by themselves when a job ends or a file is validated elsewhere. Posters come
through the server, which fetches each one from TMDB once and keeps it in `/config/images`: your
browser never contacts TMDB.

## Docker

```sh
cp compose.example.yaml compose.yaml   # adjust the paths, PUID/PGID and the keys
docker compose up -d
docker compose exec kinoshelf kinoshelf-server api-key create
```

Images are published on GHCR for `linux/amd64` and `linux/arm64`. The container keeps its database
and `config.yaml` in `/config`, listens on `8484`, and its `HEALTHCHECK` calls `/health`. Inside it,
`kinoshelf` (the CLI) and `kinoshelf-server` are on the PATH.

- **User.** Set `PUID` and `PGID` to the owner of your media folders (`id <user>`; 1000 by
  default): Kinoshelf runs as that user, so what it moves, copies or links belongs to you. It
  gives `/config` to this user at start and never touches the media folders, which that user must
  be able to read and write. On TrueNAS, use the `apps` user (568).
  Alternatively start the container with `user: "1026:100"` (Compose) or `--user`: `PUID` and
  `PGID` are then ignored, and `/config` must already belong to that user. Do not mount it read-only.
- **Hardlinks** work only inside one file system: mount downloads and library under a common
  parent (`/srv/media:/media`), not as two separate volumes. When they cannot link, Kinoshelf
  fails with an explicit error and does not copy instead.
- **Stopping.** A copy can last minutes and a stop waits for it, while Docker kills the container
  after 10 s by default. Set `stop_grace_period` (the example uses 5 minutes). A task cut short is
  resumed at the next start.

## Development

With Nix: `nix develop` (or direnv). Otherwise: Node.js 22 and pnpm.

```sh
pnpm install
pnpm typecheck && pnpm lint && pnpm test
```

`pnpm test` includes the matching corpus. The web UI is tested in a real browser with Playwright,
against the real server and a fake TMDB: `pnpm test:e2e` (the Nix shell provides the browsers; elsewhere
run `pnpm --filter @kinoshelf/e2e exec playwright install chromium` once). To work on the UI, start
the server (`make dev-server`) and `make dev-web`, which proxies the API to it.

A `Makefile` wraps these scripts: `make help` lists the targets, `make check` runs the whole
pre-merge suite.

See [AGENTS.md](AGENTS.md) for the project conventions.

## License

[MIT](LICENSE). Parsing relies on [guessit-js](https://github.com/opensubtitles/guessit-js)
(LGPL-3.0), used as an unmodified dependency.

This product uses the TMDB API but is not endorsed or certified by TMDB.
