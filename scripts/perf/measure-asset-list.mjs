#!/usr/bin/env node
/**
 * @purpose Measure synthetic asset-list query timings against a seeded perf database.
 * @role    Local perf utility for page and layout-index SQLite timing baselines.
 * @deps    sqlite3 CLI and the current asset-list SQL shape.
 * @gotcha  Measures SQLite subprocess wall time, so compare runs on the same machine.
 */

import { performance } from "node:perf_hooks";
import { spawnSync } from "node:child_process";

function parseArgs(argv) {
  const options = {
    db: "",
    vaultId: "",
    limit: 80,
    iterations: 5,
    mode: "both",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--db") {
      options.db = argv[++index] ?? "";
    } else if (arg === "--vault-id") {
      options.vaultId = argv[++index] ?? "";
    } else if (arg === "--limit") {
      options.limit = Number.parseInt(argv[++index] ?? "", 10);
    } else if (arg === "--iterations") {
      options.iterations = Number.parseInt(argv[++index] ?? "", 10);
    } else if (arg === "--mode") {
      options.mode = argv[++index] ?? "";
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!options.db) {
    throw new Error("Missing --db <path>");
  }
  if (!Number.isFinite(options.limit) || options.limit < 1) {
    throw new Error("--limit must be a positive number");
  }
  if (!Number.isFinite(options.iterations) || options.iterations < 1) {
    throw new Error("--iterations must be a positive number");
  }
  if (!["page", "layout", "both"].includes(options.mode)) {
    throw new Error("--mode must be page, layout, or both");
  }

  return options;
}

function printHelp() {
  console.log(`Usage: node scripts/perf/measure-asset-list.mjs --db <path> [options]

Options:
  --vault-id <id>         Vault id, default latest opened vault
  --limit <count>         Page size, default 80
  --mode <name>           page, layout, or both; default both
  --iterations <count>    Number of repeated timings, default 5
`);
}

function quote(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function runSql(dbPath, sql, json = false) {
  const args = json ? ["-json", dbPath, sql] : [dbPath, sql];
  const result = spawnSync("sqlite3", args, {
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 128,
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(result.stderr || `sqlite3 exited with status ${result.status}`);
  }

  return result.stdout.trim();
}

function timedSql(dbPath, sql, json = false) {
  const start = performance.now();
  const stdout = runSql(dbPath, sql, json);
  const durationMs = performance.now() - start;
  return { durationMs, stdout };
}

function getVaultId(options) {
  if (options.vaultId) {
    return options.vaultId;
  }

  const output = runSql(options.db, "select id from vaults order by last_opened_at desc limit 1;");
  const vaultId = output.split(/\r?\n/)[0] ?? "";
  if (!vaultId) {
    throw new Error("No vault found in database");
  }
  return vaultId;
}

function pageSql(vaultId, limit, cursor) {
  const conditions = [
    `asset_files.vault_id = ${quote(vaultId)}`,
    `assets.vault_id = ${quote(vaultId)}`,
    "assets.deleted_at is null",
    "asset_files.file_exists = 1",
  ];

  if (cursor) {
    conditions.push(
      `(asset_files.mtime_ms < ${cursor.valueMs} or (asset_files.mtime_ms = ${cursor.valueMs} and asset_files.asset_id < ${quote(cursor.id)}))`,
    );
  }

  return `
    select
      assets.id,
      assets.kind,
      assets.status,
      assets.title,
      asset_files.relative_path,
      asset_files.file_name,
      asset_files.extension,
      asset_files.size_bytes,
      asset_files.mtime_ms as sort_value,
      image_cache.status as image_status,
      markdown_cache.title as markdown_title
    from assets
      inner join asset_files on asset_files.asset_id = assets.id
      inner join vaults on vaults.id = assets.vault_id
      left join markdown_cache on markdown_cache.asset_id = assets.id
      left join image_cache on image_cache.asset_id = assets.id
    where ${conditions.join(" and ")}
    order by asset_files.mtime_ms desc, asset_files.asset_id desc
    limit ${limit + 1};
  `;
}

function explainSql(vaultId, limit) {
  return `explain query plan ${pageSql(vaultId, limit).trim()}`;
}

function layoutIndexSql(vaultId) {
  const conditions = [
    `asset_files.vault_id = ${quote(vaultId)}`,
    `assets.vault_id = ${quote(vaultId)}`,
    "assets.deleted_at is null",
    "asset_files.file_exists = 1",
  ];

  return `
    select
      assets.id,
      assets.vault_id,
      assets.kind,
      assets.status,
      assets.privacy,
      coalesce(markdown_cache.title, assets.title) as title,
      asset_files.relative_path,
      asset_files.file_name,
      asset_files.extension,
      asset_files.size_bytes,
      asset_files.mtime_ms,
      asset_files.ctime_ms,
      asset_files.file_exists,
      image_cache.width as image_width,
      image_cache.height as image_height,
      image_cache.thumbnail_width,
      image_cache.thumbnail_height,
      image_cache.status as thumbnail_status
    from assets
      inner join asset_files on asset_files.asset_id = assets.id
      left join markdown_cache on markdown_cache.asset_id = assets.id
      left join image_cache on image_cache.asset_id = assets.id
    where ${conditions.join(" and ")}
    order by asset_files.mtime_ms desc, asset_files.asset_id desc;
  `;
}

function explainLayoutIndexSql(vaultId) {
  return `explain query plan ${layoutIndexSql(vaultId).trim()}`;
}

function summarize(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const total = values.reduce((sum, value) => sum + value, 0);
  return {
    minMs: sorted[0],
    maxMs: sorted[sorted.length - 1],
    avgMs: total / values.length,
    p50Ms: sorted[Math.floor(sorted.length / 2)],
  };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const vaultId = getVaultId(options);
  const firstDurations = [];
  const nextDurations = [];
  const layoutDurations = [];
  let firstRows = [];
  let nextRows = [];
  let layoutRows = [];

  for (let index = 0; index < options.iterations; index += 1) {
    if (options.mode === "page" || options.mode === "both") {
      const first = timedSql(options.db, pageSql(vaultId, options.limit), true);
      firstDurations.push(first.durationMs);
      firstRows = JSON.parse(first.stdout || "[]");
      const overflow = firstRows[options.limit];
      const cursor = overflow ? { valueMs: overflow.sort_value, id: overflow.id } : null;

      if (cursor) {
        const next = timedSql(options.db, pageSql(vaultId, options.limit, cursor), true);
        nextDurations.push(next.durationMs);
        nextRows = JSON.parse(next.stdout || "[]");
      }
    }

    if (options.mode === "layout" || options.mode === "both") {
      const layout = timedSql(options.db, layoutIndexSql(vaultId), true);
      layoutDurations.push(layout.durationMs);
      layoutRows = JSON.parse(layout.stdout || "[]");
    }
  }

  const count = Number(
    runSql(
      options.db,
      `select count(*) from assets inner join asset_files on asset_files.asset_id = assets.id where assets.vault_id = ${quote(vaultId)} and assets.deleted_at is null and asset_files.file_exists = 1;`,
    ),
  );

  const result = {
    db: options.db,
    vaultId,
    limit: options.limit,
    iterations: options.iterations,
    totalAssets: count,
    firstPageRows: firstDurations.length ? Math.min(firstRows.length, options.limit) : null,
    nextPageRows: nextDurations.length ? Math.min(nextRows.length, options.limit) : null,
    layoutIndexRows: layoutDurations.length ? layoutRows.length : null,
    firstPage: firstDurations.length ? summarize(firstDurations) : null,
    nextPage: nextDurations.length ? summarize(nextDurations) : null,
    layoutIndex: layoutDurations.length ? summarize(layoutDurations) : null,
    pageExplain:
      options.mode === "layout"
        ? null
        : runSql(options.db, explainSql(vaultId, options.limit)).split(/\r?\n/),
    layoutExplain:
      options.mode === "page"
        ? null
        : runSql(options.db, explainLayoutIndexSql(vaultId)).split(/\r?\n/),
  };

  console.log(JSON.stringify(result, null, 2));
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
