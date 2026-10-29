# Kinoshelf

Identifies video files (movies, series) **already on disk**, renames them to match your player's
conventions (Plex, Jellyfin) and writes their metadata (NFO, artwork). A web-native equivalent of
tinyMediaManager and a companion to Radarr/Sonarr: it never downloads anything.

> **Status: v0.2**: the headless core, the CLI, the REST server and the Docker image work. The web
> UI (v0.3) is next, and there is no folder watcher yet: a script or a scheduled call submits
> the files (see [Server](#server)).

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
`POST /api/queue/{id}/match` picks a candidate found with `GET /api/search`. Every batch can be
undone with `POST /api/batches/{id}/undo`. Transfers are queued, survive a crash and resume at the
next start.

| Setting             | Where                                                              |
| ------------------- | ------------------------------------------------------------------ |
| `TMDB_API_KEY`      | environment, or `apiKey.tmdb` in `config.yaml`                     |
| `KINOSHELF_API_KEY` | environment (otherwise `api-key create`)                           |
| `KINOSHELF_HOST`    | address to listen on (default `0.0.0.0`)                           |
| `KINOSHELF_PORT`    | port (default `8484`)                                              |
| config directory    | `KINOSHELF_CONFIG_DIR`; holds `config.yaml` and `kinoshelf.sqlite` |

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

After a transfer, Plex or Jellyfin is asked to refresh only the libraries concerned, and each
webhook (`generic`, `gotify`, `ntfy`, `discord`) is told what happened. If the media server sees
the folders under other paths, map them with `paths: [{ from, to }]`. Check the setup without
starting the server: `kinoshelf-server notify test`.

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

A `Makefile` wraps these scripts: `make help` lists the targets, `make check` runs the whole
pre-merge suite.

See [AGENTS.md](AGENTS.md) for the project conventions.

## License

[MIT](LICENSE). Parsing relies on [guessit-js](https://github.com/opensubtitles/guessit-js)
(LGPL-3.0), used as an unmodified dependency.

This product uses the TMDB API but is not endorsed or certified by TMDB.
