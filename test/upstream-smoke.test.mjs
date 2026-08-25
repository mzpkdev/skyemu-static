import * as assert from "node:assert/strict"
import * as childProcess from "node:child_process"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import * as test from "node:test"
import * as url from "node:url"

const projectRoot = url.fileURLToPath(new URL("..", import.meta.url))

const run = async (command, args, options) =>
  await new Promise((resolve, reject) => {
    const child = childProcess.spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
    })
    let stdout = ""
    let stderr = ""

    child.stdout?.on("data", (data) => {
      stdout += data
    })
    child.stderr?.on("data", (data) => {
      stderr += data
    })
    child.once("error", reject)
    child.once("close", (code) => {
      if (code === 0) {
        resolve(stdout.trim())
        return
      }

      reject(
        new Error([stdout, stderr, `Command exited with code ${code}`].filter(Boolean).join("\n")),
      )
    })
  })

test.default("installs the pinned official SkyEmu release", async (context) => {
  const temporaryDirectory = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), "static-skyemu-smoke-"),
  )
  let tarballPath

  context.after(async () => {
    await fs.promises.rm(temporaryDirectory, { recursive: true, force: true })
    if (tarballPath) await fs.promises.rm(tarballPath, { force: true })
  })

  const npmCache = path.join(temporaryDirectory, "npm-cache")
  const tarballName = (
    await run("npm", ["pack", "--silent", "--cache", npmCache], {
      cwd: projectRoot,
    })
  )
    .split("\n")
    .at(-1)
  assert.ok(tarballName)
  tarballPath = path.join(projectRoot, tarballName)
  await fs.promises.writeFile(path.join(temporaryDirectory, "package.json"), '{"private":true}')

  await run("npm", ["install", "--ignore-scripts=false", "--cache", npmCache, tarballPath], {
    cwd: temporaryDirectory,
    env: process.env,
  })

  const installedPackage = path.join(temporaryDirectory, "node_modules", "static-skyemu")
  const skyEmu = await import(
    url.pathToFileURL(path.join(installedPackage, "dist", "index.js")).href
  )
  await fs.promises.access(skyEmu.skyEmuBinary, fs.constants.X_OK)
})
