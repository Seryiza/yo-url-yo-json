{
  description = "yo-url-yo-json CLI";

  inputs = {
    bun2nix = {
      url = "github:nix-community/bun2nix";
      inputs.nixpkgs.follows = "nixpkgs";
    };
    cloakbrowser = {
      url = "github:Seryiza/CloakBrowser";
      inputs.nixpkgs.follows = "nixpkgs";
    };
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  };

  outputs =
    {
      bun2nix,
      cloakbrowser,
      nixpkgs,
      ...
    }:
    let
      lib = nixpkgs.lib;
      systems = [
        "x86_64-linux"
        "aarch64-linux"
      ];
      forAllSystems = lib.genAttrs systems;
      perSystem =
        system:
        let
          pkgs = import nixpkgs { inherit system; };
          bun2nix' = bun2nix.packages.${system}.default;
          cloakbrowserChromium = cloakbrowser.packages.${system}.cloakbrowserChromium;
          package = bun2nix'.writeBunApplication {
            pname = "yo-url-yo-json";
            version = "0.2.0";

            src = ./.;
            bunDeps = bun2nix'.fetchBunDeps {
              bunNix = ./bun.nix;
            };

            buildPhase = ''
              runHook preBuild
              bun run build
              runHook postBuild
            '';

            startScript = ''
              bun dist/yo-url-yo-json.js "$@"
            '';
            runtimeInputs = [ pkgs.nodejs_22 ];

            meta = {
              description = "Extract validated JSON from webpages using JSON Schema";
              homepage = "https://github.com/Seryiza/yo-url-yo-json";
              license = lib.licenses.mit;
              mainProgram = "yo-url-yo-json";
              platforms = systems;
            };
          };
        in
        {
          inherit cloakbrowserChromium package pkgs;
        };
    in
    {
      packages = forAllSystems (
        system:
        let
          inherit (perSystem system) package;
        in
        {
          default = package;
          yo-url-yo-json = package;
        }
      );

      apps = forAllSystems (
        system:
        let
          inherit (perSystem system) package;
        in
        {
          default = {
            type = "app";
            program = "${package}/bin/yo-url-yo-json";
          };
          yo-url-yo-json = {
            type = "app";
            program = "${package}/bin/yo-url-yo-json";
          };
        }
      );

      devShells = forAllSystems (
        system:
        let
          inherit (perSystem system) cloakbrowserChromium pkgs;
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
