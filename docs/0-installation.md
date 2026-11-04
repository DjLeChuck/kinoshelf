# Installation

Docker is the recommended way to run Kinoshelf. The image holds the server, the web UI and the
command line.

## Docker Compose

```sh
cp compose.example.yaml compose.yaml   # adjust the paths, PUID/PGID and the keys
docker compose up -d
```

Then open `http://<your-server>:8484`. On a first launch, the welcome page asks for your TMDB key
and creates the API key (see [First key](#first-key)). To create the key from a shell instead:

```sh
docker compose exec kinoshelf kinoshelf-server api-key create
```

```yaml
services:
  kinoshelf:
    image: ghcr.io/djlechuck/kinoshelf:latest
    restart: unless-stopped
    ports:
      - '8484:8484' # '127.0.0.1:8484:8484' for this machine only
    environment:
      PUID: 1000
      PGID: 1000
      # TMDB_API_KEY: <your TMDB key>
      # KINOSHELF_API_KEY: <at least 32 random characters>
    volumes:
      - ./config:/config
      - /srv/media:/media # downloads and library on the same file system
    stop_grace_period: 5m
```

Images are published on GHCR for `linux/amd64` and `linux/arm64`. The container keeps its database
and `config.yaml` in `/config`, listens on `8484`, and its `HEALTHCHECK` calls `/health`. Inside it,
`kinoshelf` (the CLI) and `kinoshelf-server` are on the PATH.

## User and permissions

Set `PUID` and `PGID` to the owner of your media folders (`id <user>`; 1000 by default). Kinoshelf
runs as that user, so what it moves, copies or links belongs to you. It gives `/config` to this user
at start and never touches the permissions of the media folders, which that user must be able to
read and write.

- **TrueNAS**: use the `apps` user (568).
- **`user:` instead**: start the container with `user: "1026:100"` (Compose) or `--user`. `PUID`
  and `PGID` are then ignored, and `/config` must already belong to that user.
- Do not mount `/config` read-only.

## Hardlinks

A hardlink works only inside one file system. Mount downloads and library under a common parent
(`/srv/media:/media`), not as two separate volumes. When a link is impossible, Kinoshelf fails with
an explicit error: it never copies instead.

## Stopping

A copy can last minutes and a stop waits for it, while Docker kills the container after 10 s by
default. Set `stop_grace_period` (the example uses 5 minutes). A task cut short is resumed at the
next start.

## First key

Every call under `/api` needs the API key. On a first launch with no key, the sign-in page can
create it for you (shown once), but only when the server is reached by a local name:

- an IP address or `localhost`;
- a name without a dot, or ending in `.local`, `.lan`, `.home.arpa` or `.internal`;
- any name listed in `KINOSHELF_ALLOWED_HOSTS` (comma-separated).

Otherwise a page on the internet could point a name of its own at your server and take the key
first. You can also set `KINOSHELF_API_KEY` (32 characters at least) yourself.

An address that gives ten wrong keys within ten minutes is refused with a 429 until those ten
minutes are over.

## Behind a reverse proxy

The example publishes plain HTTP to the whole network. To reach Kinoshelf from elsewhere, put a
reverse proxy that adds TLS in front of it, and set `KINOSHELF_TRUST_PROXY` to the proxy's address
(or a range, or `true`). Without it, every request seems to come from the proxy, and the server sees
neither the browser's host name nor HTTPS.
