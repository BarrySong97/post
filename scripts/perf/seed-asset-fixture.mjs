#!/usr/bin/env node
/**
 * @purpose Seed deterministic large asset fixtures for asset-board performance testing.
 * @role    Local perf utility that creates a disposable Electron userData directory and SQLite DB.
 * @deps    better-sqlite3, project Drizzle SQL migrations, filesystem utilities.
 * @gotcha  This writes synthetic data only under the requested output directory.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SIZES = {
  small: 500,
  large: 10_000,
  stress: 50_000,
};

const KIND_MIX = [
  ["image", 55],
  ["markdown", 25],
  ["document", 10],
  ["video", 5],
  ["web", 5],
];

const THUMBNAIL_BYTES = Buffer.from(
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAH/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAEFAqf/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEDAQE/Aaf/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAECAQE/Aaf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAY/Aqf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAE/IV//2gAMAwEAAgADAAAAEP/EABQRAQAAAAAAAAAAAAAAAAAAABD/2gAIAQMBAT8QH//EABQRAQAAAAAAAAAAAAAAAAAAABD/2gAIAQIBAT8QH//EABQQAQAAAAAAAAAAAAAAAAAAABD/2gAIAQEAAT8QH//Z",
  "base64",
);

function parseArgs(argv) {
  const options = {
    size: "large",
    env: "dev",
    reset: false,
    userDataDir: "",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--size") {
      options.size = argv[++index] ?? options.size;
    } else if (arg === "--env") {
      options.env = argv[++index] ?? options.env;
    } else if (arg === "--user-data-dir") {
      options.userDataDir = argv[++index] ?? "";
    } else if (arg === "--reset") {
      options.reset = true;
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!Object.hasOwn(SIZES, options.size)) {
    throw new Error(
      `Unsupported size "${options.size}". Use one of: ${Object.keys(SIZES).join(", ")}`,
    );
  }

  if (options.env !== "dev" && options.env !== "prod") {
    throw new Error('--env must be "dev" or "prod"');
  }

  return options;
}

function printHelp() {
  console.log(`Usage: node scripts/perf/seed-asset-fixture.mjs [options]

Options:
  --size small|large|stress       Fixture size, default large
  --env dev|prod                  DB filename suffix, default dev
  --user-data-dir <path>          Output userData dir, default /private/tmp/post-perf-<size>
  --reset                         Delete the output dir before seeding
`);
}

function repoRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
}

function runSql(dbPath, sql) {
  const result = spawnSync("sqlite3", [dbPath], {
    input: sql,
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 64,
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(result.stderr || `sqlite3 exited with status ${result.status}`);
  }
}

function applyMigrations(dbPath, migrationsDir) {
  const journal = JSON.parse(
    readFileSync(path.join(migrationsDir, "meta", "_journal.json"), "utf8"),
  );
  runSql(
    dbPath,
    `
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS "__drizzle_migrations" (
      id SERIAL PRIMARY KEY,
      hash text NOT NULL,
      created_at numeric
    );
  `,
  );

  for (const entry of journal.entries) {
    const file = path.join(migrationsDir, `${entry.tag}.sql`);
    const sql = readFileSync(file, "utf8");
    const statements = sql
      .split("--> statement-breakpoint")
      .map((statement) => statement.trim())
      .filter(Boolean);

    runSql(
      dbPath,
      `
      PRAGMA foreign_keys = ON;
      ${statements.join("\n")}
      INSERT INTO __drizzle_migrations (hash, created_at)
      VALUES (${quote(createHash("sha256").update(sql).digest("hex"))}, ${entry.when});
    `,
    );
  }
}

function quote(value) {
  if (value === null || value === undefined) {
    return "NULL";
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : "NULL";
  }

  if (typeof value === "boolean") {
    return value ? "1" : "0";
  }

  return `'${String(value).replaceAll("'", "''")}'`;
}

function insertSql(table, values) {
  const columns = Object.keys(values);
  return `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${columns.map((column) => quote(values[column])).join(", ")});`;
}

function ensureThumbnails(userDataDir, vaultId) {
  const thumbnailDir = path.join(userDataDir, "thumbnails", vaultId);
  mkdirSync(thumbnailDir, { recursive: true });

  const paths = [];
  for (let index = 0; index < 16; index += 1) {
    const thumbPath = path.join(thumbnailDir, `thumb-${index}.jpg`);
    writeFileSync(thumbPath, THUMBNAIL_BYTES);
    paths.push(thumbPath);
  }

  return paths;
}

function kindForIndex(index) {
  const point = index % 100;
  let cursor = 0;
  for (const [kind, weight] of KIND_MIX) {
    cursor += weight;
    if (point < cursor) {
      return kind;
    }
  }

  return "image";
}

function extensionForKind(kind, index) {
  if (kind === "image") {
    return index % 7 === 0 ? "png" : "jpg";
  }
  if (kind === "markdown") {
    return "md";
  }
  if (kind === "video") {
    return "mp4";
  }
  if (kind === "web") {
    return index % 2 === 0 ? "url" : "webloc";
  }
  return index % 3 === 0 ? "pdf" : index % 3 === 1 ? "csv" : "docx";
}

function relativePathForKind(kind, index, ext) {
  const group = String(index % 100).padStart(2, "0");
  return `${kind}/${group}/asset-${String(index).padStart(6, "0")}.${ext}`;
}

function seedFixture(options) {
  const now = Date.now();
  const assetCount = SIZES[options.size];
  const vaultId = `perf-vault-${options.size}`;
  const vaultRoot = path.join(options.userDataDir, "vault");
  mkdirSync(vaultRoot, { recursive: true });
  const thumbnails = ensureThumbnails(options.userDataDir, vaultId);

  const tagIds = Array.from({ length: 24 }, (_, index) => `perf-tag-${index}`);
  const initStatements = [
    "BEGIN;",
    insertSql("vaults", {
      id: vaultId,
      name: `Perf ${options.size}`,
      root_path: vaultRoot,
      created_at: now,
      updated_at: now,
      last_opened_at: now,
      sync_status: "idle",
    }),
    ...tagIds.map((tagId, index) =>
      insertSql("tags", {
        id: tagId,
        vault_id: vaultId,
        name: `Tag ${index}`,
        color: null,
        sort_order: index,
        created_at: now,
        updated_at: now,
      }),
    ),
    "COMMIT;",
  ];
  runSql(options.dbPath, initStatements.join("\n"));

  const batchSize = 1_000;
  for (let batchStart = 0; batchStart < assetCount; batchStart += batchSize) {
    const statements = ["BEGIN;"];
    const batchEnd = Math.min(assetCount, batchStart + batchSize);

    for (let index = batchStart; index < batchEnd; index += 1) {
      const kind = kindForIndex(index);
      const ext = extensionForKind(kind, index);
      const assetId = `perf-asset-${String(index).padStart(6, "0")}`;
      const fileId = `perf-file-${String(index).padStart(6, "0")}`;
      const relativePath = relativePathForKind(kind, index, ext);
      const fileName = path.basename(relativePath);
      const mtime = now - index * 60_000;
      const ctime = mtime - 86_400_000;
      const sizeBytes = kind === "image" ? 180_000 : kind === "video" ? 8_000_000 : 32_000 + index;
      const fingerprint = `qf-${index.toString(16)}`;
      const status = index % 17 === 0 ? "organized" : index % 29 === 0 ? "draft" : "inbox";

      statements.push(
        insertSql("assets", {
          id: assetId,
          vault_id: vaultId,
          kind,
          status,
          privacy: index % 41 === 0 ? "private" : "normal",
          title: `${kind} asset ${index}`,
          description:
            index % 5 === 0 ? `Synthetic ${kind} asset for performance fixture ${index}` : null,
          created_at: ctime,
          updated_at: mtime,
          indexed_at: now,
          deleted_at: null,
        }),
      );
      statements.push(
        insertSql("asset_files", {
          id: fileId,
          asset_id: assetId,
          vault_id: vaultId,
          relative_path: relativePath,
          file_name: fileName,
          extension: ext,
          mime_type: kind === "markdown" ? "text/markdown" : kind === "image" ? "image/jpeg" : null,
          size_bytes: sizeBytes,
          mtime_ms: mtime,
          ctime_ms: ctime,
          content_hash: `hash-${index.toString(16)}`,
          quick_fingerprint: fingerprint,
          file_exists: 1,
          missing_since: null,
          first_seen_at: ctime,
          last_seen_at: mtime,
        }),
      );

      if (kind === "image" || kind === "video") {
        const thumbPath = thumbnails[index % thumbnails.length];
        statements.push(
          insertSql("image_cache", {
            asset_id: assetId,
            vault_id: vaultId,
            file_id: fileId,
            width: 1600,
            height: 1200,
            thumbnail_path: thumbPath,
            thumbnail_width: 320,
            thumbnail_height: 240,
            thumbnail_size_bytes: THUMBNAIL_BYTES.length,
            thumbnail_format: "jpeg",
            source_size_bytes: sizeBytes,
            source_mtime_ms: mtime,
            source_quick_fingerprint: fingerprint,
            status: "ready",
            error_message: null,
            generated_at: now,
            updated_at: now,
          }),
        );
      }

      if (kind === "markdown") {
        statements.push(
          insertSql("markdown_cache", {
            asset_id: assetId,
            vault_id: vaultId,
            title: `Markdown ${index}`,
            excerpt: `Synthetic markdown excerpt ${index}`,
            word_count: 200 + (index % 1500),
            headings_json: "[]",
            outbound_link_count: index % 8,
            inbound_link_count: index % 5,
            parse_status: "ready",
            parsed_at: now,
            parser_version: "perf-fixture/1",
          }),
        );
      }

      statements.push(
        insertSql("asset_tags", {
          asset_id: assetId,
          tag_id: tagIds[index % tagIds.length],
          created_at: now,
        }),
      );
      if (index % 7 === 0) {
        statements.push(
          insertSql("asset_tags", {
            asset_id: assetId,
            tag_id: tagIds[(index + 5) % tagIds.length],
            created_at: now,
          }),
        );
      }
    }

    statements.push("COMMIT;");
    runSql(options.dbPath, statements.join("\n"));
  }

  return {
    assetCount,
    dbPath: options.dbPath,
    userDataDir: options.userDataDir,
    vaultId,
    vaultRoot,
    thumbnails: thumbnails.length,
  };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const root = repoRoot();
  const migrationsDir = path.join(root, "packages", "db", "drizzle");
  const defaultUserDataDir = path.join("/private/tmp", `post-perf-${options.size}`);
  options.userDataDir = path.resolve(options.userDataDir || defaultUserDataDir);
  options.dbPath = path.join(options.userDataDir, `post-${options.env}.sqlite`);

  if (options.reset && existsSync(options.userDataDir)) {
    rmSync(options.userDataDir, { recursive: true, force: true });
  }

  mkdirSync(options.userDataDir, { recursive: true });

  if (existsSync(options.dbPath)) {
    throw new Error(`Database already exists: ${options.dbPath}. Pass --reset to recreate it.`);
  }

  applyMigrations(options.dbPath, migrationsDir);
  const result = seedFixture(options);
  writeFileSync(
    path.join(options.userDataDir, "fixture.json"),
    `${JSON.stringify({ ...result, size: options.size, env: options.env }, null, 2)}\n`,
  );
  console.log(JSON.stringify({ ok: true, ...result }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
