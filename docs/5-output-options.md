# Output options

Two options decide how files are named and which metadata files are written next to them. Set them
globally (`naming` and `metadata` in `config.yaml`, or the Settings) or per library (CLI:
`--naming` and `--metadata`). A library can also write its folder and file names itself:
see [Custom masks](#custom-masks).

| Option     | Value     | Effect                                                                                                     |
| ---------- | --------- | ---------------------------------------------------------------------------------------------------------- |
| `naming`   | `with-id` | The TMDB id is in the movie and series names, as `{tmdb-<id>}`                                             |
|            | `no-id`   | No id: cleaner names, but a player then matches on title and year alone (default)                          |
| `metadata` | `none`    | No metadata file: the player fetches its own                                                               |
|            | `nfo`     | Kodi-format NFO and artwork: `poster.jpg`, `fanart.jpg`, `clearlogo.png`, seasons' and episodes' (default) |

- With `no-id`, two works sharing both title and year are ambiguous for the player. With `nfo`, the
  NFO already says which work it is (`<uniqueid type="tmdb">`), so the id in the name is optional.
- `nfo` also writes each episode's thumbnail, `<file>-thumb.jpg` beside the video (TMDB's still), one
  per version of the episode. Plex's NFO agent, Jellyfin and Kodi all read that name.
- `nfo` writes `movie.nfo`, `tvshow.nfo` and one `<file>.nfo` per episode. No season NFO: Plex
  ignores it. A series NFO also carries the TheTVDB id (`<uniqueid type="tvdb">`) when TMDB knows it.
- Which combination to pick:

| You want                                          | `naming`  | `metadata` |
| ------------------------------------------------- | --------- | ---------- |
| Plex with its default agents                      | `with-id` | `none`     |
| Plex with its default agents, cleaner names       | `no-id`   | `none`     |
| Plex's "Plex NFO" agent (PMS 1.43.1+) or Jellyfin | `with-id` | `nfo`      |
| The same, cleaner names (the NFO carries the id)  | `no-id`   | `nfo`      |

With `nfo`, the id in the name is a safety net, for when a player ignores or has not yet read the
NFO. Jellyfin's documentation recommends it, but neither Jellyfin nor Plex's NFO agent needs it: both
identify the work from the NFO alone.

## Names

- **Forbidden characters** are removed (Windows rules, whatever the system), except a colon that opens a
  subtitle, which is written `-`: `Avatar : La Voie de l’eau` becomes `Avatar - La Voie de l’eau`. There
  is no setting for it. A library organized before this shows its colon titles as to rename.
- A movie lives in `Title (Year)` (with ` {tmdb-<id>}` when `naming` is `with-id`), a series in
  `Show (Year)`, with `Season 01` folders and episodes named `Show (2022) - s01e01`.
- **The picture size is added whatever the `naming`**: a file whose name gives one arrives as
  `Dune (2021) - 1080p.mkv` (or `Dune (2021) {tmdb-438631} - 1080p.mkv` with `with-id`), so several versions
  of a work can sit side by side (see [the rules below](#rules-that-hold-for-every-combination)). The examples of the naming
  choice in the Settings show that case.

## Custom masks

A library organized in place can name its folders and its video files its own way, instead of with one
of the two namings: choose **Custom masks** among the namings of its form in the Settings (or set `names`
for the library in `config.yaml`, see [Configuration](6-configuration.md#libraries)). A downloads
folder has none: it takes the masks of the library each file goes to. The NFO and image names are not
part of it: they stay the ones every player reads.

A mask is a template with variables in braces, such as `{title} ({year}) [imdbid-{imdb}]`. The names of a
**type go together**: a movie library sets the movie's folder and file, a series library the series folder,
the season folder and the episode file. A type you do not customise keeps its naming.

| Variable         | Stands for                                                           | Always there |
| ---------------- | -------------------------------------------------------------------- | ------------ |
| `{title}`        | the title                                                            | yes          |
| `{year}`         | the year                                                             | yes          |
| `{tmdb}`         | the TMDB id                                                          | yes          |
| `{imdb}`         | the IMDb id (`tt…`), when TMDB has it                                | no           |
| `{season}`       | the season number (`{season:02}` pads with a zero), series only      | yes          |
| `{episode}`      | the episode number (`{episode:02}`), series only                     | yes          |
| `{episodeTitle}` | the episode's title, series only                                     | no           |
| `{screenSize}`   | the picture size (`2160p`), as the file name says it                 | no           |
| `{source}`       | the source (`Blu-ray`, `Web`), as the file name says it              | no           |
| `{releaseGroup}` | the release group, as the file name says it                          | no           |
| `{videoCodec}`   | the video codec read from the file (`HEVC`, `H264`, `AV1`)           | no           |
| `{audioCodec}`   | the audio codec read from the file (`EAC3`, `AC3`, `DTS`)            | no           |
| `{hdr}`          | `Dolby Vision`, `HDR10+`, `HDR10` or `HLG`; nothing for an SDR video | no           |

Every name of a type takes every variable of the type, a folder's too: `Dune (2021) - {screenSize}` as a
movie folder makes one folder per version. A movie has no season nor episode. The codecs and `{hdr}`
are read from the video with `ffprobe`: the probe a library already holds is used while the file is
unchanged, else the file is read, and one `ffprobe` cannot read is held back with the reason (it would
be named wrongly rather than shortly).

**What may be missing is left out.** A variable that has no value (the second column says which) is
written as nothing, with the space or separator before it. A group in square brackets is written only
when everything in it has a value, with the space before it: `{title} ({year}) [imdbid-{imdb}] [{hdr}]` gives
`Dune (2021) [imdbid-tt1160419] [HDR10]`, and `Dune (2021)` when nothing else is known. Text outside the
brackets always stays, so put a label in the group with its value: `[HDR: {hdr}]`. `{title}`, `{year}`,
`{tmdb}`, `{season}` and `{episode}` are required: a work TMDB gives no year cannot be named by a mask
that uses `{year}` and waits for you in Arrivals. Write `\{`, `\}`, `\[` and `\]` for a literal brace or
bracket, and in YAML put a mask that has a backslash between single quotes.

**A custom name is kept as written.** Kinoshelf adds nothing to it, not even the quality label it adds to
the standard names: two files your masks do not tell apart wait in Arrivals as a conflict. To keep
several versions of a work, put the picture size, the source or the group in the file name (or in the
folder's, for one folder per version). A library already organized another way shows its files as to
rename, as for any change of naming.

A mask is checked when it is saved, with a preview of what it gives for a film and for a series, with
everything known and with the bare minimum. It is refused when it uses an unknown variable, when it
leaves the library (`..`, a leading `/`, a `/` in a file name) or when it would give two works the same
name (`{title}` is needed in the names of a work, `{season}` in the season folder, `{episode}` in the
episode file). It only warns when a movie file does not start with its folder's name, which Jellyfin
needs to group the versions of a movie.

```yaml
libraries:
  - id: films
    name: Films
    source: /media/films
    type: movie
    names:
      movieFolder: '{title} ({year}) [imdbid-{imdb}] [tmdbid-{tmdb}]'
      movieFile: '{title} ({year}) {screenSize} {audioCodec} [imdbid-{imdb}] [tmdbid-{tmdb}]'
```

## What `nfo` writes

| File                                                | Where                              | Notes                                                                               |
| --------------------------------------------------- | ---------------------------------- | ----------------------------------------------------------------------------------- |
| `movie.nfo`                                         | the movie's folder                 | one per movie, whatever its versions                                                |
| `poster.jpg`, `fanart.jpg`, `clearlogo.png`         | the movie's or the show's folder   | a work with no logo on TMDB gets none; a movie written flat gets no fixed-name file |
| `tvshow.nfo`                                        | the show's folder                  | carries the TheTVDB id when TMDB knows it                                           |
| `season01-poster.jpg`, `season-specials-poster.jpg` | the show's folder                  | Plex's NFO agent, Jellyfin and Kodi read this name                                  |
| `<file>.nfo`                                        | beside each episode (each version) | no player reads a shared episode NFO                                                |
| `<file>-thumb.jpg`                                  | beside each episode (each version) | TMDB's still, original size                                                         |

The NFO also carries TMDB's keywords (`<tag>`, in English), the age rating (`<mpaa>`: `FR:16`,
`PG-13`, the country following the metadata language, then the US, then the first TMDB lists), the
collection (`<set>`) of a movie that has one, and a TMDB `<uniqueid>`. Images are fetched from TMDB at
`standard` size, and `original` for a fanart or a logo.

### IMDb ratings

TMDB's rating is always written. **Write IMDb's rating in the NFO** (Settings › Default settings, or the
welcome; `imdbRatings` in `config.yaml`) adds IMDb's beside it (`<rating name="imdb">`, with its vote
count), TMDB's staying the default one. It is **off by default, and nothing is downloaded while it is**:
ticked, Kinoshelf fetches IMDb's public ratings file, which IMDb offers for personal, non-commercial
use, at most once a day, and keeps it in its own database (never shipped in the image or the binary).
The download shows in the activity panel; a work the file does not know gets no IMDb rating.

An NFO that already exists is never rewritten by a refresh, so only the ones written from then on carry
the rating. To add it to the others:

- **from the page of a movie or a show**, **Add the IMDb rating to the NFO**;
- **for every library**, the **Add IMDb ratings to the NFO** card of the [Maintenance](3-system.md#maintenance) tab.

The rating is inserted in the file as it is, with no request to TMDB, and **only if Kinoshelf wrote the
NFO and nobody edited it since**: one from another tool, or changed by hand, is left alone and counted.
The old file is set aside in `<config>/replaced/` and the batch can be undone from the History.

A `.nfo` already beside a video (another tool's, edited by hand) is never deleted nor overwritten: when
Kinoshelf writes its own, the other one stays where it is, and `kinoshelf tidy` reports it. Subtitles
always travel with their video.

**Subtitles in a release's `Subs` folder** (`Subs`, `Sub`, `Subtitles`) are taken too and put beside the
video as `<video name>.<language>.<extension>`, the language being the two-letter ISO 639-1 code read from
the file's name (`2_French.srt` becomes `… .fr.srt`; `.forced` and `.sdh` are kept: `….en.forced.srt`). A
season pack's files go to their episode, by the name of their sub-folder or by their season and episode
number. A file whose language the name does not give is left where it is, and so is a second file for a
language already taken: nothing is renamed at random. Brazilian and European Portuguese are both `pt`, so
only the first is taken. The emptied `Subs` folder goes with the release's folder, and an undo puts the
files back. The preview of a rename lists the subtitles that go along and says which ones stay, and why.

## One layout for every player

The layout is kept as close to what the players read as possible (Plex, Jellyfin and Kodi), so a library
laid out for one reads the same for the others, with next to no renaming when you switch. It uses one id tag
(`{tmdb-<id>}`), the NFO files (`movie.nfo`, `tvshow.nfo`, one per episode), the image names
(`poster.jpg`, `fanart.jpg`, `clearlogo.png`), a season's poster (`season01-poster.jpg` in the
show's folder, `season-specials-poster.jpg` for the specials), an episode's thumbnail (`<file>-thumb.jpg`
beside the video), the `Season 01` folders and the episode names (`Show (2022) - s01e01`, `s01e04-e05` for a file holding two).

Nothing is specific to a player: Jellyfin wants the video file of a movie to start with the name of its
folder, which every layout does anyway.

### Kodi

Kodi reads the layout with `metadata: nfo`, if its sources are set up for it:

- Set the movies source to **"Movies are in separate folders that match the movie title"**, with the
  content scraped from **local information only** (a series source takes local information only
  too). Without the first setting Kodi ignores a movie's `poster.jpg` and `movie.nfo`, and a
  non-recursive scan finds no movie at all.
- Several versions of one movie, or of one episode, show up as **separate entries**: Kodi 21 does not
  attach them to each other, and the names cannot change that. They can be merged by hand in Kodi
  (the "Add version" / "Manage versions" menu). Kodi 22 (tried on 22.0rc2) attaches **movies only**,
  and only a file whose NFO carries `<hasvideoversions>true</hasvideoversions>`; episodes stay separate
  entries. Kinoshelf does not write that tag, on purpose: it would help one player, for movies, from a
  version that is still a release candidate, and Kinoshelf never rewrites an existing NFO, so the
  libraries already written would not get it. Plex, Jellyfin and Kodi 21 ignore the tag.
- Seasons' posters, `s01e04-e05` files and the `{tmdb-<id>}` tag (read as a hint by Kodi's TMDB
  scraper) need nothing more.

## Rules that hold for every combination

- Metadata files are never overwritten: one already there is left as it is and reported.
- `undo` removes the metadata files a batch wrote, only if they are unchanged (a poster you replaced or
  an NFO a player edited is kept).
- After a **move**, the folder the video left is removed if everything in it is a file Kinoshelf made
  (NFO and images that were not touched). Anything else keeps the folder. Downloads folders are never
  cleaned.
- Changing an image or a collection replaces files on purpose: the old one goes to `<config>/replaced/`
  and the batch can be undone (see [Libraries](2-libraries.md#changing-an-image)).
- Several versions of one movie or one episode sit side by side in its folder, with the picture
  size as a label: `Nightbitch (2024) {tmdb-728949} - 2160p.mkv`, or `Foundation (2021) - s01e01 -
2160p.mkv` in its season folder. The label comes from the file name. When the name says none and
  another version is already there, the size is read from the video with `ffprobe` (see
  `detectPictureSize` in the [configuration](6-configuration.md)); a file already in its folder is
  never renamed unless you ask for it, from its page or on a selection ("Add the version to the name").
