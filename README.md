# static-skyemu

Install-ready SkyEmu v5 Linux x64 binary for Node projects.

```sh
npm install static-skyemu
```

The package's install hook downloads the official SkyEmu v5 archive, validates
its published SHA-256, then extracts the binary into `vendor/SkyEmu`.

```ts
import { skyEmuBinary } from "static-skyemu"
```

`STATIC_SKYEMU_DIR` changes the binary directory. The package requires Linux
x64 and `unzip`.
