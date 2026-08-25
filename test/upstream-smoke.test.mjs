import * as assert from "node:assert/strict"
import * as childProcess from "node:child_process"
import * as fs from "node:fs"
import * as http from "node:http"
import * as os from "node:os"
import * as path from "node:path"
import * as test from "node:test"
import * as url from "node:url"

const projectRoot = url.fileURLToPath(new URL("..", import.meta.url))

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

test.default("serves /ping from HTTP headless mode under Xvfb", async (context) => {
  const temporaryDirectory = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), "skyemu-static-http-smoke-"),
  )
  const binary = process.env.SKYEMU_BINARY ?? path.join(projectRoot, "vendor", "SkyEmu")
  const romPath = path.join(temporaryDirectory, "smoke.gb")
  const dataPath = path.join(temporaryDirectory, "data")
  const port = await reservePort()
  let stdout = ""
  let stderr = ""

  await fs.promises.writeFile(romPath, Buffer.alloc(32 * 1024))
  await fs.promises.mkdir(dataPath)

  const skyEmu = childProcess.spawn("xvfb-run", ["-a", binary, "http_server", `${port}`, romPath], {
    detached: true,
    env: { ...process.env, XDG_DATA_HOME: dataPath },
  })
  skyEmu.stdout?.on("data", (data) => {
    stdout += data
  })
  skyEmu.stderr?.on("data", (data) => {
    stderr += data
  })
  const closed = new Promise((resolve) => skyEmu.once("close", resolve))

  context.after(async () => {
    process.kill(-skyEmu.pid, "SIGKILL")
    await closed
    await fs.promises.rm(temporaryDirectory, { recursive: true, force: true })
  })

  const deadline = Date.now() + 15_000
  let pingError

  while (Date.now() < deadline) {
    let response
    try {
      response = await fetch(`http://127.0.0.1:${port}/ping`)
    } catch (error) {
      pingError = error
      await wait(250)
      continue
    }

    if (response.ok) {
      assert.equal((await response.text()).replaceAll("\0", ""), "pong")
      return
    }
    pingError = new Error(`Unexpected HTTP status ${response.status}`)
    await wait(250)
  }

  throw new Error(
    ["HTTP headless smoke test did not return pong", String(pingError), stdout, stderr]
      .filter(Boolean)
      .join("\n"),
  )
})
