{
  description = "Kinoshelf dev: Jellyfin and Plex in Docker, to try the profiles and notifications";

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

      # `players <up|down|logs|status> [jellyfin|plex]`: no player named means both.
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
            case "''${1:-all}" in
              jellyfin | plex | all) profile=''${1:-all} ;;
              *) echo "unknown player: $1 (jellyfin, plex or nothing for both)" >&2; exit 2 ;;
            esac
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
              *) echo "usage: players <up|down|logs|status> [jellyfin|plex]" >&2; exit 2 ;;
            esac
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
