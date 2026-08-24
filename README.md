# static-skyemu

Install-ready SkyEmu v5 Linux x64 binary for Node projects.

```sh
pnpm add github:mzpkdev/static-skyemu#b76e8aa71ff5c7a19df1b3bcdb9148e5e38ed926
```

`static-skyemu` is not published to npm yet, so install a reviewed commit from
this repository.

The package's install hook downloads the official SkyEmu v5 archive, validates
its published SHA-256, then extracts the binary into `vendor/SkyEmu`.

```ts
import { skyEmuBinary } from "static-skyemu"
```

`STATIC_SKYEMU_DIR` changes the binary directory. The package requires Linux
x64 and `unzip`.
