import { access, chmod, copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const ffmpegDir = path.join(repoRoot, "apps", "desktop", "resources", "ffmpeg");
const binaryName = process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg";
const bundledPath = path.join(ffmpegDir, binaryName);
const sourcePath = process.env.POST_FFMPEG_PATH?.trim();

await mkdir(ffmpegDir, { recursive: true });

if (sourcePath) {
  await assertFile(sourcePath, "POST_FFMPEG_PATH");
  await copyBundledFfmpeg(sourcePath);
  process.exit(0);
}

const dependencyPath = resolveFfmpegInstallerPath();
if (dependencyPath) {
  await copyBundledFfmpeg(dependencyPath);
  process.exit(0);
}

try {
  await assertFile(bundledPath, "bundled ffmpeg");
  if (process.platform !== "win32") {
    await chmod(bundledPath, 0o755);
  }
  console.log(`Using bundled ffmpeg: ${bundledPath}`);
} catch {
  console.error(
    [
      `Missing bundled ffmpeg for ${process.platform}-${process.arch}.`,
      "",
      `Expected: ${bundledPath}`,
      "",
      "Install dependencies or set POST_FFMPEG_PATH to a platform ffmpeg binary before packaging, for example:",
      "  pnpm install",
      "  pnpm ffmpeg:prepare",
      "",
      "or:",
      "  POST_FFMPEG_PATH=/absolute/path/to/ffmpeg pnpm package",
      "",
      "The binary will be copied into apps/desktop/resources/ffmpeg and included by electron-builder.",
    ].join("\n"),
  );
  process.exit(1);
}

async function copyBundledFfmpeg(source) {
  await copyFile(source, bundledPath);
  if (process.platform !== "win32") {
    await chmod(bundledPath, 0o755);
  }
  console.log(`Prepared bundled ffmpeg: ${bundledPath}`);
}

function resolveFfmpegInstallerPath() {
  try {
    const ffmpegInstaller = require("@ffmpeg-installer/ffmpeg");
    return typeof ffmpegInstaller.path === "string" ? ffmpegInstaller.path : undefined;
  } catch {
    return undefined;
  }
}

async function assertFile(filePath, label) {
  try {
    await access(filePath);
  } catch {
    throw new Error(`${label} was not found: ${filePath}`);
  }
}
