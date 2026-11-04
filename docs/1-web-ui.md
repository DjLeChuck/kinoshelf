# Concepts and web UI

The server serves the web UI on its own port (`http://localhost:8484`), in French or English
(follows your browser, switchable in the header), with a dark and a light theme.

Sign in with the API key: the browser keeps a session cookie for 7 days, so the key itself is not
stored.

## Two kinds of folders

Kinoshelf distinguishes **where files arrive** from **where they belong**.

- A **library** (movies or series) is organized in place. Kinoshelf scans it, renames what does not
  follow the profile and writes the missing metadata. Its files never leave it.
- An **arrival folder** (your downloads) is a source. Each file is identified, then transferred
  into a library by copy, hardlink or move.

```yaml
libraries:
  - { id: films, name: Films, type: movie, source: /media/Movies }
  - { id: series, name: Series, type: series, source: /media/TV }
  - {
      id: downloads,
      name: Downloads,
      source: /downloads/complete,
      into: { movie: films, series: series },
    }
```

A folder has either a `type` (library) or an `into` (arrival folder), never both. Both are set from
the Settings, with a path picker on the server's disk.

## Welcome

On a new install, `/` shows a four-step setup: TMDB key, Plex or Jellyfin, your movies and series
folders, first files. Each step ticks itself once the configuration says so, and the server
remembers what you skipped. The app then opens on Libraries.

## Libraries

One tab per library, plus an **Arrivals** tab.

A library lists what its last scan saw, with:

- **filters**: to validate, to rename, unrecognized, missing NFO or images and, for a series
  library, missing episodes or missing show files. They are kept in the address (`?state=…`), so a
  link or a reload keeps them;
- a search and the scan progress;
- a page per item: summary and `ffprobe` details.

A series library reads as a tree (show, season, episode), with its missing episodes and, at each
level, the NFO and images the profile writes (`tvshow.nfo`, poster, fanart, season poster).

**Rename** and **Refresh** open a preview first. Nothing is written until you confirm, and an
existing file is never overwritten.

### Several versions of one movie

A 1080p and a 2160p of the same movie live side by side in its folder, as Plex and Jellyfin
expect: `Nightbitch (2024) {tmdb-728949} - 2160p.mkv`. The label is the picture size found in the
file name. A file already in its folder is never renamed unless you ask for it from the movie's
page (**Add the version to the name**).

## Arrivals

Arrivals hold the files Kinoshelf could not place with confidence, that is with a score under the
threshold (85 by default). For each one you see:

- its TMDB candidates and their score, and a manual search;
- the destination a choice would give.

**Validate** sends the file to the library you pick. **Ignore** sets it aside. A series is
validated as a release: the other episodes of the same release follow.

**Check now**, at the top of the tab, scans the watched folders without waiting for files to settle
(disabled when no folder is watched).

## History

Every transfer appears as a batch with its files, along with the analyses that are waiting or
failed, with their cause and a way to send them again. Analyses that finished and moved nothing are
hidden until you ask for them.

**Undo** shows what would be restored, then asks for confirmation. A file moved or replaced since
the batch is left alone, and the metadata files the batch wrote are removed.

## Settings

The TMDB key, languages, output profile, file mode, threshold, your libraries and arrival folders,
Plex, Jellyfin, webhooks (with a test) and the API key. They are saved in `config.yaml` and apply at
once, without a restart. Secrets are never shown again.

## Good to know

- The screens update by themselves when a job ends or a file is validated elsewhere.
- Posters come through the server, which fetches each one from TMDB once and keeps it in
  `/config/images`: your browser never contacts TMDB.
