import * as path from "node:path"
import * as url from "node:url"
const packageRoot = url.fileURLToPath(new URL("..", import.meta.url))
export const skyEmuDirectory = path.join(packageRoot, "vendor")
export const skyEmuBinary = path.join(skyEmuDirectory, "SkyEmu")
