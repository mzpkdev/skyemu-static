import * as assert from "node:assert/strict"
import * as childProcess from "node:child_process"
import * as fs from "node:fs"
import * as http from "node:http"
import * as os from "node:os"
import * as path from "node:path"
import * as test from "node:test"
import * as url from "node:url"

const projectRoot = url.fileURLToPath(new URL("..", import.meta.url))

const run = async (command, args, options = {}) =>
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
      if (code === 0) resolve(stdout.trim())
      else
        reject(
          new Error(
            [stdout, stderr, `Command exited with code ${code}`].filter(Boolean).join("\n"),
          ),
        )
    })
  })

const reservePort = async () =>
  await new Promise((resolve, reject) => {
    const server = http.createServer()
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      if (!address || typeof address === "string") {
        reject(new Error("Could not reserve a TCP port"))
        return
      }
      server.close((error) => {
        if (error) reject(error)
        else resolve(address.port)
      })
    })
  })

const wait = async (milliseconds) =>
  await new Promise((resolve) => {
    setTimeout(resolve, milliseconds)
  })

const stripTrailingNul = (value) => {
  let stripped = value
  while (stripped.endsWith("\0")) stripped = stripped.slice(0, -1)
  return stripped
}

test.default(
  "packs a self-contained package that installs and serves HTTP headless mode without scripts",
  async (context) => {
    const temporaryDirectory = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), "skyemu-static-install-test-"),
    )
    const npmCache = path.join(temporaryDirectory, "npm-cache")
    const consumerDirectory = path.join(temporaryDirectory, "consumer")
    const romPath = path.join(temporaryDirectory, "smoke.gb")
    const dataPath = path.join(temporaryDirectory, "data")
    let skyEmu

    context.after(async () => {
      if (skyEmu?.pid) process.kill(-skyEmu.pid, "SIGKILL")
      await fs.promises.rm(temporaryDirectory, { recursive: true, force: true })
    })

    const tarballName = (
      await run(
        "npm",
        ["pack", "--silent", "--cache", npmCache, "--pack-destination", temporaryDirectory],
        {
          cwd: projectRoot,
          env: { ...process.env, npm_config_dry_run: "false" },
        },
      )
    )
      .split("\n")
      .at(-1)
    assert.ok(tarballName)
    const tarballPath = path.join(temporaryDirectory, tarballName)
    await fs.promises.mkdir(consumerDirectory)
    await fs.promises.writeFile(path.join(consumerDirectory, "package.json"), '{"private":true}\n')

    await run("npm", ["install", "--ignore-scripts", "--cache", npmCache, tarballPath], {
      cwd: consumerDirectory,
      env: { ...process.env, npm_config_dry_run: "false" },
    })

    const installedPackage = path.join(consumerDirectory, "node_modules", "skyemu-static")
    const { skyEmuBinary } = await import(
      url.pathToFileURL(path.join(installedPackage, "dist", "index.js")).href
    )
    await fs.promises.access(skyEmuBinary, fs.constants.X_OK)
    assert.equal(skyEmuBinary, path.join(installedPackage, "vendor", "SkyEmu"))

    await fs.promises.writeFile(romPath, Buffer.alloc(32 * 1024))
    await fs.promises.mkdir(dataPath)
    const port = await reservePort()
    let stdout = ""
    let stderr = ""
    skyEmu = childProcess.spawn(
      "xvfb-run",
      ["-a", skyEmuBinary, "http_server", `${port}`, romPath],
      { detached: true, env: { ...process.env, XDG_DATA_HOME: dataPath } },
    )
    skyEmu.stdout?.on("data", (data) => {
      stdout += data
    })
    skyEmu.stderr?.on("data", (data) => {
      stderr += data
    })

    const deadline = Date.now() + 15_000
    let pingError
    while (Date.now() < deadline) {
      try {
        const response = await fetch(`http://127.0.0.1:${port}/ping`)
        if (response.ok) {
          assert.equal(stripTrailingNul(await response.text()), "pong")
          return
        }
        pingError = new Error(`Unexpected HTTP status ${response.status}`)
      } catch (error) {
        pingError = error
      }
      await wait(250)
    }

    throw new Error(
      ["HTTP headless smoke test did not return pong", String(pingError), stdout, stderr]
        .filter(Boolean)
        .join("\n"),
    )
  },
)
