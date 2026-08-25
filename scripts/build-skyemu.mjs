import * as childProcess from "node:child_process"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import * as url from "node:url"

const projectRoot = url.fileURLToPath(new URL("..", import.meta.url))
const sourceRepository = "https://github.com/skylersaleh/SkyEmu.git"
const sourceTag = "v5"
const sourceCommit = "46efbcbdb3b902373a09f4724e6d3b1a5acc4af3"
const patchPath = path.join(projectRoot, "patches", "skyemu-v5-headless-http.patch")
const outputPath = path.join(projectRoot, "vendor", "SkyEmu")

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

const buildRoot = process.env.SKYEMU_BUILD_ROOT
  ? path.resolve(process.env.SKYEMU_BUILD_ROOT)
  : undefined
const sourceDirectory = process.env.SKYEMU_SOURCE_DIR
  ? path.resolve(process.env.SKYEMU_SOURCE_DIR)
  : buildRoot
    ? path.join(buildRoot, "source")
    : await fs.promises.mkdtemp(path.join(os.tmpdir(), "skyemu-static-source-"))
const ownsSourceDirectory = !process.env.SKYEMU_SOURCE_DIR

try {
  if (ownsSourceDirectory) {
    if (buildRoot) {
      await fs.promises.rm(sourceDirectory, { recursive: true, force: true })
      await fs.promises.mkdir(buildRoot, { recursive: true })
    }
    await run("git", [
      "clone",
      "--depth",
      "1",
      "--branch",
      sourceTag,
      sourceRepository,
      sourceDirectory,
    ])
  }

  const commit = await output("git", ["-C", sourceDirectory, "rev-parse", "HEAD"])
  if (commit !== sourceCommit) {
    throw new Error(`Expected SkyEmu ${sourceTag} commit ${sourceCommit}, received ${commit}`)
  }
  const sourceDateEpoch = await output("git", [
    "-C",
    sourceDirectory,
    "show",
    "-s",
    "--format=%ct",
    "HEAD",
  ])
  const sourcePathFlags = [
    `-ffile-prefix-map=${sourceDirectory}=/usr/src/skyemu`,
    `-fdebug-prefix-map=${sourceDirectory}=/usr/src/skyemu`,
  ].join(" ")
  const buildEnvironment = {
    ...process.env,
    CFLAGS: [process.env.CFLAGS, sourcePathFlags].filter(Boolean).join(" "),
    CXXFLAGS: [process.env.CXXFLAGS, sourcePathFlags].filter(Boolean).join(" "),
    SOURCE_DATE_EPOCH: sourceDateEpoch,
  }

  await run("git", ["-C", sourceDirectory, "apply", "--check", patchPath])
  await run("git", ["-C", sourceDirectory, "apply", patchPath])

  const buildDirectory = path.join(sourceDirectory, "build")
  await run(
    "cmake",
    [
      "-S",
      sourceDirectory,
      "-B",
      buildDirectory,
      "-DCMAKE_BUILD_TYPE=Release",
      `-DCMAKE_C_FLAGS=${sourcePathFlags}`,
      `-DCMAKE_CXX_FLAGS=${sourcePathFlags}`,
    ],
    { env: buildEnvironment },
  )
  await run("cmake", ["--build", buildDirectory, "--parallel"], { env: buildEnvironment })

  await fs.promises.mkdir(path.dirname(outputPath), { recursive: true })
  await fs.promises.copyFile(path.join(buildDirectory, "bin", "SkyEmu"), outputPath)
  await fs.promises.chmod(outputPath, 0o755)
} finally {
  if (ownsSourceDirectory) await fs.promises.rm(sourceDirectory, { recursive: true, force: true })
}
