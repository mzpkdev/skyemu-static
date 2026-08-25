import * as crypto from "node:crypto"
import * as fs from "node:fs"
import * as path from "node:path"
import * as url from "node:url"
import AdmZip from "adm-zip"
import { EnvHttpProxyAgent, fetch } from "undici"

const defaultBinariesUrl = "https://github.com/mzpkdev/skyemu-static/releases/download"
const defaultRelease = "v0.0.1"
const defaultReleaseSha256 = "f12ab515142bfb889663f3f63441b95c610ab627ed1a93a45356cc5e5349d856"
const defaultArchiveName = "SkyEmu-v5-linux-x64.zip"
const binaryName = "SkyEmu"
const downloadRetryDelay = 250
const maximumDownloadRetries = 5
const maximumDownloadTimeout = 2_147_483_647
const packageRoot = url.fileURLToPath(new URL("..", import.meta.url))
const release = process.env.SKYEMU_STATIC_RELEASE ?? defaultRelease
const archiveName =
  process.env.SKYEMU_STATIC_ARCHIVE_NAME ??
  (release === defaultRelease ? defaultArchiveName : `SkyEmu-${release}-Linux.zip`)
const binariesUrl = process.env.SKYEMU_STATIC_BINARIES_URL ?? defaultBinariesUrl
const releaseUrl =
  process.env.SKYEMU_STATIC_BINARY_URL ??
  `${binariesUrl.replace(/\/$/, "")}/${release}/${archiveName}`
const releaseSha256 = (process.env.SKYEMU_STATIC_SHA256 ?? defaultReleaseSha256).toLowerCase()
const downloadTimeout = Number(process.env.SKYEMU_STATIC_DOWNLOAD_TIMEOUT ?? 30_000)
const downloadRetries = Number(process.env.SKYEMU_STATIC_DOWNLOAD_RETRIES ?? 2)

export const skyEmuDirectory = process.env.SKYEMU_STATIC_DIR ?? path.join(packageRoot, "vendor")
export const skyEmuBinary = path.join(skyEmuDirectory, binaryName)

const installationLock = path.join(skyEmuDirectory, ".skyemu-static.lock")
const installationMarker = path.join(skyEmuDirectory, ".skyemu-static.json")
const installationMetadata = `${JSON.stringify({ archiveUrl: releaseUrl, sha256: releaseSha256 })}\n`

const sha256 = (contents: Uint8Array): string =>
  crypto.createHash("sha256").update(contents).digest("hex")

const wait = async (milliseconds: number): Promise<void> => {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, milliseconds)
  })
}

const hasProxy = (): boolean =>
  [
    process.env.http_proxy,
    process.env.HTTP_PROXY,
    process.env.https_proxy,
    process.env.HTTPS_PROXY,
  ].some(Boolean)

const isRetryableStatus = (status: number): boolean =>
  status === 408 || status === 429 || status >= 500

const requireValidDownloadSettings = (): void => {
  if (
    !Number.isSafeInteger(downloadTimeout) ||
    downloadTimeout <= 0 ||
    downloadTimeout > maximumDownloadTimeout
  ) {
    throw new Error(
      "SKYEMU_STATIC_DOWNLOAD_TIMEOUT must be a positive whole number of milliseconds",
    )
  }

  if (
    !Number.isSafeInteger(downloadRetries) ||
    downloadRetries < 0 ||
    downloadRetries > maximumDownloadRetries
  ) {
    throw new Error(
      `SKYEMU_STATIC_DOWNLOAD_RETRIES must be a whole number from 0 to ${maximumDownloadRetries}`,
    )
  }

  if (!/^[a-f\d]{64}$/i.test(releaseSha256)) {
    throw new Error("SKYEMU_STATIC_SHA256 must be a SHA-256 checksum")
  }

  if (
    (release !== defaultRelease || archiveName !== defaultArchiveName) &&
    !process.env.SKYEMU_STATIC_SHA256
  ) {
    throw new Error("SKYEMU_STATIC_SHA256 is required for a non-default SkyEmu release")
  }
}

const downloadArchive = async (): Promise<Uint8Array> => {
  requireValidDownloadSettings()

  const dispatcher = hasProxy() ? new EnvHttpProxyAgent() : undefined
  let lastError: Error | undefined

  try {
    for (let attempt = 0; attempt <= downloadRetries; attempt += 1) {
      let response: Awaited<ReturnType<typeof fetch>> | undefined

      try {
        response = await fetch(releaseUrl, {
          dispatcher,
          signal: AbortSignal.timeout(downloadTimeout),
        })
      } catch (error: unknown) {
        lastError = error instanceof Error ? error : new Error(String(error))
      }

      if (response?.ok) {
        try {
          return new Uint8Array(await response.arrayBuffer())
        } catch (error: unknown) {
          lastError = error instanceof Error ? error : new Error(String(error))
        }
      }

      if (response && !response.ok) {
        await response.body?.cancel()
        const error = new Error(
          `Could not download SkyEmu ${release}: ${response.status} ${response.statusText}`,
        )
        if (!isRetryableStatus(response.status)) throw error
        lastError = error
      }

      if (attempt < downloadRetries) await wait(downloadRetryDelay * 2 ** attempt)
    }
  } finally {
    await dispatcher?.close()
  }

  throw lastError ?? new Error(`Could not download SkyEmu ${release}`)
}

const requireLinuxX64 = (): void => {
  if (process.platform !== "linux" || process.arch !== "x64") {
    throw new Error("skyemu-static supports the official Linux x64 release only")
  }
}

const hasExecutable = async (filePath: string): Promise<boolean> => {
  try {
    await fs.promises.access(filePath, fs.constants.X_OK)
    return true
  } catch {
    return false
  }
}

const hasCurrentInstallation = async (): Promise<boolean> => {
  if (!(await hasExecutable(skyEmuBinary))) return false

  try {
    return (await fs.promises.readFile(installationMarker, "utf8")) === installationMetadata
  } catch {
    return false
  }
}

const acquireInstallationLock = async (): Promise<() => Promise<void>> => {
  const retryDelay = 100
  const totalDownloadTime = downloadTimeout * (downloadRetries + 1)
  const totalRetryBackoff = downloadRetryDelay * (2 ** downloadRetries - 1)
  const maximumInstallDuration = Math.max(120_000, totalDownloadTime + totalRetryBackoff + 10_000)
  const deadline = Date.now() + maximumInstallDuration

  while (Date.now() < deadline) {
    try {
      const handle = await fs.promises.open(installationLock, "wx")
      return async (): Promise<void> => {
        try {
          await handle.close()
        } finally {
          await fs.promises.rm(installationLock, { force: true })
        }
      }
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error

      try {
        const lock = await fs.promises.stat(installationLock)
        if (Date.now() - lock.mtimeMs > maximumInstallDuration) {
          await fs.promises.rm(installationLock, { force: true })
          continue
        }
      } catch (statError: unknown) {
        if ((statError as NodeJS.ErrnoException).code !== "ENOENT") throw statError
      }

      await wait(retryDelay)
    }
  }

  throw new Error("Timed out while waiting for another skyemu-static installation")
}

export const setupSkyEmu = async (): Promise<void> => {
  requireLinuxX64()
  requireValidDownloadSettings()
  await fs.promises.mkdir(skyEmuDirectory, { recursive: true })
  if (await hasCurrentInstallation()) return

  const releaseInstallationLock = await acquireInstallationLock()

  try {
    if (await hasCurrentInstallation()) return

    const temporaryDirectory = await fs.promises.mkdtemp(path.join(skyEmuDirectory, ".download-"))

    try {
      const archive = await downloadArchive()
      if (sha256(archive) !== releaseSha256) {
        throw new Error(`SkyEmu ${release} archive checksum did not match the expected SHA-256`)
      }

      const binary = new AdmZip(Buffer.from(archive)).readFile(binaryName)
      if (!binary) throw new Error(`SkyEmu ${release} archive did not contain ${binaryName}`)

      const temporaryBinary = path.join(temporaryDirectory, binaryName)
      const temporaryMarker = path.join(temporaryDirectory, path.basename(installationMarker))
      await fs.promises.writeFile(temporaryBinary, binary)
      await fs.promises.chmod(temporaryBinary, 0o755)
      await fs.promises.writeFile(temporaryMarker, installationMetadata)
      await fs.promises.rename(temporaryBinary, skyEmuBinary)
      await fs.promises.rename(temporaryMarker, installationMarker)
    } finally {
      await fs.promises.rm(temporaryDirectory, { recursive: true, force: true })
    }
  } finally {
    await releaseInstallationLock()
  }
}
