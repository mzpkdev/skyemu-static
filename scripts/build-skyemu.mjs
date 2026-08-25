import * as childProcess from "node:child_process"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import * as url from "node:url"

const projectRoot = url.fileURLToPath(new URL("..", import.meta.url))
const sourceRepository = "https://github.com/skylersaleh/SkyEmu.git"
const sourceCommit = "46efbcbdb3b902373a09f4724e6d3b1a5acc4af3"
const patchPath = path.join(projectRoot, "patches", "skyemu-v5-headless-http.patch")
const outputPath = path.join(projectRoot, "vendor", "SkyEmu")
const systemOpenGlLibrary = "/usr/lib/x86_64-linux-gnu/libOpenGL.so.0"
const systemOpenGlDevelopmentLibrary = "/usr/lib/x86_64-linux-gnu/libOpenGL.so"

const run = async (command, args, options = {}) =>
  await new Promise((resolve, reject) => {
    const child = childProcess.spawn(command, args, { stdio: "inherit", ...options })
    child.once("error", reject)
    child.once("close", (code) => {
      if (code === 0) resolve()
      else reject(new Error(`${command} exited with code ${code}`))
    })
  })

const output = async (command, args, options = {}) => {
  const result = await new Promise((resolve, reject) => {
    const child = childProcess.spawn(command, args, {
      ...options,
      stdio: ["ignore", "pipe", "inherit"],
    })
    let stdout = ""
    child.stdout.on("data", (data) => {
      stdout += data
    })
    child.once("error", reject)
    child.once("close", (code) => {
      if (code === 0) resolve(stdout.trim())
      else reject(new Error(`${command} exited with code ${code}`))
    })
  })
  return result
}

const sourceDirectory = await fs.promises.mkdtemp(path.join(os.tmpdir(), "skyemu-static-source-"))

try {
  await run("git", ["clone", "--no-checkout", sourceRepository, sourceDirectory])
  await run("git", ["-C", sourceDirectory, "checkout", "--detach", sourceCommit])

  const commit = await output("git", ["-C", sourceDirectory, "rev-parse", "HEAD"])
  if (commit !== sourceCommit) {
    throw new Error(`Expected SkyEmu commit ${sourceCommit}, received ${commit}`)
  }

  await run("git", ["-C", sourceDirectory, "apply", "--check", patchPath])
  await run("git", ["-C", sourceDirectory, "apply", patchPath])

  const buildDirectory = path.join(sourceDirectory, "build")
  const cmakeArguments = [
    "-S",
    sourceDirectory,
    "-B",
    buildDirectory,
    "-DCMAKE_BUILD_TYPE=Release",
    "-DCMAKE_SKIP_RPATH=ON",
  ]

  if (!fs.existsSync(systemOpenGlDevelopmentLibrary) && fs.existsSync(systemOpenGlLibrary)) {
    const compatibilityDirectory = path.join(sourceDirectory, ".cmake-compat")
    const compatibilityLibrary = path.join(compatibilityDirectory, "libOpenGL.so")
    await fs.promises.mkdir(compatibilityDirectory)
    await fs.promises.symlink(systemOpenGlLibrary, compatibilityLibrary)
    cmakeArguments.push(`-DOPENGL_opengl_LIBRARY=${compatibilityLibrary}`)
  }

  await run("cmake", cmakeArguments)
  await run("cmake", ["--build", buildDirectory, "--parallel"])

  await fs.promises.mkdir(path.dirname(outputPath), { recursive: true })
  await fs.promises.copyFile(path.join(buildDirectory, "bin", "SkyEmu"), outputPath)
  await fs.promises.chmod(outputPath, 0o755)
} finally {
  await fs.promises.rm(sourceDirectory, { recursive: true, force: true })
}
