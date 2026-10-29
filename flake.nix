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
            pkgs.nodejs_22
            pkgs.pnpm
            pkgs.python3 # native build of better-sqlite3 when no prebuilt binary exists
            pkgs.gnumake
            pkgs.gcc
          ];
          # Browsers for the end-to-end tests (`pnpm test:e2e`). The npm `@playwright/test`
          # must be the version of this package: bump them together.
          env = nixpkgs.lib.optionalAttrs pkgs.stdenv.hostPlatform.isLinux {
            PLAYWRIGHT_BROWSERS_PATH = "${pkgs.playwright-driver.browsers}";
            PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS = "true";
          };
        };
      });
    };
}
