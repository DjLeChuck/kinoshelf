# Changelog

All notable changes to Kinoshelf are written here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project follows
[Semantic Versioning](https://semver.org/). Each version's section is the text of its GitHub release.

## [Unreleased]

### Added

- The naming choice in the Settings, the library form and the welcome now says that a file whose name gives a
  picture size is named with it (`Movie (2024) - 1080p.mkv`), and points to the "Read the picture size with
  ffprobe" setting (#7).

- An IMDb id in a name (`{imdb-tt0083658}`, `[imdbid-tt0083658]`) is now used: TMDB says which work it
  designates, that work joins the candidates (so a title the search misses is still weighed) and gets the
  same bonus as a TMDB id, only when its title, season and year agree.

- The subtitles of a release's `Subs` folder now follow the video, named `<video>.<language>.<ext>`
  (`2_French.srt` becomes `….fr.srt`, with `.forced` and `.sdh` kept). A file whose language the name does
  not give stays where it is. `.smi` and `.mks` files travel too.

- The sheet of a movie or an episode now lists the **subtitle files** beside each version (`Français (forcés)`,
  `English (malentendants)`), apart from the tracks inside the video. The preview of a rename says which
  subtitles of a `Subs` folder stay behind and why (no language in the name, language already taken), and
  so does `kinoshelf scan` and `process` (with `leftBehind` in `--json`).

- **Tidy up the subtitles of a `Subs` folder** in a library organized in place (`kinoshelf tidy --subtitles`, and a
  box in System › Maintenance): they go next to their video as `<video>.<language>.<ext>`, as for an arrival.
  A video already named as the profile wants never went through those rules. Undoable.

- The panel of an arrival now says **why the best match is not a full score**: title, year, type, country,
  installment, a close runner-up, or an id or installment that contradicts the year.

- A **back to top** button on long pages.

### Changed

- A library whose folder contains another's (or lies inside it) is now refused with a clear error
  (`library.source-overlaps`), the case being a downloads folder that held the whole media folder
  (`/media` beside `/media/movies`), which made every library file an arrival (#10, #11).

- The folder a move leaves behind is now removed when its sub-folders hold only what Kinoshelf made or
  nothing (an emptied `Subs`).

- A video `ffprobe` cannot read is now said so: one log line with its path and `ffprobe`'s reason (no
  stack), an Unreadable badge on its version, and a warning on the System page.

### Fixed

- Arrivals no longer slow down with the size of a release: the episodes TMDB has no number for were
  read once per file, so a release of thousands of files cost thousands of reads of the whole release (#10).

- A capitalized word opening an episode title (`Au nom de la mère`) is no longer read as a country (`AU`),
  which penalized the right series for not being Australian.

- A scan of an arrival folder in the activity panel now links to Arrivals instead of a library page it does
  not have; a job of no library, or of one deleted since, links to the History.

- A link to a section of the Settings (`/settings#processing`) keeps the section it names, instead of the
  last one.

- The image dialog keeps a fixed height while its tabs load.

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
