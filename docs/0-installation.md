# Installation

Docker is the recommended way to run Kinoshelf. The image holds the server, the web UI and the
command line. Without Docker, a [standalone binary](#standalone-binary) does the same on Linux and
macOS, with no Node to install.

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
      # KINOSHELF_LOCALE: fr # the container has no LANG: English unless you say so here or in Settings
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

- **TrueNAS**: use the `apps` user (568). Kinoshelf moves, links and writes files, so that user
  needs write access to the datasets holding your libraries and arrival folders: make it their
  owner, or grant it in the dataset's ACL. Without it, a scan works (read only) and the renames then
  fail with `EACCES`. Put the libraries and the arrival folders in the **same dataset**: two
  datasets are two file systems, and a hardlink cannot cross them (see below). For `/config`, a
  volume managed by TrueNAS needs nothing; with a host path, the start-up `chown` may fail (a
  warning in the log), so apply the ACL to that path.
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

## Standalone binary

Each release has one archive per platform on the
[releases page](https://github.com/DjLeChuck/kinoshelf/releases): `linux-x64`, `linux-arm64` and
`macos-arm64`, with a `SHA256SUMS` file.

```
kinoshelf-<version>-linux-x64/
├── kinoshelf     # the server, the command line and the web UI, in one file
├── ffprobe       # a small build of FFmpeg's, read by Kinoshelf next to its own file
└── LICENSES/
```

```sh
sha256sum -c --ignore-missing SHA256SUMS      # shasum -a 256 -c on macOS
tar -xJf kinoshelf-<version>-linux-x64.tar.xz
cd kinoshelf-<version>-linux-x64
./kinoshelf serve                             # then open http://localhost:8484
```

`kinoshelf serve` starts the server, `kinoshelf scan`, `process`, `undo` and `submit` are the
[command line](5-cli.md), and `kinoshelf api-key create` and `kinoshelf notify test` are the
server's commands. Settings, the environment variables and the first key work as with Docker (see
[Configuration](4-configuration.md) and [First key](#first-key)); the config directory is
`~/.config/kinoshelf` unless `KINOSHELF_CONFIG_DIR` says otherwise. Put the two files wherever you
like (for example `/usr/local/lib/kinoshelf/`, and a link to `kinoshelf` in `/usr/local/bin`), but
keep them together: without `ffprobe` beside it, the binary falls back to the one on the `PATH`
(or `KINOSHELF_FFPROBE`), and without any, Kinoshelf still works but reads no codec or picture size.

**Requirements (Linux)**: glibc 2.28 or later (Debian 10, Ubuntu 18.10, RHEL 8 and newer),
`libstdc++` and **`libatomic`**, which a minimal install may lack (`apt install libatomic1`,
`dnf install libatomic`, `apk add libatomic`). Alpine and other musl systems have no archive: use
the Docker image.

**macOS**: the binary is not notarized, so Gatekeeper blocks the first launch of a downloaded
file. Allow it once with `xattr -d com.apple.quarantine kinoshelf ffprobe`.

### As a service (systemd)

Kinoshelf runs as one user, who must be able to read and write the media folders (see
[Hardlinks](#hardlinks): downloads and libraries on one file system). Creating a user of its own is
the cleanest, but any existing one that owns the media does as well: put it in `User=` and skip
the `useradd`.

```sh
sudo useradd --system --home-dir /var/lib/kinoshelf --create-home --shell /usr/sbin/nologin kinoshelf
sudo install -d /usr/local/lib/kinoshelf
sudo install kinoshelf ffprobe /usr/local/lib/kinoshelf/
sudo ln -s /usr/local/lib/kinoshelf/kinoshelf /usr/local/bin/kinoshelf
```

`/etc/systemd/system/kinoshelf.service`:

```ini
[Unit]
Description=Kinoshelf
After=network-online.target
Wants=network-online.target

[Service]
User=kinoshelf
Group=kinoshelf
Environment=KINOSHELF_CONFIG_DIR=/var/lib/kinoshelf
# Environment=KINOSHELF_HOST=127.0.0.1
# Environment=KINOSHELF_PORT=8484
# EnvironmentFile=/etc/kinoshelf.env     # TMDB_API_KEY=..., KINOSHELF_API_KEY=...
ExecStart=/usr/local/bin/kinoshelf serve
Restart=on-failure
# A copy can last minutes and a stop waits for it (see Stopping); the task is resumed at the next start.
TimeoutStopSec=5min

[Install]
WantedBy=multi-user.target
```

```sh
sudo systemctl enable --now kinoshelf
journalctl -u kinoshelf -f                # the logs
```

Open `http://<your-server>:8484`. **The permissions are what goes wrong most often**: with the
`kinoshelf` user, a scan works (it only reads) and the renames then fail with `EACCES` until that
user owns the media folders or belongs to their group (`usermod -aG <group> kinoshelf`, and the
group needs write access). The commands that use the same database run as the same user:

```sh
sudo -u kinoshelf env KINOSHELF_CONFIG_DIR=/var/lib/kinoshelf kinoshelf api-key create
```

To update, replace the two files with the new archive's and `systemctl restart kinoshelf`: the
database migrates itself at start.

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
