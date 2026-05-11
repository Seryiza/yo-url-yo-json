{
  description = "Development shell for yo-url-yo-json";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  };

  outputs =
    { nixpkgs, ... }:
    let
      lib = nixpkgs.lib;
      systems = [
        "x86_64-linux"
        "aarch64-linux"
      ];
      forAllSystems = lib.genAttrs systems;
    in
    {
      devShells = forAllSystems (
        system:
        let
          pkgs = import nixpkgs { inherit system; };
          browserRuntimeLibs = with pkgs; [
            alsa-lib
            at-spi2-atk
            at-spi2-core
            atk
            cairo
            cups
            dbus
            expat
            fontconfig
            freetype
            gdk-pixbuf
            glib
            gtk3
            libdrm
            libGL
            libx11
            libxkbcommon
            libxcomposite
            libxdamage
            libxext
            libxfixes
            libxrandr
            libxscrnsaver
            libxcb
            libxshmfence
            mesa
            nspr
            nss
            pango
            stdenv.cc.cc
            zlib
          ];
        in
        {
          default = pkgs.mkShell {
            packages =
              (with pkgs; [
                bun
                cacert
                git
                nodejs_22
              ])
              ++ browserRuntimeLibs;

            LD_LIBRARY_PATH = lib.makeLibraryPath browserRuntimeLibs;
            SSL_CERT_FILE = "${pkgs.cacert}/etc/ssl/certs/ca-bundle.crt";

            shellHook = ''
              export CLOAKBROWSER_CACHE_DIR="$PWD/.yo-url-yo-json/cloakbrowser"
              mkdir -p "$CLOAKBROWSER_CACHE_DIR"
            '';
          };
        }
      );
    };
}
