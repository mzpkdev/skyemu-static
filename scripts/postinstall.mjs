import * as fs from "node:fs"

const cli = new URL("../dist/cli.js", import.meta.url)

if (fs.existsSync(cli)) {
  await import(cli.href)
}
