# Changelog

All notable changes to Kinoshelf are written here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project follows
[Semantic Versioning](https://semver.org/). Each version's section is the text of its GitHub release.

## [Unreleased]

## [1.0.0] - 2026-11-16

First stable release.

### Added

- **Identification and renaming** of movies and series already on disk: parsing with guessit, matching
  against TMDB (a score and a threshold decide, anything uncertain waits for review), a plan you can
  preview, then execution. Nothing touches the disk without a validated plan, and a destination file is
  never overwritten.
- **Undo**: every batch is journaled and can be undone from the History or with `kinoshelf undo`.
- **Two layout axes** for any player: `naming` (`with-id` or `no-id`) and `metadata` (`none` or `nfo`),
  global or per library. One layout reads the same under Plex, Jellyfin and Kodi.
- **NFO and artwork** (poster, fanart, clear logo, season posters, episode thumbnails), also for a
  library that is already organized, with a dialog to change any image.
- **Several versions** of a movie or an episode, told apart by picture size, source or release group,
  listed once with their coverage.
- **Collections** (sagas) written to the NFO, with a Collections screen and poster and background sent
  to Plex and Jellyfin.
- **Series validated as a release**, not file by file, with the missing episodes of each show.
- **Libraries** organized in place, and arrival folders that send what lands in them to a movie and a
  series library, with a watcher for folders that only hold finished downloads and
  `kinoshelf submit` for a download client's on-completion hook.
- **Web UI** in French and English: welcome page, Libraries, Arrivals, History, Settings and System
  (health, logs, TMDB usage, maintenance, diagnostic archive), with an activity panel for background
  tasks.
- **Maintenance**: tidy-up of empty folders and metadata named after the video, database backup and
  compaction, emptying of `replaced/`.
- **Notifications**: webhooks, and library refreshes on Plex (signed in with a Plex account) and
  Jellyfin.
- **REST API** with an OpenAPI document, protected by an API key.
- **Command line**: `scan`, `process`, `undo`, `tidy` and `submit`, with `--json` output.
- **Distribution**: a multi-architecture Docker image (`ghcr.io/djlechuck/kinoshelf`) and standalone
  binaries for Linux (x64, arm64) and macOS (arm64), with ffprobe included and a `SHA256SUMS` file.
- **Documentation** site built from `docs/`.

[Unreleased]: https://github.com/DjLeChuck/kinoshelf/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/DjLeChuck/kinoshelf/releases/tag/v1.0.0
