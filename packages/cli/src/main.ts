/**
 * @purpose Register and run the Post command line interface.
 * @role    Commander.js entrypoint for safe Post workspace organization automation.
 * @deps    commander, @post/domain, @post/db schema, CLI runtime/output and local IPC helpers.
 * @gotcha  Write commands only mutate SQLite when --commit is passed; app refresh notices are best-effort.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Command } from "commander";
import { count } from "drizzle-orm";

import {
  addGalleryItems,
  addTagToAsset,
  createGallery,
  createSavedView,
  createTag,
  deleteGallery,
  deleteSavedView,
  deleteTagAndCleanViews,
  getAssetTags,
  getGalleryById,
  getRequestedOrActiveVault,
  listAssets,
  listGalleries,
  listSavedViews,
  listTags,
  listVaults,
  removeGalleryItems,
  removeTagFromAsset,
  reorderGalleryItems,
  reorderSavedViews,
  reorderTags,
  setGalleryCover,
  updateGallery,
  updateGalleryItemCaption,
  updateSavedView,
  updateTag,
  type AssetListSort,
  type SavedViewFilters,
} from "@post/domain";
import { schema, type AssetKind, type AssetPrivacy, type AssetStatus } from "@post/db";

import { writeError, writeSuccess, exitCodeForError } from "./output/format";
import { createCliRuntime, type CliGlobalOptions } from "./runtime/context";
import { notifyDesktopLedgerChanged } from "./runtime/local-ipc";

type CommandOptions = CliGlobalOptions & {
  json?: boolean;
};

type WriteOptions = CommandOptions & {
  commit?: boolean;
  dryRun?: boolean;
};

type PatchOperation =
  | { op: "tag.create"; name: string; color?: string | null }
  | { op: "tag.update"; tagId: string; name: string; color?: string | null }
  | { op: "tag.delete"; tagId: string }
  | { op: "tag.reorder"; orderedTagIds: string[] }
  | { op: "asset.tag.add"; assetId: string; tagName: string }
  | { op: "asset.tag.remove"; assetId: string; tagId: string }
  | { op: "view.create"; name: string; filters?: Partial<SavedViewFilters>; sort?: AssetListSort }
  | {
      op: "view.update";
      viewId: string;
      name: string;
      filters?: Partial<SavedViewFilters>;
      sort?: AssetListSort;
    }
  | { op: "view.delete"; viewId: string }
  | { op: "view.reorder"; orderedViewIds: string[] }
  | { op: "gallery.create"; title: string; description?: string | null; assetIds: string[] }
  | {
      op: "gallery.update";
      galleryId: string;
      title: string;
      description?: string | null;
      status?: AssetStatus;
      privacy?: AssetPrivacy;
    }
  | { op: "gallery.delete"; galleryId: string }
  | { op: "gallery.add"; galleryId: string; assetIds: string[] }
  | { op: "gallery.remove"; galleryId: string; assetIds: string[] }
  | { op: "gallery.reorder"; galleryId: string; orderedAssetIds: string[] }
  | { op: "gallery.setCover"; galleryId: string; assetId: string }
  | { op: "gallery.caption"; galleryId: string; assetId: string; caption?: string | null };

type PatchFile = {
  version: 1;
  operations: PatchOperation[];
};

const program = new Command();

function globalOptions(): CommandOptions {
  return program.opts<CommandOptions>();
}

function readJsonFile<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function runRead<T>(
  options: CommandOptions,
  callback: (runtime: ReturnType<typeof createCliRuntime>) => T,
): void {
  try {
    writeSuccess(callback(createCliRuntime(options)), { json: options.json });
  } catch (error) {
    writeError(error, { json: options.json });
    process.exitCode = exitCodeForError(error);
  }
}

function runWrite<T>(
  label: string,
  options: WriteOptions,
  input: unknown,
  callback: (runtime: ReturnType<typeof createCliRuntime>) => T,
): Promise<void> {
  try {
    if (!options.commit) {
      writeSuccess(
        {
          dryRun: true,
          operation: label,
          input,
          message: "No changes written. Re-run with --commit to apply.",
        },
        { json: options.json },
      );
      return Promise.resolve();
    }

    const runtime = createCliRuntime(options);
    const result = callback(runtime);
    return notifyDesktopLedgerChanged({
      dbPath: runtime.dbPath,
      changed: changedScopesForOperation(label),
      operationCount: 1,
    }).then((warnings) => {
      writeSuccess(result, { json: options.json }, warnings);
    });
  } catch (error) {
    writeError(error, { json: options.json });
    process.exitCode = exitCodeForError(error);
    return Promise.resolve();
  }
}

function changedScopesForOperation(operation: string): string[] {
  if (operation.startsWith("tag.")) {
    return ["assets", "tags", "views"];
  }

  if (operation.startsWith("asset.tag.")) {
    return ["assets", "tags"];
  }

  if (operation.startsWith("view.")) {
    return ["views"];
  }

  if (operation.startsWith("gallery.")) {
    return ["assets", "galleries"];
  }

  return ["vault"];
}

function uniqueChangedScopes(operations: readonly string[]): string[] {
  return Array.from(new Set(operations.flatMap(changedScopesForOperation))).sort();
}

function optionArray(value: string | string[] | undefined): string[] {
  if (!value) {
    return [];
  }

  return Array.isArray(value) ? value : [value];
}

function filtersFromOptions(options: {
  tag?: string[];
  kind?: string[];
  status?: AssetStatus;
}): Partial<SavedViewFilters> {
  return {
    tagIds: optionArray(options.tag),
    types: optionArray(options.kind).filter((kind) =>
      ["markdown", "image", "video", "link", "file"].includes(kind),
    ) as SavedViewFilters["types"],
    status: options.status ?? "any",
  };
}

function executePatchOperation(
  runtime: ReturnType<typeof createCliRuntime>,
  operation: PatchOperation,
) {
  const { ctx } = runtime;

  switch (operation.op) {
    case "tag.create":
      return createTag(ctx, operation);
    case "tag.update":
      return updateTag(ctx, {
        id: operation.tagId,
        name: operation.name,
        color: operation.color,
      });
    case "tag.delete":
      return deleteTagAndCleanViews(ctx, operation.tagId);
    case "tag.reorder":
      return reorderTags(ctx, { orderedIds: operation.orderedTagIds });
    case "asset.tag.add":
      return addTagToAsset(ctx, { assetId: operation.assetId, name: operation.tagName });
    case "asset.tag.remove":
      return removeTagFromAsset(ctx, { assetId: operation.assetId, tagId: operation.tagId });
    case "view.create":
      return createSavedView(ctx, {
        name: operation.name,
        filters: operation.filters,
        sort: operation.sort,
      });
    case "view.update":
      return updateSavedView(ctx, {
        id: operation.viewId,
        name: operation.name,
        filters: operation.filters,
        sort: operation.sort,
      });
    case "view.delete":
      return deleteSavedView(ctx, operation.viewId);
    case "view.reorder":
      return reorderSavedViews(ctx, { orderedIds: operation.orderedViewIds });
    case "gallery.create":
      return createGallery(ctx, operation);
    case "gallery.update": {
      const current = getGalleryById(ctx, operation.galleryId).gallery;
      return updateGallery(ctx, {
        galleryId: operation.galleryId,
        title: operation.title,
        description: operation.description ?? current.description,
        status: operation.status ?? current.status,
        privacy: operation.privacy ?? current.privacy,
      });
    }
    case "gallery.delete":
      return deleteGallery(ctx, operation.galleryId);
    case "gallery.add":
      return addGalleryItems(ctx, {
        galleryId: operation.galleryId,
        assetIds: operation.assetIds,
      });
    case "gallery.remove":
      return removeGalleryItems(ctx, {
        galleryId: operation.galleryId,
        assetIds: operation.assetIds,
      });
    case "gallery.reorder":
      return reorderGalleryItems(ctx, operation);
    case "gallery.setCover":
      return setGalleryCover(ctx, operation);
    case "gallery.caption":
      return updateGalleryItemCaption(ctx, operation);
  }
}

program
  .name("post-cli")
  .description("Safe command line interface for organizing a local Post workspace")
  .option("--db <path>", "SQLite database path")
  .option("--env <env>", "Post app environment for default database resolution", "prod")
  .option("--vault <vaultId>", "Vault id to operate on")
  .option("--json", "Emit stable JSON output");

program
  .command("ledger-info")
  .description("Show CLI and workspace information")
  .action(() => {
    const options = globalOptions();
    runRead(options, (runtime) => {
      const vault = getRequestedOrActiveVault(runtime.ctx, options.vault);
      const assetCount =
        runtime.ctx.db.select({ total: count() }).from(schema.assets).get()?.total ?? 0;
      const tagCount =
        runtime.ctx.db.select({ total: count() }).from(schema.tags).get()?.total ?? 0;
      const viewCount =
        runtime.ctx.db.select({ total: count() }).from(schema.savedViews).get()?.total ?? 0;
      const galleryCount =
        runtime.ctx.db.select({ total: count() }).from(schema.assetGalleries).get()?.total ?? 0;

      return {
        cli: { name: "post-cli", version: "0.0.0", patchVersion: 1 },
        database: { path: runtime.dbPath, migrationsFolder: runtime.migrationsFolder },
        activeVault: vault,
        counts: { assets: assetCount, tags: tagCount, views: viewCount, galleries: galleryCount },
        operations: ["tag.*", "asset.tag.*", "view.*", "gallery.*", "apply-patch"],
      };
    });
  });

const vault = program.command("vault").description("Inspect Post vaults");
vault.command("list").action(() => {
  const options = globalOptions();
  runRead(options, (runtime) => listVaults(runtime.ctx));
});
vault.command("current").action(() => {
  const options = globalOptions();
  runRead(options, (runtime) => getRequestedOrActiveVault(runtime.ctx, options.vault));
});

const asset = program.command("asset").description("Inspect and organize assets");
asset
  .command("list")
  .option("--kind <kind>", "Asset kind")
  .option("--status <status>", "Asset status")
  .option("--tag <tagId>", "Tag id")
  .option("--search <text>", "Search text")
  .option("--limit <count>", "Maximum rows", (value) => Number.parseInt(value, 10))
  .action(
    (local: {
      kind?: AssetKind;
      status?: AssetStatus;
      tag?: string;
      search?: string;
      limit?: number;
    }) => {
      runRead(globalOptions(), (runtime) =>
        listAssets(runtime.ctx, {
          kind: local.kind,
          status: local.status,
          tagId: local.tag,
          search: local.search,
          limit: local.limit,
        }),
      );
    },
  );
asset
  .command("tags")
  .argument("<assetId>")
  .action((assetId: string) => {
    runRead(globalOptions(), (runtime) => getAssetTags(runtime.ctx, assetId));
  });
const assetTag = asset.command("tag").description("Manage asset-tag bindings");
assetTag
  .command("add")
  .argument("<assetId>")
  .argument("<tagName>")
  .option("--commit", "Write changes")
  .action((assetId: string, tagName: string, local: WriteOptions) => {
    const options = { ...globalOptions(), ...local };
    return runWrite("asset.tag.add", options, { assetId, tagName }, (runtime) =>
      addTagToAsset(runtime.ctx, { assetId, name: tagName }),
    );
  });
assetTag
  .command("remove")
  .argument("<assetId>")
  .argument("<tagId>")
  .option("--commit", "Write changes")
  .action((assetId: string, tagId: string, local: WriteOptions) => {
    const options = { ...globalOptions(), ...local };
    return runWrite("asset.tag.remove", options, { assetId, tagId }, (runtime) =>
      removeTagFromAsset(runtime.ctx, { assetId, tagId }),
    );
  });
assetTag
  .command("add-many")
  .requiredOption("--asset <assetId>", "Asset id")
  .option(
    "--tag <tagName>",
    "Tag name",
    (value, previous: string[] = []) => [...previous, value],
    [],
  )
  .option("--commit", "Write changes")
  .action((local: WriteOptions & { asset: string; tag?: string[] }) => {
    const options = { ...globalOptions(), ...local };
    const input = { assetId: local.asset, tagNames: local.tag ?? [] };
    return runWrite("asset.tag.addMany", options, input, (runtime) =>
      input.tagNames.map((tagName) =>
        addTagToAsset(runtime.ctx, { assetId: input.assetId, name: tagName }),
      ),
    );
  });
assetTag
  .command("remove-many")
  .requiredOption("--asset <assetId>", "Asset id")
  .option("--tag <tagId>", "Tag id", (value, previous: string[] = []) => [...previous, value], [])
  .option("--commit", "Write changes")
  .action((local: WriteOptions & { asset: string; tag?: string[] }) => {
    const options = { ...globalOptions(), ...local };
    const input = { assetId: local.asset, tagIds: local.tag ?? [] };
    return runWrite("asset.tag.removeMany", options, input, (runtime) =>
      input.tagIds.map((tagId) =>
        removeTagFromAsset(runtime.ctx, { assetId: input.assetId, tagId }),
      ),
    );
  });

const tag = program.command("tag").description("Manage tags");
tag.command("list").action(() => runRead(globalOptions(), (runtime) => listTags(runtime.ctx)));
tag
  .command("get")
  .argument("<tagId>")
  .action((tagId: string) => {
    runRead(
      globalOptions(),
      (runtime) => listTags(runtime.ctx).find((item) => item.id === tagId) ?? null,
    );
  });
tag
  .command("create")
  .argument("<name>")
  .option("--color <color>", "Tag color")
  .option("--commit", "Write changes")
  .action((name: string, local: WriteOptions & { color?: string }) => {
    const options = { ...globalOptions(), ...local };
    return runWrite("tag.create", options, { name, color: local.color }, (runtime) =>
      createTag(runtime.ctx, { name, color: local.color }),
    );
  });
tag
  .command("update")
  .argument("<tagId>")
  .option("--name <name>", "Tag name")
  .option("--color <color>", "Tag color")
  .option("--commit", "Write changes")
  .action((tagId: string, local: WriteOptions & { name?: string; color?: string }) => {
    const options = { ...globalOptions(), ...local };
    return runWrite(
      "tag.update",
      options,
      { tagId, name: local.name, color: local.color },
      (runtime) => {
        const current = listTags(runtime.ctx).find((item) => item.id === tagId);
        return updateTag(runtime.ctx, {
          id: tagId,
          name: local.name ?? current?.name ?? "",
          color: local.color ?? current?.color,
        });
      },
    );
  });
tag
  .command("delete")
  .argument("<tagId>")
  .option("--commit", "Write changes")
  .action((tagId: string, local: WriteOptions) => {
    const options = { ...globalOptions(), ...local };
    return runWrite("tag.delete", options, { tagId }, (runtime) =>
      deleteTagAndCleanViews(runtime.ctx, tagId),
    );
  });
tag
  .command("reorder")
  .argument("<tagIds...>")
  .option("--commit", "Write changes")
  .action((tagIds: string[], local: WriteOptions) => {
    const options = { ...globalOptions(), ...local };
    return runWrite("tag.reorder", options, { tagIds }, (runtime) =>
      reorderTags(runtime.ctx, { orderedIds: tagIds }),
    );
  });

const view = program.command("view").description("Manage saved views");
view
  .command("list")
  .action(() => runRead(globalOptions(), (runtime) => listSavedViews(runtime.ctx)));
view
  .command("get")
  .argument("<viewId>")
  .action((viewId: string) => {
    runRead(
      globalOptions(),
      (runtime) => listSavedViews(runtime.ctx).find((item) => item.id === viewId) ?? null,
    );
  });
view
  .command("create")
  .argument("<name>")
  .option("--tag <tagId>", "Tag id", (value, previous: string[] = []) => [...previous, value], [])
  .option(
    "--kind <kind>",
    "Asset kind",
    (value, previous: string[] = []) => [...previous, value],
    [],
  )
  .option("--status <status>", "Status")
  .option("--sort <sort>", "Sort order", "updated_desc")
  .option("--commit", "Write changes")
  .action(
    (
      name: string,
      local: WriteOptions & {
        tag?: string[];
        kind?: string[];
        status?: AssetStatus;
        sort?: AssetListSort;
      },
    ) => {
      const options = { ...globalOptions(), ...local };
      const input = { name, filters: filtersFromOptions(local), sort: local.sort };
      return runWrite("view.create", options, input, (runtime) =>
        createSavedView(runtime.ctx, input),
      );
    },
  );
view
  .command("delete")
  .argument("<viewId>")
  .option("--commit", "Write changes")
  .action((viewId: string, local: WriteOptions) => {
    const options = { ...globalOptions(), ...local };
    return runWrite("view.delete", options, { viewId }, (runtime) =>
      deleteSavedView(runtime.ctx, viewId),
    );
  });
view
  .command("update")
  .argument("<viewId>")
  .option("--name <name>", "View name")
  .option("--tag <tagId>", "Tag id", (value, previous: string[] = []) => [...previous, value], [])
  .option(
    "--kind <kind>",
    "Asset kind",
    (value, previous: string[] = []) => [...previous, value],
    [],
  )
  .option("--status <status>", "Status")
  .option("--sort <sort>", "Sort order")
  .option("--commit", "Write changes")
  .action(
    (
      viewId: string,
      local: WriteOptions & {
        name?: string;
        tag?: string[];
        kind?: string[];
        status?: AssetStatus;
        sort?: AssetListSort;
      },
    ) => {
      const options = { ...globalOptions(), ...local };
      const input = {
        viewId,
        name: local.name,
        filters: filtersFromOptions(local),
        sort: local.sort,
      };
      return runWrite("view.update", options, input, (runtime) => {
        const current = listSavedViews(runtime.ctx).find((item) => item.id === viewId);
        return updateSavedView(runtime.ctx, {
          id: viewId,
          name: local.name ?? current?.name ?? "",
          icon: current?.icon,
          filters: input.filters,
          sort: local.sort,
        });
      });
    },
  );
view
  .command("reorder")
  .argument("<viewIds...>")
  .option("--commit", "Write changes")
  .action((viewIds: string[], local: WriteOptions) => {
    const options = { ...globalOptions(), ...local };
    return runWrite("view.reorder", options, { viewIds }, (runtime) =>
      reorderSavedViews(runtime.ctx, { orderedIds: viewIds }),
    );
  });

const gallery = program.command("gallery").description("Manage galleries");
gallery
  .command("list")
  .action(() => runRead(globalOptions(), (runtime) => listGalleries(runtime.ctx)));
gallery
  .command("get")
  .argument("<galleryId>")
  .action((galleryId: string) => {
    runRead(globalOptions(), (runtime) => getGalleryById(runtime.ctx, galleryId));
  });
gallery
  .command("create")
  .argument("<title>")
  .option(
    "--asset <assetId>",
    "Image asset id",
    (value, previous: string[] = []) => [...previous, value],
    [],
  )
  .option("--description <description>", "Gallery description")
  .option("--commit", "Write changes")
  .action((title: string, local: WriteOptions & { asset?: string[]; description?: string }) => {
    const options = { ...globalOptions(), ...local };
    const input = { title, description: local.description, assetIds: local.asset ?? [] };
    return runWrite("gallery.create", options, input, (runtime) =>
      createGallery(runtime.ctx, input),
    );
  });
gallery
  .command("delete")
  .argument("<galleryId>")
  .option("--commit", "Write changes")
  .action((galleryId: string, local: WriteOptions) => {
    const options = { ...globalOptions(), ...local };
    return runWrite("gallery.delete", options, { galleryId }, (runtime) =>
      deleteGallery(runtime.ctx, galleryId),
    );
  });
gallery
  .command("update")
  .argument("<galleryId>")
  .option("--title <title>", "Gallery title")
  .option("--description <description>", "Gallery description")
  .option("--status <status>", "Gallery status")
  .option("--privacy <privacy>", "Gallery privacy")
  .option("--commit", "Write changes")
  .action(
    (
      galleryId: string,
      local: WriteOptions & {
        title?: string;
        description?: string;
        status?: AssetStatus;
        privacy?: AssetPrivacy;
      },
    ) => {
      const options = { ...globalOptions(), ...local };
      const input = {
        galleryId,
        title: local.title,
        description: local.description,
        status: local.status,
        privacy: local.privacy,
      };
      return runWrite("gallery.update", options, input, (runtime) => {
        const current = getGalleryById(runtime.ctx, galleryId).gallery;
        return updateGallery(runtime.ctx, {
          galleryId,
          title: local.title ?? current.title,
          description: local.description ?? current.description,
          status: local.status ?? current.status,
          privacy: local.privacy ?? current.privacy,
        });
      });
    },
  );
gallery
  .command("add")
  .argument("<galleryId>")
  .option(
    "--asset <assetId>",
    "Image asset id",
    (value, previous: string[] = []) => [...previous, value],
    [],
  )
  .option("--commit", "Write changes")
  .action((galleryId: string, local: WriteOptions & { asset?: string[] }) => {
    const options = { ...globalOptions(), ...local };
    const input = { galleryId, assetIds: local.asset ?? [] };
    return runWrite("gallery.add", options, input, (runtime) =>
      addGalleryItems(runtime.ctx, input),
    );
  });
gallery
  .command("remove")
  .argument("<galleryId>")
  .option(
    "--asset <assetId>",
    "Image asset id",
    (value, previous: string[] = []) => [...previous, value],
    [],
  )
  .option("--commit", "Write changes")
  .action((galleryId: string, local: WriteOptions & { asset?: string[] }) => {
    const options = { ...globalOptions(), ...local };
    const input = { galleryId, assetIds: local.asset ?? [] };
    return runWrite("gallery.remove", options, input, (runtime) =>
      removeGalleryItems(runtime.ctx, input),
    );
  });
gallery
  .command("reorder")
  .argument("<galleryId>")
  .argument("<assetIds...>")
  .option("--commit", "Write changes")
  .action((galleryId: string, assetIds: string[], local: WriteOptions) => {
    const options = { ...globalOptions(), ...local };
    const input = { galleryId, orderedAssetIds: assetIds };
    return runWrite("gallery.reorder", options, input, (runtime) =>
      reorderGalleryItems(runtime.ctx, input),
    );
  });
gallery
  .command("set-cover")
  .argument("<galleryId>")
  .argument("<assetId>")
  .option("--commit", "Write changes")
  .action((galleryId: string, assetId: string, local: WriteOptions) => {
    const options = { ...globalOptions(), ...local };
    const input = { galleryId, assetId };
    return runWrite("gallery.setCover", options, input, (runtime) =>
      setGalleryCover(runtime.ctx, input),
    );
  });
gallery
  .command("caption")
  .argument("<galleryId>")
  .argument("<assetId>")
  .option("--caption <caption>", "Member caption")
  .option("--commit", "Write changes")
  .action((galleryId: string, assetId: string, local: WriteOptions & { caption?: string }) => {
    const options = { ...globalOptions(), ...local };
    const input = { galleryId, assetId, caption: local.caption };
    return runWrite("gallery.caption", options, input, (runtime) =>
      updateGalleryItemCaption(runtime.ctx, input),
    );
  });

program
  .command("apply-patch")
  .argument("<patchPath>")
  .option("--dry-run", "Preview operations without writing")
  .option("--commit", "Write changes")
  .action(async (patchPath: string, local: WriteOptions) => {
    const options = { ...globalOptions(), ...local };
    try {
      const patch = readJsonFile<PatchFile>(patchPath);
      if (patch.version !== 1 || !Array.isArray(patch.operations)) {
        throw new Error("Unsupported patch file");
      }

      if (!options.commit) {
        writeSuccess(
          {
            dryRun: true,
            operationCount: patch.operations.length,
            operations: patch.operations,
            message: "No changes written. Re-run with --commit to apply.",
          },
          { json: options.json },
        );
        return;
      }

      const runtime = createCliRuntime(options);
      const results = runtime.ctx.db.transaction(() =>
        patch.operations.map((operation, index) => {
          try {
            return { index, op: operation.op, result: executePatchOperation(runtime, operation) };
          } catch (error) {
            writeError(error, { json: options.json }, index);
            throw error;
          }
        }),
      );
      const warnings =
        results.length > 0
          ? await notifyDesktopLedgerChanged({
              dbPath: runtime.dbPath,
              changed: uniqueChangedScopes(patch.operations.map((operation) => operation.op)),
              operationCount: results.length,
            })
          : [];

      writeSuccess({ applied: results.length, results }, { json: options.json }, warnings);
    } catch (error) {
      if (!process.exitCode) {
        writeError(error, { json: options.json });
        process.exitCode = exitCodeForError(error);
      }
    }
  });

function getUserArgv(): string[] {
  const mainPath = fileURLToPath(import.meta.url);
  return process.argv.slice(1).filter((arg) => {
    if (arg === "src/main.ts") {
      return false;
    }

    return path.resolve(arg) !== mainPath;
  });
}

program.parseAsync(getUserArgv(), { from: "user" }).catch((error: unknown) => {
  writeError(error, { json: globalOptions().json });
  process.exitCode = exitCodeForError(error);
});
