# Kodi 22 (release candidate) for trying the layout against it: nixpkgs only has Kodi 21, so this is
# its derivation with another source. Drop it when nixpkgs ships Kodi 22.
#
# nixpkgs' derivation is written for Kodi 21; what Kodi 22 changed, and what is done about it:
# - Kodi 22 looks for CrossGUID with pkg-config; nixpkgs gives Kodi 21 `libcrossguid` (2016), which
#   has no .pc file. `crossguid` (2019) has one, and the newer API (crossguid/guid.hpp).
# - Exiv2, nlohmann_json and PCRE2 are new required dependencies (RapidJSON and PCRE are gone), read
#   from Kodi's CMakeLists.txt.
# - It wants FFmpeg 7.0 or newer, where nixpkgs hands Kodi 21 version 6.
# - Its python bindings want SWIG 4.5.0, nixpkgs has 4.4.1.
# - On Linux it always builds libdvdcss, libdvdnav and libdvdread itself with Meson and downloads
#   them, which Nix's sandbox forbids: the archives are fetched by Nix (hashes from
#   tools/depends/target/*/*-VERSION in Kodi's tree) and handed over with -D<NAME>_URL. Meson and
#   Ninja are given by path, not as native inputs: their setup hooks would take over the cmake build.
# - The patches nixpkgs applies to Kodi 21.3 (TexturePacker with giflib 6, PCRE2 instead of PCRE) are
#   in Kodi 22 already: applied again they are rejected as reversed.
# - No tests (ENABLE_TESTING=OFF: it wants gtest) and no XSLT (optional, and its library is not
#   found at link time), neither is of any use here.
pkgs:
let
  swig = pkgs.swig.overrideAttrs {
    version = "4.5.0";
    src = pkgs.fetchFromGitHub {
      owner = "swig";
      repo = "swig";
      rev = "v4.5.0";
      hash = "sha256-NXN3Zx66PNpYNuFVCalHymb/GW0cUi5drjIXNOVMgb8=";
    };
  };

  mirror = "https://mirrors.kodi.tv/build-deps/sources";
  dvd = {
    css = pkgs.fetchurl {
      url = "${mirror}/libdvdcss-1.5.0.tar.bz2";
      sha512 = "439fbd9dae60b9a114d3429a19703478c734e8525ac6852da6f05f72d9ca44ca0ac5e874ab6a10017e7f31869fcd29f01d1bc156c4f0331b4e4abd98ec2f95cd";
    };
    nav = pkgs.fetchurl {
      url = "${mirror}/libdvdnav-7.0.0.tar.bz2";
      sha512 = "8d12d476e352def9716ecbd7ba184a70dd9bae87dcde669b8647a0ef9ac1991f617c9918c043e159eb353302c4cc50fb71bc591ceaeba1d3b9d47af77fa72c71";
    };
    read = pkgs.fetchurl {
      url = "${mirror}/libdvdread-7.0.1.tar.bz2";
      sha512 = "b5390a1acb8fdf6e24188f9259199eb0fef2dd4b332447ba2bfa571f9fc0c3bfad00c1d27a8b8806180a853c04a818b7802d3075ff787142c1a175ad798c6a3d";
    };
  };
in
(pkgs.kodi.override { ffmpeg = pkgs.ffmpeg_7; }).overrideAttrs (old: {
  version = "22.0rc2";
  kodiReleaseName = "Piers";
  # The hash is that of the tag's source tree (`nix flake prefetch github:xbmc/xbmc/22.0rc2-Piers`).
  src = pkgs.fetchFromGitHub {
    owner = "xbmc";
    repo = "xbmc";
    rev = "22.0rc2-Piers";
    hash = "sha256-Y5oJ7QMp6n2y4IxtTxgWO1Zgmcd+1B+4mNtRPODPwkk=";
  };
  patches = [ ];
  doCheck = false;

  cmakeFlags = old.cmakeFlags ++ [
    "-DLIBDVDCSS_URL=${dvd.css}"
    "-DLIBDVDNAV_URL=${dvd.nav}"
    "-DLIBDVDREAD_URL=${dvd.read}"
    "-DMESON_EXECUTABLE=${pkgs.meson}/bin/meson"
    "-DNINJA_EXECUTABLE=${pkgs.ninja}/bin/ninja"
    "-DENABLE_TESTING=OFF"
    "-DENABLE_XSLT=OFF"
    # After the one nixpkgs sets: the last -D wins.
    "-DSWIG_EXECUTABLE=${swig}/bin/swig"
  ];

  buildInputs = builtins.filter (p: pkgs.lib.getName p != "libcrossguid") old.buildInputs ++ [
    pkgs.crossguid
    pkgs.exiv2
    pkgs.nlohmann_json
    pkgs.pcre2
  ];
})
