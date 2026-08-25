# skyemu-static

Install-ready SkyEmu v5 Linux x64 binary for Node projects.

```sh
npm install skyemu-static
```

The package's install hook downloads the official SkyEmu v5 archive, validates
its published SHA-256, and writes the binary to `vendor/SkyEmu`.

```ts
import { skyEmuBinary } from "skyemu-static"
```

The package requires Linux x64. It does not need `unzip` or another system
archive tool.

## Configuration

`SKYEMU_STATIC_DIR` changes the binary directory.

For private mirrors or a release hosted elsewhere, use these install-time
environment variables:

- `SKYEMU_STATIC_BINARIES_URL` changes the release-download base URL.
- `SKYEMU_STATIC_RELEASE` changes the release tag and selects
  `SkyEmu-<tag>-Linux.zip`.
- `SKYEMU_STATIC_ARCHIVE_NAME` changes the archive name when a release uses a
  different naming convention.
- `SKYEMU_STATIC_BINARY_URL` uses an exact archive URL.
- `SKYEMU_STATIC_SHA256` changes the expected archive SHA-256. Set this with
  `SKYEMU_STATIC_BINARY_URL`, `SKYEMU_STATIC_RELEASE`, or
  `SKYEMU_STATIC_ARCHIVE_NAME` when using a different archive.
- `SKYEMU_STATIC_DOWNLOAD_TIMEOUT` sets each download attempt's timeout in
  milliseconds. Use a positive whole number. The default is 30000.
- `SKYEMU_STATIC_DOWNLOAD_RETRIES` sets retries after the first attempt. The
  default is 2, and the maximum is 5.

The installer also honors standard `HTTP_PROXY`, `HTTPS_PROXY`, and `NO_PROXY`
environment variables. It records the installed archive URL and checksum, then
downloads again when either value changes.
