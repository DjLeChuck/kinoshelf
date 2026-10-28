# Kinoshelf

Identifies video files (movies, series) **already on disk**, renames them to match your player's
conventions (Plex, Jellyfin) and writes their metadata (NFO, artwork). A web-native equivalent of
tinyMediaManager and a companion to Radarr/Sonarr: it never downloads anything.

> **Status: v0.1 done**: the headless core and the CLI work from source (see below). The server and
> Docker image (v0.2) and the web UI (v0.3) are next.

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

## Docker: volume permissions

The image runs as `node` (uid/gid 1000) and keeps its database and `config.yaml` in `/config`.
That volume must be writable by this user, and the media folders readable (and writable, to move
or rename) by it. On a NAS the folder you mount usually belongs to another user, and the server
stops at startup with `Cannot write to the config directory /config (running as uid 1000)` or
`Permission denied for /config/config.yaml`. Either:

- give the folder to uid 1000: `chown -R 1000:1000 /path/to/config`; or
- run the container as the owner of your folders (`user: "1026:100"` in Compose, `--user` with
  `docker run`), which also gives it their access to the media.

A named volume is created as root and needs the same `chown`. Do not mount it read-only (`:ro`).

## Development

With Nix: `nix develop` (or direnv). Otherwise: Node.js 22 and pnpm.

```sh
pnpm install
pnpm typecheck && pnpm lint && pnpm test
```

See [AGENTS.md](AGENTS.md) for the project conventions.

## License

[MIT](LICENSE). Parsing relies on [guessit-js](https://github.com/opensubtitles/guessit-js)
(LGPL-3.0), used as an unmodified dependency.

This product uses the TMDB API but is not endorsed or certified by TMDB.
