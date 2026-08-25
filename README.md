# skyemu-static

Install-ready SkyEmu v5 Linux x64 binary for Node projects.

```sh
npm install skyemu-static
```

The patched SkyEmu binary is bundled in the package at `vendor/SkyEmu`. Installing
the package does not run an installer or download anything.

```ts
import { skyEmuBinary } from "skyemu-static"
```

The package requires Linux x64.

## Build provenance

Release builds use the pinned upstream SkyEmu v5 commit
`46efbcbdb3b902373a09f4724e6d3b1a5acc4af3` with the tracked HTTP headless
startup patch in this repository.

Run `pnpm run build:release` to build the TypeScript package and the patched
Linux x64 binary. `npm pack` and `npm publish` run the same command through
`prepack`.
