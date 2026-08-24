import * as childProcess from "node:child_process";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import * as url from "node:url";
//#region src/index.ts
const releaseUrl = "https://github.com/skylersaleh/SkyEmu/releases/download/v5/SkyEmu-v5-Linux.zip";
const releaseSha256 = "f3904c4be148a5115ddb427356857d6b7c3cefb1843d488cbe9147a92905547f";
const archiveName = "SkyEmu-v5-Linux.zip";
const binaryName = "SkyEmu";
const packageRoot = url.fileURLToPath(new URL("..", import.meta.url));
const skyEmuDirectory = process.env.STATIC_SKYEMU_DIR ?? path.join(packageRoot, "vendor");
const skyEmuBinary = path.join(skyEmuDirectory, binaryName);
const run = (command, args, cwd) => {
	const result = childProcess.spawnSync(command, args, {
		cwd,
		encoding: "utf8"
	});
	if (result.status === 0) return;
	throw new Error([
		result.error?.message,
		result.stdout,
		result.stderr
	].filter(Boolean).join("\n"));
};
const sha256 = (contents) => crypto.createHash("sha256").update(contents).digest("hex");
const requireLinuxX64 = () => {
	if (process.platform !== "linux" || process.arch !== "x64") throw new Error("static-skyemu supports the official Linux x64 release only");
};
const hasExecutable = async (filePath) => {
	try {
		await fs.promises.access(filePath, fs.constants.X_OK);
		return true;
	} catch {
		return false;
	}
};
const setupSkyEmu = async () => {
	requireLinuxX64();
	await fs.promises.mkdir(skyEmuDirectory, { recursive: true });
	if (await hasExecutable(skyEmuBinary)) return;
	const temporaryDirectory = await fs.promises.mkdtemp(path.join(skyEmuDirectory, ".download-"));
	try {
		const archivePath = path.join(temporaryDirectory, archiveName);
		const response = await fetch(releaseUrl);
		if (!response.ok) throw new Error(`Could not download SkyEmu v5: ${response.status} ${response.statusText}`);
		const archive = new Uint8Array(await response.arrayBuffer());
		if (sha256(archive) !== releaseSha256) throw new Error("SkyEmu v5 archive checksum did not match the expected SHA-256");
		await fs.promises.writeFile(archivePath, archive);
		run("unzip", [
			"-q",
			archivePath,
			"-d",
			temporaryDirectory
		], temporaryDirectory);
		const extractedBinary = path.join(temporaryDirectory, binaryName);
		await fs.promises.access(extractedBinary, fs.constants.F_OK);
		const temporaryBinary = `${skyEmuBinary}.tmp`;
		await fs.promises.copyFile(extractedBinary, temporaryBinary);
		await fs.promises.chmod(temporaryBinary, 493);
		await fs.promises.rename(temporaryBinary, skyEmuBinary);
	} finally {
		await fs.promises.rm(temporaryDirectory, {
			recursive: true,
			force: true
		});
	}
};
//#endregion
export { skyEmuBinary as n, skyEmuDirectory as r, setupSkyEmu as t };
