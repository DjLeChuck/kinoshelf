# Command line

`kinoshelf` is the same core as the server, without the server. It ships in the Docker image:

```sh
docker compose exec kinoshelf kinoshelf …
```

and in the [standalone binary](0-installation.md#standalone-binary), which is the same `kinoshelf` file
as the server (`kinoshelf serve`). To build it from source, see [Development](7-development.md).

## Commands

```sh
export TMDB_API_KEY=...   # your own key, from themoviedb.org

kinoshelf scan ~/Downloads --dest-movies /media/Movies --dest-series /media/TV
kinoshelf process ~/Downloads --dest-movies /media/Movies --dest-series /media/TV           # dry run
kinoshelf process ~/Downloads --dest-movies /media/Movies --dest-series /media/TV --apply
kinoshelf undo --apply    # revert the last batch
kinoshelf submit <path>   # hand a path to a running server (see Getting downloads in)
```

| Command   | What it does                                                            |
| --------- | ----------------------------------------------------------------------- |
| `scan`    | parses and matches the files, writes nothing                            |
| `process` | plans the transfers; writes only with `--apply`                         |
| `undo`    | reverts the last batch; writes only with `--apply`                      |
| `submit`  | sends a path to the server, `--apply` to transfer confident matches too |

## Guarantees

- Nothing is written without `--apply`.
- An existing file is never overwritten.
- A failed hardlink is reported instead of silently copying.

## Settings and language

Settings can live in `~/.config/kinoshelf/config.yaml` (same format as the server's, see
[Configuration](4-configuration.md)). The tool speaks French or English: `--lang fr|en`, or your
locale.

`submit` reads `KINOSHELF_API_KEY` and `KINOSHELF_URL` (default `http://localhost:8484`) from the
environment.

## Server commands

```sh
kinoshelf-server                  # start the server
kinoshelf-server api-key create   # print a new API key once (replaces the previous one)
kinoshelf-server notify test      # check the Plex, Jellyfin and webhook setup
```

The standalone binary has no `kinoshelf-server`: the same three are `kinoshelf serve`,
`kinoshelf api-key create` and `kinoshelf notify test` (the Docker image answers to both names).
