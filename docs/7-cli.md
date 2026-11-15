# Command line

`kinoshelf` is the same core as the server, without the server. It ships in the Docker image:

```sh
docker compose exec kinoshelf kinoshelf …
```

and in the [standalone binary](0-installation.md#standalone-binary), which is the same `kinoshelf` file
as the server (`kinoshelf serve`). To build it from source, see [Development](9-development.md).

## Commands

```sh
export TMDB_API_KEY=...   # your own key, from themoviedb.org

kinoshelf scan ~/Downloads --dest-movies /media/Movies --dest-series /media/TV
kinoshelf process ~/Downloads --dest-movies /media/Movies --dest-series /media/TV           # dry run
kinoshelf process ~/Downloads --dest-movies /media/Movies --dest-series /media/TV --apply
kinoshelf undo --apply    # revert the last batch
kinoshelf submit <path>   # hand a path to a running server (see Getting downloads in)
kinoshelf tidy            # report what clutters the libraries (read-only)
kinoshelf cleanup --apply # remove the temporary files an interrupted copy left
```

| Command   | What it does                                                                                         |
| --------- | ---------------------------------------------------------------------------------------------------- |
| `scan`    | parses and matches the files of a folder or a file, writes nothing                                   |
| `process` | plans the transfers (and the NFO and images); writes only with `--apply`                             |
| `undo`    | reverts the last batch, or the one you name (`undo <batch>`); writes only with `--apply`             |
| `submit`  | sends a path to the server, `--apply` to transfer confident matches too                              |
| `tidy`    | reports the folders holding no video and the metadata named after a video (read-only by default)     |
| `cleanup` | lists, then removes with `--apply`, the temporary files an interrupted copy left in the destinations |

### Options of `scan`, `process` and `undo`

| Option                          | Meaning                                                                   |
| ------------------------------- | ------------------------------------------------------------------------- |
| `--library <id>`                | take the destination and settings of a library of `config.yaml`           |
| `--dest <dir>`                  | one destination folder for movies and series                              |
| `--dest-movies <dir>`           | destination folder for movies                                             |
| `--dest-series <dir>`           | destination folder for series                                             |
| `--naming <no-id\|with-id>`     | the `{tmdb-<id>}` tag in names, see [Output options](5-output-options.md) |
| `--metadata <nfo\|none>`        | NFO and artwork beside the videos                                         |
| `--mode <copy\|hardlink\|move>` | how files reach their destination                                         |
| `--threshold <score>`           | minimum score (0 to 100) for automatic processing                         |
| `--metadata-language <code>`    | language of the titles fetched from TMDB (`fr`, `en-US`)                  |
| `--apply`                       | actually write (`process`, `undo`, `tidy`, `cleanup`)                     |
| `--json`                        | machine-readable output: codes and parameters, never translated text      |
| `--lang <fr\|en>`               | language of the tool                                                      |
| `--config-dir <dir>`            | folder holding `config.yaml` and the database                             |

Flags win over `config.yaml`, which wins over the defaults. Movies and series may go to separate
libraries, as Plex recommends (`--dest-movies`, `--dest-series`).

### `submit`

`kinoshelf submit <path> [--apply] [--url <address>] [--json]` queues a file or folder on a running
server, for a download client's "on completion" hook. It reads `KINOSHELF_API_KEY` and
`KINOSHELF_URL` (default `http://localhost:8484`) from the environment, so the key never sits in a
command line. See [Getting downloads in](4-getting-downloads-in.md).

### `tidy`

`kinoshelf tidy [--library <id>] [--json]` is a read-only report on the libraries organized in place
(never an arrival folder): folders holding no video at the depth of a work, with what is in them, and,
in a movie library, the metadata another tool named after the video (`<video>.nfo`, `-poster`,
`-fanart`, `-clearlogo`).

- `--folders` takes the folders with no video out (a dry run unless `--apply`): only when they hold
  nothing but NFO, images and subtitles and a sibling holding a video bears the same name. Files go
  to `<config>/replaced/`, nothing is deleted, and `kinoshelf undo` puts them back.
- `--files` renames the metadata named after the video to Kinoshelf's names, or sets it aside when
  those exist; undoable. `--with-nfo` adds the `<video>.nfo` files that sit beside a `movie.nfo`.

The web has the same tool in [System › Maintenance](3-system.md#maintenance).

### `cleanup`

`kinoshelf cleanup [folders…] [--older-than <hours>] [--apply] [--json]` removes the temporary files an
interrupted copy left in the destinations (default: the typed libraries of `config.yaml`). Only files
untouched for at least 24 hours by default (`--older-than`, minimum 1): a younger one may still be
copying.

## Guarantees

- Nothing is written without `--apply`.
- An existing file is never overwritten.
- A failed hardlink is reported instead of silently copying.
- Every `--apply` run is a batch you can `undo`.

## Exit codes

`0` success, `1` a run or an operation failed, `2` bad usage.

## Settings and language

Settings can live in `~/.config/kinoshelf/config.yaml` (same format as the server's, see
[Configuration](6-configuration.md)). The tool speaks French or English: `--lang fr|en`, or your
locale.

## Server commands

```sh
kinoshelf-server                  # start the server
kinoshelf-server api-key create   # print a new API key once (replaces the previous one)
kinoshelf-server notify test      # check the Plex, Jellyfin and webhook setup
kinoshelf-server notify refresh <path> [--kind movie|series] [--dry-run]
                                  # ask Plex and Jellyfin to look at a folder
```

The standalone binary has no `kinoshelf-server`: the same are `kinoshelf serve`,
`kinoshelf api-key create` and `kinoshelf notify …` (the Docker image answers to both names).
