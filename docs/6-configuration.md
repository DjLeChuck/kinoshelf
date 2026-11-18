# Configuration

Everything can be set from the web UI's Settings. They are saved in `config.yaml`, in the config
directory (`/config` in Docker), next to the database `kinoshelf.sqlite`. Editing the file by hand
works too.

## Environment variables

| Variable                      | Purpose                                                                             |
| ----------------------------- | ----------------------------------------------------------------------------------- |
| `TMDB_API_KEY`                | your own TMDB key (or `apiKey.tmdb` in `config.yaml`)                               |
| `KINOSHELF_API_KEY`           | the server's API key, 32 characters at least (otherwise `api-key create`)           |
| `KINOSHELF_ALLOWED_HOSTS`     | more host names the first key may be created through (comma-separated)              |
| `KINOSHELF_TRUST_PROXY`       | proxy addresses or ranges whose `X-Forwarded-*` are believed, or `true`             |
| `KINOSHELF_LOCALE`            | default language of the tool, `fr` or `en` (otherwise `LANG`)                       |
| `KINOSHELF_METADATA_LANGUAGE` | default language asked of TMDB, e.g. `fr` or `en-US` (otherwise follows the locale) |
| `KINOSHELF_HOST`              | address to listen on (default `0.0.0.0`)                                            |
| `KINOSHELF_PORT`              | port (default `8484`)                                                               |
| `KINOSHELF_CONFIG_DIR`        | config directory, holds `config.yaml` and `kinoshelf.sqlite`                        |
| `KINOSHELF_WEB_DIR`           | built web UI to serve (found by itself in the Docker image)                         |
| `KINOSHELF_LOG_LEVEL`         | log level at start: `debug`, `info` (default), `warn`, `error`                      |
| `KINOSHELF_URL`               | CLI only: the server `kinoshelf submit` talks to (default `http://localhost:8484`)  |
| `KINOSHELF_FFPROBE`           | `ffprobe` to run (default: the one next to the `kinoshelf` binary, else the `PATH`) |
| `KINOSHELF_TMDB_URL`          | TMDB API base, for a proxy or tests (default `https://api.themoviedb.org`)          |
| `KINOSHELF_TMDB_IMAGES_URL`   | TMDB images base (default `https://image.tmdb.org/t/p`)                             |
| `PUID`, `PGID`                | Docker only: the user Kinoshelf runs as (see [Installation](0-installation.md))     |

`TMDB_API_KEY` and `KINOSHELF_API_KEY` win over what the Settings could save: the Settings then
show the field as disabled, say where the value comes from, and the API refuses the change. A value
saved and never used would be worse than a refusal.

`KINOSHELF_LOCALE` and `KINOSHELF_METADATA_LANGUAGE` are only **defaults**, used while `locale` /
`metadataLanguage` is not set (then `LANG`, then `en-US`); the Settings preselect what is in use.

## `config.yaml`

```yaml
apiKey:
  tmdb: ...
  plex: ... # Plex token typed by hand, optional: Settings can sign in with Plex instead
  jellyfin: ...

locale: fr # language of the tool itself: fr or en
metadataLanguage: fr # language of the titles fetched from TMDB, e.g. fr or en-US
naming: no-id # no-id (default) or with-id, see Output options
metadata: nfo # nfo (default) or none, see Output options
mode: hardlink # copy, hardlink or move (default: move in place, copy to another folder)
threshold: 85 # minimum score for an automatic match, 0 to 100 (default 85)
retentionDays: 30 # days after which a settled job is forgotten, 0 keeps all
detectPictureSize: true # read a video's size with ffprobe when its name says none (default)
allowLocalImageUrls: false # let a custom image address point at the local network (default off)
imdbRatings: false # download IMDb's ratings file and write the rating in the NFO (default off)
backupKeep: 3 # database backups kept by the Maintenance tab
replacedRetentionDays: 30 # days before "Empty replaced/" deletes a file set aside, 0 = all

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
  plex:
    url: 'http://plex:32400'
    section: 2 # optional: force one Plex library
    paths: [{ from: /media, to: /data }] # optional: the paths as Plex sees them
  jellyfin: { url: 'http://jellyfin:8096' }
  webhooks:
    - { url: 'https://ntfy.sh/my-topic', format: ntfy, on: [transferred, failed, needs-review] }
    - { url: 'https://example.org/hook', headers: { Authorization: 'Bearer …' } }
```

### Global options

| Key                     | Values                      | Default                                  | Purpose                                                                           |
| ----------------------- | --------------------------- | ---------------------------------------- | --------------------------------------------------------------------------------- |
| `locale`                | `fr`, `en`                  | `KINOSHELF_LOCALE`, `LANG`, else `en-US` | language of the tool and of the notifications                                     |
| `metadataLanguage`      | a TMDB code (`fr`, `en-US`) | follows the locale                       | language of the titles, overviews and logos asked of TMDB                         |
| `naming`                | `no-id`, `with-id`          | `no-id`                                  | the `{tmdb-<id>}` tag in names ([Output options](5-output-options.md))            |
| `metadata`              | `nfo`, `none`               | `nfo`                                    | NFO and artwork beside the videos                                                 |
| `mode`                  | `copy`, `hardlink`, `move`  | automatic                                | how a file reaches its destination (an downloads folder's own `mode` wins)        |
| `threshold`             | 0 to 100                    | 85                                       | minimum score for an automatic match                                              |
| `detectPictureSize`     | `true`, `false`             | `true`                                   | read a size with `ffprobe` when the name gives none and another version is there  |
| `allowLocalImageUrls`   | `true`, `false`             | `false`                                  | let an image address of your own point at the local network                       |
| `imdbRatings`           | `true`, `false`             | `false`                                  | download IMDb's ratings file and write its rating in the NFO                      |
| `retentionDays`         | whole number                | 30                                       | days before a settled job is forgotten (0 keeps all); the journal is never purged |
| `backupKeep`            | at least 1                  | 3                                        | database backups kept                                                             |
| `replacedRetentionDays` | whole number                | 30                                       | days before "Empty replaced/" deletes a set-aside file (0 = all)                  |

Every key can be left out. The file is validated before it is written (by the Settings or by hand),
and an unknown key is an error. Comments and order survive an edit from the Settings.

Precedence for the command line: flags, then `config.yaml`, then defaults. A job carries the settings
it was queued with, shown in the History.

### Libraries

Each entry of `libraries` is either a library or an downloads folder (see
[Concepts](1-web-ui.md#two-kinds-of-folders)).

| Key         | Library (`type`)               | Downloads folder (`into`)                       |
| ----------- | ------------------------------ | ----------------------------------------------- |
| `id`        | required                       | required                                        |
| `name`      | required                       | required                                        |
| `source`    | the folder organized in place  | the folder files arrive in                      |
| `type`      | `movie` or `series`            | —                                               |
| `into`      | —                              | `{ movie?: <id>, series?: <id> }`, one at least |
| `naming`    | overrides the global naming    | — (takes its destination's)                     |
| `metadata`  | overrides the global metadata  | — (takes its destination's)                     |
| `mode`      | — (organized in place: `move`) | `copy` (default), `hardlink` or `move`          |
| `threshold` | overrides the global threshold | overrides the global threshold                  |
| `watch`     | —                              | `true` to submit what lands in `source`         |

Rules the file enforces: ids are lowercase letters, digits and dashes and are generated from the
name; two folders cannot share a source nor contain one another (`library.source-overlaps`); a source cannot be `/`, `/proc`, `/sys` or `/dev`; `into`
must name existing libraries of the right type. A library's profile is its own `naming`/`metadata`,
else the global ones, else the defaults.

### Watching

See [Getting downloads in](4-getting-downloads-in.md#watch-a-folder).

### Notifications

After a transfer, Plex or Jellyfin is asked to refresh only the libraries concerned, and each
webhook is told what happened.

- **Webhook formats**: `generic` (Kinoshelf's own JSON: event, title, message and details, for a
  script, n8n or Home Assistant), `gotify` (`https://gotify.example/message?token=…`), `ntfy`
  (`https://ntfy.sh/<topic>`, or your own server) and `discord` (the webhook URL made in the
  channel's Integrations).
- **Events** (`on`): `transferred`, `failed`, `needs-review` (default: `transferred` and `failed`).
- **Headers**: a webhook can send extra `headers`. Addresses and headers are secrets: the Settings
  never show them again, and the logs wipe them.
- **Plex library**: `section` forces one Plex library; left out, Kinoshelf finds the right one from
  the folder the file went to.
- **Other paths**: if the media server sees the folders under other paths, map them with
  `paths: [{ from, to }]` on `plex` or `jellyfin`.
- **Plex sign-in**: in Settings, “Sign in with Plex” opens plex.tv to approve Kinoshelf, then lists the
  servers of your account to pick one. Nothing to copy: the access lasts a week and renews itself, even
  if the server was stopped for longer. It is kept in the database, not in `config.yaml`, and a token
  typed in `apiKey.plex` wins over it. Sign-in replaces a typed token; sign out to type one again.
  The device stays in your Plex account’s authorized devices, where you can revoke it.

- **Jellyfin** needs its address and a token (`apiKey.jellyfin`).
- Collection images chosen in a movie library are pushed to Plex and Jellyfin through the same
  connection (see [Libraries](2-libraries.md#collections)).

Check the setup without starting the server:

```sh
kinoshelf-server notify test                              # reaches every webhook, Plex and Jellyfin
kinoshelf-server notify refresh /media/Movies/Dune --kind movie --dry-run
```

`notify refresh <path>` asks Plex and Jellyfin to look at a folder as Kinoshelf sees it
(`--dry-run` shows what would be asked). The Settings have a **Send a test notification** button that
does the same as `notify test`.

### Retention and storage

`retentionDays`, `backupKeep` and `replacedRetentionDays` are in the table above; the folders under
`/config` and what each holds are in [System](3-system.md#where-files-go).
