{
  description = "Kinoshelf dev: Jellyfin and Plex in Docker, Kodi from Nix, to try the profiles and notifications";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";

  outputs =
    { nixpkgs, ... }:
    let
      systems = [
        "x86_64-linux"
        "aarch64-linux"
        "x86_64-darwin"
        "aarch64-darwin"
      ];
      forAllSystems = f: nixpkgs.lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});

      # Tiny clips named like releases, to give Kinoshelf something to organize (see seed.sh).
      seed =
        pkgs:
        pkgs.writeShellApplication {
          name = "seed";
          runtimeInputs = [
            pkgs.ffmpeg-headless
            pkgs.coreutils
            pkgs.findutils
          ];
          text = builtins.readFile ./seed.sh;
        };

      # Kodi has no maintained Docker image: it runs from nixpkgs on a virtual screen, served to a
      # browser by noVNC (see kodi.sh).
      kodi =
        pkgs:
        pkgs.writeShellApplication {
          name = "kodi-dev";
          runtimeInputs = [
            pkgs.kodi
            pkgs.xorg-server
            pkgs.x11vnc
            pkgs.novnc
            pkgs.pulseaudio # pactl, to create Kodi's silent sink
            pkgs.sqlite
            pkgs.findutils
            pkgs.coreutils
          ];
          text = builtins.readFile ./kodi.sh;
        };

      # `players <up|down|logs|status|seed> [jellyfin|plex|kodi]`: no player named means all three.
      players =
        pkgs:
        pkgs.writeShellApplication {
          name = "players";
          runtimeInputs = [
            pkgs.docker-compose
            pkgs.git
            pkgs.coreutils
          ];
          text = ''
            root=$(git rev-parse --show-toplevel)
            export WORK="''${KINOSHELF_WORK:-$root/.work}"
            PUID=$(id -u)
            PGID=$(id -g)
            export PUID PGID
            compose=(docker compose -f "$root/dev/players/compose.yaml" -p kinoshelf-players)

            cmd=''${1:-}
            shift || true
            if [ "$cmd" = seed ]; then exec ${seed pkgs}/bin/seed; fi
            case "''${1:-all}" in
              jellyfin | plex | kodi | all) player=''${1:-all} ;;
              *) echo "unknown player: $1 (jellyfin, plex, kodi or nothing for all)" >&2; exit 2 ;;
            esac
            case "$cmd" in
              up | down | logs | status) ;;
              *) echo "usage: players <up|down|logs|status|seed> [jellyfin|plex|kodi]" >&2; exit 2 ;;
            esac

            # Jellyfin and Plex are Docker services; Kodi is a set of processes, started on its own.
            if [ "$player" != kodi ]; then
              case "$player" in all) profile=all ;; *) profile=$player ;; esac
              compose+=(--profile "$profile")
              case "$cmd" in
                up)
                  mkdir -p "$WORK/media/movies" "$WORK/media/series" \
                    "$WORK/players/jellyfin/config" "$WORK/players/jellyfin/cache" "$WORK/players/plex/config"
                  "''${compose[@]}" up -d
                  echo
                  echo "Jellyfin  http://localhost:8096      (libraries: /media/movies, /media/series)"
                  echo "Plex      http://localhost:32400/web (libraries: /media/movies, /media/series)"
                  echo "Media     $WORK/media"
                  ;;
                down) "''${compose[@]}" down ;;
                logs) "''${compose[@]}" logs -f ;;
                status) "''${compose[@]}" ps ;;
              esac
            fi
            if [ "$player" = kodi ] || [ "$player" = all ]; then
              # `logs` follows one stream: with no player named it is the Docker ones, Kodi's is `logs kodi`.
              if [ "$cmd" != logs ] || [ "$player" = kodi ]; then ${kodi pkgs}/bin/kodi-dev "$cmd"; fi
            fi
          '';
        };
    in
    {
      packages = forAllSystems (pkgs: {
        default = players pkgs;
      });

      apps = forAllSystems (pkgs: {
        default = {
          type = "app";
          meta.description = "Start or stop Jellyfin and Plex in Docker";
          program = "${players pkgs}/bin/players";
        };
      });

      devShells = forAllSystems (pkgs: {
        default = pkgs.mkShell { packages = [ (players pkgs) ]; };
      });
    };
}
