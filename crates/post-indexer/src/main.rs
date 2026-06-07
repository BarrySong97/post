use std::{
    collections::{HashMap, HashSet},
    env,
    ffi::OsStr,
    fs::{self, File},
    io::Write,
    path::{Component, Path, PathBuf},
    process::{Command, Stdio},
    time::{SystemTime, UNIX_EPOCH},
};

use image::{GenericImageView, ImageReader, codecs::jpeg::JpegEncoder, imageops::FilterType};

const INDEXER_VERSION: &str = "post-indexer/0.1.0";
const PARSER_VERSION: &str = "markdown-links/0.1.0";
const THUMBNAIL_LONG_EDGE: u32 = 720;
const THUMBNAIL_JPEG_QUALITY: u8 = 82;
const THUMBNAIL_DB_FLUSH_BATCH: usize = 8;

#[derive(Clone, Copy)]
enum CommandKind {
    Scan,
    Reconcile,
    Watch,
    Thumbnails,
}

impl CommandKind {
    fn from_str(value: &str) -> Option<Self> {
        match value {
            "scan" => Some(Self::Scan),
            "reconcile" => Some(Self::Reconcile),
            "watch" => Some(Self::Watch),
            "thumbnails" => Some(Self::Thumbnails),
            _ => None,
        }
    }

    fn reason(self) -> &'static str {
        match self {
            Self::Scan => "initial_import",
            Self::Reconcile => "manual",
            Self::Watch => "watcher_event",
            Self::Thumbnails => "manual",
        }
    }

    fn as_str(self) -> &'static str {
        match self {
            Self::Scan => "scan",
            Self::Reconcile => "reconcile",
            Self::Watch => "watch",
            Self::Thumbnails => "thumbnails",
        }
    }
}

struct Config {
    command: CommandKind,
    vault_id: String,
    root_path: PathBuf,
    db_path: PathBuf,
    thumbnail_root: Option<PathBuf>,
    asset_ids: Vec<String>,
    limit: Option<usize>,
}

#[derive(Clone)]
struct FileEntry {
    asset_id: String,
    file_id: String,
    moved_from: Option<String>,
    conflict_candidates: Vec<String>,
    relative_path: String,
    file_name: String,
    extension: Option<String>,
    kind: String,
    title: String,
    size_bytes: u64,
    mtime_ms: i64,
    ctime_ms: Option<i64>,
    quick_fingerprint: String,
}

#[derive(Clone)]
struct ExistingFile {
    file_id: String,
    asset_id: String,
    relative_path: String,
    quick_fingerprint: Option<String>,
    file_exists: bool,
}

struct ThumbnailTarget {
    asset_id: String,
    file_id: String,
    relative_path: String,
    extension: Option<String>,
    size_bytes: u64,
    mtime_ms: i64,
    quick_fingerprint: String,
    cache_status: Option<String>,
    cached_thumbnail_path: Option<String>,
    cached_source_size_bytes: Option<u64>,
    cached_source_mtime_ms: Option<i64>,
    cached_source_quick_fingerprint: Option<String>,
}

struct GeneratedThumbnail {
    source_width: u32,
    source_height: u32,
    thumbnail_path: PathBuf,
    thumbnail_width: u32,
    thumbnail_height: u32,
    thumbnail_size_bytes: u64,
}

struct MarkdownLink {
    target_ref: String,
    target_subpath: Option<String>,
    relation_type: &'static str,
    target_kind_hint: Option<String>,
    source_span_start: usize,
    source_span_end: usize,
}

struct ResolvedLink {
    target_asset_id: Option<String>,
    resolved_status: &'static str,
}

fn main() {
    if let Err(error) = run() {
        emit_event("error", &[("message", JsonValue::String(error))]);
        std::process::exit(1);
    }
}

fn run() -> Result<(), String> {
    let config = parse_args(env::args().skip(1).collect())?;

    if !config.root_path.is_dir() {
        return Err(format!(
            "root path is not a directory: {}",
            config.root_path.display()
        ));
    }

    if matches!(config.command, CommandKind::Thumbnails) {
        return run_thumbnail_generation(&config);
    }

    let started_at = now_ms();
    let run_id = format!(
        "sync_run_{}_{:x}",
        started_at,
        stable_hash(&format!(
            "{}:{}:{}",
            config.vault_id,
            config.root_path.display(),
            config.command.as_str()
        ))
    );

    start_sync_run(&config, &run_id, started_at)?;
    emit_event(
        "started",
        &[
            ("runId", JsonValue::String(run_id.clone())),
            (
                "command",
                JsonValue::String(config.command.as_str().to_string()),
            ),
            ("vaultId", JsonValue::String(config.vault_id.clone())),
            (
                "rootPath",
                JsonValue::String(config.root_path.display().to_string()),
            ),
        ],
    );

    if matches!(config.command, CommandKind::Watch) {
        emit_event(
            "progress",
            &[
                ("runId", JsonValue::String(run_id.clone())),
                ("phase", JsonValue::String("watch_snapshot".to_string())),
            ],
        );
    }

    let mut entries = collect_files(&config, &run_id)?;
    let moved_count = reconcile_entries(&config, &mut entries)?;
    write_index(&config, &run_id, started_at, &entries)?;

    let completed_at = now_ms();
    complete_sync_run(
        &config,
        &run_id,
        started_at,
        completed_at,
        entries.len() as i64,
        moved_count as i64,
    )?;

    emit_event(
        "completed",
        &[
            ("runId", JsonValue::String(run_id)),
            ("filesSeen", JsonValue::Number(entries.len() as i64)),
            ("filesMoved", JsonValue::Number(moved_count as i64)),
            ("durationMs", JsonValue::Number(completed_at - started_at)),
        ],
    );

    Ok(())
}

fn parse_args(args: Vec<String>) -> Result<Config, String> {
    if args.iter().any(|arg| arg == "-h" || arg == "--help") {
        print_help();
        std::process::exit(0);
    }

    let command = args
        .first()
        .and_then(|value| CommandKind::from_str(value))
        .ok_or_else(|| "expected command: scan, reconcile, or watch".to_string())?;

    let mut vault_id = None;
    let mut root_path = None;
    let mut db_path = None;
    let mut thumbnail_root = None;
    let mut asset_ids = Vec::new();
    let mut limit = None;
    let mut index = 1;

    while index < args.len() {
        let flag = &args[index];
        let value = args
            .get(index + 1)
            .ok_or_else(|| format!("missing value for {flag}"))?;

        match flag.as_str() {
            "--vault-id" => vault_id = Some(value.clone()),
            "--root-path" => root_path = Some(PathBuf::from(value)),
            "--db-path" => db_path = Some(PathBuf::from(value)),
            "--thumbnail-root" => thumbnail_root = Some(PathBuf::from(value)),
            "--asset-ids" => {
                asset_ids = value
                    .split(',')
                    .map(str::trim)
                    .filter(|asset_id| !asset_id.is_empty())
                    .map(ToString::to_string)
                    .collect();
            }
            "--limit" => {
                limit = Some(
                    value
                        .parse::<usize>()
                        .map_err(|error| format!("invalid --limit value {value}: {error}"))?,
                );
            }
            _ => return Err(format!("unknown argument: {flag}")),
        }

        index += 2;
    }

    Ok(Config {
        command,
        vault_id: vault_id.ok_or_else(|| "missing --vault-id".to_string())?,
        root_path: root_path.ok_or_else(|| "missing --root-path".to_string())?,
        db_path: db_path.ok_or_else(|| "missing --db-path".to_string())?,
        thumbnail_root,
        asset_ids,
        limit,
    })
}

fn print_help() {
    println!(
        "\
post-indexer

Usage:
  post-indexer scan --vault-id <id> --root-path <path> --db-path <path>
  post-indexer reconcile --vault-id <id> --root-path <path> --db-path <path>
  post-indexer watch --vault-id <id> --root-path <path> --db-path <path>
  post-indexer thumbnails --vault-id <id> --root-path <path> --db-path <path> --thumbnail-root <path> [--asset-ids <id,id>] [--limit <n>]

The first version treats watch as a snapshot scan entrypoint. A persistent
file-system watcher can replace it without changing the NDJSON contract."
    );
}

fn collect_files(config: &Config, run_id: &str) -> Result<Vec<FileEntry>, String> {
    let mut entries = Vec::new();
    let mut stack = vec![config.root_path.clone()];

    while let Some(dir) = stack.pop() {
        let read_dir = fs::read_dir(&dir)
            .map_err(|error| format!("failed to read directory {}: {error}", dir.display()))?;

        for item in read_dir {
            let item = item.map_err(|error| format!("failed to read directory item: {error}"))?;
            let path = item.path();
            let file_name = item.file_name();

            if should_skip(&file_name) {
                continue;
            }

            let metadata = item
                .metadata()
                .map_err(|error| format!("failed to stat {}: {error}", path.display()))?;

            if metadata.is_dir() {
                stack.push(path);
                continue;
            }

            if !metadata.is_file() {
                continue;
            }

            let relative_path = relative_path(&config.root_path, &path)?;
            let extension = path
                .extension()
                .and_then(OsStr::to_str)
                .map(|value| value.to_ascii_lowercase());
            let kind = kind_for_extension(extension.as_deref()).to_string();
            let file_name = path
                .file_name()
                .and_then(OsStr::to_str)
                .ok_or_else(|| format!("file name is not valid UTF-8: {}", path.display()))?
                .to_string();
            let title = path
                .file_stem()
                .and_then(OsStr::to_str)
                .unwrap_or(&file_name)
                .to_string();
            let mtime_ms = metadata.modified().ok().map(system_time_ms).unwrap_or(0);
            let ctime_ms = metadata.created().ok().map(system_time_ms);
            let quick_fingerprint = format!(
                "{}:{}:{}",
                metadata.len(),
                mtime_ms,
                extension.as_deref().unwrap_or("")
            );
            let asset_id =
                deterministic_id("asset", &format!("{}\0{}", config.vault_id, relative_path));
            let file_id = deterministic_id(
                "asset_file",
                &format!("{}\0{}", config.vault_id, relative_path),
            );

            entries.push(FileEntry {
                asset_id,
                file_id,
                moved_from: None,
                conflict_candidates: Vec::new(),
                relative_path,
                file_name,
                extension,
                kind,
                title,
                size_bytes: metadata.len(),
                mtime_ms,
                ctime_ms,
                quick_fingerprint,
            });

            if entries.len() % 500 == 0 {
                emit_event(
                    "progress",
                    &[
                        ("runId", JsonValue::String(run_id.to_string())),
                        ("phase", JsonValue::String("stat".to_string())),
                        ("filesSeen", JsonValue::Number(entries.len() as i64)),
                    ],
                );
            }
        }
    }

    entries.sort_by(|left, right| left.relative_path.cmp(&right.relative_path));

    emit_event(
        "progress",
        &[
            ("runId", JsonValue::String(run_id.to_string())),
            ("phase", JsonValue::String("stat_complete".to_string())),
            ("filesSeen", JsonValue::Number(entries.len() as i64)),
        ],
    );

    Ok(entries)
}

fn run_thumbnail_generation(config: &Config) -> Result<(), String> {
    let started_at = now_ms();
    let thumbnail_root = config
        .thumbnail_root
        .as_ref()
        .ok_or_else(|| "missing --thumbnail-root".to_string())?;
    fs::create_dir_all(thumbnail_root).map_err(|error| {
        format!(
            "failed to create thumbnail root {}: {error}",
            thumbnail_root.display()
        )
    })?;

    let targets = load_thumbnail_targets(config)?;
    emit_event(
        "started",
        &[
            ("command", JsonValue::String("thumbnails".to_string())),
            ("vaultId", JsonValue::String(config.vault_id.clone())),
            ("requested", JsonValue::Number(targets.len() as i64)),
        ],
    );

    let mut sql = String::from("BEGIN;\n");
    let mut pending_sql_rows = 0usize;
    let mut ready_count = 0;
    let mut cached_count = 0;
    let mut failed_count = 0;

    for target in targets {
        if thumbnail_cache_matches(&target) {
            cached_count += 1;
            emit_event(
                "thumbnail_cached",
                &[("assetId", JsonValue::String(target.asset_id.clone()))],
            );
            continue;
        }

        match generate_thumbnail(config, &target, thumbnail_root) {
            Ok(generated) => {
                ready_count += 1;
                push_image_cache_ready_sql(&mut sql, config, &target, &generated, now_ms());
                pending_sql_rows += 1;
                emit_event(
                    "thumbnail_ready",
                    &[
                        ("assetId", JsonValue::String(target.asset_id.clone())),
                        ("width", JsonValue::Number(generated.source_width as i64)),
                        ("height", JsonValue::Number(generated.source_height as i64)),
                        (
                            "thumbnailWidth",
                            JsonValue::Number(generated.thumbnail_width as i64),
                        ),
                        (
                            "thumbnailHeight",
                            JsonValue::Number(generated.thumbnail_height as i64),
                        ),
                    ],
                );
            }
            Err(error) => {
                failed_count += 1;
                push_image_cache_failed_sql(
                    &mut sql,
                    config,
                    &target,
                    &truncate_error(&error),
                    now_ms(),
                );
                pending_sql_rows += 1;
                emit_event(
                    "thumbnail_failed",
                    &[
                        ("assetId", JsonValue::String(target.asset_id.clone())),
                        ("message", JsonValue::String(error)),
                    ],
                );
            }
        }

        if pending_sql_rows >= THUMBNAIL_DB_FLUSH_BATCH {
            flush_thumbnail_sql(config, &mut sql, &mut pending_sql_rows)?;
        }
    }

    flush_thumbnail_sql(config, &mut sql, &mut pending_sql_rows)?;

    emit_event(
        "completed",
        &[
            ("command", JsonValue::String("thumbnails".to_string())),
            ("ready", JsonValue::Number(ready_count)),
            ("cached", JsonValue::Number(cached_count)),
            ("failed", JsonValue::Number(failed_count)),
            ("durationMs", JsonValue::Number(now_ms() - started_at)),
        ],
    );

    Ok(())
}

fn flush_thumbnail_sql(
    config: &Config,
    sql: &mut String,
    pending_sql_rows: &mut usize,
) -> Result<(), String> {
    if *pending_sql_rows == 0 {
        return Ok(());
    }

    sql.push_str("COMMIT;\n");
    run_sqlite(&config.db_path, sql)?;
    sql.clear();
    sql.push_str("BEGIN;\n");
    *pending_sql_rows = 0;
    Ok(())
}

fn load_thumbnail_targets(config: &Config) -> Result<Vec<ThumbnailTarget>, String> {
    let asset_filter = if config.asset_ids.is_empty() {
        String::new()
    } else {
        format!(
            "AND af.asset_id IN ({})",
            config
                .asset_ids
                .iter()
                .map(|asset_id| sql_text(asset_id))
                .collect::<Vec<_>>()
                .join(", ")
        )
    };
    let limit_clause = config
        .limit
        .map(|limit| format!("LIMIT {}", limit.min(500)))
        .unwrap_or_default();
    let sql = format!(
        "\
SELECT
  af.asset_id,
  af.id,
  af.relative_path,
  COALESCE(af.extension, ''),
  af.size_bytes,
  af.mtime_ms,
  COALESCE(af.quick_fingerprint, ''),
  COALESCE(ic.status, ''),
  COALESCE(ic.thumbnail_path, ''),
  COALESCE(ic.source_size_bytes, -1),
  COALESCE(ic.source_mtime_ms, -1),
  COALESCE(ic.source_quick_fingerprint, '')
FROM asset_files af
INNER JOIN assets a ON a.id = af.asset_id
LEFT JOIN image_cache ic ON ic.asset_id = af.asset_id
WHERE af.vault_id = {}
  AND af.file_exists = 1
  AND a.kind = 'image'
  {asset_filter}
ORDER BY af.mtime_ms DESC
{limit_clause};\n",
        sql_text(&config.vault_id),
    );
    let output = query_sqlite(&config.db_path, &sql)?;
    let mut targets = Vec::new();

    for line in output.lines().filter(|line| !line.trim().is_empty()) {
        let columns: Vec<_> = line.split('\t').collect();
        if columns.len() != 12 {
            return Err(format!(
                "unexpected sqlite row while loading thumbnail targets: {line}"
            ));
        }

        targets.push(ThumbnailTarget {
            asset_id: columns[0].to_string(),
            file_id: columns[1].to_string(),
            relative_path: columns[2].to_string(),
            extension: none_if_empty(columns[3]),
            size_bytes: parse_u64(columns[4], "size_bytes")?,
            mtime_ms: parse_i64(columns[5], "mtime_ms")?,
            quick_fingerprint: columns[6].to_string(),
            cache_status: none_if_empty(columns[7]),
            cached_thumbnail_path: none_if_empty(columns[8]),
            cached_source_size_bytes: parse_optional_u64(columns[9])?,
            cached_source_mtime_ms: parse_optional_i64(columns[10])?,
            cached_source_quick_fingerprint: none_if_empty(columns[11]),
        });
    }

    if config.asset_ids.is_empty() {
        targets.retain(thumbnail_generation_needed);
    }

    Ok(targets)
}

fn thumbnail_cache_matches(target: &ThumbnailTarget) -> bool {
    if target.cache_status.as_deref() != Some("ready") {
        return false;
    }

    let Some(path) = target.cached_thumbnail_path.as_deref() else {
        return false;
    };

    Path::new(path).is_file()
        && target.cached_source_size_bytes == Some(target.size_bytes)
        && target.cached_source_mtime_ms == Some(target.mtime_ms)
        && target.cached_source_quick_fingerprint.as_deref() == Some(&target.quick_fingerprint)
}

fn thumbnail_source_matches(target: &ThumbnailTarget) -> bool {
    target.cached_source_size_bytes == Some(target.size_bytes)
        && target.cached_source_mtime_ms == Some(target.mtime_ms)
        && target.cached_source_quick_fingerprint.as_deref() == Some(&target.quick_fingerprint)
}

fn thumbnail_generation_needed(target: &ThumbnailTarget) -> bool {
    match target.cache_status.as_deref() {
        Some("ready") => !thumbnail_cache_matches(target),
        Some("failed") => !thumbnail_source_matches(target),
        _ => true,
    }
}

fn generate_thumbnail(
    config: &Config,
    target: &ThumbnailTarget,
    thumbnail_root: &Path,
) -> Result<GeneratedThumbnail, String> {
    if !is_supported_thumbnail_extension(target.extension.as_deref()) {
        return Err(format!(
            "unsupported image format for thumbnail: {}",
            target.extension.as_deref().unwrap_or("unknown")
        ));
    }

    let source_path = config.root_path.join(&target.relative_path);
    let image = ImageReader::open(&source_path)
        .map_err(|error| format!("failed to open image {}: {error}", source_path.display()))?
        .with_guessed_format()
        .map_err(|error| {
            format!(
                "failed to detect image format {}: {error}",
                source_path.display()
            )
        })?
        .decode()
        .map_err(|error| format!("failed to decode image {}: {error}", source_path.display()))?;
    let (source_width, source_height) = image.dimensions();
    let thumbnail = image.resize(
        THUMBNAIL_LONG_EDGE,
        THUMBNAIL_LONG_EDGE,
        FilterType::Triangle,
    );
    let rgb = thumbnail.to_rgb8();
    let (thumbnail_width, thumbnail_height) = rgb.dimensions();

    let vault_dir = thumbnail_root.join(&config.vault_id);
    fs::create_dir_all(&vault_dir).map_err(|error| {
        format!(
            "failed to create thumbnail dir {}: {error}",
            vault_dir.display()
        )
    })?;
    let thumbnail_path = vault_dir.join(format!(
        "{}-{:016x}.jpg",
        target.asset_id,
        stable_hash(&target.quick_fingerprint)
    ));
    let mut file = File::create(&thumbnail_path).map_err(|error| {
        format!(
            "failed to create thumbnail {}: {error}",
            thumbnail_path.display()
        )
    })?;
    let mut encoder = JpegEncoder::new_with_quality(&mut file, THUMBNAIL_JPEG_QUALITY);
    encoder
        .encode(
            &rgb,
            thumbnail_width,
            thumbnail_height,
            image::ExtendedColorType::Rgb8,
        )
        .map_err(|error| {
            format!(
                "failed to encode thumbnail {}: {error}",
                thumbnail_path.display()
            )
        })?;
    let thumbnail_size_bytes = fs::metadata(&thumbnail_path)
        .map_err(|error| {
            format!(
                "failed to stat thumbnail {}: {error}",
                thumbnail_path.display()
            )
        })?
        .len();

    Ok(GeneratedThumbnail {
        source_width,
        source_height,
        thumbnail_path,
        thumbnail_width,
        thumbnail_height,
        thumbnail_size_bytes,
    })
}

fn is_supported_thumbnail_extension(extension: Option<&str>) -> bool {
    matches!(
        extension.unwrap_or(""),
        "bmp" | "gif" | "ico" | "jpg" | "jpeg" | "png" | "tif" | "tiff" | "webp"
    )
}

fn reconcile_entries(config: &Config, entries: &mut [FileEntry]) -> Result<usize, String> {
    let existing_files = load_existing_files(config)?;
    let current_paths = entries
        .iter()
        .map(|entry| entry.relative_path.to_ascii_lowercase())
        .collect::<HashSet<_>>();
    let by_path: HashMap<String, ExistingFile> = existing_files
        .iter()
        .map(|file| (file.relative_path.to_ascii_lowercase(), file.clone()))
        .collect();
    let mut by_fingerprint = HashMap::<String, Vec<ExistingFile>>::new();

    for file in existing_files {
        let Some(fingerprint) = file.quick_fingerprint.as_ref() else {
            continue;
        };

        let absent_from_current_scan =
            !current_paths.contains(&file.relative_path.to_ascii_lowercase());

        if !file.file_exists || absent_from_current_scan {
            by_fingerprint
                .entry(fingerprint.clone())
                .or_default()
                .push(file);
        }
    }

    let mut moved_count = 0;

    for entry in entries {
        if let Some(existing) = by_path.get(&entry.relative_path.to_ascii_lowercase()) {
            entry.asset_id = existing.asset_id.clone();
            entry.file_id = existing.file_id.clone();
            continue;
        }

        let Some(candidates) = by_fingerprint.get(&entry.quick_fingerprint) else {
            continue;
        };

        if let [existing] = candidates.as_slice() {
            entry.asset_id = existing.asset_id.clone();
            entry.file_id = existing.file_id.clone();
            entry.moved_from = Some(existing.relative_path.clone());
            moved_count += 1;
        } else if candidates.len() > 1 {
            entry.conflict_candidates = candidates
                .iter()
                .map(|candidate| candidate.relative_path.clone())
                .collect();
        }
    }

    Ok(moved_count)
}

fn load_existing_files(config: &Config) -> Result<Vec<ExistingFile>, String> {
    let sql = format!(
        "\
SELECT id, asset_id, relative_path, COALESCE(quick_fingerprint, ''), file_exists
FROM asset_files
WHERE vault_id = {}
ORDER BY relative_path;\n",
        sql_text(&config.vault_id)
    );
    let output = query_sqlite(&config.db_path, &sql)?;
    let mut files = Vec::new();

    for line in output.lines().filter(|line| !line.trim().is_empty()) {
        let columns: Vec<_> = line.split('\t').collect();
        if columns.len() != 5 {
            return Err(format!("unexpected sqlite row while loading files: {line}"));
        }

        files.push(ExistingFile {
            file_id: columns[0].to_string(),
            asset_id: columns[1].to_string(),
            relative_path: columns[2].to_string(),
            quick_fingerprint: if columns[3].is_empty() {
                None
            } else {
                Some(columns[3].to_string())
            },
            file_exists: columns[4] == "1",
        });
    }

    Ok(files)
}

fn write_index(
    config: &Config,
    run_id: &str,
    started_at: i64,
    entries: &[FileEntry],
) -> Result<(), String> {
    let mut sql = String::from("BEGIN;\n");
    let mut asset_by_path = HashMap::new();
    let mut asset_by_basename = HashMap::<String, Vec<String>>::new();

    for entry in entries {
        asset_by_path.insert(
            entry.relative_path.to_ascii_lowercase(),
            entry.asset_id.clone(),
        );
        asset_by_basename
            .entry(entry.file_name.to_ascii_lowercase())
            .or_default()
            .push(entry.asset_id.clone());

        if let Some(stem) = Path::new(&entry.file_name)
            .file_stem()
            .and_then(OsStr::to_str)
        {
            asset_by_basename
                .entry(stem.to_ascii_lowercase())
                .or_default()
                .push(entry.asset_id.clone());
        }

        if entry.kind == "markdown" {
            let markdown_path = config.root_path.join(&entry.relative_path);
            if let Ok(content) = fs::read_to_string(markdown_path) {
                if let Some(title) = markdown_title(&content) {
                    asset_by_basename
                        .entry(title.to_ascii_lowercase())
                        .or_default()
                        .push(entry.asset_id.clone());
                }
            }
        }
    }

    for entry in entries {
        push_asset_sql(&mut sql, config, entry, started_at);
        push_asset_file_sql(&mut sql, config, entry, started_at);

        if let Some(moved_from) = entry.moved_from.as_deref() {
            push_sync_event_sql(
                &mut sql,
                config,
                run_id,
                Some(&entry.asset_id),
                "moved",
                Some(moved_from),
                Some(&entry.relative_path),
                Some(0.86),
                &format!(
                    "{{\"strategy\":\"quick_fingerprint\",\"quickFingerprint\":{}}}",
                    json_quote(&entry.quick_fingerprint)
                ),
                started_at,
            );
        } else if !entry.conflict_candidates.is_empty() {
            push_sync_event_sql(
                &mut sql,
                config,
                run_id,
                Some(&entry.asset_id),
                "conflict",
                None,
                Some(&entry.relative_path),
                Some(0.5),
                &format!(
                    "{{\"strategy\":\"quick_fingerprint\",\"reason\":\"multiple_candidates\",\"candidates\":{}}}",
                    json_array(&entry.conflict_candidates)
                ),
                started_at,
            );
        }
    }

    for entry in entries.iter().filter(|entry| entry.kind == "markdown") {
        let markdown_path = config.root_path.join(&entry.relative_path);
        let content = match fs::read_to_string(&markdown_path) {
            Ok(content) => content,
            Err(error) => {
                push_markdown_cache_sql(&mut sql, config, entry, "failed", None, 0, 0, started_at);
                push_sync_event_sql(
                    &mut sql,
                    config,
                    run_id,
                    Some(&entry.asset_id),
                    "updated",
                    None,
                    Some(&entry.relative_path),
                    None,
                    &format!(
                        "{{\"phase\":\"markdown_parse\",\"status\":\"failed\",\"message\":{}}}",
                        json_quote(&error.to_string())
                    ),
                    started_at,
                );
                continue;
            }
        };

        let links = parse_markdown_links(&content);
        let title = markdown_title(&content).or_else(|| Some(entry.title.clone()));
        push_markdown_cache_sql(
            &mut sql,
            config,
            entry,
            "parsed",
            title.as_deref(),
            word_count(&content),
            links.len(),
            started_at,
        );
        sql.push_str(&format!(
            "DELETE FROM asset_links WHERE source_asset_id = {} AND created_from = 'markdown_parse';\n",
            sql_text(&entry.asset_id)
        ));

        for link in links {
            let resolved = resolve_link(entry, &link, &asset_by_path, &asset_by_basename);
            push_asset_link_sql(&mut sql, config, entry, &link, &resolved, started_at);
        }
    }

    sql.push_str(&format!(
        "UPDATE asset_files SET file_exists = 0, missing_since = COALESCE(missing_since, {started_at}) WHERE vault_id = {} AND last_seen_at < {started_at} AND file_exists = 1;\n",
        sql_text(&config.vault_id)
    ));
    sql.push_str("COMMIT;\n");

    run_sqlite(&config.db_path, &sql)?;
    Ok(())
}

fn start_sync_run(config: &Config, run_id: &str, started_at: i64) -> Result<(), String> {
    let vault_name = config
        .root_path
        .file_name()
        .and_then(OsStr::to_str)
        .unwrap_or("Vault");
    let sql = format!(
        "\
INSERT INTO vaults (
  id, name, root_path, created_at, updated_at, last_opened_at,
  last_sync_started_at, sync_status
) VALUES (
  {}, {}, {}, {started_at}, {started_at}, {started_at}, {started_at}, 'syncing'
)
ON CONFLICT(id) DO UPDATE SET
  name = excluded.name,
  root_path = excluded.root_path,
  updated_at = excluded.updated_at,
  last_opened_at = excluded.last_opened_at,
  last_sync_started_at = excluded.last_sync_started_at,
  sync_status = 'syncing';

INSERT INTO sync_runs (
  id, vault_id, reason, status, owner, indexer_version, parser_version,
  started_at, files_seen, files_added, files_updated, files_moved, files_missing
) VALUES (
  {}, {}, {}, 'running', 'rust_indexer', {}, {}, {}, 0, 0, 0, 0, 0
)
ON CONFLICT(id) DO UPDATE SET
  status = 'running',
  started_at = excluded.started_at,
  completed_at = NULL,
  error_message = NULL;\n",
        sql_text(&config.vault_id),
        sql_text(vault_name),
        sql_text(&config.root_path.display().to_string()),
        sql_text(run_id),
        sql_text(&config.vault_id),
        sql_text(config.command.reason()),
        sql_text(INDEXER_VERSION),
        sql_text(PARSER_VERSION),
        started_at,
    );

    run_sqlite(&config.db_path, &sql)
}

fn complete_sync_run(
    config: &Config,
    run_id: &str,
    started_at: i64,
    completed_at: i64,
    files_seen: i64,
    files_moved: i64,
) -> Result<(), String> {
    let sql = format!(
        "\
UPDATE sync_runs
SET status = 'completed',
    completed_at = {completed_at},
    duration_ms = {},
    files_seen = {files_seen},
    files_moved = {files_moved}
WHERE id = {};

UPDATE vaults
SET updated_at = {completed_at},
    last_sync_completed_at = {completed_at},
    sync_status = 'idle'
WHERE id = {};\n",
        completed_at - started_at,
        sql_text(run_id),
        sql_text(&config.vault_id)
    );

    run_sqlite(&config.db_path, &sql)
}

fn push_asset_sql(sql: &mut String, config: &Config, entry: &FileEntry, now: i64) {
    sql.push_str(&format!(
        "\
INSERT INTO assets (
  id, vault_id, kind, status, privacy, title, description, created_at, updated_at, indexed_at
) VALUES (
  {}, {}, {}, 'inbox', 'normal', {}, NULL, {now}, {now}, {now}
)
ON CONFLICT(id) DO UPDATE SET
  kind = excluded.kind,
  title = excluded.title,
  updated_at = excluded.updated_at,
  indexed_at = excluded.indexed_at,
  deleted_at = NULL;\n",
        sql_text(&entry.asset_id),
        sql_text(&config.vault_id),
        sql_text(&entry.kind),
        sql_text(&entry.title),
    ));
}

fn push_asset_file_sql(sql: &mut String, config: &Config, entry: &FileEntry, now: i64) {
    sql.push_str(&format!(
        "\
INSERT INTO asset_files (
  id, asset_id, vault_id, relative_path, file_name, extension, mime_type,
  size_bytes, mtime_ms, ctime_ms, content_hash, quick_fingerprint, file_exists,
  missing_since, first_seen_at, last_seen_at
) VALUES (
  {}, {}, {}, {}, {}, {}, NULL, {}, {}, {}, NULL, {}, 1, NULL, {now}, {now}
)
ON CONFLICT(id) DO UPDATE SET
  relative_path = excluded.relative_path,
  file_name = excluded.file_name,
  extension = excluded.extension,
  size_bytes = excluded.size_bytes,
  mtime_ms = excluded.mtime_ms,
  ctime_ms = excluded.ctime_ms,
  quick_fingerprint = excluded.quick_fingerprint,
  file_exists = 1,
  missing_since = NULL,
  last_seen_at = excluded.last_seen_at;\n",
        sql_text(&entry.file_id),
        sql_text(&entry.asset_id),
        sql_text(&config.vault_id),
        sql_text(&entry.relative_path),
        sql_text(&entry.file_name),
        sql_nullable(entry.extension.as_deref()),
        entry.size_bytes,
        entry.mtime_ms,
        sql_nullable_i64(entry.ctime_ms),
        sql_text(&entry.quick_fingerprint),
    ));
}

fn push_image_cache_ready_sql(
    sql: &mut String,
    config: &Config,
    target: &ThumbnailTarget,
    generated: &GeneratedThumbnail,
    now: i64,
) {
    sql.push_str(&format!(
        "\
INSERT INTO image_cache (
  asset_id, vault_id, file_id, width, height, thumbnail_path, thumbnail_width,
  thumbnail_height, thumbnail_size_bytes, thumbnail_format, source_size_bytes,
  source_mtime_ms, source_quick_fingerprint, status, error_message, generated_at, updated_at
) VALUES (
  {}, {}, {}, {}, {}, {}, {}, {}, {}, 'jpeg', {}, {}, {}, 'ready', NULL, {now}, {now}
)
ON CONFLICT(asset_id) DO UPDATE SET
  vault_id = excluded.vault_id,
  file_id = excluded.file_id,
  width = excluded.width,
  height = excluded.height,
  thumbnail_path = excluded.thumbnail_path,
  thumbnail_width = excluded.thumbnail_width,
  thumbnail_height = excluded.thumbnail_height,
  thumbnail_size_bytes = excluded.thumbnail_size_bytes,
  thumbnail_format = excluded.thumbnail_format,
  source_size_bytes = excluded.source_size_bytes,
  source_mtime_ms = excluded.source_mtime_ms,
  source_quick_fingerprint = excluded.source_quick_fingerprint,
  status = 'ready',
  error_message = NULL,
  generated_at = excluded.generated_at,
  updated_at = excluded.updated_at;\n",
        sql_text(&target.asset_id),
        sql_text(&config.vault_id),
        sql_text(&target.file_id),
        generated.source_width,
        generated.source_height,
        sql_text(&generated.thumbnail_path.display().to_string()),
        generated.thumbnail_width,
        generated.thumbnail_height,
        generated.thumbnail_size_bytes,
        target.size_bytes,
        target.mtime_ms,
        sql_text(&target.quick_fingerprint),
    ));
}

fn push_image_cache_failed_sql(
    sql: &mut String,
    config: &Config,
    target: &ThumbnailTarget,
    error_message: &str,
    now: i64,
) {
    sql.push_str(&format!(
        "\
INSERT INTO image_cache (
  asset_id, vault_id, file_id, source_size_bytes, source_mtime_ms,
  source_quick_fingerprint, status, error_message, updated_at
) VALUES (
  {}, {}, {}, {}, {}, {}, 'failed', {}, {now}
)
ON CONFLICT(asset_id) DO UPDATE SET
  vault_id = excluded.vault_id,
  file_id = excluded.file_id,
  source_size_bytes = excluded.source_size_bytes,
  source_mtime_ms = excluded.source_mtime_ms,
  source_quick_fingerprint = excluded.source_quick_fingerprint,
  status = 'failed',
  error_message = excluded.error_message,
  updated_at = excluded.updated_at;\n",
        sql_text(&target.asset_id),
        sql_text(&config.vault_id),
        sql_text(&target.file_id),
        target.size_bytes,
        target.mtime_ms,
        sql_text(&target.quick_fingerprint),
        sql_text(error_message),
    ));
}

fn push_markdown_cache_sql(
    sql: &mut String,
    config: &Config,
    entry: &FileEntry,
    parse_status: &str,
    title: Option<&str>,
    word_count: usize,
    outbound_link_count: usize,
    now: i64,
) {
    sql.push_str(&format!(
        "\
INSERT INTO markdown_cache (
  asset_id, vault_id, title, excerpt, word_count, headings_json,
  outbound_link_count, inbound_link_count, parse_status, parsed_at, parser_version
) VALUES (
  {}, {}, {}, NULL, {}, '[]', {}, 0, {}, {now}, {}
)
ON CONFLICT(asset_id) DO UPDATE SET
  title = excluded.title,
  word_count = excluded.word_count,
  outbound_link_count = excluded.outbound_link_count,
  parse_status = excluded.parse_status,
  parsed_at = excluded.parsed_at,
  parser_version = excluded.parser_version;\n",
        sql_text(&entry.asset_id),
        sql_text(&config.vault_id),
        sql_nullable(title),
        word_count,
        outbound_link_count,
        sql_text(parse_status),
        sql_text(PARSER_VERSION),
    ));
}

fn push_asset_link_sql(
    sql: &mut String,
    config: &Config,
    source: &FileEntry,
    link: &MarkdownLink,
    resolved: &ResolvedLink,
    now: i64,
) {
    let link_id = deterministic_id(
        "asset_link",
        &format!(
            "{}\0{}\0{}\0{}",
            source.asset_id, link.source_span_start, link.relation_type, link.target_ref
        ),
    );

    sql.push_str(&format!(
        "\
INSERT INTO asset_links (
  id, vault_id, source_asset_id, target_asset_id, target_ref, target_subpath,
  relation_type, target_kind_hint, resolved_status, source_span_start, source_span_end,
  created_from, discovered_at, updated_at
) VALUES (
  {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, 'markdown_parse', {now}, {now}
);\n",
        sql_text(&link_id),
        sql_text(&config.vault_id),
        sql_text(&source.asset_id),
        sql_nullable(resolved.target_asset_id.as_deref()),
        sql_text(&link.target_ref),
        sql_nullable(link.target_subpath.as_deref()),
        sql_text(link.relation_type),
        sql_nullable(link.target_kind_hint.as_deref()),
        sql_text(resolved.resolved_status),
        link.source_span_start,
        link.source_span_end,
    ));
}

fn push_sync_event_sql(
    sql: &mut String,
    config: &Config,
    run_id: &str,
    asset_id: Option<&str>,
    event_type: &str,
    old_relative_path: Option<&str>,
    new_relative_path: Option<&str>,
    confidence: Option<f64>,
    detail_json: &str,
    now: i64,
) {
    let event_id = deterministic_id(
        "sync_event",
        &format!(
            "{}\0{}\0{}\0{}",
            run_id,
            asset_id.unwrap_or(""),
            event_type,
            detail_json
        ),
    );

    sql.push_str(&format!(
        "\
INSERT INTO sync_events (
  id, sync_run_id, vault_id, asset_id, event_type, old_relative_path,
  new_relative_path, confidence, detail_json, created_at
) VALUES (
  {}, {}, {}, {}, {}, {}, {}, {}, {}, {now}
)
ON CONFLICT(id) DO NOTHING;\n",
        sql_text(&event_id),
        sql_text(run_id),
        sql_text(&config.vault_id),
        sql_nullable(asset_id),
        sql_text(event_type),
        sql_nullable(old_relative_path),
        sql_nullable(new_relative_path),
        confidence
            .map(|value| value.to_string())
            .unwrap_or_else(|| "NULL".to_string()),
        sql_text(detail_json),
    ));
}

fn run_sqlite(db_path: &Path, sql: &str) -> Result<(), String> {
    let mut child = Command::new("sqlite3")
        .arg(db_path)
        .stdin(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("failed to start sqlite3: {error}"))?;

    child
        .stdin
        .as_mut()
        .ok_or_else(|| "failed to open sqlite3 stdin".to_string())?
        .write_all(format!("PRAGMA foreign_keys = ON;\n{sql}").as_bytes())
        .map_err(|error| format!("failed to write sqlite3 SQL: {error}"))?;

    let output = child
        .wait_with_output()
        .map_err(|error| format!("failed to wait for sqlite3: {error}"))?;

    if !output.status.success() {
        return Err(format!(
            "sqlite3 failed: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    Ok(())
}

fn query_sqlite(db_path: &Path, sql: &str) -> Result<String, String> {
    let output = Command::new("sqlite3")
        .arg("-separator")
        .arg("\t")
        .arg(db_path)
        .arg(format!("PRAGMA foreign_keys = ON;\n{sql}"))
        .output()
        .map_err(|error| format!("failed to query sqlite3: {error}"))?;

    if !output.status.success() {
        return Err(format!(
            "sqlite3 query failed: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

fn resolve_link(
    source: &FileEntry,
    link: &MarkdownLink,
    asset_by_path: &HashMap<String, String>,
    asset_by_basename: &HashMap<String, Vec<String>>,
) -> ResolvedLink {
    if is_external_url(&link.target_ref) {
        return ResolvedLink {
            target_asset_id: None,
            resolved_status: "resolved",
        };
    }

    let ref_without_alias = link
        .target_ref
        .split_once('|')
        .map(|(target, _alias)| target)
        .unwrap_or(&link.target_ref);
    let ref_path = ref_without_alias
        .split_once('#')
        .map(|(target, _subpath)| target)
        .unwrap_or(ref_without_alias)
        .trim();

    if ref_path.is_empty() {
        return ResolvedLink {
            target_asset_id: None,
            resolved_status: "unresolved",
        };
    }

    let mut candidates = Vec::new();

    if ref_path.contains('/') || Path::new(ref_path).extension().is_some() {
        let source_dir = Path::new(&source.relative_path)
            .parent()
            .unwrap_or_else(|| Path::new(""));
        let joined = normalize_relative_path(&source_dir.join(ref_path));
        collect_path_candidate(&mut candidates, asset_by_path, &joined);
        collect_path_candidate(&mut candidates, asset_by_path, ref_path);

        if Path::new(ref_path).extension().is_none() {
            collect_path_candidate(&mut candidates, asset_by_path, &format!("{joined}.md"));
            collect_path_candidate(&mut candidates, asset_by_path, &format!("{ref_path}.md"));
        }
    } else {
        let basename = ref_path.to_ascii_lowercase();
        if let Some(ids) = asset_by_basename.get(&basename) {
            candidates.extend(ids.iter().cloned());
        }

        if let Some(ids) = asset_by_basename.get(&format!("{basename}.md")) {
            candidates.extend(ids.iter().cloned());
        }
    }

    candidates.sort();
    candidates.dedup();

    match candidates.as_slice() {
        [asset_id] => ResolvedLink {
            target_asset_id: Some(asset_id.clone()),
            resolved_status: "resolved",
        },
        [] => ResolvedLink {
            target_asset_id: None,
            resolved_status: "unresolved",
        },
        _ => ResolvedLink {
            target_asset_id: None,
            resolved_status: "ambiguous",
        },
    }
}

fn collect_path_candidate(
    candidates: &mut Vec<String>,
    asset_by_path: &HashMap<String, String>,
    path: &str,
) {
    if let Some(asset_id) = asset_by_path.get(&path.to_ascii_lowercase()) {
        candidates.push(asset_id.clone());
    }
}

fn parse_markdown_links(content: &str) -> Vec<MarkdownLink> {
    let mut links = parse_wiki_links(content);
    links.extend(parse_standard_markdown_links(content));
    links.extend(parse_bare_urls(content));
    links
}

fn parse_wiki_links(content: &str) -> Vec<MarkdownLink> {
    let mut links = Vec::new();
    let mut offset = 0;

    while let Some(start) = content[offset..].find("[[") {
        let absolute_start = offset + start;
        let content_start = absolute_start + 2;
        let Some(end) = content[content_start..].find("]]") else {
            break;
        };
        let absolute_end = content_start + end + 2;
        let raw = content[content_start..content_start + end].trim();

        if !raw.is_empty() {
            let embed = absolute_start > 0 && content.as_bytes()[absolute_start - 1] == b'!';
            links.push(MarkdownLink {
                target_ref: raw.to_string(),
                target_subpath: target_subpath(raw),
                relation_type: if embed { "embed" } else { "wiki_link" },
                target_kind_hint: kind_hint(raw),
                source_span_start: if embed {
                    absolute_start - 1
                } else {
                    absolute_start
                },
                source_span_end: absolute_end,
            });
        }

        offset = absolute_end;
    }

    links
}

fn parse_standard_markdown_links(content: &str) -> Vec<MarkdownLink> {
    let mut links = Vec::new();
    let mut offset = 0;

    while let Some(close_bracket) = content[offset..].find("](") {
        let absolute_close = offset + close_bracket;
        let target_start = absolute_close + 2;
        let Some(target_end_offset) = content[target_start..].find(')') else {
            break;
        };
        let target_end = target_start + target_end_offset;
        let target = content[target_start..target_end].trim();

        if !target.is_empty() && !target.starts_with('#') {
            let open_bracket = content[..absolute_close].rfind('[');
            let image = open_bracket
                .map(|index| index > 0 && content.as_bytes()[index - 1] == b'!')
                .unwrap_or(false);
            let relation_type = if is_external_url(target) {
                "external_url"
            } else if image {
                "markdown_image"
            } else {
                "markdown_link"
            };

            links.push(MarkdownLink {
                target_ref: target.to_string(),
                target_subpath: target_subpath(target),
                relation_type,
                target_kind_hint: kind_hint(target),
                source_span_start: open_bracket.unwrap_or(absolute_close),
                source_span_end: target_end + 1,
            });
        }

        offset = target_end + 1;
    }

    links
}

fn parse_bare_urls(content: &str) -> Vec<MarkdownLink> {
    let mut links = Vec::new();
    let mut offset = 0;

    while offset < content.len() {
        let http = content[offset..].find("http://");
        let https = content[offset..].find("https://");
        let Some(next) = [http, https].into_iter().flatten().min() else {
            break;
        };

        let start = offset + next;
        let end = content[start..]
            .find(|character: char| {
                character.is_whitespace()
                    || matches!(character, ')' | ']' | '}' | '"' | '\'' | '<' | '>')
            })
            .map(|end| start + end)
            .unwrap_or(content.len());
        let target = content[start..end].trim_end_matches(['.', ',', ';', ':']);

        if !target.is_empty() {
            links.push(MarkdownLink {
                target_ref: target.to_string(),
                target_subpath: None,
                relation_type: "external_url",
                target_kind_hint: None,
                source_span_start: start,
                source_span_end: start + target.len(),
            });
        }

        offset = end;
    }

    links
}

fn target_subpath(raw: &str) -> Option<String> {
    let without_alias = raw.split_once('|').map(|(target, _)| target).unwrap_or(raw);
    without_alias
        .split_once('#')
        .map(|(_, subpath)| subpath.trim())
        .filter(|subpath| !subpath.is_empty())
        .map(ToString::to_string)
}

fn kind_hint(raw: &str) -> Option<String> {
    let without_alias = raw.split_once('|').map(|(target, _)| target).unwrap_or(raw);
    let without_subpath = without_alias
        .split_once('#')
        .map(|(target, _)| target)
        .unwrap_or(without_alias);
    let extension = Path::new(without_subpath)
        .extension()
        .and_then(OsStr::to_str)
        .map(|value| value.to_ascii_lowercase());

    Some(kind_for_extension(extension.as_deref()).to_string()).filter(|kind| kind != "other")
}

fn markdown_title(content: &str) -> Option<String> {
    content.lines().find_map(|line| {
        line.strip_prefix("# ")
            .map(str::trim)
            .filter(|title| !title.is_empty())
            .map(ToString::to_string)
    })
}

fn word_count(content: &str) -> usize {
    content.split_whitespace().count()
}

fn should_skip(file_name: &OsStr) -> bool {
    matches!(
        file_name.to_str(),
        Some(".git" | "node_modules" | ".DS_Store")
    )
}

fn kind_for_extension(extension: Option<&str>) -> &'static str {
    match extension.unwrap_or("") {
        "md" | "markdown" => "markdown",
        "png" | "jpg" | "jpeg" | "gif" | "webp" | "avif" | "heic" | "svg" => "image",
        "mp4" | "mov" | "mkv" | "webm" | "avi" => "video",
        "mp3" | "wav" | "m4a" | "flac" | "aac" | "ogg" => "audio",
        "pdf" => "pdf",
        "doc" | "docx" | "rtf" | "txt" => "document",
        "csv" | "xls" | "xlsx" | "tsv" => "spreadsheet",
        "zip" | "tar" | "gz" | "rar" | "7z" => "archive",
        "url" | "webloc" => "web",
        _ => "other",
    }
}

fn is_external_url(value: &str) -> bool {
    value.starts_with("http://") || value.starts_with("https://")
}

fn relative_path(root: &Path, path: &Path) -> Result<String, String> {
    let relative = path
        .strip_prefix(root)
        .map_err(|error| format!("failed to strip root {}: {error}", root.display()))?;
    Ok(normalize_relative_path(relative))
}

fn normalize_relative_path(path: &Path) -> String {
    let mut parts = Vec::new();

    for component in path.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                parts.pop();
            }
            Component::Normal(part) => parts.push(part.to_string_lossy().to_string()),
            _ => {}
        }
    }

    parts.join("/")
}

fn deterministic_id(prefix: &str, value: &str) -> String {
    format!("{prefix}_{:016x}", stable_hash(value))
}

fn stable_hash(value: &str) -> u64 {
    let mut hash = 0xcbf29ce484222325u64;

    for byte in value.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }

    hash
}

fn now_ms() -> i64 {
    system_time_ms(SystemTime::now())
}

fn system_time_ms(value: SystemTime) -> i64 {
    value
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0)
}

fn sql_text(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}

fn sql_nullable(value: Option<&str>) -> String {
    value.map(sql_text).unwrap_or_else(|| "NULL".to_string())
}

fn sql_nullable_i64(value: Option<i64>) -> String {
    value
        .map(|value| value.to_string())
        .unwrap_or_else(|| "NULL".to_string())
}

fn none_if_empty(value: &str) -> Option<String> {
    if value.is_empty() {
        None
    } else {
        Some(value.to_string())
    }
}

fn parse_i64(value: &str, column: &str) -> Result<i64, String> {
    value
        .parse::<i64>()
        .map_err(|error| format!("invalid sqlite integer for {column}: {value}: {error}"))
}

fn parse_u64(value: &str, column: &str) -> Result<u64, String> {
    value
        .parse::<u64>()
        .map_err(|error| format!("invalid sqlite integer for {column}: {value}: {error}"))
}

fn parse_optional_i64(value: &str) -> Result<Option<i64>, String> {
    let parsed = parse_i64(value, "optional integer")?;
    Ok((parsed >= 0).then_some(parsed))
}

fn parse_optional_u64(value: &str) -> Result<Option<u64>, String> {
    let parsed = parse_i64(value, "optional integer")?;
    Ok((parsed >= 0).then_some(parsed as u64))
}

fn truncate_error(value: &str) -> String {
    value.chars().take(500).collect()
}

enum JsonValue {
    String(String),
    Number(i64),
}

fn emit_event(event_type: &str, fields: &[(&str, JsonValue)]) {
    let mut output = format!("{{\"type\":{}", json_quote(event_type));

    for (key, value) in fields {
        output.push(',');
        output.push_str(&json_quote(key));
        output.push(':');
        match value {
            JsonValue::String(value) => output.push_str(&json_quote(value)),
            JsonValue::Number(value) => output.push_str(&value.to_string()),
        }
    }

    output.push('}');
    println!("{output}");
}

fn json_quote(value: &str) -> String {
    let mut quoted = String::from("\"");

    for character in value.chars() {
        match character {
            '"' => quoted.push_str("\\\""),
            '\\' => quoted.push_str("\\\\"),
            '\n' => quoted.push_str("\\n"),
            '\r' => quoted.push_str("\\r"),
            '\t' => quoted.push_str("\\t"),
            character if character.is_control() => {
                quoted.push_str(&format!("\\u{:04x}", character as u32));
            }
            character => quoted.push(character),
        }
    }

    quoted.push('"');
    quoted
}

fn json_array(values: &[String]) -> String {
    let items = values
        .iter()
        .map(|value| json_quote(value))
        .collect::<Vec<_>>()
        .join(",");
    format!("[{items}]")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_wiki_links_and_embeds() {
        let links = parse_markdown_links("See [[Note#Intro|alias]] and ![[clip.mp4]].");

        assert_eq!(links.len(), 2);
        assert_eq!(links[0].relation_type, "wiki_link");
        assert_eq!(links[0].target_ref, "Note#Intro|alias");
        assert_eq!(links[0].target_subpath.as_deref(), Some("Intro"));
        assert_eq!(links[1].relation_type, "embed");
        assert_eq!(links[1].target_kind_hint.as_deref(), Some("video"));
    }

    #[test]
    fn parses_standard_markdown_links() {
        let links =
            parse_markdown_links("[Doc](docs/a.pdf) ![Alt](images/a.png) https://example.com");

        assert_eq!(links.len(), 3);
        assert_eq!(links[0].relation_type, "markdown_link");
        assert_eq!(links[0].target_kind_hint.as_deref(), Some("pdf"));
        assert_eq!(links[1].relation_type, "markdown_image");
        assert_eq!(links[1].target_kind_hint.as_deref(), Some("image"));
        assert_eq!(links[2].relation_type, "external_url");
    }

    #[test]
    fn normalizes_relative_paths() {
        assert_eq!(
            normalize_relative_path(Path::new("a/./b/../c.md")),
            "a/c.md"
        );
    }
}
