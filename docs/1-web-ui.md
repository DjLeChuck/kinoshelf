# Concepts and web UI

The server serves the web UI on its own port (`http://localhost:8484`), in French or English
(follows your browser, switchable in the header), with a dark, a light or a system theme (the header's
theme menu).

Sign in with the API key: the browser keeps a session cookie for 7 days, so the key itself is not
stored.

The header has four entries: **Libraries**, **History**, **Settings** and **System**. The
[Libraries](2-libraries.md) page and the [System](3-system.md) page have a chapter of their own; this
one covers the concepts, the welcome, Arrivals, History, the activity panel and the Settings.

## How a file is handled

Every file goes through the same four steps, and nothing touches the disk before the third is
validated:

1. **Parse**: the file name (and its folders) is read for a title, a year, a season and episode,
   a picture size, a language, an id…
2. **Match**: TMDB candidates are searched and scored. A score at or above the **threshold** (85 by
   default) is a match with confidence; below it, or when two candidates are too close, a human
   decides.
3. **Plan**: the new name, the NFO and the images to write are computed, and conflicts are flagged.
   This is what the preview shows.
4. **Execute**: the plan runs and is recorded in a journal, which is what makes every batch
   undoable.

Kinoshelf's guarantees hold in every screen, the CLI and the API:

- a preview before every write;
- an existing file is **never overwritten**: the planner flags it, the executor checks it again right
  before writing, and the file primitives refuse to replace (the only overwrites are the explicit,
  journaled ones, such as changing an image, which sets the old file aside);
- no silent copy when a hardlink is impossible: it fails with an explicit error;
- every batch can be undone, and a file that changed since is left alone.

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
the Settings, with a path picker on the server's disk. See
[Configuration](6-configuration.md#libraries) for every key.

## Welcome

On a new install, `/` shows a setup in four steps: the TMDB key (your own, tested as soon as you enter
it), Plex or Jellyfin, your movies and series folders (the first two libraries, organized in place),
and an arrival folder pointing at them (watched, or scanned once). Each step ticks itself once the
configuration says so, and the server remembers what you skipped. The app then opens on Libraries.

If the first job fails, it is not lost: the History lists it with its cause.

## Arrivals

The **Arrivals** tab of the Libraries page holds the files that wait for you. A library organized in
place never lands here. The files are in three states:

- **Ready to transfer**: matched with confidence (a score at or above the threshold), but not moved
  because the analysis only reads. That is what a watched folder or a scan does while the setting
  "Transfer what is identified with confidence" is off. **Transfer** runs the plan as it is, or pick
  another candidate, library or size and **Validate** instead; **Transfer all the files that are
  ready** (at the top) starts them all, even those the list has not loaded yet.
- **To validate**: Kinoshelf could not place the file with confidence, or a conflict or a failed
  transfer needs a look.
- **Not recognized**: nothing was found.

For each file you see its TMDB candidates and their score, a manual search, and the destination a
choice would give. When TMDB lacks the season and episode of some files of the series, the panel lists
them grouped by season, with a link to each season on TMDB (or says the season does not exist there): a
perfect title still waits for validation, because the numbering may differ.

![The Arrivals tab: files ready to transfer, with the TMDB candidate and the destination](images/arrivals.png#gh-dark-mode-only)
![The Arrivals tab: files ready to transfer, with the TMDB candidate and the destination](images/arrivals-light.png#gh-light-mode-only)

- **Validate** sends the file to the library you pick (by default the one of its kind in the arrival
  folder's `into`; any library of the work's kind otherwise). The choice is for that file and the
  release mates that follow it: the next arrival of the same work takes the folder's `into` again.
  Validation runs in the background (the row says "Validating… 3/20").
- **Ignore** sets the file or its release aside.
- A series is validated **as a release**, not file by file: the episodes of a folder vote on the series
  title, one search is made for all of them, and the other episodes of the same release follow your
  choice. A folder holding several series is split into clusters, each validated as a whole; the
  other clusters are listed under the release.
- When the file name gives no picture size and another version of the work is in the way, set the
  size by hand while validating (or let Kinoshelf read it with `ffprobe`, see
  [Default settings](#default-settings)).
- **Check now**, at the top of the tab, scans the watched folders without waiting for files to settle
  (disabled when no folder is watched).
- **Analyse everything again** starts over: every file of the arrival folders is analysed again, except
  those already waiting here. Useful after emptying a library.

How a download gets here is explained in [Getting downloads in](4-getting-downloads-in.md).

## History

One list for what Kinoshelf did:

- a **batch** is a line (a transfer, a rename, a refresh, an image change, a tidy-up…), with its
  files, what was written beside them (NFO, images) and what was set aside;
- a **job** is a line only while it has no batch: waiting, running, or failed, with its cause, the
  settings it ran with and **Send again**. A job that made a batch is folded into it.
- Analyses that finished and moved nothing are hidden until you tick **Show every analysis**. They
  stay in the database until the daily purge (see [Retention](#retention)), but the journal is never
  purged: any batch stays undoable.

**Undo** shows what would be restored (a check first), then asks for confirmation, and runs in the
background with a progress bar you can leave and come back to. A file moved or replaced since the
batch is left alone, a copy or hardlink whose original is gone is kept (it is the only one left),
the metadata files the batch wrote are removed, and the folders it created are pruned.

The selected line is in the address (`/history/<id>`), so you can link to it.

![The History: a batch with what it wrote and its Undo button](images/history.png#gh-dark-mode-only)
![The History: a batch with what it wrote and its Undo button](images/history-light.png#gh-light-mode-only)

## Activity panel

At the bottom right of every page, a pill says how many tasks run in the background. It unfolds to a
line per task: title, phase, progress bar, current file and a link to where it is followed. It lists
scans, transfers, undos, arrival validations, tidy-ups, database backup and compaction, emptying
`replaced/` and sending collection images. A finished task stays a few seconds (ten minutes when it
failed) and can be closed by hand.

## Settings

Everything is saved in `config.yaml` and applies at once, without a restart. Secrets are never shown
again: a field says that a value is set and leaves it alone when empty. A value forced by an
environment variable (`TMDB_API_KEY`, `KINOSHELF_API_KEY`) is disabled with an explanation, and the
API refuses to change it.

![The Settings: libraries and arrival folders](images/settings.png#gh-dark-mode-only)
![The Settings: libraries and arrival folders](images/settings-light.png#gh-light-mode-only)

### TMDB and languages

- **TMDB key**: your own, from [themoviedb.org](https://www.themoviedb.org/settings/api), with a test
  button. None is ever embedded in Kinoshelf.
- **Language**: the language of notifications and of the tool.
- **TMDB titles language** (advanced): a code such as `fr` or `en-US`; empty follows the language.

### Libraries

Libraries and arrival folders, added with a server-side path picker (a browser cannot see the
server's disk, and in Docker only mounted folders exist). A library sets its own names and metadata
options and threshold; an arrival folder sets its mode (copy, hardlink, move), its destination
libraries and whether it is watched. Ids are generated from the name and never change; two
libraries cannot share a source. A library an arrival folder points at cannot be deleted.

### Folder watching

How long a release must stay unchanged before it is submitted, a polling interval for network shares
and whether to transfer what is matched with confidence. See
[Getting downloads in](4-getting-downloads-in.md#watch-a-folder).

### Default settings

Used by libraries that do not set their own, and for a folder outside any library (a path you submit,
or `scan` and `process` on the command line):

- **Names** and **Metadata files**: see [Output options](5-output-options.md);
- **File mode**: automatic (move when the destination is the source folder, copy otherwise), copy,
  hardlink or move;
- **Automatic threshold** (0 to 100): a match scoring below it waits in Arrivals;
- **Read the picture size with ffprobe** (on by default): when a name says no size and another
  version is in the way, the size is read from the file so both can be kept side by side;
- **Allow image addresses on the local network** (off by default): see
  [Changing an image](2-libraries.md#changing-an-image).

### Retention

What the System page's Maintenance tab keeps: how many database backups (3 by default) and how many
days before the files set aside are emptied (30 by default, 0 for all). These change nothing until
the action is run. Settled jobs are forgotten after `retentionDays` (30; 0 keeps all, see
[Configuration](6-configuration.md)).

### Plex, Jellyfin and webhooks

- **Plex**: sign in with your Plex account (no token to copy, the access renews itself) and pick a
  server, or paste a token and an address. An optional library number forces one Plex library.
- **Jellyfin**: address and token.
- Both have a **path mapping** for when the media server sees the folders under other paths.
- **Webhooks**: generic, Gotify, ntfy or Discord, each told about transferred files, failures and/or
  files to validate. An address stays secret once saved. **Send a test notification** checks every
  target.

Details in [Configuration](6-configuration.md#notifications).

### API key

The key used to sign in and by scripts. **Replace** it if it leaked or was lost: scripts using the
old one stop working at once, the browser stays signed in.

## Good to know

- The screens update by themselves when a job ends or a file is validated elsewhere.
- Posters come through the server, which fetches each one from TMDB once and keeps it in
  `/config/images`: your browser never contacts TMDB.
- Filters, sort and open trees live in the address, so a link or a reload keeps them.
