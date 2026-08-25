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

test.default("installs the packed package without a system unzip command", async (context) => {
  const archive = new AdmZip()
  archive.addFile("SkyEmu", Buffer.from("#!/bin/sh\nexit 0\n"), "", 0o755)
  const archiveContents = archive.toBuffer()
  const archiveSha256 = crypto.createHash("sha256").update(archiveContents).digest("hex")
  let servedArchive = archiveContents
  let requests = 0
  const requestedUrls = []

  const server = http.createServer((request, response) => {
    requests += 1
    requestedUrls.push(request.url)

    if (requests === 1) {
      response.writeHead(500)
      response.end("try again")
      return
    }

    response.writeHead(200, { "content-type": "application/zip" })
    response.end(servedArchive)
  })

  await new Promise((resolve) => {
    server.listen(0, "127.0.0.1", resolve)
  })

  const address = server.address()
  assert.ok(address && typeof address !== "string")
  const temporaryDirectory = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), "skyemu-static-test-"),
  )
  let tarballPath

  context.after(async () => {
    await new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) reject(error)
        else resolve()
      })
    })
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

  const installationEnvironment = {
    ...process.env,
    NO_PROXY: "127.0.0.1,localhost",
    SKYEMU_STATIC_BINARIES_URL: `http://127.0.0.1:${address.port}`,
    SKYEMU_STATIC_DOWNLOAD_RETRIES: "1",
    SKYEMU_STATIC_DOWNLOAD_TIMEOUT: "1000",
    SKYEMU_STATIC_RELEASE: "test",
    SKYEMU_STATIC_SHA256: archiveSha256,
    no_proxy: "127.0.0.1,localhost",
  }

  await run("npm", ["install", "--ignore-scripts=false", "--cache", npmCache, tarballPath], {
    cwd: temporaryDirectory,
    env: installationEnvironment,
  })

  assert.equal(requests, 2)
  assert.deepEqual(requestedUrls, ["/test/SkyEmu-test-Linux.zip", "/test/SkyEmu-test-Linux.zip"])

  const installedPackage = path.join(temporaryDirectory, "node_modules", "skyemu-static")
  const skyEmu = await import(
    url.pathToFileURL(path.join(installedPackage, "dist", "index.js")).href
  )
  await fs.promises.access(skyEmu.skyEmuBinary, fs.constants.X_OK)

  await run(process.execPath, ["scripts/postinstall.mjs"], {
    cwd: installedPackage,
    env: installationEnvironment,
  })
  assert.equal(requests, 2)

  const updatedArchive = new AdmZip()
  updatedArchive.addFile("SkyEmu", Buffer.from("#!/bin/sh\nexit 0\n# updated\n"), "", 0o755)
  servedArchive = updatedArchive.toBuffer()
  const updatedSha256 = crypto.createHash("sha256").update(servedArchive).digest("hex")
  const updatedEnvironment = { ...installationEnvironment, SKYEMU_STATIC_SHA256: updatedSha256 }
  await run(process.execPath, ["scripts/postinstall.mjs"], {
    cwd: installedPackage,
    env: updatedEnvironment,
  })
  assert.equal(requests, 3)

  await fs.promises.rm(skyEmu.skyEmuBinary, { force: true })
  await fs.promises.rm(path.join(skyEmu.skyEmuDirectory, ".skyemu-static.json"), { force: true })
  await Promise.all(
    [updatedEnvironment, updatedEnvironment].map(
      async (environment) =>
        await run(process.execPath, ["scripts/postinstall.mjs"], {
          cwd: installedPackage,
          env: environment,
        }),
    ),
  )
  assert.equal(requests, 4)

  assert.deepEqual(
    JSON.parse(
      await fs.promises.readFile(path.join(skyEmu.skyEmuDirectory, ".skyemu-static.json"), "utf8"),
    ),
    {
      archiveUrl: `http://127.0.0.1:${address.port}/test/SkyEmu-test-Linux.zip`,
      sha256: updatedSha256,
    },
  )
  await run(skyEmu.skyEmuBinary, [], { cwd: temporaryDirectory })
})
