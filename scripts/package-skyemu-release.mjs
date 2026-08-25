import * as childProcess from "node:child_process"
import * as crypto from "node:crypto"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import * as url from "node:url"

const projectRoot = url.fileURLToPath(new URL("..", import.meta.url))
const binaryPath = process.env.SKYEMU_BINARY ?? path.join(projectRoot, "vendor", "SkyEmu")
const outputPath = path.resolve(
  process.env.SKYEMU_RELEASE_ARCHIVE ??
    path.join(projectRoot, "release", "SkyEmu-v5-linux-x64.zip"),
)
const temporaryDirectory = await fs.promises.mkdtemp(
  path.join(os.tmpdir(), "skyemu-static-release-"),
)
const stagedBinary = path.join(temporaryDirectory, "SkyEmu")

const run = async (command, args) =>
  await new Promise((resolve, reject) => {
    const child = childProcess.spawn(command, args, { stdio: "inherit" })
    child.once("error", reject)
    child.once("close", (code) => {
      if (code === 0) resolve()
      else reject(new Error(`${command} exited with code ${code}`))
    })
  })

try {
  await fs.promises.access(binaryPath, fs.constants.X_OK)
  await fs.promises.mkdir(path.dirname(outputPath), { recursive: true })
  await fs.promises.copyFile(binaryPath, stagedBinary)
  await fs.promises.chmod(stagedBinary, 0o755)
  await fs.promises.utimes(
    stagedBinary,
    new Date("1980-01-01T00:00:00Z"),
    new Date("1980-01-01T00:00:00Z"),
  )
  await fs.promises.rm(outputPath, { force: true })
  await run("zip", ["-X", "-j", outputPath, stagedBinary])
  const archive = await fs.promises.readFile(outputPath)
  process.stdout.write(
    `${crypto.createHash("sha256").update(archive).digest("hex")}  ${outputPath}\n`,
  )
} finally {
  await fs.promises.rm(temporaryDirectory, { recursive: true, force: true })
}
