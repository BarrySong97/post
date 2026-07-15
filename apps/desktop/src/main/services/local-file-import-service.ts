/**
 * @purpose Copy dropped local files into the active vault and refresh the indexer.
 * @role    Main-process service for OS drag-and-drop import into assets/imports/.
 * @deps    Node fs/path, vault repositories, indexer, background tasks, thumbnail tasks.
 * @gotcha  Skip vault-internal sources and hidden path segments; refresh only copied relative paths.
 */

import { copyFile, mkdir, readdir, stat, utimes } from "node:fs/promises";
import path from "node:path";

import { backgroundTaskManager } from "../background-tasks";
import { runIndexer, type IndexerEvent } from "../indexer";
import { getRequestedOrActiveVault } from "../repositories/vaults-repository";
import { runThumbnailTask } from "../thumbnail-tasks";

export const LOCAL_IMPORT_DIR = "assets/imports";

export type ImportLocalFilesInput = {
  paths: string[];
  vaultId?: string;
};

export type ImportLocalFilesResult = {
  imported: number;
  skipped: number;
  failed: number;
  relativePaths: string[];
};

type CopyCounters = {
  imported: number;
  skipped: number;
  failed: number;
  relativePaths: string[];
};

export function isHiddenPathSegment(name: string): boolean {
  return name.startsWith(".");
}

export function isPathInsideDirectory(candidate: string, directory: string): boolean {
  const resolvedCandidate = path.resolve(candidate);
  const resolvedDirectory = path.resolve(directory);
  const relative = path.relative(resolvedDirectory, resolvedCandidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export function splitFileName(fileName: string): { stem: string; extension: string } {
  const extension = path.extname(fileName);
  const stem = extension.length > 0 ? fileName.slice(0, -extension.length) : fileName;
  return {
    stem: stem || "file",
    extension: extension.startsWith(".") ? extension.slice(1) : extension,
  };
}

export function buildUniqueRelativePath(
  destinationDir: string,
  fileName: string,
  existingRelativePaths: ReadonlySet<string>,
  pathExistsSync: (relativePath: string) => boolean,
): string {
  const { stem, extension } = splitFileName(fileName);
  let index = 0;

  while (true) {
    const suffix = index === 0 ? "" : `-${index + 1}`;
    const nextName = extension ? `${stem}${suffix}.${extension}` : `${stem}${suffix}`;
    const relativePath = path.posix.join(destinationDir, nextName);
    if (!existingRelativePaths.has(relativePath) && !pathExistsSync(relativePath)) {
      return relativePath;
    }
    index += 1;
  }
}

export function buildUniqueDirectoryName(
  baseName: string,
  existingRelativeDirs: ReadonlySet<string>,
  dirExistsSync: (relativeDir: string) => boolean,
): string {
  const safeBase = baseName.trim() || "folder";
  let index = 0;

  while (true) {
    const suffix = index === 0 ? "" : `-${index + 1}`;
    const name = `${safeBase}${suffix}`;
    const relativeDir = path.posix.join(LOCAL_IMPORT_DIR, name);
    if (!existingRelativeDirs.has(relativeDir) && !dirExistsSync(relativeDir)) {
      return name;
    }
    index += 1;
  }
}

/** Build a short subject for footer/pill display from dropped absolute paths. */
export function buildImportSubject(paths: readonly string[]) {
  const names = paths
    .map((item) => path.basename(item))
    .filter((name) => name.length > 0)
    .slice(0, 3);

  return {
    names,
    count: paths.length,
  };
}

async function pathExists(absolutePath: string): Promise<boolean> {
  try {
    await stat(absolutePath);
    return true;
  } catch {
    return false;
  }
}

async function allocateUniqueFileRelativePath(
  vaultRoot: string,
  destinationDir: string,
  fileName: string,
  reserved: Set<string>,
): Promise<string> {
  const { stem, extension } = splitFileName(fileName);
  let index = 0;

  while (true) {
    const suffix = index === 0 ? "" : `-${index + 1}`;
    const nextName = extension ? `${stem}${suffix}.${extension}` : `${stem}${suffix}`;
    const candidate = path.posix.join(destinationDir, nextName);
    if (!reserved.has(candidate) && !(await pathExists(path.join(vaultRoot, candidate)))) {
      reserved.add(candidate);
      return candidate;
    }
    index += 1;
  }
}

async function allocateUniqueImportFolderName(
  vaultRoot: string,
  baseName: string,
  reservedDirs: Set<string>,
): Promise<string> {
  const safeBase = baseName.trim() || "folder";
  let index = 0;

  while (true) {
    const suffix = index === 0 ? "" : `-${index + 1}`;
    const candidate = `${safeBase}${suffix}`;
    const relativeDir = path.posix.join(LOCAL_IMPORT_DIR, candidate);
    if (!reservedDirs.has(relativeDir) && !(await pathExists(path.join(vaultRoot, relativeDir)))) {
      reservedDirs.add(relativeDir);
      return candidate;
    }
    index += 1;
  }
}

async function copyOneFile(
  sourceAbsolute: string,
  vaultRoot: string,
  destinationDir: string,
  fileName: string,
  counters: CopyCounters,
  reserved: Set<string>,
): Promise<void> {
  try {
    const relativePath = await allocateUniqueFileRelativePath(
      vaultRoot,
      destinationDir,
      fileName,
      reserved,
    );
    const absoluteDest = path.join(vaultRoot, relativePath);
    await mkdir(path.dirname(absoluteDest), { recursive: true });
    const sourceStat = await stat(sourceAbsolute);
    await copyFile(sourceAbsolute, absoluteDest);
    // Preserve the source file's mtime so "Date Modified" sort stays consistent whether
    // a file was dropped onto the app window or picked up in place by the vault watcher.
    await utimes(absoluteDest, sourceStat.atime, sourceStat.mtime);
    counters.imported += 1;
    counters.relativePaths.push(relativePath);
  } catch {
    counters.failed += 1;
  }
}

async function walkAndCopyDirectory(
  sourceDir: string,
  vaultRoot: string,
  destinationDir: string,
  counters: CopyCounters,
  reserved: Set<string>,
): Promise<void> {
  let entries;
  try {
    entries = await readdir(sourceDir, { withFileTypes: true });
  } catch {
    counters.failed += 1;
    return;
  }

  for (const entry of entries) {
    if (isHiddenPathSegment(entry.name)) {
      counters.skipped += 1;
      continue;
    }

    const sourceAbsolute = path.join(sourceDir, entry.name);
    if (entry.isDirectory()) {
      await walkAndCopyDirectory(
        sourceAbsolute,
        vaultRoot,
        path.posix.join(destinationDir, entry.name),
        counters,
        reserved,
      );
      continue;
    }

    if (!entry.isFile()) {
      counters.skipped += 1;
      continue;
    }

    await copyOneFile(sourceAbsolute, vaultRoot, destinationDir, entry.name, counters, reserved);
  }
}

function findLastEvent(events: IndexerEvent[], eventType: string): IndexerEvent | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (events[index]?.type === eventType) {
      return events[index];
    }
  }
  return undefined;
}

function parseStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string" && item.length > 0);
}

export async function importLocalFiles(
  input: ImportLocalFilesInput,
): Promise<ImportLocalFilesResult> {
  const vault = getRequestedOrActiveVault(input.vaultId);
  if (!vault) {
    throw new Error("No active vault selected.");
  }

  const counters: CopyCounters = {
    imported: 0,
    skipped: 0,
    failed: 0,
    relativePaths: [],
  };
  const reservedFiles = new Set<string>();
  const reservedDirs = new Set<string>();

  const task = backgroundTaskManager.createTask({
    type: "import",
    title: "Importing files",
    vaultId: vault.id,
    vaultName: vault.name,
    subject: buildImportSubject(input.paths),
    progress: {
      current: 0,
      total: input.paths.length,
      label: `${input.paths.length} items`,
    },
  });
  backgroundTaskManager.startTask(task.id);

  try {
    for (let index = 0; index < input.paths.length; index += 1) {
      const rawPath = input.paths[index];
      if (!rawPath) {
        counters.failed += 1;
        continue;
      }

      backgroundTaskManager.updateTask(task.id, {
        progress: {
          current: index,
          total: input.paths.length,
          label: path.basename(rawPath),
        },
      });

      const sourceAbsolute = path.resolve(rawPath);

      if (isPathInsideDirectory(sourceAbsolute, vault.rootPath)) {
        counters.skipped += 1;
        continue;
      }

      const baseName = path.basename(sourceAbsolute);
      if (isHiddenPathSegment(baseName)) {
        counters.skipped += 1;
        continue;
      }

      let sourceStat;
      try {
        sourceStat = await stat(sourceAbsolute);
      } catch {
        counters.failed += 1;
        continue;
      }

      if (sourceStat.isDirectory()) {
        const folderName = await allocateUniqueImportFolderName(
          vault.rootPath,
          baseName,
          reservedDirs,
        );
        await walkAndCopyDirectory(
          sourceAbsolute,
          vault.rootPath,
          path.posix.join(LOCAL_IMPORT_DIR, folderName),
          counters,
          reservedFiles,
        );
        continue;
      }

      if (!sourceStat.isFile()) {
        counters.skipped += 1;
        continue;
      }

      await copyOneFile(
        sourceAbsolute,
        vault.rootPath,
        LOCAL_IMPORT_DIR,
        baseName,
        counters,
        reservedFiles,
      );
    }

    if (counters.relativePaths.length > 0) {
      backgroundTaskManager.updateTask(task.id, {
        progress: {
          current: counters.imported,
          total: counters.imported,
          label: "Indexing",
        },
      });

      const result = await runIndexer("refresh", {
        vaultId: vault.id,
        rootPath: vault.rootPath,
        paths: counters.relativePaths,
      });

      const completed = findLastEvent(result.events, "completed");
      const thumbnailAssetIds = parseStringArray(
        completed?.thumbnailAssetIds ?? completed?.imageAssetIds,
      );

      if (thumbnailAssetIds.length > 0) {
        void runThumbnailTask(vault, {
          assetIds: thumbnailAssetIds,
          limit: thumbnailAssetIds.length,
        }).catch((error) => {
          console.error("Failed to generate import thumbnails", error);
        });
      }
    }

    backgroundTaskManager.completeTask(
      task.id,
      `Imported ${counters.imported} · skipped ${counters.skipped} · failed ${counters.failed}`,
    );

    return {
      imported: counters.imported,
      skipped: counters.skipped,
      failed: counters.failed,
      relativePaths: counters.relativePaths,
    };
  } catch (error) {
    backgroundTaskManager.failTask(task.id, error);
    throw error;
  }
}
