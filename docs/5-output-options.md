# Output options

Two options decide how files are named and which metadata files are written next to them. Set them
globally (`naming` and `metadata` in `config.yaml`, or the Settings) or per library (CLI:
`--naming` and `--metadata`).

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

A `.nfo` already beside a video (another tool's, edited by hand) is never deleted nor overwritten: when
Kinoshelf writes its own, the other one stays where it is, and `kinoshelf tidy` reports it. Subtitles
always travel with their video.

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
  (NFO and images that were not touched). Anything else keeps the folder. Arrival folders are never
  cleaned.
- Changing an image or a collection replaces files on purpose: the old one goes to `<config>/replaced/`
  and the batch can be undone (see [Libraries](2-libraries.md#changing-an-image)).
- Several versions of one movie or one episode sit side by side in its folder, with the picture
  size as a label: `Nightbitch (2024) {tmdb-728949} - 2160p.mkv`, or `Foundation (2021) - s01e01 -
2160p.mkv` in its season folder. The label comes from the file name. When the name says none and
  another version is already there, the size is read from the video with `ffprobe` (see
  `detectPictureSize` in the [configuration](6-configuration.md)); a file already in its folder is
  never renamed unless you ask for it, from its page ("Add the version to the name").
