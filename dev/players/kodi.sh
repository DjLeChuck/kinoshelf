# Kodi for trying Kinoshelf's layout on this machine, with no Docker: Kodi has no maintained image,
# so it runs from nixpkgs on a virtual screen (Xvfb) that x11vnc and noVNC serve to a browser.
# Usage: kodi <up|down|logs|status>. State lives in .work/players/kodi, media in .work/media (read by
# Kodi, never written by it).
dir="${WORK:?}/players/kodi"
run="$dir/run"
home="$dir/home"
userdata="$home/.kodi/userdata"
display=:97
# The virtual screen, WIDTHxHEIGHT: Kodi fills it and noVNC scales it to the browser window.
resolution=${KODI_RESOLUTION:-1920x1080}
vnc_port=5997
web_port=6080
rpc_port=8080
mkdir -p "$run" "$userdata"

alive() { [ -s "$run/$1.pid" ] && kill -0 "$(cat "$run/$1.pid")" 2>/dev/null; }

# spawn <name> <command...>: detached, so it outlives this script.
spawn() {
  local name=$1
  shift
  alive "$name" && return 0
  setsid "$@" >"$run/$name.log" 2>&1 </dev/null &
  echo $! >"$run/$name.pid"
}

stop() {
  alive "$1" || return 0
  kill "$(cat "$run/$1.pid")" 2>/dev/null || true
  for _ in $(seq 20); do alive "$1" || break; sleep 0.5; done
  rm -f "$run/$1.pid"
}

# Kodi runs inside the desktop session, so its own power menu would reach the real logind and reboot
# or power off the machine. Pointing it at a system bus that does not exist leaves it with no power
# actions at all: the buttons disappear and "Quit" only exits Kodi.
start_kodi() {
  spawn kodi env HOME="$home" DISPLAY="$display" DBUS_SYSTEM_BUS_ADDRESS=unix:path=/nonexistent \
    kodi --standalone --windowing=x11
}

# Kodi only has to render, not be heard: it plays into a silent sink of its own rather than the
# desktop's default output, where a stream left open across a suspend can wedge PipeWire for every
# other app. The lowest priority keeps the sink from ever becoming the default one.
sink_name=kodi_null
sink_description="Kodi (null sink)"
sink_device="PIPEWIRE:$sink_name|$sink_description (PIPEWIRE)"

start_sink() {
  if pactl list short sinks | cut -f2 | grep -qx "$sink_name"; then return 0; fi
  pactl load-module module-null-sink "sink_name=$sink_name" \
    "sink_properties=device.description=\"${sink_description// /\\ }\" priority.session=1 priority.driver=1" \
    >"$run/sink.id"
}

stop_sink() {
  [ -s "$run/sink.id" ] || return 0
  pactl unload-module "$(cat "$run/sink.id")" 2>/dev/null || true
  rm -f "$run/sink.id"
}

# The settings Kodi would otherwise ask for. Written once: Kodi rewrites guisettings.xml on exit.
configure() {
  cat >"$userdata/sources.xml" <<EOF
<sources>
  <video>
    <default pathversion="1"></default>
    <source><name>Movies</name><path pathversion="1">$WORK/media/movies/</path><allowsharing>true</allowsharing></source>
    <source><name>Series</name><path pathversion="1">$WORK/media/series/</path><allowsharing>true</allowsharing></source>
  </video>
</sources>
EOF
  # Already-written settings still get the audio device (Kodi has to be stopped, or it rewrites them).
  if [ -e "$userdata/guisettings.xml" ]; then
    sed -i "s#<setting id=\"audiooutput.audiodevice\"[^>]*>[^<]*</setting>#<setting id=\"audiooutput.audiodevice\">$sink_device</setting>#" \
      "$userdata/guisettings.xml"
  fi
  [ -e "$userdata/guisettings.xml" ] || cat >"$userdata/guisettings.xml" <<EOF
<settings version="2">
  <setting id="audiooutput.audiodevice">$sink_device</setting>
  <setting id="services.webserver">true</setting>
  <setting id="services.webserverport">$rpc_port</setting>
  <setting id="services.webserverusername">kodi</setting>
  <setting id="services.webserverpassword">kodi</setting>
  <setting id="videolibrary.updateonstartup">true</setting>
  <setting id="general.addonupdates">2</setting>
  <setting id="general.addonnotifications">false</setting>
</settings>
EOF
}

# What a source's "Set content" dialog stores, which Kodi keeps only in its database: movies one per
# folder (so poster.jpg and movie.nfo are read), series, both from local information only (the NFO).
# Kodi creates the database on its first start, so that start comes first.
set_contents() {
  local db
  db=$(find "$userdata/Database" -name 'MyVideos*.db' 2>/dev/null | head -n 1 || true)
  if [ -z "$db" ]; then
    start_kodi
    for _ in $(seq 120); do
      db=$(find "$userdata/Database" -name 'MyVideos*.db' 2>/dev/null | head -n 1 || true)
      [ -n "$db" ] && break
      sleep 1
    done
    [ -n "$db" ] || { echo "Kodi did not create its database; see $run/kodi.log" >&2; exit 1; }
    sleep 3
    stop kodi
  fi
  sqlite3 "$db" "
    insert into path (strPath, strContent, strScraper, scanRecursive, useFolderNames, strSettings, noUpdate, exclude, allAudio)
      select '$WORK/media/movies/', 'movies', 'metadata.local', 2147483647, 1, '<settings version=\"2\"></settings>', 0, 0, 0
      where not exists (select 1 from path where strPath = '$WORK/media/movies/');
    insert into path (strPath, strContent, strScraper, scanRecursive, useFolderNames, strSettings, noUpdate, exclude, allAudio)
      select '$WORK/media/series/', 'tvshows', 'metadata.local', 0, 0, '<settings version=\"2\"></settings>', 0, 0, 0
      where not exists (select 1 from path where strPath = '$WORK/media/series/');"
}

case "${1:-}" in
  up)
    mkdir -p "$WORK/media/movies" "$WORK/media/series"
    start_sink
    configure
    spawn xvfb Xvfb "$display" -screen 0 "${resolution}x24"
    sleep 1
    export DISPLAY=$display
    set_contents
    start_kodi
    # x11vnc refuses to start when the desktop it runs in is Wayland, whatever display it is given.
    spawn vnc env -u WAYLAND_DISPLAY XDG_SESSION_TYPE=x11 x11vnc -display "$display" -rfbport "$vnc_port" -localhost -nopw -forever -shared -quiet -noxdamage
    spawn novnc novnc --listen "127.0.0.1:$web_port" --vnc "localhost:$vnc_port"
    echo "Kodi      http://localhost:$web_port/vnc.html?autoconnect=true&resize=scale (screen in the browser)"
    echo "          JSON-RPC http://localhost:$rpc_port/jsonrpc (kodi / kodi), libraries: $WORK/media/{movies,series}"
    ;;
  down)
    for name in novnc vnc kodi xvfb; do stop "$name"; done
    stop_sink
    ;;
  status)
    for name in xvfb kodi vnc novnc; do
      if alive "$name"; then echo "$name: running ($(cat "$run/$name.pid"))"; else echo "$name: stopped"; fi
    done
    ;;
  logs)
    exec tail -n 50 -F "$home/.kodi/temp/kodi.log" "$run"/*.log
    ;;
  *)
    echo "usage: kodi <up|down|status|logs>" >&2
    exit 2
    ;;
esac
