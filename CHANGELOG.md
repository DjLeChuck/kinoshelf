# Changelog

All notable changes to Kinoshelf are written here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project follows
[Semantic Versioning](https://semver.org/). Each version's section is the text of its GitHub release.

## [Unreleased]

### Fixed

- Signed in with Plex, Kinoshelf now sends the media server the token plex.tv lists for it instead of the
  sign-in's own token, which a server refused (`HTTP 401`) when reached through an address that requires
  authentication (a public address, a remote server, a network not allowed without auth): refreshes after a
  transfer, the notification test, collection images and the Health card (#31).

## [1.1.0] - 2026-11-20

### Added

- A library organized in place can now write its folder and file names its own way, from its form in the
  settings ("Custom masks" among the namings, or `names` in `config.yaml`): `{title}`, `{year}`, `{tmdb}`,
  `{imdb}`, `{season:02}`, `{episode:02}`, and what the video says: `{screenSize}`, `{source}`, `{releaseGroup}`, plus the
  codecs and dynamic range read from the file (`{videoCodec}`, `{audioCodec}`, `{audioChannels}` as `5.1`, `{audioLanguages}` as `FR+EN`, `{hdr}`). Any of them can also
  name a folder, which gives one folder per version. A `[group]` is left out,
  with the space before it, when a value in it is missing (`[imdbid-{imdb}]`). The names of a type go together (a
  movie's folder and file; a series' folder, season folder and episode file) and are kept as written: nothing
  is added to them, so two files they do not tell apart wait in Arrivals as a conflict. They are checked when
  saved (unique per work, inside the library) with a preview, and a warning when a movie file does not start
  with its folder's name (Jellyfin's rule). `{screenSize}` falls back on the picture's size read with ffprobe when the file name gives none (unless "Read the picture size with ffprobe" is off). The NFO and image names stay the ones every player reads. A name that
  uses the codecs needs the file read with ffprobe: a file it cannot read is held back with the reason. The
  parser now reads `[tmdbtvid-…]` and `[tmdbmovieid-…]` tags back (#12).

- A scan, or any analysis, can now be cancelled while it is queued or running, from the library page
  ("Cancel the scan") and from the activity panel. Nothing is stored: the library keeps the rows its last scan
  left, and the History lists the job as cancelled, not failed, where "Send again" is offered (#8).

- The NFO can now carry IMDb's rating beside TMDB's (`<rating name="imdb">`, with its vote count). It is opt-in
  (Settings › Processing, `imdbRatings` in `config.yaml`) and nothing is downloaded until it is ticked: Kinoshelf
  then fetches IMDb's public ratings file, offered for personal, non-commercial use, at most once a day, and
  shows the download in the activity panel. Only the NFO written afterwards carry it. The Maintenance tab shows
  what was downloaded (whether the setting is on or not) and can forget it. The sheet of a movie or a show now lists
  its ratings (IMDb's when available, TMDB's), the number of votes in a tip. An NFO written before the setting
  was on gets the rating on request: one work from its sheet, or every library from the Maintenance tab. Only an
  NFO Kinoshelf wrote and nobody edited is rewritten (the old one is set aside, the History undoes the batch) (#13).

- Movies and series libraries are now optional: someone who keeps only movies, or only series, no longer
  has to create a library they will not use. The welcome and the settings accept one folder, an arrival
  folder can send to one kind only, and a file of a kind nobody keeps waits in Arrivals with the reason
  (and a link to the settings) instead of going to another library or failing at transfer time (#6).

- The main buttons of a library (Organize, Complete, Add the version to the name, Scan again, Change the
  match) and of Arrivals (Validate, Transfer, Ignore, Analyse everything again) now explain themselves in a
  tooltip that opens on hover or keyboard focus, closes on Escape, and opens on a long press on a phone,
  instead of the browser's slow native one (#27). The other hints (the counts of missing episodes, the
  metadata marks, the subtitle languages, a webhook's attempts, the time of a log line) use it too.

- "Add the version to the name…" is now a bulk action: tick movies in a library's list, or shows in its tree,
  and name every one of their files with its picture size, with a preview first, as the page of one movie or
  episode already did. Any movie or show can be ticked for it, not only those to rename or refresh (#15).

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

- On a phone (640 px and below) the library tables drop their tick columns (NFO, poster, fanart, logo,
  thumbnail), and a series tree its year and seasons columns: the sheet of the work says the same, and the
  table fits the screen without scrolling sideways (#14). Where the page of a work or of a collection has no
  room beside the list, it opens as a sheet over it, never under it, and the versions scroll on their own.
  On a narrow screen the header folds the theme, the language and the sign-out into a menu.

- "Add the version to the name…" now only renames: it no longer writes the NFO and images that are missing
  (that is what the refresh is for), and a `.nfo` beside the video travels with it.
- "Rename…" is now "Organize…" and "Refresh…" is "Complete…": the first also writes what the profile expects
  beside the video, the second only what is missing. The movie page's separate "Write the missing files…"
  button, which did the same as the refresh, is gone.

- A library whose folder contains another's (or lies inside it) is now refused with a clear error
  (`library.source-overlaps`), the case being a downloads folder that held the whole media folder
  (`/media` beside `/media/movies`), which made every library file an arrival (#10, #11).

- The Settings, the welcome and the folder forms now tell **final files** from **downloads**: "Library" only names
  a folder that holds your final files, and the folders where downloads land are "Downloads folders". The
  Settings section is called "Folders", and a notice in the welcome and in each form says what the folder
  must hold (#10).

- The folder a move leaves behind is now removed when its sub-folders hold only what Kinoshelf made or
  nothing (an emptied `Subs`).

- A video `ffprobe` cannot read is now said so: one log line with its path and `ffprobe`'s reason (no
  stack), an Unreadable badge on its version, and a warning on the System page.

- The welcome now opens on **Arrivals** when its setup created a downloads folder, since that is where what the
  folder picks up waits, instead of an empty Libraries page.

- The activity panel folds the scans of one watched folder into a single line: a folder queues one scan per
  release, so a hundred arrivals no longer make a hundred lines. A failed scan stays apart, with its cause.

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

- **Transfer** in the panel of an arrival no longer turns into **Validate** when the list is read again while the
  panel is open.

- The page no longer scrolls behind a dialog or a sheet while one is open.

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

[Unreleased]: https://github.com/DjLeChuck/kinoshelf/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/DjLeChuck/kinoshelf/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/DjLeChuck/kinoshelf/releases/tag/v1.0.0
