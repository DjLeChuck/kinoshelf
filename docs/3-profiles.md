# Output profiles

A profile decides how files are named and which metadata files are written next to them. Set it
globally (`profile` in `config.yaml`, or the Settings) or per library. The value is a shipped id or
the path of your own YAML file.

| Profile      | For                                    | TMDB id in the name | NFO | Artwork                                    |
| ------------ | -------------------------------------- | ------------------- | --- | ------------------------------------------ |
| `plex`       | Plex's default agents                  | `{tmdb-<id>}`       | no  | no                                         |
| `plex-no-id` | Plex, matching on title and year alone | no                  | no  | no                                         |
| `plex-nfo`   | Plex's "Plex NFO" agents (PMS 1.43.1+) | no                  | yes | `poster.jpg`, `background.jpg`, `logo.png` |
| `jellyfin`   | Jellyfin                               | `[tmdbid-<id>]`     | yes | `poster.jpg`, `background.jpg`, `logo.png` |

- `plex` and `plex-no-id` write no metadata files: Plex fetches its own.
- `jellyfin` and `plex-nfo` write the same Kodi-format NFO: `movie.nfo`, `tvshow.nfo`, and one per
  episode. No season NFO: Plex ignores it.
- `plex-nfo` uses the same layout as `plex-no-id`, with NFO and artwork.

## Rules that hold for every profile

- Metadata files are never overwritten: one already there is left as it is and reported.
- `undo` removes the metadata files a batch wrote.
- Several versions of one movie or one episode sit side by side in its folder, with the picture
  size as a label: `Nightbitch (2024) {tmdb-728949} - 2160p.mkv`, or `Foundation (2021) S01E01 -
2160p.mkv` in its season folder. The label comes from the file name. When the name says none and
  another version is already there, the size is read from the video with `ffprobe` (see
  `detectPictureSize` in the [configuration](4-configuration.md)); a file already in its folder is
  never renamed unless you ask for it, from its page ("Add the version to the name").
