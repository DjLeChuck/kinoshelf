# Configuration

Everything can be set from the web UI's Settings. They are saved in `config.yaml`, in the config
directory (`/config` in Docker), next to the database `kinoshelf.sqlite`. Editing the file by hand
works too.

## Environment variables

| Variable                    | Purpose                                                                         |
| --------------------------- | ------------------------------------------------------------------------------- |
| `TMDB_API_KEY`              | your own TMDB key (or `apiKey.tmdb` in `config.yaml`)                           |
| `KINOSHELF_API_KEY`         | the server's API key, 32 characters at least (otherwise `api-key create`)       |
| `KINOSHELF_ALLOWED_HOSTS`   | more host names the first key may be created through (comma-separated)          |
| `KINOSHELF_TRUST_PROXY`     | proxy addresses or ranges whose `X-Forwarded-*` are believed, or `true`         |
| `KINOSHELF_HOST`            | address to listen on (default `0.0.0.0`)                                        |
| `KINOSHELF_PORT`            | port (default `8484`)                                                           |
| `KINOSHELF_CONFIG_DIR`      | config directory, holds `config.yaml` and `kinoshelf.sqlite`                    |
| `KINOSHELF_WEB_DIR`         | built web UI to serve (found by itself in the Docker image)                     |
| `KINOSHELF_TMDB_URL`        | TMDB API base, for a proxy or tests (default `https://api.themoviedb.org`)      |
| `KINOSHELF_TMDB_IMAGES_URL` | TMDB images base (default `https://image.tmdb.org/t/p`)                         |
| `PUID`, `PGID`              | Docker only: the user Kinoshelf runs as (see [Installation](0-installation.md)) |

A variable wins over what the Settings could save.

## `config.yaml`

```yaml
apiKey:
  tmdb: ...
  plex: ... # Plex admin token, to refresh a library after a transfer
  jellyfin: ...

locale: fr # language of the tool itself: fr or en
metadataLanguage: fr # language of the titles fetched from TMDB, e.g. fr or en-US
naming: with-id # with-id or no-id, see Output options
metadata: none # none or nfo, see Output options
mode: hardlink # copy, hardlink or move
threshold: 85 # minimum score for an automatic match, 0 to 100
retentionDays: 30 # days after which a settled job is forgotten, 0 keeps all
detectPictureSize: true # read a video's size with ffprobe when its name says none (default)

libraries:
  - { id: films, name: Films, type: movie, source: /media/Movies }
  - { id: series, name: Series, type: series, source: /media/TV }
  - id: downloads
    name: Downloads
    source: /downloads/complete
    into: { movie: films, series: series }
    watch: true

watch:
  settleSeconds: 30
  pollSeconds: 0
  apply: false

notify:
  plex: { url: 'http://plex:32400' }
  jellyfin: { url: 'http://jellyfin:8096' }
  webhooks:
    - { url: 'https://ntfy.sh/my-topic', format: ntfy, on: [transferred, failed, needs-review] }
```

### Libraries

Each entry of `libraries` is either a library or an arrival folder (see
[Concepts](1-web-ui.md#two-kinds-of-folders)).

| Key         | Library (`type`)               | Arrival folder (`into`)                        |
| ----------- | ------------------------------ | ---------------------------------------------- |
| `id`        | required                       | required                                       |
| `name`      | required                       | required                                       |
| `source`    | the folder organized in place  | the folder files arrive in                     |
| `type`      | `movie` or `series`            | —                                              |
| `into`      | —                              | `{ movie: <id>, series: <id> }`, both required |
| `naming`    | overrides the global naming    | — (takes its destination's)                    |
| `metadata`  | overrides the global metadata  | — (takes its destination's)                    |
| `mode`      | — (organized in place)         | `copy` (default), `hardlink` or `move`         |
| `threshold` | overrides the global threshold | overrides the global threshold                 |
| `watch`     | —                              | `true` to submit what lands in `source`        |

### Watching

See [Getting downloads in](2-getting-downloads-in.md#2-watch-a-folder).

### Notifications

After a transfer, Plex or Jellyfin is asked to refresh only the libraries concerned, and each
webhook is told what happened.

- **Webhook formats**: `generic`, `gotify`, `ntfy`, `discord`.
- **Events** (`on`): `transferred`, `failed`, `needs-review`.
- **Other paths**: if the media server sees the folders under other paths, map them with
  `paths: [{ from, to }]` on `plex` or `jellyfin`.

Check the setup without starting the server:

```sh
kinoshelf-server notify test
```
