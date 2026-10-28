# Kinoshelf

Identifies video files (movies, series) **already on disk**, renames them to match your player's
conventions (Plex, Jellyfin) and writes their metadata (NFO, artwork). A web-native equivalent of
tinyMediaManager and a companion to Radarr/Sonarr: it never downloads anything.

> **Status: v0.1 in progress** — headless core and CLI. Nothing is usable yet.

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

## Development

With Nix: `nix develop` (or direnv). Otherwise: Node.js 22 and pnpm.

```sh
pnpm install
pnpm typecheck && pnpm lint && pnpm test
```

See [AGENTS.md](AGENTS.md) for project conventions.

## License

[MIT](LICENSE). Parsing relies on [guessit-js](https://github.com/opensubtitles/guessit-js)
(LGPL-3.0), used as an unmodified dependency.

This product uses the TMDB API but is not endorsed or certified by TMDB.
