import * as assert from "node:assert/strict"
import * as childProcess from "node:child_process"
import * as crypto from "node:crypto"
import * as fs from "node:fs"
import * as http from "node:http"
import * as os from "node:os"
import * as path from "node:path"
import * as test from "node:test"
import * as url from "node:url"
import AdmZip from "adm-zip"

const projectRoot = url.fileURLToPath(new URL("..", import.meta.url))

const run = async (command, args, options) =>
  await new Promise((resolve, reject) => {
    const child = childProcess.spawn(command, args, options)
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

test.default(
  "installs the packed package and serves /ping from HTTP headless mode under Xvfb",
  async (context) => {
    const sourceBinary = process.env.SKYEMU_BINARY ?? path.join(projectRoot, "vendor", "SkyEmu")
    await fs.promises.access(sourceBinary, fs.constants.X_OK)

    const archive = new AdmZip()
    archive.addLocalFile(sourceBinary, "", "SkyEmu")
    const archiveContents = archive.toBuffer()
    const archiveSha256 = crypto.createHash("sha256").update(archiveContents).digest("hex")
    let archiveRequests = 0
    const archiveServer = http.createServer((request, response) => {
      archiveRequests += 1
      assert.equal(request.url, "/SkyEmu-v5-linux-x64.zip")
      response.writeHead(200, { "content-type": "application/zip" })
      response.end(archiveContents)
    })
    await new Promise((resolve) => archiveServer.listen(0, "127.0.0.1", resolve))
    const archiveAddress = archiveServer.address()
    assert.ok(archiveAddress && typeof archiveAddress !== "string")

    const temporaryDirectory = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), "skyemu-static-http-smoke-"),
    )
    const romPath = path.join(temporaryDirectory, "smoke.gb")
    const dataPath = path.join(temporaryDirectory, "data")
    const npmCache = path.join(temporaryDirectory, "npm-cache")
    let skyEmu
    let closed

    context.after(async () => {
      if (skyEmu?.pid) process.kill(-skyEmu.pid, "SIGKILL")
      if (closed) await closed
      await new Promise((resolve, reject) => {
        archiveServer.close((error) => {
          if (error) reject(error)
          else resolve()
        })
      })
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
    await fs.promises.writeFile(path.join(temporaryDirectory, "package.json"), '{"private":true}')

    const installationEnvironment = {
      ...process.env,
      NO_PROXY: "127.0.0.1,localhost",
      SKYEMU_STATIC_BINARY_URL: `http://127.0.0.1:${archiveAddress.port}/SkyEmu-v5-linux-x64.zip`,
      SKYEMU_STATIC_SHA256: archiveSha256,
      no_proxy: "127.0.0.1,localhost",
      npm_config_dry_run: "false",
    }
    await run("npm", ["install", "--ignore-scripts=false", "--cache", npmCache, tarballPath], {
      cwd: temporaryDirectory,
      env: installationEnvironment,
    })
    assert.equal(archiveRequests, 1)

    const installedBinary = path.join(
      temporaryDirectory,
      "node_modules",
      "skyemu-static",
      "vendor",
      "SkyEmu",
    )
    await fs.promises.access(installedBinary, fs.constants.X_OK)
    await fs.promises.writeFile(romPath, Buffer.alloc(32 * 1024))
    await fs.promises.mkdir(dataPath)
    const port = await reservePort()
    let stdout = ""
    let stderr = ""

    skyEmu = childProcess.spawn(
      "xvfb-run",
      ["-a", installedBinary, "http_server", `${port}`, romPath],
      { detached: true, env: { ...process.env, XDG_DATA_HOME: dataPath } },
    )
    skyEmu.stdout?.on("data", (data) => {
      stdout += data
    })
    skyEmu.stderr?.on("data", (data) => {
      stderr += data
    })
    closed = new Promise((resolve) => skyEmu.once("close", resolve))

    const deadline = Date.now() + 15_000
    let pingError
    while (Date.now() < deadline) {
      try {
        const response = await fetch(`http://127.0.0.1:${port}/ping`)
        if (response.ok) {
          assert.equal((await response.text()).replaceAll("\0", ""), "pong")
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
