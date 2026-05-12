{
  description = "Development shell for yo-url-yo-json";

  inputs = {
    cloakbrowser = {
      url = "github:Seryiza/CloakBrowser";
      inputs.nixpkgs.follows = "nixpkgs";
    };
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  };

  outputs =
    { cloakbrowser, nixpkgs, ... }:
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
          cloakbrowserChromium = cloakbrowser.packages.${system}.cloakbrowserChromium;
        in
        {
          default = pkgs.mkShell {
            packages =
              (with pkgs; [
                bun
                git
                nodejs_22
              ])
              ++ [
                cloakbrowserChromium
              ];

            CLOAKBROWSER_BINARY_PATH = "${cloakbrowserChromium}/bin/cloakbrowser-chrome";
            shellHook = ''
              export CLOAKBROWSER_CACHE_DIR="$PWD/.yo-url-yo-json/cloakbrowser"
              mkdir -p "$CLOAKBROWSER_CACHE_DIR"
            '';
          };
        }
      );
    };
}
