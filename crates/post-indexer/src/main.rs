/**
 * @purpose Scan, watch, reconcile, parse, and thumbnail vault files for the Electron app.
 * @role    Rust sidecar CLI that owns indexing commands and structured progress events.
 * @deps    SQLite, notify, image crate, filesystem paths, stdout JSON event contract.
 * @gotcha  Keep CLI/event shapes stable and preserve x-post Markdown / YouTube .url classification.
 */

use std::{
    collections::{HashMap, HashSet},
    env,
    ffi::OsStr,
    fs::{self, File},
    io::{self, BufRead, Write},
    path::{Component, Path, PathBuf},
    process::{Command, Stdio},
    sync::mpsc,
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use image::{
    DynamicImage, GenericImageView, ImageEncoder, ImageReader,
    codecs::{jpeg::JpegEncoder, png::PngEncoder},
    imageops::FilterType,
};
use notify::{Config as NotifyConfig, Event as NotifyEvent, PollWatcher, RecursiveMode, Watcher};

const INDEXER_VERSION: &str = "post-indexer/0.1.0";
const PARSER_VERSION: &str = "markdown-links/0.3.0";
const THUMBNAIL_LONG_EDGE: u32 = 720;
const THUMBNAIL_JPEG_QUALITY: u8 = 82;
const THUMBNAIL_DB_FLUSH_BATCH: usize = 8;
const WATCH_DEBOUNCE_MS: u64 = 250;
const WATCH_NOTIFY_POLL_MS: u64 = 1_000;

#[derive(Clone, Copy)]
enum CommandKind {
    Scan,
    Reconcile,
    Refresh,
    Watch,
    Thumbnails,
}

impl CommandKind {
    fn from_str(value: &str) -> Option<Self> {
        match value {
            "scan" => Some(Self::Scan),
            "reconcile" => Some(Self::Reconcile),
            "refresh" => Some(Self::Refresh),
            "watch" => Some(Self::Watch),
            "thumbnails" => Some(Self::Thumbnails),
            _ => None,
        }
    }

    fn reason(self) -> &'static str {
        match self {
            Self::Scan => "initial_import",
            Self::Reconcile => "manual",
            Self::Refresh => "watcher_event",
            Self::Watch => "watcher_event",
            Self::Thumbnails => "manual",
        }
    }

    fn as_str(self) -> &'static str {
        match self {
            Self::Scan => "scan",
            Self::Reconcile => "reconcile",
            Self::Refresh => "refresh",
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
    paths: Vec<String>,
    limit: Option<usize>,
    daemon: bool,
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

struct RefreshCollection {
    entries: Vec<FileEntry>,
    missing_paths: HashSet<String>,
}

struct WriteIndexOptions<'a> {
    mark_missing_unseen: bool,
    include_existing_lookup: bool,
    missing_paths: &'a HashSet<String>,
}

struct WriteIndexResult {
    link_refresh_count: usize,
}

#[derive(Clone)]
struct ExistingFile {
    file_id: String,
    asset_id: String,
    relative_path: String,
    quick_fingerprint: Option<String>,
    file_exists: bool,
}

struct LinkCandidate {
    source_asset_id: String,
    target_asset_id: Option<String>,
    target_ref: String,
    source_relative_path: String,
}

#[derive(Clone)]
enum WatchScopeKind {
    Vault,
    Note {
        asset_id: Option<String>,
        relative_path: String,
    },
}

#[derive(Clone)]
struct WatchFileState {
    relative_path: String,
    size_bytes: u64,
    mtime_ms: i64,
    quick_fingerprint: String,
}

struct WatchChange {
    kind: &'static str,
    relative_path: String,
    previous_relative_path: Option<String>,
    size_bytes: Option<u64>,
    mtime_ms: Option<i64>,
    quick_fingerprint: Option<String>,
}

enum WatchCommand {
    SetScope(WatchScopeKind),
    AuditScope,
    Shutdown,
}

enum WatchDaemonMessage {
    Command(String),
    FileEvent(Result<NotifyEvent, notify::Error>),
}

struct ThumbnailTarget {
    asset_id: String,
    file_id: String,
    kind: String,
    relative_path: String,
    extension: Option<String>,
    size_bytes: u64,
    mtime_ms: i64,
    quick_fingerprint: String,
    cache_status: Option<String>,
    cached_thumbnail_path: Option<String>,
    cached_thumbnail_format: Option<String>,
    cached_source_width: Option<u32>,
    cached_source_height: Option<u32>,
    cached_error_message: Option<String>,
    cached_source_size_bytes: Option<u64>,
    cached_source_mtime_ms: Option<i64>,
    cached_source_quick_fingerprint: Option<String>,
    cached_thumbnail_luma: Option<i64>,
    // None = never written (needs backfill for videos). Some(-1) = probed, unavailable.
    // Some(ms >= 0) = known duration.
    cached_video_duration_ms: Option<i64>,
}

struct GeneratedThumbnail {
    source_width: u32,
    source_height: u32,
    thumbnail_path: Option<PathBuf>,
    thumbnail_width: u32,
    thumbnail_height: u32,
    thumbnail_size_bytes: u64,
    thumbnail_format: &'static str,
    bottom_luma: u8,
    // Populated for video assets when ffprobe succeeds; None otherwise.
    video_duration_ms: Option<i64>,
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

    if matches!(config.command, CommandKind::Watch) && config.daemon {
        return run_watch_daemon(&config);
    }

    if matches!(config.command, CommandKind::Refresh) {
        return run_refresh_paths(&config);
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
    let empty_missing_paths = HashSet::new();
    write_index(
        &config,
        &run_id,
        started_at,
        &entries,
        WriteIndexOptions {
            mark_missing_unseen: true,
            include_existing_lookup: false,
            missing_paths: &empty_missing_paths,
        },
    )?;

    let completed_at = now_ms();
    complete_sync_run(
        &config,
        &run_id,
        started_at,
        completed_at,
        entries.len() as i64,
        moved_count as i64,
        0,
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
    let mut paths = Vec::new();
    let mut limit = None;
    let mut daemon = false;
    let mut index = 1;

    while index < args.len() {
        let flag = &args[index];

        if flag == "--daemon" {
            daemon = true;
            index += 1;
            continue;
        }

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
            "--paths" => {
                paths.extend(
                    value
                        .split(',')
                        .map(str::trim)
                        .filter(|path| !path.is_empty())
                        .map(ToString::to_string),
                );
            }
            "--path" => {
                paths.push(value.clone());
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

    if daemon && !matches!(command, CommandKind::Watch) {
        return Err("--daemon can only be used with watch".to_string());
    }

    Ok(Config {
        command,
        vault_id: vault_id.ok_or_else(|| "missing --vault-id".to_string())?,
        root_path: root_path.ok_or_else(|| "missing --root-path".to_string())?,
        db_path: db_path.ok_or_else(|| "missing --db-path".to_string())?,
        thumbnail_root,
        asset_ids,
        paths,
        limit,
        daemon,
    })
}

fn print_help() {
    println!(
        "\
post-indexer

Usage:
  post-indexer scan --vault-id <id> --root-path <path> --db-path <path>
  post-indexer reconcile --vault-id <id> --root-path <path> --db-path <path>
  post-indexer refresh --vault-id <id> --root-path <path> --db-path <path> --paths <relative,path>
  post-indexer watch --vault-id <id> --root-path <path> --db-path <path> [--daemon]
  post-indexer thumbnails --vault-id <id> --root-path <path> --db-path <path> --thumbnail-root <path> [--asset-ids <id,id>] [--limit <n>]

Without --daemon, watch runs a snapshot scan for watcher-triggered sync.
Refresh updates only the provided vault-relative paths.
With --daemon, watch keeps running, reads scope commands from stdin, and emits
watcher events as NDJSON."
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

            entries.push(file_entry_from_metadata(config, &path, &metadata)?);

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

fn file_entry_from_metadata(
    config: &Config,
    path: &Path,
    metadata: &fs::Metadata,
) -> Result<FileEntry, String> {
    let relative_path = relative_path(&config.root_path, path)?;
    let extension = path
        .extension()
        .and_then(OsStr::to_str)
        .map(|value| value.to_ascii_lowercase());
    let kind = kind_for_path(path, extension.as_deref()).to_string();
    let file_name = path
        .file_name()
        .and_then(OsStr::to_str)
        .ok_or_else(|| format!("file name is not valid UTF-8: {}", path.display()))?
        .to_string();
    let title = if kind == "post" {
        markdown_frontmatter_value(path, "title")
    } else {
        None
    }
    .unwrap_or_else(|| {
        path.file_stem()
            .and_then(OsStr::to_str)
            .unwrap_or(&file_name)
            .to_string()
    });
    let mtime_ms = metadata.modified().ok().map(system_time_ms).unwrap_or(0);
    let ctime_ms = metadata.created().ok().map(system_time_ms);
    let quick_fingerprint = format!(
        "{}:{}:{}",
        metadata.len(),
        mtime_ms,
        extension.as_deref().unwrap_or("")
    );
    let asset_id = deterministic_id("asset", &format!("{}\0{}", config.vault_id, relative_path));
    let file_id = deterministic_id(
        "asset_file",
        &format!("{}\0{}", config.vault_id, relative_path),
    );

    Ok(FileEntry {
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
    })
}

fn run_refresh_paths(config: &Config) -> Result<(), String> {
    let started_at = now_ms();
    let run_id = format!(
        "sync_run_{}_{:x}",
        started_at,
        stable_hash(&format!(
            "{}:{}:{}:{}",
            config.vault_id,
            config.root_path.display(),
            config.command.as_str(),
            config.paths.join("\0")
        ))
    );

    start_sync_run(config, &run_id, started_at)?;
    emit_event(
        "started",
        &[
            ("runId", JsonValue::String(run_id.clone())),
            (
                "command",
                JsonValue::String(config.command.as_str().to_string()),
            ),
            ("vaultId", JsonValue::String(config.vault_id.clone())),
            ("paths", JsonValue::Number(config.paths.len() as i64)),
        ],
    );

    let mut refresh = collect_refresh_entries(config, &run_id)?;
    let moved_count =
        reconcile_refresh_entries(config, &mut refresh.entries, &refresh.missing_paths)?;
    let write_result = write_index(
        config,
        &run_id,
        started_at,
        &refresh.entries,
        WriteIndexOptions {
            mark_missing_unseen: false,
            include_existing_lookup: true,
            missing_paths: &refresh.missing_paths,
        },
    )?;

    let moved_sources = refresh
        .entries
        .iter()
        .filter_map(|entry| entry.moved_from.as_deref())
        .map(|path| path.to_ascii_lowercase())
        .collect::<HashSet<_>>();
    let missing_count = refresh
        .missing_paths
        .iter()
        .filter(|path| !moved_sources.contains(&path.to_ascii_lowercase()))
        .count();
    let thumbnail_asset_ids = refresh
        .entries
        .iter()
        .filter(|entry| supports_thumbnail_generation_for_kind(&entry.kind))
        .map(|entry| entry.asset_id.clone())
        .collect::<HashSet<_>>();
    let mut thumbnail_asset_ids = thumbnail_asset_ids.into_iter().collect::<Vec<_>>();
    thumbnail_asset_ids.sort();
    let completed_at = now_ms();

    complete_sync_run(
        config,
        &run_id,
        started_at,
        completed_at,
        refresh.entries.len() as i64,
        moved_count as i64,
        missing_count as i64,
    )?;

    emit_event(
        "completed",
        &[
            ("runId", JsonValue::String(run_id)),
            ("filesSeen", JsonValue::Number(refresh.entries.len() as i64)),
            ("filesMoved", JsonValue::Number(moved_count as i64)),
            ("filesMissing", JsonValue::Number(missing_count as i64)),
            (
                "linksRefreshed",
                JsonValue::Number(write_result.link_refresh_count as i64),
            ),
            (
                "thumbnailAssetIds",
                JsonValue::Raw(json_array(&thumbnail_asset_ids)),
            ),
            (
                "imageAssetIds",
                JsonValue::Raw(json_array(&thumbnail_asset_ids)),
            ),
            ("durationMs", JsonValue::Number(completed_at - started_at)),
        ],
    );

    Ok(())
}

fn collect_refresh_entries(config: &Config, run_id: &str) -> Result<RefreshCollection, String> {
    if config.paths.is_empty() {
        return Err("refresh requires --paths or --path".to_string());
    }

    let mut seen_paths = HashSet::new();
    let mut entries = Vec::new();
    let mut missing_paths = HashSet::new();

    for raw_path in &config.paths {
        let Some(relative_path) = normalize_refresh_path(raw_path)? else {
            continue;
        };
        if !seen_paths.insert(relative_path.to_ascii_lowercase()) {
            continue;
        }

        let absolute_path = config.root_path.join(&relative_path);
        match fs::metadata(&absolute_path) {
            Ok(metadata) if metadata.is_file() => {
                entries.push(file_entry_from_metadata(config, &absolute_path, &metadata)?);
            }
            Ok(_) => {}
            Err(error) if error.kind() == io::ErrorKind::NotFound => {
                missing_paths.insert(relative_path);
            }
            Err(error) => {
                return Err(format!(
                    "failed to stat refresh path {}: {error}",
                    absolute_path.display()
                ));
            }
        }
    }

    entries.sort_by(|left, right| left.relative_path.cmp(&right.relative_path));

    emit_event(
        "progress",
        &[
            ("runId", JsonValue::String(run_id.to_string())),
            ("phase", JsonValue::String("refresh_collected".to_string())),
            ("filesSeen", JsonValue::Number(entries.len() as i64)),
            (
                "filesMissing",
                JsonValue::Number(missing_paths.len() as i64),
            ),
        ],
    );

    Ok(RefreshCollection {
        entries,
        missing_paths,
    })
}

fn normalize_refresh_path(raw_path: &str) -> Result<Option<String>, String> {
    let trimmed = raw_path.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }

    validate_relative_watch_path(trimmed)?;
    let relative_path = normalize_relative_path(Path::new(trimmed));
    if relative_path.is_empty() || should_skip_relative_path(&relative_path) {
        return Ok(None);
    }

    Ok(Some(relative_path))
}

fn run_watch_daemon(config: &Config) -> Result<(), String> {
    let mut scope = WatchScopeKind::Vault;
    let mut snapshot = collect_watch_snapshot(config, &scope)?;
    let (message_tx, message_rx) = mpsc::channel::<WatchDaemonMessage>();
    let command_tx = message_tx.clone();

    thread::spawn(move || {
        let stdin = io::stdin();
        for line in stdin.lock().lines() {
            let Ok(line) = line else {
                break;
            };

            if command_tx.send(WatchDaemonMessage::Command(line)).is_err() {
                break;
            }
        }
    });

    let _watcher = start_notify_watcher(config, message_tx)?;
    let mut pending_event_count = 0usize;
    let mut flush_deadline: Option<Instant> = None;
    let mut fallback_deadline =
        Instant::now() + Duration::from_millis(watch_fallback_audit_ms(&scope));

    emit_watch_status(config, &scope, "watcher_ready", None);

    loop {
        match message_rx.recv_timeout(next_watch_timeout(flush_deadline, fallback_deadline)) {
            Ok(WatchDaemonMessage::Command(line)) => match parse_watch_command(&line) {
                Ok(Some(WatchCommand::SetScope(next_scope))) => {
                    scope = next_scope;
                    pending_event_count = 0;
                    flush_deadline = None;
                    fallback_deadline =
                        Instant::now() + Duration::from_millis(watch_fallback_audit_ms(&scope));
                    match collect_watch_snapshot(config, &scope) {
                        Ok(next_snapshot) => {
                            snapshot = next_snapshot;
                            emit_watch_status(config, &scope, "watcher_ready", None);
                        }
                        Err(error) => {
                            emit_watch_status(config, &scope, "watcher_error", Some(&error))
                        }
                    }
                }
                Ok(Some(WatchCommand::AuditScope)) => {
                    pending_event_count = 0;
                    flush_deadline = None;
                    flush_watch_changes(config, &scope, &mut snapshot);
                }
                Ok(Some(WatchCommand::Shutdown)) => {
                    emit_watch_status(config, &scope, "watcher_stopped", None);
                    break;
                }
                Ok(None) => {}
                Err(error) => emit_watch_status(config, &scope, "watcher_error", Some(&error)),
            },
            Ok(WatchDaemonMessage::FileEvent(result)) => match result {
                Ok(event) => {
                    if should_process_notify_event(config, &scope, &event) {
                        pending_event_count = pending_event_count.saturating_add(1);
                        flush_deadline =
                            Some(Instant::now() + Duration::from_millis(WATCH_DEBOUNCE_MS));
                    }
                }
                Err(error) => {
                    emit_watch_status(config, &scope, "watcher_error", Some(&error.to_string()));
                }
            },
            Err(mpsc::RecvTimeoutError::Timeout) => {
                let now = Instant::now();
                if pending_event_count > 0
                    && flush_deadline
                        .map(|deadline| now >= deadline)
                        .unwrap_or(false)
                {
                    pending_event_count = 0;
                    flush_deadline = None;
                    flush_watch_changes(config, &scope, &mut snapshot);
                    fallback_deadline =
                        Instant::now() + Duration::from_millis(watch_fallback_audit_ms(&scope));
                } else if now >= fallback_deadline {
                    flush_watch_changes(config, &scope, &mut snapshot);
                    fallback_deadline =
                        Instant::now() + Duration::from_millis(watch_fallback_audit_ms(&scope));
                }
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                emit_watch_status(config, &scope, "watcher_stopped", None);
                break;
            }
        }
    }

    Ok(())
}

fn start_notify_watcher(
    config: &Config,
    message_tx: mpsc::Sender<WatchDaemonMessage>,
) -> Result<PollWatcher, String> {
    let mut watcher = PollWatcher::new(
        move |result| {
            let _ = message_tx.send(WatchDaemonMessage::FileEvent(result));
        },
        NotifyConfig::default().with_poll_interval(Duration::from_millis(WATCH_NOTIFY_POLL_MS)),
    )
    .map_err(|error| format!("failed to create file watcher: {error}"))?;

    watcher
        .watch(&config.root_path, RecursiveMode::Recursive)
        .map_err(|error| {
            format!(
                "failed to watch vault root {}: {error}",
                config.root_path.display()
            )
        })?;

    Ok(watcher)
}

fn flush_watch_changes(
    config: &Config,
    scope: &WatchScopeKind,
    snapshot: &mut HashMap<String, WatchFileState>,
) {
    match audit_watch_scope(config, scope, snapshot) {
        Ok(changes) => emit_watch_changes(config, scope, &changes),
        Err(error) => emit_watch_status(config, scope, "watcher_error", Some(&error)),
    }
}

fn next_watch_timeout(flush_deadline: Option<Instant>, fallback_deadline: Instant) -> Duration {
    let now = Instant::now();
    let next_deadline = flush_deadline
        .filter(|deadline| *deadline < fallback_deadline)
        .unwrap_or(fallback_deadline);

    next_deadline.saturating_duration_since(now)
}

fn should_process_notify_event(
    config: &Config,
    scope: &WatchScopeKind,
    event: &NotifyEvent,
) -> bool {
    event
        .paths
        .iter()
        .any(|path| is_watch_event_path_relevant(config, scope, path))
}

fn is_watch_event_path_relevant(config: &Config, scope: &WatchScopeKind, path: &Path) -> bool {
    let absolute_path = if path.is_absolute() {
        path.to_path_buf()
    } else {
        config.root_path.join(path)
    };

    if absolute_path == config.root_path {
        return matches!(scope, WatchScopeKind::Vault);
    }

    let Ok(relative_path) = relative_path(&config.root_path, &absolute_path) else {
        return false;
    };

    if should_skip_relative_path(&relative_path) {
        return false;
    }

    match scope {
        WatchScopeKind::Vault => true,
        WatchScopeKind::Note {
            relative_path: active_relative_path,
            ..
        } => relative_path.eq_ignore_ascii_case(active_relative_path),
    }
}

fn should_skip_relative_path(relative_path: &str) -> bool {
    Path::new(relative_path)
        .components()
        .any(|component| matches!(component, Component::Normal(part) if should_skip(part)))
}

fn audit_watch_scope(
    config: &Config,
    scope: &WatchScopeKind,
    snapshot: &mut HashMap<String, WatchFileState>,
) -> Result<Vec<WatchChange>, String> {
    let next_snapshot = collect_watch_snapshot(config, scope)?;
    let changes = diff_watch_snapshots(snapshot, &next_snapshot);
    *snapshot = next_snapshot;
    Ok(changes)
}

fn collect_watch_snapshot(
    config: &Config,
    scope: &WatchScopeKind,
) -> Result<HashMap<String, WatchFileState>, String> {
    let mut files = HashMap::new();

    match scope {
        WatchScopeKind::Vault => {
            let mut stack = vec![config.root_path.clone()];

            while let Some(dir) = stack.pop() {
                let read_dir = fs::read_dir(&dir).map_err(|error| {
                    format!("failed to read directory {}: {error}", dir.display())
                })?;

                for item in read_dir {
                    let item =
                        item.map_err(|error| format!("failed to read directory item: {error}"))?;
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

                    if metadata.is_file() {
                        let file = watch_file_state(
                            config,
                            &path,
                            metadata.len(),
                            metadata.modified().ok(),
                        )?;
                        files.insert(file.relative_path.to_ascii_lowercase(), file);
                    }
                }
            }
        }
        WatchScopeKind::Note { relative_path, .. } => {
            validate_relative_watch_path(relative_path)?;
            let path = config.root_path.join(relative_path);

            if let Ok(metadata) = fs::metadata(&path) {
                if metadata.is_file() {
                    let file =
                        watch_file_state(config, &path, metadata.len(), metadata.modified().ok())?;
                    files.insert(file.relative_path.to_ascii_lowercase(), file);
                }
            }
        }
    }

    Ok(files)
}

fn watch_file_state(
    config: &Config,
    path: &Path,
    size_bytes: u64,
    modified: Option<SystemTime>,
) -> Result<WatchFileState, String> {
    let relative_path = relative_path(&config.root_path, path)?;
    let extension = path
        .extension()
        .and_then(OsStr::to_str)
        .map(|value| value.to_ascii_lowercase());
    let mtime_ms = modified.map(system_time_ms).unwrap_or(0);
    let quick_fingerprint = format!(
        "{}:{}:{}",
        size_bytes,
        mtime_ms,
        extension.as_deref().unwrap_or("")
    );

    Ok(WatchFileState {
        relative_path,
        size_bytes,
        mtime_ms,
        quick_fingerprint,
    })
}

fn diff_watch_snapshots(
    previous: &HashMap<String, WatchFileState>,
    next: &HashMap<String, WatchFileState>,
) -> Vec<WatchChange> {
    let mut changes = Vec::new();
    let mut created = Vec::new();
    let mut deleted = Vec::new();

    for (key, next_file) in next {
        match previous.get(key) {
            Some(previous_file)
                if previous_file.quick_fingerprint != next_file.quick_fingerprint =>
            {
                changes.push(WatchChange {
                    kind: "updated",
                    relative_path: next_file.relative_path.clone(),
                    previous_relative_path: None,
                    size_bytes: Some(next_file.size_bytes),
                    mtime_ms: Some(next_file.mtime_ms),
                    quick_fingerprint: Some(next_file.quick_fingerprint.clone()),
                });
            }
            Some(_) => {}
            None => created.push(next_file.clone()),
        }
    }

    for (key, previous_file) in previous {
        if !next.contains_key(key) {
            deleted.push(previous_file.clone());
        }
    }

    let mut moved_deleted_indexes = HashSet::new();
    for created_file in created {
        let moved_from = deleted
            .iter()
            .enumerate()
            .find(|(index, deleted_file)| {
                !moved_deleted_indexes.contains(index)
                    && deleted_file.quick_fingerprint == created_file.quick_fingerprint
            })
            .map(|(index, deleted_file)| (index, deleted_file.relative_path.clone()));

        if let Some((index, previous_relative_path)) = moved_from {
            moved_deleted_indexes.insert(index);
            changes.push(WatchChange {
                kind: "moved",
                relative_path: created_file.relative_path.clone(),
                previous_relative_path: Some(previous_relative_path),
                size_bytes: Some(created_file.size_bytes),
                mtime_ms: Some(created_file.mtime_ms),
                quick_fingerprint: Some(created_file.quick_fingerprint.clone()),
            });
        } else {
            changes.push(WatchChange {
                kind: "created",
                relative_path: created_file.relative_path.clone(),
                previous_relative_path: None,
                size_bytes: Some(created_file.size_bytes),
                mtime_ms: Some(created_file.mtime_ms),
                quick_fingerprint: Some(created_file.quick_fingerprint.clone()),
            });
        }
    }

    for (index, deleted_file) in deleted.into_iter().enumerate() {
        if moved_deleted_indexes.contains(&index) {
            continue;
        }

        changes.push(WatchChange {
            kind: "deleted",
            relative_path: deleted_file.relative_path,
            previous_relative_path: None,
            size_bytes: None,
            mtime_ms: None,
            quick_fingerprint: Some(deleted_file.quick_fingerprint),
        });
    }

    changes.sort_by(|left, right| left.relative_path.cmp(&right.relative_path));
    changes
}

fn emit_watch_status(
    config: &Config,
    scope: &WatchScopeKind,
    event_type: &str,
    message: Option<&str>,
) {
    let mut fields = vec![
        ("vaultId", JsonValue::String(config.vault_id.clone())),
        (
            "rootPath",
            JsonValue::String(config.root_path.display().to_string()),
        ),
        (
            "scope",
            JsonValue::String(watch_scope_label(scope).to_string()),
        ),
    ];

    if let WatchScopeKind::Note {
        asset_id,
        relative_path,
    } = scope
    {
        fields.push(("relativePath", JsonValue::String(relative_path.clone())));
        if let Some(asset_id) = asset_id {
            fields.push(("assetId", JsonValue::String(asset_id.clone())));
        }
    }

    if let Some(message) = message {
        fields.push(("message", JsonValue::String(message.to_string())));
    }

    emit_event(event_type, &fields);
}

fn emit_watch_changes(config: &Config, scope: &WatchScopeKind, changes: &[WatchChange]) {
    if changes.is_empty() {
        return;
    }

    emit_event(
        "watcher_changes",
        &[
            ("vaultId", JsonValue::String(config.vault_id.clone())),
            (
                "scope",
                JsonValue::String(watch_scope_label(scope).to_string()),
            ),
            (
                "changes",
                JsonValue::Raw(watch_changes_json(config, changes)),
            ),
        ],
    );
}

fn watch_changes_json(config: &Config, changes: &[WatchChange]) -> String {
    let items = changes
        .iter()
        .map(|change| {
            let mut fields = vec![
                format!("\"kind\":{}", json_quote(change.kind)),
                format!("\"vaultId\":{}", json_quote(&config.vault_id)),
                format!("\"relativePath\":{}", json_quote(&change.relative_path)),
            ];

            if let Some(previous_relative_path) = change.previous_relative_path.as_deref() {
                fields.push(format!(
                    "\"previousRelativePath\":{}",
                    json_quote(previous_relative_path)
                ));
            }

            if let Some(size_bytes) = change.size_bytes {
                fields.push(format!("\"sizeBytes\":{size_bytes}"));
            }

            if let Some(mtime_ms) = change.mtime_ms {
                fields.push(format!("\"mtimeMs\":{mtime_ms}"));
            }

            if let Some(quick_fingerprint) = change.quick_fingerprint.as_deref() {
                fields.push(format!(
                    "\"quickFingerprint\":{}",
                    json_quote(quick_fingerprint)
                ));
            }

            format!("{{{}}}", fields.join(","))
        })
        .collect::<Vec<_>>()
        .join(",");

    format!("[{items}]")
}

fn parse_watch_command(line: &str) -> Result<Option<WatchCommand>, String> {
    let Some(command) = json_string_field(line, "command") else {
        return Ok(None);
    };

    match command.as_str() {
        "audit_scope" => Ok(Some(WatchCommand::AuditScope)),
        "shutdown" => Ok(Some(WatchCommand::Shutdown)),
        "set_scope" => {
            let scope_type = json_string_field(line, "type")
                .ok_or_else(|| "set_scope command is missing scope.type".to_string())?;

            match scope_type.as_str() {
                "vault" => Ok(Some(WatchCommand::SetScope(WatchScopeKind::Vault))),
                "note" => {
                    let relative_path = json_string_field(line, "relativePath")
                        .ok_or_else(|| "note scope is missing relativePath".to_string())?;
                    validate_relative_watch_path(&relative_path)?;
                    Ok(Some(WatchCommand::SetScope(WatchScopeKind::Note {
                        asset_id: json_string_field(line, "assetId"),
                        relative_path,
                    })))
                }
                _ => Err(format!("unknown watcher scope type: {scope_type}")),
            }
        }
        _ => Err(format!("unknown watcher command: {command}")),
    }
}

fn validate_relative_watch_path(relative_path: &str) -> Result<(), String> {
    let path = Path::new(relative_path);
    if path.is_absolute()
        || path
            .components()
            .any(|component| matches!(component, Component::ParentDir))
    {
        return Err(format!(
            "watch path is outside of the vault: {relative_path}"
        ));
    }

    Ok(())
}

fn json_string_field(input: &str, field: &str) -> Option<String> {
    let key = json_quote(field);
    let key_index = input.find(&key)?;
    let after_key = &input[key_index + key.len()..];
    let colon_index = after_key.find(':')?;
    let after_colon = after_key[colon_index + 1..].trim_start();

    parse_json_string(after_colon).map(|(value, _)| value)
}

fn parse_json_string(input: &str) -> Option<(String, usize)> {
    let mut chars = input.char_indices();
    let (_, first) = chars.next()?;
    if first != '"' {
        return None;
    }

    let mut value = String::new();
    let mut escaped = false;

    for (index, character) in chars {
        if escaped {
            match character {
                '"' => value.push('"'),
                '\\' => value.push('\\'),
                '/' => value.push('/'),
                'b' => value.push('\u{0008}'),
                'f' => value.push('\u{000c}'),
                'n' => value.push('\n'),
                'r' => value.push('\r'),
                't' => value.push('\t'),
                'u' => {
                    return None;
                }
                other => value.push(other),
            }
            escaped = false;
            continue;
        }

        if character == '\\' {
            escaped = true;
            continue;
        }

        if character == '"' {
            return Some((value, index + character.len_utf8()));
        }

        value.push(character);
    }

    None
}

fn watch_scope_label(scope: &WatchScopeKind) -> &'static str {
    match scope {
        WatchScopeKind::Vault => "vault",
        WatchScopeKind::Note { .. } => "note",
    }
}

fn watch_fallback_audit_ms(scope: &WatchScopeKind) -> u64 {
    match scope {
        WatchScopeKind::Vault => 30_000,
        WatchScopeKind::Note { .. } => 10_000,
    }
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
            if video_duration_backfill_needed(&target) {
                let source_path = config.root_path.join(&target.relative_path);
                // -1 marks "probed, unavailable" so prewarm does not retry forever.
                let duration_ms = probe_video_duration_ms(&source_path).unwrap_or(-1);
                push_image_cache_duration_sql(&mut sql, &target, duration_ms, now_ms());
                pending_sql_rows += 1;
                if duration_ms >= 0 {
                    ready_count += 1;
                    emit_event(
                        "thumbnail_ready",
                        &[
                            ("assetId", JsonValue::String(target.asset_id.clone())),
                            ("videoDurationMs", JsonValue::Number(duration_ms)),
                            ("durationBackfill", JsonValue::Raw("true".to_string())),
                        ],
                    );
                } else {
                    cached_count += 1;
                    emit_event(
                        "thumbnail_cached",
                        &[
                            ("assetId", JsonValue::String(target.asset_id.clone())),
                            ("durationBackfill", JsonValue::Raw("true".to_string())),
                        ],
                    );
                }
            } else {
                cached_count += 1;
                emit_event(
                    "thumbnail_cached",
                    &[("assetId", JsonValue::String(target.asset_id.clone()))],
                );
            }

            if pending_sql_rows >= THUMBNAIL_DB_FLUSH_BATCH {
                flush_thumbnail_sql(config, &mut sql, &mut pending_sql_rows)?;
            }
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
  a.kind,
  af.relative_path,
  COALESCE(af.extension, ''),
  af.size_bytes,
  af.mtime_ms,
  COALESCE(af.quick_fingerprint, ''),
  COALESCE(ic.status, ''),
  COALESCE(ic.thumbnail_path, ''),
  COALESCE(ic.thumbnail_format, ''),
  COALESCE(ic.width, -1),
  COALESCE(ic.height, -1),
  REPLACE(REPLACE(REPLACE(COALESCE(ic.error_message, ''), char(9), ' '), char(10), ' '), char(13), ' '),
  COALESCE(ic.source_size_bytes, -1),
  COALESCE(ic.source_mtime_ms, -1),
  COALESCE(ic.source_quick_fingerprint, ''),
  COALESCE(ic.thumbnail_luma, -1),
  CASE WHEN ic.video_duration_ms IS NULL THEN '' ELSE CAST(ic.video_duration_ms AS TEXT) END
FROM asset_files af
INNER JOIN assets a ON a.id = af.asset_id
LEFT JOIN image_cache ic ON ic.asset_id = af.asset_id
WHERE af.vault_id = {}
  AND af.file_exists = 1
  AND a.kind IN ('image', 'video')
  {asset_filter}
ORDER BY af.mtime_ms DESC
{limit_clause};\n",
        sql_text(&config.vault_id),
    );
    let output = query_sqlite(&config.db_path, &sql)?;
    let mut targets = Vec::new();

    for line in output.lines().filter(|line| !line.trim().is_empty()) {
        let columns: Vec<_> = line.split('\t').collect();
        if columns.len() != 19 {
            return Err(format!(
                "unexpected sqlite row while loading thumbnail targets: {line}"
            ));
        }

        targets.push(ThumbnailTarget {
            asset_id: columns[0].to_string(),
            file_id: columns[1].to_string(),
            kind: columns[2].to_string(),
            relative_path: columns[3].to_string(),
            extension: none_if_empty(columns[4]),
            size_bytes: parse_u64(columns[5], "size_bytes")?,
            mtime_ms: parse_i64(columns[6], "mtime_ms")?,
            quick_fingerprint: columns[7].to_string(),
            cache_status: none_if_empty(columns[8]),
            cached_thumbnail_path: none_if_empty(columns[9]),
            cached_thumbnail_format: none_if_empty(columns[10]),
            cached_source_width: parse_optional_u32(columns[11])?,
            cached_source_height: parse_optional_u32(columns[12])?,
            cached_error_message: none_if_empty(columns[13]),
            cached_source_size_bytes: parse_optional_u64(columns[14])?,
            cached_source_mtime_ms: parse_optional_i64(columns[15])?,
            cached_source_quick_fingerprint: none_if_empty(columns[16]),
            cached_thumbnail_luma: parse_optional_i64(columns[17])?,
            cached_video_duration_ms: parse_optional_i64_allow_negative(columns[18])?,
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

    let source_matches = target.cached_source_size_bytes == Some(target.size_bytes)
        && target.cached_source_mtime_ms == Some(target.mtime_ms)
        && target.cached_source_quick_fingerprint.as_deref() == Some(&target.quick_fingerprint)
        // Regenerate ready thumbnails cached before thumbnail_luma existed, so the
        // overlay-text luma backfills once without touching unchanged sources otherwise.
        && target.cached_thumbnail_luma.is_some();
    if !source_matches {
        return false;
    }

    let should_use_original = target.kind == "image"
        && target
            .cached_source_width
            .zip(target.cached_source_height)
            .is_some_and(|(width, height)| should_use_original_image(width, height));
    if should_use_original {
        return target.cached_thumbnail_format.as_deref() == Some("original")
            && target.cached_thumbnail_path.is_none();
    }

    target.cached_thumbnail_format.as_deref() == Some(expected_thumbnail_format(target))
        && target
            .cached_thumbnail_path
            .as_deref()
            .is_some_and(|path| Path::new(path).is_file())
}

fn thumbnail_source_matches(target: &ThumbnailTarget) -> bool {
    target.cached_source_size_bytes == Some(target.size_bytes)
        && target.cached_source_mtime_ms == Some(target.mtime_ms)
        && target.cached_source_quick_fingerprint.as_deref() == Some(&target.quick_fingerprint)
}

fn thumbnail_generation_needed(target: &ThumbnailTarget) -> bool {
    match target.cache_status.as_deref() {
        Some("ready") => !thumbnail_cache_matches(target) || video_duration_backfill_needed(target),
        Some("failed") => {
            !thumbnail_source_matches(target)
                || thumbnail_failure_is_retryable(target.cached_error_message.as_deref())
        }
        _ => true,
    }
}

fn video_duration_backfill_needed(target: &ThumbnailTarget) -> bool {
    target.kind == "video" && target.cached_video_duration_ms.is_none()
}

fn thumbnail_failure_is_retryable(error_message: Option<&str>) -> bool {
    let message = error_message.unwrap_or("").to_ascii_lowercase();
    message.contains("ffmpeg executable unavailable")
}

fn generate_thumbnail(
    config: &Config,
    target: &ThumbnailTarget,
    thumbnail_root: &Path,
) -> Result<GeneratedThumbnail, String> {
    let source_path = config.root_path.join(&target.relative_path);

    match target.kind.as_str() {
        "image" => generate_image_thumbnail(config, target, thumbnail_root, &source_path),
        "video" => generate_video_thumbnail(config, target, thumbnail_root, &source_path),
        kind => Err(format!("unsupported asset kind for thumbnail: {kind}")),
    }
}

fn generate_image_thumbnail(
    config: &Config,
    target: &ThumbnailTarget,
    thumbnail_root: &Path,
    source_path: &Path,
) -> Result<GeneratedThumbnail, String> {
    if !is_supported_image_thumbnail_extension(target.extension.as_deref()) {
        return Err(format!(
            "unsupported image format for thumbnail: {}",
            target.extension.as_deref().unwrap_or("unknown")
        ));
    }

    let image = decode_image_file(source_path, "image")?;
    let (source_width, source_height) = image.dimensions();
    if should_use_original_image(source_width, source_height) {
        let rgb = image.to_rgb8();
        return Ok(GeneratedThumbnail {
            source_width,
            source_height,
            thumbnail_path: None,
            thumbnail_width: source_width,
            thumbnail_height: source_height,
            thumbnail_size_bytes: target.size_bytes,
            thumbnail_format: "original",
            bottom_luma: average_bottom_luma(&rgb),
            video_duration_ms: None,
        });
    }
    persist_thumbnail_from_image(config, target, thumbnail_root, image)
}

fn should_use_original_image(width: u32, height: u32) -> bool {
    width.max(height) <= THUMBNAIL_LONG_EDGE
}

fn expected_thumbnail_format(target: &ThumbnailTarget) -> &'static str {
    if target.kind == "image"
        && target
            .extension
            .as_deref()
            .is_some_and(|extension| extension.eq_ignore_ascii_case("png"))
    {
        "png"
    } else {
        "jpeg"
    }
}

fn generate_video_thumbnail(
    config: &Config,
    target: &ThumbnailTarget,
    thumbnail_root: &Path,
    source_path: &Path,
) -> Result<GeneratedThumbnail, String> {
    if !is_supported_video_thumbnail_extension(target.extension.as_deref()) {
        return Err(format!(
            "unsupported video format for thumbnail: {}",
            target.extension.as_deref().unwrap_or("unknown")
        ));
    }

    let vault_dir = ensure_thumbnail_vault_dir(thumbnail_root, &config.vault_id)?;
    let frame_path = vault_dir.join(format!(
        "{}-{:016x}.frame.jpg",
        target.asset_id,
        stable_hash(&target.quick_fingerprint)
    ));
    extract_video_frame_with_ffmpeg(source_path, &frame_path)?;
    let frame = decode_image_file(&frame_path, "video frame");
    let _ = fs::remove_file(&frame_path);

    let mut generated = persist_thumbnail_from_image(config, target, thumbnail_root, frame?)?;
    // Duration is best-effort: missing/failing ffprobe must not block a ready thumbnail.
    generated.video_duration_ms = probe_video_duration_ms(source_path);
    Ok(generated)
}

fn persist_thumbnail_from_image(
    config: &Config,
    target: &ThumbnailTarget,
    thumbnail_root: &Path,
    image: DynamicImage,
) -> Result<GeneratedThumbnail, String> {
    let (source_width, source_height) = image.dimensions();
    let thumbnail = image.resize(
        THUMBNAIL_LONG_EDGE,
        THUMBNAIL_LONG_EDGE,
        FilterType::Triangle,
    );
    let (thumbnail_width, thumbnail_height) = thumbnail.dimensions();
    let rgb = thumbnail.to_rgb8();
    let bottom_luma = average_bottom_luma(&rgb);

    let vault_dir = ensure_thumbnail_vault_dir(thumbnail_root, &config.vault_id)?;
    let thumbnail_format = expected_thumbnail_format(target);
    let thumbnail_path = vault_dir.join(format!(
        "{}-{:016x}.{}",
        target.asset_id,
        stable_hash(&target.quick_fingerprint),
        if thumbnail_format == "png" {
            "png"
        } else {
            "jpg"
        }
    ));
    let mut file = File::create(&thumbnail_path).map_err(|error| {
        format!(
            "failed to create thumbnail {}: {error}",
            thumbnail_path.display()
        )
    })?;
    let encode_result = if thumbnail_format == "png" {
        let rgba = thumbnail.to_rgba8();
        PngEncoder::new(&mut file).write_image(
            &rgba,
            thumbnail_width,
            thumbnail_height,
            image::ExtendedColorType::Rgba8,
        )
    } else {
        JpegEncoder::new_with_quality(&mut file, THUMBNAIL_JPEG_QUALITY).encode(
            &rgb,
            thumbnail_width,
            thumbnail_height,
            image::ExtendedColorType::Rgb8,
        )
    };
    encode_result.map_err(|error| {
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
        thumbnail_path: Some(thumbnail_path),
        thumbnail_width,
        thumbnail_height,
        thumbnail_size_bytes,
        thumbnail_format,
        bottom_luma,
        video_duration_ms: None,
    })
}

/// Average perceptual luma (0-255) of the thumbnail's bottom ~30%, where the card's
/// overlay text sits. Rec. 601 weights on a subsampled grid keep this cheap.
fn average_bottom_luma(rgb: &image::RgbImage) -> u8 {
    let (width, height) = rgb.dimensions();
    if width == 0 || height == 0 {
        return 128;
    }

    let start_y = height - (height * 3 / 10).max(1);
    let step_x = (width / 64).max(1);
    let step_y = ((height - start_y) / 24).max(1);

    let mut total: u64 = 0;
    let mut samples: u64 = 0;
    let mut y = start_y;
    while y < height {
        let mut x = 0;
        while x < width {
            let pixel = rgb.get_pixel(x, y).0;
            // Rec. 601 luma, integer weights summing to 256.
            let luma = (77 * pixel[0] as u32 + 150 * pixel[1] as u32 + 29 * pixel[2] as u32) >> 8;
            total += luma as u64;
            samples += 1;
            x += step_x;
        }
        y += step_y;
    }

    if samples == 0 {
        return 128;
    }

    (total / samples) as u8
}

fn ensure_thumbnail_vault_dir(thumbnail_root: &Path, vault_id: &str) -> Result<PathBuf, String> {
    let vault_dir = thumbnail_root.join(vault_id);
    fs::create_dir_all(&vault_dir).map_err(|error| {
        format!(
            "failed to create thumbnail dir {}: {error}",
            vault_dir.display()
        )
    })?;
    Ok(vault_dir)
}

fn decode_image_file(path: &Path, label: &str) -> Result<DynamicImage, String> {
    ImageReader::open(path)
        .map_err(|error| format!("failed to open {label} {}: {error}", path.display()))?
        .with_guessed_format()
        .map_err(|error| {
            format!(
                "failed to detect {label} format {}: {error}",
                path.display()
            )
        })?
        .decode()
        .map_err(|error| format!("failed to decode {label} {}: {error}", path.display()))
}

fn extract_video_frame_with_ffmpeg(source_path: &Path, frame_path: &Path) -> Result<(), String> {
    let mut failures = Vec::new();
    let mut executable_started = false;

    for ffmpeg_path in ffmpeg_candidates() {
        let output = Command::new(&ffmpeg_path)
            .arg("-hide_banner")
            .arg("-loglevel")
            .arg("error")
            .arg("-y")
            .arg("-i")
            .arg(source_path)
            .arg("-map")
            .arg("0:v:0")
            .arg("-frames:v")
            .arg("1")
            .arg("-q:v")
            .arg("3")
            .arg(frame_path)
            .output();

        match output {
            Ok(output) if output.status.success() && frame_path.is_file() => return Ok(()),
            Ok(output) => {
                executable_started = true;
                let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
                failures.push(format!(
                    "{}: {}",
                    ffmpeg_path.display(),
                    if stderr.is_empty() {
                        output.status.to_string()
                    } else {
                        stderr
                    }
                ));
                let _ = fs::remove_file(frame_path);
            }
            Err(error) if error.kind() == io::ErrorKind::NotFound => {
                failures.push(format!("{}: not found", ffmpeg_path.display()));
            }
            Err(error) => {
                failures.push(format!("{}: {error}", ffmpeg_path.display()));
            }
        }
    }

    let summary = failures.join("; ");
    if executable_started {
        Err(format!(
            "failed to extract video frame with ffmpeg ({summary})"
        ))
    } else {
        Err(format!(
            "ffmpeg executable unavailable; bundle ffmpeg with the app resources or set POST_FFMPEG_PATH ({summary})"
        ))
    }
}

fn ffmpeg_candidates() -> Vec<PathBuf> {
    media_tool_candidates("POST_FFMPEG_PATH", "ffmpeg")
}

fn ffprobe_candidates() -> Vec<PathBuf> {
    media_tool_candidates("POST_FFPROBE_PATH", "ffprobe")
}

fn media_tool_candidates(env_key: &str, tool_name: &str) -> Vec<PathBuf> {
    let mut candidates = Vec::new();

    if let Ok(path) = env::var(env_key) {
        if !path.trim().is_empty() {
            candidates.push(PathBuf::from(path));
        }
    }

    if let Ok(executable) = env::current_exe() {
        if let Some(executable_dir) = executable.parent() {
            let binary_name = media_tool_binary_name(tool_name);
            // Bundled layout keeps ffmpeg/ffprobe under the same sibling folders.
            candidates.push(executable_dir.join("ffmpeg").join(&binary_name));
            candidates.push(executable_dir.join("bin").join(&binary_name));
            candidates.push(executable_dir.join(&binary_name));
        }
    }

    if allow_system_ffmpeg() {
        candidates.push(PathBuf::from(tool_name));
    }
    dedupe_paths(candidates)
}

/// Best-effort duration probe for video assets. Prefers ffprobe; falls back to
/// parsing `Duration:` from `ffmpeg -i` stderr because the desktop app only
/// bundles ffmpeg. Missing tools or unparseable output return None — never fail
/// the thumbnail path.
fn probe_video_duration_ms(source_path: &Path) -> Option<i64> {
    for ffprobe_path in ffprobe_candidates() {
        let output = Command::new(&ffprobe_path)
            .args([
                "-v",
                "error",
                "-show_entries",
                "format=duration",
                "-of",
                "csv=p=0",
            ])
            .arg(source_path)
            .output();

        let Ok(output) = output else {
            continue;
        };
        if !output.status.success() {
            continue;
        }
        let stdout = String::from_utf8_lossy(&output.stdout);
        if let Some(duration_ms) = parse_ffprobe_duration_ms(&stdout) {
            return Some(duration_ms);
        }
    }

    for ffmpeg_path in ffmpeg_candidates() {
        // ffmpeg -i prints metadata to stderr and exits non-zero without an
        // output target; that is expected for a probe-only invocation.
        let output = Command::new(&ffmpeg_path).arg("-i").arg(source_path).output();
        let Ok(output) = output else {
            continue;
        };
        let stderr = String::from_utf8_lossy(&output.stderr);
        if let Some(duration_ms) = parse_ffmpeg_duration_ms(&stderr) {
            return Some(duration_ms);
        }
    }
    None
}

fn parse_ffprobe_duration_ms(raw: &str) -> Option<i64> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }
    let seconds: f64 = trimmed.parse().ok()?;
    if !seconds.is_finite() || seconds < 0.0 {
        return None;
    }
    Some((seconds * 1000.0).round() as i64)
}

fn parse_ffmpeg_duration_ms(raw: &str) -> Option<i64> {
    let marker = "Duration: ";
    let start = raw.find(marker)? + marker.len();
    let rest = raw.get(start..)?;
    let end = rest.find([',', '\n']).unwrap_or(rest.len());
    let token = rest.get(..end)?.trim();
    if token.is_empty() || token.starts_with('N') {
        return None;
    }

    let mut parts = token.split(':');
    let hours: f64 = parts.next()?.parse().ok()?;
    let minutes: f64 = parts.next()?.parse().ok()?;
    let seconds: f64 = parts.next()?.parse().ok()?;
    if parts.next().is_some() {
        return None;
    }
    if ![hours, minutes, seconds]
        .into_iter()
        .all(|value| value.is_finite() && value >= 0.0)
    {
        return None;
    }
    Some(((hours * 3600.0 + minutes * 60.0 + seconds) * 1000.0).round() as i64)
}

fn allow_system_ffmpeg() -> bool {
    matches!(
        env::var("POST_INDEXER_ALLOW_SYSTEM_FFMPEG").ok().as_deref(),
        Some("1" | "true" | "yes")
    )
}

fn media_tool_binary_name(tool_name: &str) -> String {
    if cfg!(windows) {
        format!("{tool_name}.exe")
    } else {
        tool_name.to_string()
    }
}

fn dedupe_paths(paths: Vec<PathBuf>) -> Vec<PathBuf> {
    let mut seen = HashSet::new();
    paths
        .into_iter()
        .filter(|path| seen.insert(path.to_string_lossy().to_string()))
        .collect()
}

fn supports_thumbnail_generation_for_kind(kind: &str) -> bool {
    matches!(kind, "image" | "video")
}

fn is_supported_image_thumbnail_extension(extension: Option<&str>) -> bool {
    matches!(
        extension.unwrap_or(""),
        "bmp" | "gif" | "ico" | "jpg" | "jpeg" | "png" | "tif" | "tiff" | "webp"
    )
}

fn is_supported_video_thumbnail_extension(extension: Option<&str>) -> bool {
    matches!(
        extension.unwrap_or(""),
        "3g2" | "3gp" | "avi" | "m4v" | "mkv" | "mov" | "mp4" | "mpeg" | "mpg" | "webm"
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

fn reconcile_refresh_entries(
    config: &Config,
    entries: &mut [FileEntry],
    missing_paths: &HashSet<String>,
) -> Result<usize, String> {
    let existing_files = load_existing_files(config)?;
    let missing_path_keys = missing_paths
        .iter()
        .map(|path| path.to_ascii_lowercase())
        .collect::<HashSet<_>>();
    let by_path: HashMap<String, ExistingFile> = existing_files
        .iter()
        .map(|file| (file.relative_path.to_ascii_lowercase(), file.clone()))
        .collect();
    let mut by_refresh_missing_fingerprint = HashMap::<String, Vec<ExistingFile>>::new();

    for file in existing_files {
        let Some(fingerprint) = file.quick_fingerprint.as_ref() else {
            continue;
        };

        if !file.file_exists || missing_path_keys.contains(&file.relative_path.to_ascii_lowercase())
        {
            by_refresh_missing_fingerprint
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

        let Some(candidates) = by_refresh_missing_fingerprint.get(&entry.quick_fingerprint) else {
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

fn load_asset_lookup(
    config: &Config,
) -> Result<(HashMap<String, String>, HashMap<String, Vec<String>>), String> {
    let sql = format!(
        "\
SELECT
  af.asset_id,
  af.relative_path,
  af.file_name,
  COALESCE(mc.title, '')
FROM asset_files af
INNER JOIN assets a ON a.id = af.asset_id
LEFT JOIN markdown_cache mc ON mc.asset_id = af.asset_id
WHERE af.vault_id = {}
  AND af.file_exists = 1
  AND a.deleted_at IS NULL
ORDER BY af.relative_path;\n",
        sql_text(&config.vault_id)
    );
    let output = query_sqlite(&config.db_path, &sql)?;
    let mut asset_by_path = HashMap::new();
    let mut asset_by_basename = HashMap::<String, Vec<String>>::new();

    for line in output.lines().filter(|line| !line.trim().is_empty()) {
        let columns: Vec<_> = line.split('\t').collect();
        if columns.len() != 4 {
            return Err(format!(
                "unexpected sqlite row while loading asset lookup: {line}"
            ));
        }

        add_asset_lookup_entry(
            &mut asset_by_path,
            &mut asset_by_basename,
            columns[1],
            columns[2],
            columns[0],
            none_if_empty(columns[3]).as_deref(),
        );
    }

    Ok((asset_by_path, asset_by_basename))
}

fn load_link_refresh_entries(
    config: &Config,
    entries: &[FileEntry],
    missing_paths: &HashSet<String>,
    refreshed_markdown_asset_ids: &HashSet<String>,
) -> Result<Vec<FileEntry>, String> {
    let mut affected_asset_ids = entries
        .iter()
        .map(|entry| entry.asset_id.clone())
        .collect::<HashSet<_>>();
    let mut affected_aliases = HashSet::new();

    for entry in entries {
        let title = if is_markdown_kind(&entry.kind) {
            fs::read_to_string(config.root_path.join(&entry.relative_path))
                .ok()
                .and_then(|content| markdown_title(&content))
        } else {
            None
        };
        add_relative_path_link_aliases(
            &mut affected_aliases,
            &entry.relative_path,
            title.as_deref(),
        );
    }

    for missing_path in missing_paths {
        add_relative_path_link_aliases(&mut affected_aliases, missing_path, None);
    }

    for (asset_id, relative_path, title) in load_existing_aliases_for_paths(config, missing_paths)?
    {
        affected_asset_ids.insert(asset_id);
        add_relative_path_link_aliases(&mut affected_aliases, &relative_path, title.as_deref());
    }

    let mut source_asset_ids = HashSet::new();
    for candidate in load_link_candidates(config, &affected_asset_ids)? {
        if refreshed_markdown_asset_ids.contains(&candidate.source_asset_id) {
            continue;
        }

        let targets_affected_asset = candidate
            .target_asset_id
            .as_ref()
            .map(|asset_id| affected_asset_ids.contains(asset_id))
            .unwrap_or(false);
        let targets_affected_alias = link_target_intersects_aliases(
            &candidate.source_relative_path,
            &candidate.target_ref,
            &affected_aliases,
        );

        if targets_affected_asset || targets_affected_alias {
            source_asset_ids.insert(candidate.source_asset_id);
        }
    }

    load_markdown_entries_by_asset_ids(config, &source_asset_ids)
}

fn load_existing_aliases_for_paths(
    config: &Config,
    paths: &HashSet<String>,
) -> Result<Vec<(String, String, Option<String>)>, String> {
    if paths.is_empty() {
        return Ok(Vec::new());
    }

    let mut sorted_paths = paths.iter().cloned().collect::<Vec<_>>();
    sorted_paths.sort();
    let path_filter = sorted_paths
        .iter()
        .map(|path| sql_text(path))
        .collect::<Vec<_>>()
        .join(", ");
    let sql = format!(
        "\
SELECT
  af.asset_id,
  af.relative_path,
  COALESCE(mc.title, '')
FROM asset_files af
LEFT JOIN markdown_cache mc ON mc.asset_id = af.asset_id
WHERE af.vault_id = {}
  AND af.relative_path IN ({path_filter})
ORDER BY af.relative_path;\n",
        sql_text(&config.vault_id)
    );
    let output = query_sqlite(&config.db_path, &sql)?;
    let mut aliases = Vec::new();

    for line in output.lines().filter(|line| !line.trim().is_empty()) {
        let columns: Vec<_> = line.split('\t').collect();
        if columns.len() != 3 {
            return Err(format!(
                "unexpected sqlite row while loading path aliases: {line}"
            ));
        }

        aliases.push((
            columns[0].to_string(),
            columns[1].to_string(),
            none_if_empty(columns[2]),
        ));
    }

    Ok(aliases)
}

fn load_link_candidates(
    config: &Config,
    affected_asset_ids: &HashSet<String>,
) -> Result<Vec<LinkCandidate>, String> {
    let target_filter = if affected_asset_ids.is_empty() {
        "al.target_asset_id IS NULL".to_string()
    } else {
        let mut sorted_asset_ids = affected_asset_ids.iter().cloned().collect::<Vec<_>>();
        sorted_asset_ids.sort();
        let asset_filter = sorted_asset_ids
            .iter()
            .map(|asset_id| sql_text(asset_id))
            .collect::<Vec<_>>()
            .join(", ");
        format!("(al.target_asset_id IN ({asset_filter}) OR al.target_asset_id IS NULL)")
    };
    let sql = format!(
        "\
SELECT DISTINCT
  al.source_asset_id,
  COALESCE(al.target_asset_id, ''),
  al.target_ref,
  af.relative_path
FROM asset_links al
INNER JOIN assets a ON a.id = al.source_asset_id
INNER JOIN asset_files af ON af.asset_id = al.source_asset_id
WHERE al.vault_id = {}
  AND al.created_from = 'markdown_parse'
  AND a.kind IN ('markdown', 'post')
  AND a.deleted_at IS NULL
  AND af.file_exists = 1
  AND {target_filter}
ORDER BY af.relative_path;\n",
        sql_text(&config.vault_id)
    );
    let output = query_sqlite(&config.db_path, &sql)?;
    let mut candidates = Vec::new();

    for line in output.lines().filter(|line| !line.trim().is_empty()) {
        let columns: Vec<_> = line.split('\t').collect();
        if columns.len() != 4 {
            return Err(format!(
                "unexpected sqlite row while loading link candidates: {line}"
            ));
        }

        candidates.push(LinkCandidate {
            source_asset_id: columns[0].to_string(),
            target_asset_id: none_if_empty(columns[1]),
            target_ref: columns[2].to_string(),
            source_relative_path: columns[3].to_string(),
        });
    }

    Ok(candidates)
}

fn load_markdown_entries_by_asset_ids(
    config: &Config,
    asset_ids: &HashSet<String>,
) -> Result<Vec<FileEntry>, String> {
    if asset_ids.is_empty() {
        return Ok(Vec::new());
    }

    let mut sorted_asset_ids = asset_ids.iter().cloned().collect::<Vec<_>>();
    sorted_asset_ids.sort();
    let asset_filter = sorted_asset_ids
        .iter()
        .map(|asset_id| sql_text(asset_id))
        .collect::<Vec<_>>()
        .join(", ");
    let sql = format!(
        "\
SELECT af.id, af.asset_id, af.relative_path
FROM asset_files af
INNER JOIN assets a ON a.id = af.asset_id
WHERE af.vault_id = {}
  AND af.asset_id IN ({asset_filter})
  AND af.file_exists = 1
  AND a.kind IN ('markdown', 'post')
  AND a.deleted_at IS NULL
ORDER BY af.relative_path;\n",
        sql_text(&config.vault_id)
    );
    let output = query_sqlite(&config.db_path, &sql)?;
    let mut entries = Vec::new();

    for line in output.lines().filter(|line| !line.trim().is_empty()) {
        let columns: Vec<_> = line.split('\t').collect();
        if columns.len() != 3 {
            return Err(format!(
                "unexpected sqlite row while loading markdown entries: {line}"
            ));
        }

        let absolute_path = config.root_path.join(columns[2]);
        let Ok(metadata) = fs::metadata(&absolute_path) else {
            continue;
        };
        if !metadata.is_file() {
            continue;
        }

        let mut entry = file_entry_from_metadata(config, &absolute_path, &metadata)?;
        entry.file_id = columns[0].to_string();
        entry.asset_id = columns[1].to_string();
        entries.push(entry);
    }

    Ok(entries)
}

fn add_relative_path_link_aliases(
    aliases: &mut HashSet<String>,
    relative_path: &str,
    title: Option<&str>,
) {
    add_link_alias(aliases, relative_path);

    let path = Path::new(relative_path);
    if let Some(file_name) = path.file_name().and_then(OsStr::to_str) {
        add_link_alias(aliases, file_name);
    }

    if path.extension().is_some() {
        if let Some(stem) = path.file_stem().and_then(OsStr::to_str) {
            add_link_alias(aliases, stem);
            let parent = path.parent().unwrap_or_else(|| Path::new(""));
            let path_without_extension = normalize_relative_path(&parent.join(stem));
            add_link_alias(aliases, &path_without_extension);
        }
    }

    if let Some(title) = title {
        add_link_alias(aliases, title);
    }
}

fn add_link_alias(aliases: &mut HashSet<String>, value: &str) {
    let alias = value.trim().to_ascii_lowercase();
    if !alias.is_empty() {
        aliases.insert(alias);
    }
}

fn link_target_intersects_aliases(
    source_relative_path: &str,
    target_ref: &str,
    aliases: &HashSet<String>,
) -> bool {
    if aliases.is_empty() {
        return false;
    }

    link_target_lookup_keys(source_relative_path, target_ref)
        .into_iter()
        .any(|key| aliases.contains(&key))
}

fn link_target_lookup_keys(source_relative_path: &str, target_ref: &str) -> Vec<String> {
    let Some(ref_path) = clean_link_target_ref(target_ref) else {
        return Vec::new();
    };
    let mut keys = Vec::new();
    let ref_path_obj = Path::new(&ref_path);

    if ref_path.contains('/') || ref_path_obj.extension().is_some() {
        let source_dir = Path::new(source_relative_path)
            .parent()
            .unwrap_or_else(|| Path::new(""));
        push_link_lookup_key(
            &mut keys,
            &normalize_relative_path(&source_dir.join(&ref_path)),
        );
        push_link_lookup_key(&mut keys, &normalize_relative_path(ref_path_obj));

        if ref_path_obj.extension().is_none() {
            push_link_lookup_key(
                &mut keys,
                &format!(
                    "{}.md",
                    normalize_relative_path(&source_dir.join(&ref_path))
                ),
            );
            push_link_lookup_key(
                &mut keys,
                &format!("{}.md", normalize_relative_path(ref_path_obj)),
            );
        }
    } else {
        let basename = ref_path.to_ascii_lowercase();
        push_link_lookup_key(&mut keys, &basename);
        push_link_lookup_key(&mut keys, &format!("{basename}.md"));
    }

    keys.sort();
    keys.dedup();
    keys
}

fn push_link_lookup_key(keys: &mut Vec<String>, key: &str) {
    let normalized = key.trim().to_ascii_lowercase();
    if !normalized.is_empty() {
        keys.push(normalized);
    }
}

fn clean_link_target_ref(target_ref: &str) -> Option<String> {
    let ref_without_alias = target_ref
        .split_once('|')
        .map(|(target, _alias)| target)
        .unwrap_or(target_ref);
    let ref_path = ref_without_alias
        .split_once('#')
        .map(|(target, _subpath)| target)
        .unwrap_or(ref_without_alias)
        .trim();

    if ref_path.is_empty() || is_external_url(ref_path) {
        None
    } else {
        Some(ref_path.to_string())
    }
}

fn add_asset_lookup_entry(
    asset_by_path: &mut HashMap<String, String>,
    asset_by_basename: &mut HashMap<String, Vec<String>>,
    relative_path: &str,
    file_name: &str,
    asset_id: &str,
    title: Option<&str>,
) {
    asset_by_path.insert(relative_path.to_ascii_lowercase(), asset_id.to_string());
    add_asset_basename_alias(asset_by_basename, file_name, asset_id);

    if let Some(stem) = Path::new(file_name).file_stem().and_then(OsStr::to_str) {
        add_asset_basename_alias(asset_by_basename, stem, asset_id);
    }

    if let Some(title) = title {
        add_asset_basename_alias(asset_by_basename, title, asset_id);
    }
}

fn add_asset_basename_alias(
    asset_by_basename: &mut HashMap<String, Vec<String>>,
    alias: &str,
    asset_id: &str,
) {
    let key = alias.trim().to_ascii_lowercase();
    if key.is_empty() {
        return;
    }

    let ids = asset_by_basename.entry(key).or_default();
    if !ids.iter().any(|existing| existing == asset_id) {
        ids.push(asset_id.to_string());
    }
}

fn remove_asset_from_lookup(
    asset_by_path: &mut HashMap<String, String>,
    asset_by_basename: &mut HashMap<String, Vec<String>>,
    asset_id: &str,
) {
    asset_by_path.retain(|_, existing_asset_id| existing_asset_id != asset_id);

    for ids in asset_by_basename.values_mut() {
        ids.retain(|existing_asset_id| existing_asset_id != asset_id);
    }
    asset_by_basename.retain(|_, ids| !ids.is_empty());
}

fn write_index(
    config: &Config,
    run_id: &str,
    started_at: i64,
    entries: &[FileEntry],
    options: WriteIndexOptions<'_>,
) -> Result<WriteIndexResult, String> {
    let mut sql = String::from("BEGIN;\n");
    let (mut asset_by_path, mut asset_by_basename) = if options.include_existing_lookup {
        load_asset_lookup(config)?
    } else {
        (HashMap::new(), HashMap::new())
    };

    for missing_path in options.missing_paths {
        asset_by_path.remove(&missing_path.to_ascii_lowercase());
    }
    for (asset_id, _relative_path, _title) in
        load_existing_aliases_for_paths(config, options.missing_paths)?
    {
        remove_asset_from_lookup(&mut asset_by_path, &mut asset_by_basename, &asset_id);
    }

    for entry in entries {
        remove_asset_from_lookup(&mut asset_by_path, &mut asset_by_basename, &entry.asset_id);
        add_asset_lookup_entry(
            &mut asset_by_path,
            &mut asset_by_basename,
            &entry.relative_path,
            &entry.file_name,
            &entry.asset_id,
            None,
        );

        if is_markdown_kind(&entry.kind) {
            let markdown_path = config.root_path.join(&entry.relative_path);
            if let Ok(content) = fs::read_to_string(markdown_path) {
                if let Some(title) = markdown_title(&content) {
                    add_asset_basename_alias(&mut asset_by_basename, &title, &entry.asset_id);
                }
            }
        }
    }
    let refreshed_markdown_asset_ids = entries
        .iter()
        .filter(|entry| is_markdown_kind(&entry.kind))
        .map(|entry| entry.asset_id.clone())
        .collect::<HashSet<_>>();
    let link_refresh_entries = if options.include_existing_lookup {
        load_link_refresh_entries(
            config,
            entries,
            options.missing_paths,
            &refreshed_markdown_asset_ids,
        )?
    } else {
        Vec::new()
    };

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

    for entry in entries.iter().filter(|entry| is_markdown_kind(&entry.kind)) {
        push_markdown_parse_sql(
            &mut sql,
            config,
            entry,
            run_id,
            started_at,
            &asset_by_path,
            &asset_by_basename,
        );
    }

    for entry in &link_refresh_entries {
        push_markdown_parse_sql(
            &mut sql,
            config,
            entry,
            run_id,
            started_at,
            &asset_by_path,
            &asset_by_basename,
        );
    }

    for missing_path in options.missing_paths {
        push_missing_file_sql(&mut sql, config, missing_path, started_at);
    }

    if options.mark_missing_unseen {
        sql.push_str(&format!(
            "UPDATE asset_files SET file_exists = 0, missing_since = COALESCE(missing_since, {started_at}) WHERE vault_id = {} AND last_seen_at < {started_at} AND file_exists = 1;\n",
            sql_text(&config.vault_id)
        ));
    }
    sql.push_str("COMMIT;\n");

    run_sqlite(&config.db_path, &sql)?;
    Ok(WriteIndexResult {
        link_refresh_count: link_refresh_entries.len(),
    })
}

fn push_markdown_parse_sql(
    sql: &mut String,
    config: &Config,
    entry: &FileEntry,
    run_id: &str,
    started_at: i64,
    asset_by_path: &HashMap<String, String>,
    asset_by_basename: &HashMap<String, Vec<String>>,
) {
    let markdown_path = config.root_path.join(&entry.relative_path);
    let content = match fs::read_to_string(&markdown_path) {
        Ok(content) => content,
        Err(error) => {
            push_markdown_cache_sql(sql, config, entry, "failed", None, None, 0, 0, started_at);
            push_sync_event_sql(
                sql,
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
            return;
        }
    };

    let links = parse_markdown_links(&content);
    let title = markdown_title(&content).or_else(|| Some(entry.title.clone()));
    let excerpt = make_excerpt(&content);
    push_markdown_cache_sql(
        sql,
        config,
        entry,
        "parsed",
        title.as_deref(),
        excerpt.as_deref(),
        word_count(&content),
        links.len(),
        started_at,
    );
    sql.push_str(&format!(
        "DELETE FROM asset_links WHERE source_asset_id = {} AND created_from = 'markdown_parse';\n",
        sql_text(&entry.asset_id)
    ));

    for link in links {
        let resolved = resolve_link(entry, &link, asset_by_path, asset_by_basename);
        push_asset_link_sql(sql, config, entry, &link, &resolved, started_at);
    }
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
    files_missing: i64,
) -> Result<(), String> {
    let sql = format!(
        "\
UPDATE sync_runs
SET status = 'completed',
    completed_at = {completed_at},
    duration_ms = {},
    files_seen = {files_seen},
    files_moved = {files_moved},
    files_missing = {files_missing}
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
  title = CASE
    WHEN assets.kind IN ('web', 'youtube')
      AND excluded.kind IN ('web', 'youtube')
    THEN assets.title
    ELSE excluded.title
  END,
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

fn push_missing_file_sql(sql: &mut String, config: &Config, relative_path: &str, now: i64) {
    sql.push_str(&format!(
        "\
UPDATE asset_files
SET file_exists = 0,
    missing_since = COALESCE(missing_since, {now})
WHERE vault_id = {}
  AND relative_path = {}
  AND file_exists = 1;\n",
        sql_text(&config.vault_id),
        sql_text(relative_path),
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
  thumbnail_height, thumbnail_size_bytes, thumbnail_format, thumbnail_luma, video_duration_ms,
  source_size_bytes, source_mtime_ms, source_quick_fingerprint, status, error_message,
  generated_at, updated_at
) VALUES (
  {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, 'ready', NULL, {now}, {now}
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
  thumbnail_luma = excluded.thumbnail_luma,
  video_duration_ms = excluded.video_duration_ms,
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
        sql_nullable(
            generated
                .thumbnail_path
                .as_ref()
                .map(|path| path.display().to_string())
                .as_deref(),
        ),
        generated.thumbnail_width,
        generated.thumbnail_height,
        generated.thumbnail_size_bytes,
        sql_text(generated.thumbnail_format),
        generated.bottom_luma,
        // Videos with a failed duration probe store -1 so cache hits do not retry forever.
        sql_nullable_i64(match (target.kind.as_str(), generated.video_duration_ms) {
            ("video", None) => Some(-1),
            (_, value) => value,
        }),
        target.size_bytes,
        target.mtime_ms,
        sql_text(&target.quick_fingerprint),
    ));
}

fn push_image_cache_duration_sql(
    sql: &mut String,
    target: &ThumbnailTarget,
    video_duration_ms: i64,
    now: i64,
) {
    sql.push_str(&format!(
        "\
UPDATE image_cache
SET video_duration_ms = {video_duration_ms},
    updated_at = {now}
WHERE asset_id = {};\n",
        sql_text(&target.asset_id),
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
    excerpt: Option<&str>,
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
  {}, {}, {}, {}, {}, '[]', {}, 0, {}, {now}, {}
)
ON CONFLICT(asset_id) DO UPDATE SET
  title = excluded.title,
  excerpt = excluded.excerpt,
  word_count = excluded.word_count,
  outbound_link_count = excluded.outbound_link_count,
  parse_status = excluded.parse_status,
  parsed_at = excluded.parsed_at,
  parser_version = excluded.parser_version;\n",
        sql_text(&entry.asset_id),
        sql_text(&config.vault_id),
        sql_nullable(title),
        sql_nullable(excerpt),
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

/// Build a short plain-text excerpt for card previews: skip YAML frontmatter,
/// code fences, headings, and other block decorations, then accumulate prose
/// across paragraphs (joined with `\n` so the renderer's `whitespace-pre-line`
/// keeps the breaks) with inline markup stripped, truncated to a small budget.
/// A short opening paragraph must not starve the preview, so blank lines mark
/// a boundary instead of ending the excerpt.
fn make_excerpt(content: &str) -> Option<String> {
    const MAX_CHARS: usize = 240;

    let mut lines = content.lines().peekable();

    // Skip a leading YAML frontmatter block delimited by `---`.
    if matches!(lines.peek(), Some(first) if first.trim() == "---") {
        lines.next();
        for line in lines.by_ref() {
            if line.trim() == "---" {
                break;
            }
        }
    }

    let mut excerpt = String::new();
    let mut in_code_fence = false;
    let mut at_paragraph_break = false;

    for raw_line in lines {
        let line = raw_line.trim();

        if line.starts_with("```") || line.starts_with("~~~") {
            in_code_fence = !in_code_fence;
            continue;
        }
        if in_code_fence {
            continue;
        }
        if line.is_empty() {
            if !excerpt.is_empty() {
                at_paragraph_break = true;
            }
            continue;
        }
        if is_skippable_block_line(line) {
            continue;
        }

        let cleaned = strip_inline_markdown(line);
        let cleaned = cleaned.trim();
        if cleaned.is_empty() {
            continue;
        }
        if !excerpt.is_empty() {
            excerpt.push(if at_paragraph_break { '\n' } else { ' ' });
        }
        at_paragraph_break = false;
        excerpt.push_str(cleaned);
        if excerpt.chars().count() >= MAX_CHARS {
            break;
        }
    }

    let excerpt = excerpt.trim();
    if excerpt.is_empty() {
        return None;
    }
    Some(truncate_chars(excerpt, MAX_CHARS))
}

/// Block-level lines that carry no prose worth showing in a preview.
fn is_skippable_block_line(line: &str) -> bool {
    line.starts_with('#') || line.starts_with("<!--") || is_thematic_break(line) || is_table_rule(line)
}

fn is_thematic_break(line: &str) -> bool {
    let trimmed: String = line.chars().filter(|c| !c.is_whitespace()).collect();
    trimmed.len() >= 3
        && (trimmed.chars().all(|c| c == '-')
            || trimmed.chars().all(|c| c == '*')
            || trimmed.chars().all(|c| c == '_'))
}

fn is_table_rule(line: &str) -> bool {
    line.contains('-')
        && line
            .chars()
            .all(|c| matches!(c, '|' | '-' | ':' | ' ' | '\t'))
}

/// Remove leading blockquote/list markers, then inline emphasis, code spans,
/// images, and links (keeping their visible text).
fn strip_inline_markdown(line: &str) -> String {
    let chars: Vec<char> = strip_block_prefix(line).chars().collect();
    let mut out = String::with_capacity(chars.len());
    let mut i = 0;

    while i < chars.len() {
        let ch = chars[i];

        // Image `![alt](url)` -> drop entirely.
        if ch == '!' && chars.get(i + 1) == Some(&'[') {
            if let Some(next) = consume_link(&chars, i + 1, true, &mut out) {
                i = next;
                continue;
            }
        }

        if ch == '[' {
            if chars.get(i + 1) == Some(&'[') {
                if let Some(next) = consume_wiki_link(&chars, i, &mut out) {
                    i = next;
                    continue;
                }
            } else if let Some(next) = consume_link(&chars, i, false, &mut out) {
                i = next;
                continue;
            }
        }

        // Drop emphasis / inline-code / strikethrough markers.
        if matches!(ch, '*' | '_' | '`' | '~') {
            i += 1;
            continue;
        }

        out.push(ch);
        i += 1;
    }

    out
}

fn strip_block_prefix(line: &str) -> &str {
    let mut rest = line.trim_start();
    loop {
        if let Some(after) = rest.strip_prefix("> ") {
            rest = after.trim_start();
            continue;
        }
        if rest == ">" {
            return "";
        }
        if let Some(after) = rest
            .strip_prefix("- ")
            .or_else(|| rest.strip_prefix("* "))
            .or_else(|| rest.strip_prefix("+ "))
        {
            rest = strip_task_marker(after.trim_start());
            continue;
        }
        if let Some(after) = strip_ordered_marker(rest) {
            rest = after.trim_start();
            continue;
        }
        break;
    }
    rest
}

fn strip_task_marker(line: &str) -> &str {
    line.strip_prefix("[ ] ")
        .or_else(|| line.strip_prefix("[x] "))
        .or_else(|| line.strip_prefix("[X] "))
        .unwrap_or(line)
}

fn strip_ordered_marker(line: &str) -> Option<&str> {
    let digits_end = line.find(|c: char| !c.is_ascii_digit())?;
    if digits_end == 0 {
        return None;
    }
    let rest = &line[digits_end..];
    rest.strip_prefix(". ").or_else(|| rest.strip_prefix(") "))
}

/// Consume `[text](url)` (or an image when `is_image`) starting at the `[`.
/// Pushes the visible text for links, nothing for images. Returns the index
/// past the closing `)`, or `None` if the span is not a well-formed link.
fn consume_link(chars: &[char], start: usize, is_image: bool, out: &mut String) -> Option<usize> {
    let text_start = start + 1;
    let mut depth = 1;
    let mut j = text_start;
    while j < chars.len() {
        match chars[j] {
            '[' => depth += 1,
            ']' => {
                depth -= 1;
                if depth == 0 {
                    break;
                }
            }
            _ => {}
        }
        j += 1;
    }
    if depth != 0 {
        return None;
    }
    let text_end = j;

    let paren = j + 1;
    if chars.get(paren) != Some(&'(') {
        return None;
    }
    let mut depth = 1;
    let mut k = paren + 1;
    while k < chars.len() {
        match chars[k] {
            '(' => depth += 1,
            ')' => {
                depth -= 1;
                if depth == 0 {
                    break;
                }
            }
            _ => {}
        }
        k += 1;
    }
    if depth != 0 {
        return None;
    }

    if !is_image {
        let text: String = chars[text_start..text_end]
            .iter()
            .filter(|c| !matches!(c, '*' | '_' | '`' | '~'))
            .collect();
        out.push_str(text.trim());
    }
    Some(k + 1)
}

/// Consume `[[target#sub|alias]]` starting at the first `[`, pushing the alias
/// (or target) text. Returns the index past `]]`, or `None` if unterminated.
fn consume_wiki_link(chars: &[char], start: usize, out: &mut String) -> Option<usize> {
    let inner_start = start + 2;
    let mut j = inner_start;
    while j + 1 < chars.len() {
        if chars[j] == ']' && chars[j + 1] == ']' {
            let inner: String = chars[inner_start..j].iter().collect();
            let display = inner.rsplit('|').next().unwrap_or("").trim();
            let display = display.split('#').next().unwrap_or(display).trim();
            out.push_str(display);
            return Some(j + 2);
        }
        j += 1;
    }
    None
}

fn truncate_chars(text: &str, max: usize) -> String {
    if text.chars().count() <= max {
        return text.to_string();
    }
    let truncated: String = text.chars().take(max).collect();
    format!("{}…", truncated.trim_end())
}

fn should_skip(file_name: &OsStr) -> bool {
    match file_name.to_str() {
        // Skip every hidden entry (dotfile or dot-directory) so vault-adjacent
        // tooling folders like .git, .turbo, .obsidian and stray dotfiles never
        // enter the asset index. Skipping a directory also skips its whole subtree.
        // node_modules is not hidden but must stay excluded.
        Some("node_modules") => true,
        Some(value) => value.starts_with('.'),
        None => false,
    }
}

fn kind_for_extension(extension: Option<&str>) -> &'static str {
    match extension.unwrap_or("") {
        "md" | "markdown" => "markdown",
        "png" | "jpg" | "jpeg" | "gif" | "webp" | "avif" | "heic" | "svg" => "image",
        "3g2" | "3gp" | "avi" | "m4v" | "mkv" | "mov" | "mp4" | "mpeg" | "mpg" | "webm" => "video",
        "mp3" | "wav" | "m4a" | "flac" | "aac" | "ogg" => "audio",
        "pdf" => "pdf",
        "doc" | "docx" | "rtf" | "txt" => "document",
        "csv" | "xls" | "xlsx" | "tsv" => "spreadsheet",
        "zip" | "tar" | "gz" | "rar" | "7z" => "archive",
        "url" | "webloc" => "web",
        _ => "other",
    }
}

fn kind_for_path(path: &Path, extension: Option<&str>) -> &'static str {
    let kind = kind_for_extension(extension);
    if kind == "markdown" && markdown_declares_x_post(path) {
        return "post";
    }
    if kind == "web" && extension == Some("url") && internet_shortcut_is_youtube_video(path) {
        return "youtube";
    }

    kind
}

fn is_markdown_kind(kind: &str) -> bool {
    matches!(kind, "markdown" | "post")
}

fn markdown_declares_x_post(path: &Path) -> bool {
    markdown_frontmatter_value(path, "type").as_deref() == Some("x-post")
}

fn internet_shortcut_is_youtube_video(path: &Path) -> bool {
    let Ok(file) = File::open(path) else {
        return false;
    };
    let reader = io::BufReader::new(file);
    reader
        .lines()
        .take(40)
        .filter_map(Result::ok)
        .find_map(|line| {
            let (key, value) = line.split_once('=')?;
            key.trim()
                .eq_ignore_ascii_case("url")
                .then(|| value.trim().to_string())
        })
        .is_some_and(|url| is_youtube_video_url(&url))
}

fn is_youtube_video_url(raw_url: &str) -> bool {
    let normalized = raw_url.trim().to_ascii_lowercase();
    let without_scheme = normalized
        .strip_prefix("https://")
        .or_else(|| normalized.strip_prefix("http://"))
        .unwrap_or(&normalized);
    let authority_end = without_scheme
        .find(['/', '?', '#'])
        .unwrap_or(without_scheme.len());
    let host = without_scheme[..authority_end]
        .split('@')
        .next_back()
        .unwrap_or("")
        .split(':')
        .next()
        .unwrap_or("")
        .trim_start_matches("www.")
        .trim_start_matches("m.");
    let remainder = &without_scheme[authority_end..];

    if host == "youtu.be" {
        return remainder
            .trim_start_matches('/')
            .split(['?', '#', '/'])
            .next()
            .is_some_and(|value| !value.is_empty());
    }
    if host != "youtube.com" && host != "youtube-nocookie.com" {
        return false;
    }

    let path = remainder.split(['?', '#']).next().unwrap_or("");
    if ["/shorts/", "/live/", "/embed/"]
        .iter()
        .any(|prefix| path.strip_prefix(prefix).is_some_and(|id| !id.is_empty()))
    {
        return true;
    }

    remainder
        .split_once('?')
        .map(|(_, query)| query)
        .unwrap_or("")
        .split('&')
        .filter_map(|pair| pair.split_once('='))
        .any(|(key, value)| key == "v" && !value.is_empty())
}

fn markdown_frontmatter_value(path: &Path, key: &str) -> Option<String> {
    let Ok(file) = File::open(path) else {
        return None;
    };
    let reader = io::BufReader::new(file);
    let mut frontmatter_started = false;
    let prefix = format!("{key}:");

    for line in reader.lines().take(80) {
        let Ok(line) = line else {
            return None;
        };
        let trimmed = line.trim();

        if trimmed == "---" {
            if frontmatter_started {
                return None;
            }
            frontmatter_started = true;
            continue;
        }

        if !frontmatter_started {
            if trimmed.is_empty() {
                continue;
            }
            return None;
        }

        if let Some(value) = trimmed.strip_prefix(&prefix) {
            let normalized = value
                .trim()
                .trim_matches(|character| character == '\"' || character == '\'');
            return (!normalized.is_empty()).then(|| normalized.to_string());
        }
    }

    None
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

/// Empty → None (SQL NULL). Keeps negatives such as the -1 "probed, unavailable" sentinel.
fn parse_optional_i64_allow_negative(value: &str) -> Result<Option<i64>, String> {
    if value.is_empty() {
        return Ok(None);
    }
    Ok(Some(parse_i64(value, "optional integer")?))
}

fn parse_optional_u64(value: &str) -> Result<Option<u64>, String> {
    let parsed = parse_i64(value, "optional integer")?;
    Ok((parsed >= 0).then_some(parsed as u64))
}

fn parse_optional_u32(value: &str) -> Result<Option<u32>, String> {
    let parsed = parse_optional_u64(value)?;
    parsed
        .map(|value| {
            u32::try_from(value)
                .map_err(|error| format!("optional integer exceeds u32: {value}: {error}"))
        })
        .transpose()
}

fn truncate_error(value: &str) -> String {
    value.chars().take(500).collect()
}

enum JsonValue {
    String(String),
    Number(i64),
    Raw(String),
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
            JsonValue::Raw(value) => output.push_str(value),
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
    fn average_bottom_luma_reflects_bottom_brightness() {
        let white = image::RgbImage::from_pixel(32, 32, image::Rgb([255, 255, 255]));
        assert!(average_bottom_luma(&white) > 240);

        let black = image::RgbImage::from_pixel(32, 32, image::Rgb([0, 0, 0]));
        assert!(average_bottom_luma(&black) < 15);

        // Dark top, bright bottom: the sampled bottom strip should read as light.
        let mut split = image::RgbImage::from_pixel(32, 32, image::Rgb([0, 0, 0]));
        for y in 24..32 {
            for x in 0..32 {
                split.put_pixel(x, y, image::Rgb([255, 255, 255]));
            }
        }
        assert!(average_bottom_luma(&split) > 200);
    }

    #[test]
    fn uses_original_image_at_or_below_thumbnail_bounds() {
        assert!(should_use_original_image(320, 240));
        assert!(should_use_original_image(720, 720));
        assert!(should_use_original_image(400, 720));
        assert!(!should_use_original_image(721, 480));
    }

    #[test]
    fn skips_hidden_entries_and_node_modules() {
        // Hidden dotfiles and dot-directories are excluded wholesale.
        assert!(should_skip(OsStr::new(".git")));
        assert!(should_skip(OsStr::new(".DS_Store")));
        assert!(should_skip(OsStr::new(".turbo")));
        assert!(should_skip(OsStr::new(".gitignore")));
        assert!(should_skip(OsStr::new(".post-import-123")));
        // node_modules is not hidden but stays excluded.
        assert!(should_skip(OsStr::new("node_modules")));
        // Ordinary files and folders (including ones with a dotted extension) pass.
        assert!(!should_skip(OsStr::new("photo.png")));
        assert!(!should_skip(OsStr::new("notes")));
        assert!(!should_skip(OsStr::new("archive.tar.gz")));
        // A hidden component anywhere in a relative path is skipped.
        assert!(should_skip_relative_path("a/.obsidian/workspace.json"));
        assert!(should_skip_relative_path(".config/app.md"));
        assert!(!should_skip_relative_path("docs/guide.md"));
    }

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

    #[test]
    fn excerpt_skips_frontmatter_and_heading() {
        let content = "---\ntitle: Demo\ntags: [a]\n---\n\n# Heading\n\nFirst **bold** paragraph with a [link](http://x).\n\nSecond paragraph.";
        assert_eq!(
            make_excerpt(content).as_deref(),
            Some("First bold paragraph with a link.\nSecond paragraph.")
        );
    }

    #[test]
    fn excerpt_continues_past_short_opening_paragraph() {
        // A one-line opener must not starve the preview: later paragraphs keep
        // accumulating, separated by newlines, and headings in between are skipped.
        let content = "Opening line.\n\n## Section\n\nSecond paragraph\nwraps here.\n\nThird paragraph.";
        assert_eq!(
            make_excerpt(content).as_deref(),
            Some("Opening line.\nSecond paragraph wraps here.\nThird paragraph.")
        );
    }

    #[test]
    fn excerpt_strips_list_and_wiki_markup() {
        // Consecutive list items (no blank line) fold into one preview block.
        let content = "- [ ] do [[Note#Intro|the thing]]\n- next";
        assert_eq!(
            make_excerpt(content).as_deref(),
            Some("do the thing next")
        );
    }

    #[test]
    fn excerpt_returns_none_for_headings_only() {
        assert_eq!(make_excerpt("# Only\n## Headings").as_deref(), None);
    }

    #[test]
    fn excerpt_truncates_long_text() {
        let long = "word ".repeat(200);
        let excerpt = make_excerpt(&long).expect("excerpt");
        assert!(excerpt.ends_with('…'));
        assert!(excerpt.chars().count() <= 241);
    }

    #[test]
    fn detects_x_post_markdown_frontmatter() {
        let path = env::temp_dir().join(format!("post-indexer-x-post-{}.md", now_ms()));
        fs::write(
            &path,
            "---\ntype: x-post\ntitle: Captured title\npost_id: \"123\"\n---\n\nCaptured post.\n",
        )
        .expect("write x post fixture");

        assert_eq!(kind_for_path(&path, Some("md")), "post");
        assert_eq!(
            markdown_frontmatter_value(&path, "title").as_deref(),
            Some("Captured title")
        );
        fs::remove_file(path).expect("remove x post fixture");
    }

    #[test]
    fn detects_youtube_internet_shortcuts() {
        for url in [
            "https://www.youtube.com/watch?v=abc_123",
            "https://youtu.be/abc_123?t=12",
            "https://www.youtube.com/shorts/abc_123",
            "https://www.youtube-nocookie.com/embed/abc_123",
        ] {
            let path = env::temp_dir().join(format!(
                "post-indexer-youtube-{}-{}.url",
                now_ms(),
                stable_hash(url)
            ));
            fs::write(&path, format!("[InternetShortcut]\nURL={url}\n"))
                .expect("write YouTube shortcut fixture");
            assert_eq!(kind_for_path(&path, Some("url")), "youtube");
            fs::remove_file(path).expect("remove YouTube shortcut fixture");
        }

        assert!(!is_youtube_video_url("https://www.youtube.com/@post"));
        assert!(!is_youtube_video_url(
            "https://www.youtube.com/playlist?list=PL123"
        ));
    }

    #[test]
    fn preserves_bookmark_titles_when_refreshing_url_files() {
        let db_path = env::temp_dir().join(format!(
            "post-indexer-bookmark-title-{}-{}.sqlite",
            now_ms(),
            std::process::id()
        ));
        let config = Config {
            command: CommandKind::Refresh,
            vault_id: "vault-1".to_string(),
            root_path: env::temp_dir(),
            db_path: db_path.clone(),
            thumbnail_root: None,
            asset_ids: Vec::new(),
            paths: Vec::new(),
            limit: None,
            daemon: false,
        };
        let entry = FileEntry {
            asset_id: "asset-1".to_string(),
            file_id: "file-1".to_string(),
            moved_from: None,
            conflict_candidates: Vec::new(),
            relative_path: "assets/web-clips/youtube/abc.url".to_string(),
            file_name: "abc.url".to_string(),
            extension: Some("url".to_string()),
            kind: "youtube".to_string(),
            title: "abc".to_string(),
            size_bytes: 64,
            mtime_ms: 1,
            ctime_ms: Some(1),
            quick_fingerprint: "fingerprint".to_string(),
        };
        let mut sql = "\
CREATE TABLE assets (
  id TEXT PRIMARY KEY,
  vault_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  privacy TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  indexed_at INTEGER,
  deleted_at INTEGER
);
INSERT INTO assets (
  id, vault_id, kind, status, privacy, title, created_at, updated_at, indexed_at
) VALUES (
  'asset-1', 'vault-1', 'youtube', 'inbox', 'normal', 'Custom title', 1, 1, 1
);
"
        .to_string();
        push_asset_sql(&mut sql, &config, &entry, 2);

        run_sqlite(&db_path, &sql).expect("refresh bookmark asset");
        let title = query_sqlite(&db_path, "SELECT title FROM assets WHERE id = 'asset-1';")
            .expect("query refreshed bookmark title");
        assert_eq!(title.trim(), "Custom title");
        fs::remove_file(db_path).expect("remove bookmark title fixture");
    }

    #[test]
    fn retries_thumbnail_only_when_ffmpeg_is_unavailable() {
        assert!(thumbnail_failure_is_retryable(Some(
            "ffmpeg executable unavailable; ffmpeg: not found"
        )));
        assert!(!thumbnail_failure_is_retryable(Some(
            "failed to extract video frame with ffmpeg (/bundled/ffmpeg: Stream map '0:v:0' matches no streams; ffmpeg: not found)"
        )));
        assert!(!thumbnail_failure_is_retryable(Some(
            "failed to extract video frame with ffmpeg: Invalid data found when processing input"
        )));
    }

    #[test]
    fn parses_ffprobe_duration_to_milliseconds() {
        assert_eq!(parse_ffprobe_duration_ms("12.345\n"), Some(12345));
        assert_eq!(parse_ffprobe_duration_ms("0"), Some(0));
        assert_eq!(parse_ffprobe_duration_ms("65.0"), Some(65000));
        assert_eq!(parse_ffprobe_duration_ms(""), None);
        assert_eq!(parse_ffprobe_duration_ms("N/A"), None);
        assert_eq!(parse_ffprobe_duration_ms("-1"), None);
    }

    #[test]
    fn parses_ffmpeg_duration_metadata_line() {
        let stderr = "Input #0, mov, from 'clip.mp4':\n  Duration: 00:01:05.12, start: 0.000000, bitrate: 1234 kb/s\n";
        assert_eq!(parse_ffmpeg_duration_ms(stderr), Some(65120));
        assert_eq!(
            parse_ffmpeg_duration_ms("  Duration: 01:00:00.00, start: 0.000000\n"),
            Some(3_600_000)
        );
        assert_eq!(parse_ffmpeg_duration_ms("Duration: N/A, start: 0.000000"), None);
    }
}
