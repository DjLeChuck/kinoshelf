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

See [Installation](installation.md#first-key) for creating the key.

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

## Main routes

| Route                          | Purpose                                                         |
| ------------------------------ | --------------------------------------------------------------- |
| `POST /api/jobs`               | analyze a path, optionally transfer (`apply`)                   |
| `GET /api/arrivals`            | the files waiting for a decision                                |
| `GET /api/search`              | search TMDB for candidates                                      |
| `POST /api/entries/{id}/match` | pick a candidate for a waiting file (a series' release follows) |
| `POST /api/batches/{id}/undo`  | undo a batch                                                    |
| `GET /api/watch`               | what is watched                                                 |
| `POST /api/watch/scan`         | scan the watched folders now                                    |

The OpenAPI document is the reference for parameters and responses.
