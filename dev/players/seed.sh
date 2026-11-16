# Fills an arrival folder with tiny clips named like real releases, so Kinoshelf has something to
# identify, rename and hand to the players. Re-running adds what is missing and touches nothing else.
# Everything lives under one filesystem (.work/media), so a hardlink from the arrivals to the
# libraries works.
arrivals="${WORK:?}/media/arrivals"
mkdir -p "$arrivals" "$WORK/media/movies" "$WORK/media/series"

# One two-second clip, copied for every name: the content is irrelevant, the names are the test.
base=$(mktemp --suffix=.mkv)
trap 'rm -f "$base"' EXIT
ffmpeg -loglevel error -y \
  -f lavfi -i color=c=black:s=320x180:d=2:r=24 \
  -f lavfi -i anullsrc=r=48000:cl=stereo \
  -t 2 -c:v mpeg4 -c:a aac "$base"

# put <release folder> <file name>: one file, in its release folder.
put() {
  mkdir -p "$arrivals/$1"
  [ -e "$arrivals/$1/$2" ] || cp "$base" "$arrivals/$1/$2"
}

# Movies, matched with confidence.
put "The.Matrix.1999.1080p.BluRay.x264-SEED" "The.Matrix.1999.1080p.BluRay.x264-SEED.mkv"
# A second film of the same saga, so a collection holds two movies of its four on TMDB.
put "The.Matrix.Reloaded.2003.1080p.BluRay.x264-SEED" "The.Matrix.Reloaded.2003.1080p.BluRay.x264-SEED.mkv"
put "Dune.2021.1080p.WEB-DL.DDP5.1.H.264-SEED" "Dune.2021.1080p.WEB-DL.DDP5.1.H.264-SEED.mkv"

# Two qualities of one movie: both arrive named with their picture size (versions).
put "Nightbitch.2024.1080p.WEB-DL.DDP5.1.H.264-SEED" "Nightbitch.2024.1080p.WEB-DL.DDP5.1.H.264-SEED.mkv"
put "Nightbitch.2024.2160p.WEB-DL.DDP5.1.H.265-SEED" "Nightbitch.2024.2160p.WEB-DL.DDP5.1.H.265-SEED.mkv"
# ...and two more, to see how a list and a page carry four versions (more than two make rows taller
# and the comparison wider).
put "Nightbitch.2024.720p.BluRay.x264-SEED" "Nightbitch.2024.720p.BluRay.x264-SEED.mkv"
put "Nightbitch.2024.480p.DVDRip.x264-SEED" "Nightbitch.2024.480p.DVDRip.x264-SEED.mkv"

# A bilingual title, and a part number: the matcher has to read both.
put "Anatomy.Of.A.Fall-Anatomie.d.une.chute.2023.1080p.BluRay.x264-SEED" \
  "Anatomy.Of.A.Fall-Anatomie.d.une.chute.2023.1080p.BluRay.x264-SEED.mkv"
put "Kill.Bill.Vol.2.2004.1080p.BluRay.x264-SEED" "Kill.Bill.Vol.2.2004.1080p.BluRay.x264-SEED.mkv"

# Series, validated as the release they came in.
for e in 01 02 03; do
  put "Foundation.2021.S01.1080p.WEB-DL.DDP5.1.H.264-SEED" "Foundation.2021.S01E$e.1080p.WEB-DL.DDP5.1.H.264-SEED.mkv"
done
for e in 01 02; do
  put "The.Office.US.S01.720p.BluRay.x264-SEED" "The.Office.US.S01E$e.720p.BluRay.x264-SEED.mkv"
done

# Two qualities of the same episodes, in two season packs: each episode arrives named with its
# picture size (versions), and the two files of one episode share a season folder.
for e in 01 02; do
  put "The.Bear.2022.S01.1080p.WEB-DL.DDP5.1.H.264-SEED" "The.Bear.2022.S01E$e.1080p.WEB-DL.DDP5.1.H.264-SEED.mkv"
  put "The.Bear.2022.S01.2160p.WEB-DL.DDP5.1.H.265-SEED" "The.Bear.2022.S01E$e.2160p.WEB-DL.DDP5.1.H.265-SEED.mkv"
done

# Two more qualities of the same two episodes (four versions each), for the same reason as the movie.
for e in 01 02; do
  put "The.Bear.2022.S01.720p.BluRay.x264-SEED" "The.Bear.2022.S01E$e.720p.BluRay.x264-SEED.mkv"
  put "The.Bear.2022.S01.480p.DVDRip.x264-SEED" "The.Bear.2022.S01E$e.480p.DVDRip.x264-SEED.mkv"
done

# A special (season 0), alone in its release: the players name it "Season 00" or "Specials".
put "The.Office.US.S00E01.Specials.720p.BluRay.x264-SEED" "The.Office.US.S00E01.720p.BluRay.x264-SEED.mkv"

# One file holding two episodes, written two ways. Each lands in a release of its own: adding it to
# the season pack above would send that folder through the watcher again, old episodes included.
# Plex joins the range with `-e`, Jellyfin with `-E`: each player must show two episodes.
put "Foundation.2021.S01E04E05.1080p.WEB-DL.DDP5.1.H.264-SEED" "Foundation.2021.S01E04E05.1080p.WEB-DL.DDP5.1.H.264-SEED.mkv"
put "The.Office.US.S01E03-E04.720p.BluRay.x264-SEED" "The.Office.US.S01E03-E04.720p.BluRay.x264-SEED.mkv"

# Subtitles. A tiny SubRip text, copied for every file: only the names are the test.
sub=$(mktemp --suffix=.srt)
trap 'rm -f "$base" "$sub"' EXIT
printf '1\n00:00:00,000 --> 00:00:01,000\nKinoshelf\n' >"$sub"

# putsub <release folder> <path under it>: one subtitle file, in its release folder.
putsub() {
  mkdir -p "$(dirname "$arrivals/$1/$2")"
  [ -e "$arrivals/$1/$2" ] || cp "$sub" "$arrivals/$1/$2"
}

# A movie with a Subs folder, as scene releases ship them: the language is read from the name, `forced`
# and `sdh` are kept. `Parasite.srt` names no language and `6_French.srt` is a second French, so both
# stay in Subs and the preview of the rename says why.
parasite="Parasite.2019.1080p.BluRay.x264-SEED"
put "$parasite" "$parasite.mkv"
putsub "$parasite" "Subs/2_French.srt"
putsub "$parasite" "Subs/3_English.srt"
putsub "$parasite" "Subs/4_English_Forced.srt"
putsub "$parasite" "Subs/5_English SDH.srt"
putsub "$parasite" "Subs/6_French.srt"
putsub "$parasite" "Subs/Parasite.srt"

# Subtitles already named after the video, and a VobSub pair (`.idx` and `.sub` stay together).
alien="Alien.1979.1080p.BluRay.x264-SEED"
put "$alien" "$alien.mkv"
putsub "$alien" "$alien.fr.srt"
putsub "$alien" "$alien.en.forced.srt"
putsub "$alien" "$alien.eng.srt"
putsub "$alien" "Subs/2_Spanish.idx"
putsub "$alien" "Subs/2_Spanish.sub"

# A season pack with one Subs sub-folder per episode, and a flat file naming its episode by number.
severance="Severance.2022.S01.1080p.WEB-DL.DDP5.1.H.264-SEED"
for e in 01 02; do
  put "$severance" "Severance.2022.S01E$e.1080p.WEB-DL.DDP5.1.H.264-SEED.mkv"
  putsub "$severance" "Subs/Severance.2022.S01E$e.1080p.WEB-DL.DDP5.1.H.264-SEED/2_English.srt"
  putsub "$severance" "Subs/Severance.2022.S01E$e.1080p.WEB-DL.DDP5.1.H.264-SEED/3_French.srt"
done
putsub "$severance" "Subs/Severance 1x02 German.srt"

# What no one can identify: it waits in Arrivals as unrecognized.
put "zzqx.unknown.clip.2019.720p-SEED" "zzqx.unknown.clip.2019.720p-SEED.mkv"

count=$(find "$arrivals" -type f -name '*.mkv' | wc -l)
echo "$count clips in $arrivals"
echo "Add that folder as an arrival folder in Kinoshelf (into: .work/media/movies and .work/media/series)."
