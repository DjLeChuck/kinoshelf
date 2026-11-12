{
  description = "Kinoshelf: identify, rename and enrich a video library";

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
    in
    {
      devShells = forAllSystems (pkgs: {
        default = pkgs.mkShell {
          packages = [
            pkgs.nodejs_26
            pkgs.pnpm
            pkgs.gnumake
            pkgs.gcc
            pkgs.ffmpeg-headless # `ffprobe`: codec, audio and size of a video, and a file to probe in tests
            pkgs.nixfmt # `make flake-check`
          ];
          # Browsers for the end-to-end tests (`pnpm test:e2e`). The npm `@playwright/test`
          # must be the version of this package: bump them together.
          env = nixpkgs.lib.optionalAttrs pkgs.stdenv.hostPlatform.isLinux {
            PLAYWRIGHT_BROWSERS_PATH = "${pkgs.playwright-driver.browsers}";
            PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS = "true";
          };
        };

        # `nix develop .#ffprobe -c scripts/build-ffprobe.sh <dir>`: what building the small
        # static ffprobe takes (a compiler, and libc.a on Linux), kept out of the default shell.
        ffprobe = pkgs.mkShell {
          packages = [
            pkgs.gnumake
            pkgs.gcc
            pkgs.curl
            pkgs.xz
          ]
          ++ nixpkgs.lib.optional pkgs.stdenv.hostPlatform.isLinux pkgs.glibc.static;
        };
      });
    };
}
