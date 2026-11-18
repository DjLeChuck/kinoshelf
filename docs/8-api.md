# REST API

`kinoshelf-server` is a REST API over the same core as the CLI: a post-download script makes one
HTTP call instead of running a tool. The API serves Kinoshelf's own clients (the web UI and
`kinoshelf submit`); it is documented as OpenAPI at `/api/openapi.json`.

## Authentication

- `GET /health` is public.
- Everything under `/api`, the OpenAPI document included, needs the API key:
  `Authorization: Bearer <key>`.
- An address that gives ten wrong keys within ten minutes is refused with a 429 until those ten
  minutes are over.

See [Installation](0-installation.md#first-key) for creating the key.

## Jobs

A job analyzes a file or a folder: parse, match, plan.

```sh
curl -X POST localhost:8484/api/jobs -H "Authorization: Bearer $KEY" \
  -H 'content-type: application/json' \
  -d '{"path": "/media/downloads/Dune.2021.1080p.mkv", "apply": true}'
```

- **Without `apply`**, nothing is written: the files wait in Arrivals, to be checked and validated
  there.
- **With `apply`**, the files matched with confidence are transferred in one batch, and the others
  wait among the arrivals.

Transfers are queued, survive a crash and resume at the next start.

## Routes

The API serves Kinoshelf's own clients (the web UI, `kinoshelf submit` and the end-to-end tests): a
route nobody reads is removed rather than kept. The OpenAPI document (`/api/openapi.json`, behind the
key) is the reference for parameters and responses; this is the map.

| Area            | Routes                                                                                                                                                                                    |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Public          | `GET /health`, the sign-in (`/api/session`) and first-key setup (`POST /api/setup/api-key`)                                                                                               |
| Jobs            | `POST /api/jobs` (analyze a path, `apply` to transfer), `GET /api/jobs/{id}`                                                                                                              |
| Arrivals        | `GET /api/arrivals` (`?state=ready\|review\|unrecognized`), `GET /api/search` (TMDB candidates)                                                                                           |
| Entries         | `POST /api/entries/{id}/match`, `/preview`, `/ignore`; `GET .../match` follows a validation                                                                                               |
| Plans           | `POST /api/plans/{id}/execute` (with `entries`) transfers what a plan holds                                                                                                               |
| Libraries       | `/api/libraries` and `/api/libraries/{id}` (CRUD), `.../scan`, `.../rescan`, `.../execute`                                                                                                |
| Library content | `.../items`, `.../items/{itemId}`, `.../shows`, `.../shows/{tmdbId}`, `PUT`/`DELETE .../shows/{tmdbId}/seasons/{season}/versions/accepted`                                                |
| Metadata        | `POST .../libraries/{id}/imdb-nfo` adds IMDb's rating to the NFO of one work                                                                                                              |
| Images          | `.../items/{itemId}/images`, `.../shows/{tmdbId}/images` and an episode's, with `.../preview`                                                                                             |
| Collections     | `.../collection`, `.../collections`, `.../collections/{key}/images`, `/rename`, `/send`                                                                                                   |
| History         | `GET /api/history`, `GET /api/batches/{id}`, `POST /api/batches/{id}/undo` (202, a task)                                                                                                  |
| Watching        | `GET /api/watch`, `POST /api/watch/scan`                                                                                                                                                  |
| Settings        | `/api/settings`, `/api/settings/api-key`, `/api/settings/tmdb/test`, `/api/onboarding`                                                                                                    |
| Notifications   | `POST /api/notifications/test`, `/api/plex/auth` (sign-in), `/api/plex/servers`                                                                                                           |
| System          | `/api/health`, `/api/health/report`, `/api/logs` (+ `/download`, `/level`), `/api/tmdb/usage`, `/api/tmdb/cache`, `/api/maintenance/*`, `/api/diagnostic` (+ `/archive`), `/api/activity` |
| Misc            | `/api/fs` (path picker), `/api/images/{size}/{file}`, `/api/events` (server-sent events)                                                                                                  |

## Things to know

- **Nothing that can last runs inside a request.** A scan, an undo, a validation, a tidy-up, a
  backup, sending collection images: `POST` answers **202** and the progress is read with a `GET`
  (or announced on the event stream). A dry run of a long task is a task too.
- **Events**: `GET /api/events` is a server-sent stream of payload-less topics (`jobs`, `progress`,
  `arrivals`, `history`, `settings`, `logs`, `tmdb`, `health`, and `ready` on each connection): a
  client reads the list again when its topic fires.
- **Errors** carry a stable `code` and parameters (`library.scan-in-progress`,
  `batch.already-undone`, `image.format-mismatch`…), translated by the client, not by the server.
- **A variable that overrides a setting** makes its change a 409 (`settings.tmdb-key-from-env`,
  `settings.api-key-from-env`).
- **First key**: `POST /api/setup/api-key` works only while no key exists and only through a local
  host name (see [Installation](0-installation.md#first-key)).
- **Behind a proxy**, the rate limit and the origin checks read the address the proxy forwards, so
  `KINOSHELF_TRUST_PROXY` must name it.
- The web is served with a strict content security policy: nothing is loaded from another origin.
