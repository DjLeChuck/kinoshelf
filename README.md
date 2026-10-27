# Kinoshelf

Identifies video files (movies, series) **already on disk**, renames them to match your player's
conventions (Plex, Jellyfin) and writes their metadata (NFO, artwork). A web-native equivalent of
tinyMediaManager and a companion to Radarr/Sonarr: it never downloads anything.

> **Status: v0.1 in progress** — headless core and CLI. Nothing is usable yet.

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
