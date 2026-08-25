# skyemu-static

Install-ready SkyEmu v5 Linux x64 binary for Node projects.

```sh
npm install skyemu-static
```

The package's install hook downloads the official SkyEmu v5 archive, validates
its published SHA-256, then extracts the binary into `vendor/SkyEmu`.

```ts
import { skyEmuBinary } from "skyemu-static"
```

`SKYEMU_STATIC_DIR` changes the binary directory. The package requires Linux
x64 and `unzip`.
