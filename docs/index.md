---
layout: home
hero:
  name: Kinoshelf
  text: Your video files, identified and organized
  tagline: Identifies the movies and series already on your disk, renames them for Plex or Jellyfin and writes their metadata. It never downloads anything.
  actions:
    - theme: brand
      text: Get started
      link: /installation
    - theme: alt
      text: Concepts and web UI
      link: /web-ui
    - theme: alt
      text: GitHub
      link: https://github.com/DjLeChuck/kinoshelf
features:
  - title: Safe by design
    details: A preview before every write, no file ever overwritten, no silent copy when a hardlink fails, and every batch can be undone.
  - title: Plex, Jellyfin and Kodi
    details: One layout read the same by all three, with Kodi-format NFO and artwork (poster, background, logo, thumbnails) if you want them.
  - title: Libraries and arrivals
    details: Libraries organized in place, arrival folders whose files are identified then transferred, several versions of a movie or an episode side by side.
  - title: Artwork and collections
    details: Change a poster, a background or a logo from TMDB or an address of yours, and set the collections that Plex and Jellyfin show.
  - title: Getting downloads in
    details: From your download client's completion hook, or by watching a folder that only holds finished downloads.
  - title: Runs anywhere
    details: A multi-arch Docker image or a standalone binary with no Node to install, a web UI in French and English, a REST API and a command line.
---

<div class="home-shot">

![The Libraries page: a movie library with its filters and the page of one film](images/libraries.png#gh-dark-mode-only)
![The Libraries page: a movie library with its filters and the page of one film](images/libraries-light.png#gh-light-mode-only)

</div>

## Quick start

```sh
curl -O https://raw.githubusercontent.com/DjLeChuck/kinoshelf/main/compose.example.yaml
mv compose.example.yaml compose.yaml   # adjust the paths and PUID/PGID
docker compose up -d
```

Open `http://<your-server>:8484`: the welcome page asks for your TMDB key (your own, from
[themoviedb.org](https://www.themoviedb.org/settings/api)), creates the API key and walks you through your
first library. Without Docker, see [Installation](0-installation.md#standalone-binary).
