# Getting downloads in

Kinoshelf never guesses that a download is finished by polling a folder: a file that stopped
growing may be a finished download or a dead torrent, and the disk cannot tell. There are four
ways instead, from the most to the least precise.

## Let the client say it is done

Run `kinoshelf submit <path>` from the client's "on completion" hook. It reads `KINOSHELF_API_KEY`
and `KINOSHELF_URL` (default `http://localhost:8484`) from the environment, so the secret never sits
in a command line. Add `--apply` to also transfer what is matched with confidence; the rest waits in
[Arrivals](1-web-ui.md#arrivals).

| Client       | Where                                                  | Command                                                                                                |
| ------------ | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| qBittorrent  | Options › Downloads › Run external program on finished | `kinoshelf submit "%F"`                                                                                |
| Transmission | `script-torrent-done-filename` (a script)              | `kinoshelf submit "$TR_TORRENT_DIR/$TR_TORRENT_NAME"`                                                  |
| Deluge       | Execute plugin, event _Torrent Complete_               | `kinoshelf submit "$3/$2"` (save path, torrent name)                                                   |
| SABnzbd      | post-processing script                                 | `kinoshelf submit "$1"` (final folder)                                                                 |
| rTorrent     | `.rtorrent.rc`                                         | `method.set_key = event.download.finished,kinoshelf,"execute.throw.bg=kinoshelf,submit,$d.base_path="` |

### Client in another container

The client then has no `kinoshelf` command. Make the same call over HTTP:

```sh
curl -fsS -X POST http://kinoshelf:8484/api/jobs \
  -H "Authorization: Bearer $KEY" -H 'content-type: application/json' \
  -d '{"path": "/downloads/Dune.2021.mkv"}'
```

Either way, **the path is read by Kinoshelf**: mount the downloads at the same path in both
containers.

## Watch a folder

This only works if your client writes unfinished downloads **outside** the watched folder, which it
does not do by default:

- **qBittorrent**: enable "Keep incomplete torrents in" and set it to a different folder than "Save
  files to location".
- **Transmission**: set an incomplete folder different from the download folder.

A download then moves to the final folder only once it is complete, and that final folder is the
one to watch. Without this, a stalled torrent and a finished one look the same.

```yaml
libraries:
  - id: downloads
    name: Downloads
    source: /downloads/complete
    into: { movie: films, series: series }
    watch: true # also settable from the Libraries page
watch:
  settleSeconds: 30 # a release is submitted once none of its files changed for this long
  pollSeconds: 0 # 0 listens for changes (no disk reads); 120 scans every 2 minutes
  apply: false # true also transfers what is matched with confidence
```

How it behaves:

- The kernel's change notifications only wake a scan, which then decides whether a release is
  complete: all its files stable, none still named `.!qB`, `.part` and the like.
- A release is submitted once; a file that is replaced is submitted again.
- What is already in the folder when watching starts is submitted too.
- **Network shares** (NFS, SMB) announce no change: give them a `pollSeconds`.
- Prefer the `hardlink` or `copy` mode: `move` takes the file from under its torrent.

## Scan a library or a path

A scan of a library's source (**Update from source**) or a path sent with `POST /api/jobs` or
`kinoshelf process` goes through the same queue, and files matched with confidence wait in Arrivals
unless you ask for them to be transferred (`apply`, or "Transfer what is identified with confidence"
for a watched folder).

## Ask by hand

**Check now**, at the top of the Arrivals tab, scans the watched folders without waiting for files
to settle (a still-incomplete suffix such as `.part` is still skipped). The API equivalent is
`POST /api/watch/scan` (`GET /api/watch` says what is watched).

## Plugging in a folder that already exists

If the folder you plug in already holds files that are in your library (renamed by hand or by another
tool, or hard-linked by Sonarr or Radarr), do it in this order:

1. **Scan the libraries first.** Kinoshelf compares each arrival with what its destination library holds,
   as the last scan saw it (same TMDB id, and for an episode the same season and episode): a file that has
   the same inode (a hard link) or the same size is _Already in the library_. A library file the scan could
   not identify has no TMDB id and cannot be compared.
2. **Add the downloads folder.**
3. In Arrivals, open **Already in the library** and **ignore them all** in one click, then process the
   rest.

The same work in a file of another size is not set aside: it waits in _To validate_, as it may be another
version. Alternatively, `kinoshelf submit` from the client, without watching the folder, only brings in new
downloads.

## What happens next

Each release found becomes one job in the queue: analyses and transfers run one at a time each, and
together only when they touch no common folder. A job survives a crash and resumes at the next start.
The result shows in [Arrivals](1-web-ui.md#arrivals) and, once files move, in the
[History](1-web-ui.md#history) as a batch you can undo. After a transfer, Plex and Jellyfin are asked
to refresh and webhooks are told (see [Configuration](6-configuration.md#notifications)).

Not built: reading completion from the download client's own API (qBittorrent, Transmission).
Watching a raw download folder stays out on purpose.
