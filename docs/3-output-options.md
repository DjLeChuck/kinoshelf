# Output options

Two options decide how files are named and which metadata files are written next to them. Set them
globally (`naming` and `metadata` in `config.yaml`, or the Settings) or per library (CLI:
`--naming` and `--metadata`).

| Option     | Value     | Effect                                                                            |
| ---------- | --------- | --------------------------------------------------------------------------------- |
| `naming`   | `with-id` | The TMDB id is in the movie and series names, as `{tmdb-<id>}` (default)          |
|            | `no-id`   | No id: cleaner names, but a player then matches on title and year alone           |
| `metadata` | `none`    | No metadata file: the player fetches its own (default)                            |
|            | `nfo`     | Kodi-format NFO and artwork: `poster.jpg`, `background.jpg`, `logo.png`, seasons' |

- With `no-id`, two works sharing both title and year are ambiguous for the player. With `nfo`, the
  NFO already says which work it is (`<uniqueid type="tmdb">`), so the id in the name is optional.
- `nfo` writes `movie.nfo`, `tvshow.nfo` and one `<file>.nfo` per episode. No season NFO: Plex
  ignores it. A series NFO also carries the TheTVDB id (`<uniqueid type="tvdb">`) when TMDB knows it.
- Which combination for which player:

| Player                               | `naming`  | `metadata` |
| ------------------------------------ | --------- | ---------- |
| Plex, default agents                 | `with-id` | `none`     |
| Plex, default agents, no id in names | `no-id`   | `none`     |
| Plex, "Plex NFO" agent (PMS 1.43.1+) | `no-id`   | `nfo`      |
| Jellyfin                             | `with-id` | `nfo`      |

## One layout for every player

The layout is kept as close to what both players read as possible, so a library laid out for one
reads the same for the other, with next to no renaming when you switch. It uses one id tag
(`{tmdb-<id>}`), the NFO files (`movie.nfo`, `tvshow.nfo`, one per episode), the image names
(`poster.jpg`, `background.jpg`, `logo.png`), a season's poster (`season01-poster.jpg` in the
show's folder, `season-specials-poster.jpg` for the specials), the `Season 01` folders and the
episode names (`Show (2022) - s01e01`, `s01e04-e05` for a file holding two).

Nothing is specific to a player: Jellyfin wants the video file of a movie to start with the name of its
folder, which every layout does anyway.

## Rules that hold for every combination

- Metadata files are never overwritten: one already there is left as it is and reported.
- `undo` removes the metadata files a batch wrote.
- Several versions of one movie or one episode sit side by side in its folder, with the picture
  size as a label: `Nightbitch (2024) {tmdb-728949} - 2160p.mkv`, or `Foundation (2021) - s01e01 -
2160p.mkv` in its season folder. The label comes from the file name. When the name says none and
  another version is already there, the size is read from the video with `ffprobe` (see
  `detectPictureSize` in the [configuration](4-configuration.md)); a file already in its folder is
  never renamed unless you ask for it, from its page ("Add the version to the name").
