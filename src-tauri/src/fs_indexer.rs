use serde::Serialize;
use std::{
    collections::HashSet,
    fs::Metadata,
    future,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};
use tauri::{AppHandle, Emitter, Manager};
use tokio::{
    select,
    sync::mpsc::{self, UnboundedSender},
    time::{self, Duration as TokioDuration, Instant as TokioInstant},
};

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum FsDiff {
    UpsertChildren {
        version: u64,
        #[serde(rename = "parentPath")]
        parent_path: String,
        entries: Vec<DirEntrySummary>,
        seq: u64,
    },
    RemovePaths {
        version: u64,
        paths: Vec<RemovalSummary>,
        seq: u64,
    },
    RenamePath {
        version: u64,
        #[serde(rename = "oldPath")]
        old_path: String,
        #[serde(rename = "newPath")]
        new_path: String,
        #[serde(rename = "newName")]
        new_name: String,
        seq: u64,
    },
    EndInitial {
        version: u64,
        seq: u64,
    },
    Checkpoint {
        version: u64,
        seq: u64,
    },
}

#[derive(Debug, Clone, Serialize)]
pub struct DirEntrySummary {
    pub name: String,
    #[serde(rename = "isDirectory")]
    pub is_directory: bool,
    pub fingerprint: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct RemovalSummary {
    pub path: String,
    pub fingerprint: Option<String>,
}

#[derive(Default)]
pub struct IndexerInner {
    pub version: u64,
    pub root: PathBuf,
    pub seq: u64,
    pub control_tx: Option<UnboundedSender<FsIndexerControl>>,
}

#[derive(Default)]
pub struct FsIndexerState(pub Arc<Mutex<Option<IndexerInner>>>);

#[derive(Debug)]
enum FsIndexerControl {
    AddScope(PathBuf),
    RemoveScope(PathBuf),
    Shutdown,
}

fn is_in_git_dir(path: &Path) -> bool {
    use std::ffi::OsStr;
    path.ancestors()
        .any(|p| p.file_name() == Some(OsStr::new(".git")))
}

fn read_children(parent: &Path) -> std::io::Result<Vec<DirEntrySummary>> {
    let mut entries: Vec<DirEntrySummary> = std::fs::read_dir(parent)?
        .filter_map(|res| match res {
            Ok(de) => {
                let name = de.file_name().to_string_lossy().into_owned();
                // Skip . and .. implicitly; filter hidden/ignored handled on UI as needed
                let is_dir = de.file_type().map(|t| t.is_dir()).unwrap_or(false);
                Some(DirEntrySummary {
                    name,
                    is_directory: is_dir,
                    fingerprint: entry_fingerprint(&de),
                })
            }
            Err(_) => None,
        })
        .collect();
    // Directory-first + natural name ordering (simple locale-insensitive here; UI can re-sort if needed)
    entries.sort_by(|a, b| {
        if a.is_directory != b.is_directory {
            return if a.is_directory {
                std::cmp::Ordering::Less
            } else {
                std::cmp::Ordering::Greater
            };
        }
        a.name.to_lowercase().cmp(&b.name.to_lowercase())
    });
    Ok(entries)
}

#[cfg(target_os = "windows")]
fn metadata_fingerprint(meta: &Metadata) -> Option<String> {
    use std::os::windows::fs::MetadataExt;
    Some(format!(
        "win:{:x}:{:x}:{:x}:{:x}",
        meta.file_attributes(),
        meta.creation_time(),
        meta.last_write_time(),
        meta.len()
    ))
}

#[cfg(not(target_os = "windows"))]
fn metadata_fingerprint(meta: &Metadata) -> Option<String> {
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        use std::os::unix::fs::MetadataExt;
        return Some(format!("{:x}:{:x}", meta.dev(), meta.ino()));
    }

    #[cfg(target_os = "macos")]
    {
        use std::os::unix::fs::MetadataExt;
        return Some(format!(
            "{:x}:{:x}:{:x}",
            meta.dev(),
            meta.rdev(),
            meta.ino()
        ));
    }

    #[allow(unreachable_code)]
    {
        let len = meta.len();
        let modified = meta
            .modified()
            .ok()
            .and_then(|m| m.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_nanos())
            .unwrap_or_default();
        Some(format!("fallback:{len}:{modified}"))
    }
}

fn entry_fingerprint(entry: &std::fs::DirEntry) -> Option<String> {
    entry.metadata().ok().and_then(|m| metadata_fingerprint(&m))
}

#[tauri::command]
pub async fn start_fs_indexer(app: AppHandle, root: String, version: u64) -> Result<(), String> {
    // Replace any existing indexer state
    let state: tauri::State<'_, FsIndexerState> = app.state();
    let root_path = PathBuf::from(&root);
    let (ctrl_tx, ctrl_rx) = mpsc::unbounded_channel::<FsIndexerControl>();
    {
        // 如果之前已有索引器在运行，先请求它优雅退出，避免同时监听旧工作区
        let mut guard = state.0.lock().unwrap();
        if let Some(prev) = guard.as_ref() {
            if let Some(prev_tx) = prev.control_tx.clone() {
                let _ = prev_tx.send(FsIndexerControl::Shutdown);
            }
        }
        *guard = Some(IndexerInner {
            version,
            root: root_path.clone(),
            seq: 0,
            control_tx: Some(ctrl_tx.clone()),
        });
    }

    // Initial emit: root children
    let entries = read_children(Path::new(&root)).map_err(|e| e.to_string())?;
    let seq = next_seq(&app).ok_or_else(|| "fs indexer state unavailable".to_string())?;
    emit_diff(
        &app,
        FsDiff::UpsertChildren {
            version,
            parent_path: root.clone(),
            entries,
            seq,
        },
    );
    let seq = next_seq(&app).ok_or_else(|| "fs indexer state unavailable".to_string())?;
    emit_diff(&app, FsDiff::EndInitial { version, seq });

    // Spawn watcher with debouncing; only directories explicitly marked active will emit updates
    tauri::async_runtime::spawn(async move {
        use notify::{Event, RecommendedWatcher, RecursiveMode, Watcher};
        let (tx, mut rx) = mpsc::unbounded_channel::<Event>();
        // Create a blocking watcher that sends into async channel
        let mut watcher = RecommendedWatcher::new(
            move |res| {
                if let Ok(ev) = res {
                    let _ = tx.send(ev);
                }
            },
            notify::Config::default(),
        )
        .expect("watcher");
        // 根目录采用递归监听，后续在事件层过滤 .git 等内部目录
        if let Err(e) = watcher.watch(Path::new(&root), RecursiveMode::Recursive) {
            let _ = emit_err(&app, format!("watch error: {e}"));
            return;
        }

        let mut pending: HashSet<PathBuf> = HashSet::new();
        let mut active_scopes: HashSet<PathBuf> = HashSet::new();
        active_scopes.insert(root_path.clone());
        let debounce = TokioDuration::from_millis(250);
        let mut flush_deadline: Option<TokioInstant> = None;
        let mut scope_rx = ctrl_rx;
        let mut shutdown = false;
        let mut last_fs_metrics_log = TokioInstant::now() - TokioDuration::from_secs(10);

        // Rolling 1s window stats (detect high event throughput even if the queue doesn't build up).
        let mut win_started = TokioInstant::now();
        let mut win_events: u64 = 0;
        let mut win_paths: u64 = 0;
        let mut win_pending_added: u64 = 0;
        let mut win_skipped_inactive: u64 = 0;
        let mut win_flushes: u64 = 0;
        let mut win_flush_ms_total: u128 = 0;
        let mut win_flush_ms_max: u128 = 0;

        while !shutdown {
            select! {
                Some(cmd) = scope_rx.recv() => {
                    match cmd {
                        FsIndexerControl::AddScope(path) => {
                            if path.starts_with(&root_path) {
                                active_scopes.insert(path.clone());
                                // debug!("[fs_indexer] 添加监听作用域: {:?}, 当前作用域数: {}", path, active_scopes.len());
                            }
                        }
                        FsIndexerControl::RemoveScope(path) => {
                            if path != root_path {
                                active_scopes.remove(&path);
                                // debug!("[fs_indexer] 移除监听作用域: {:?}, 当前作用域数: {}", path, active_scopes.len());
                            }
                        }
                        FsIndexerControl::Shutdown => {
                            shutdown = true;
                        }
                    }
                }
                Some(ev) = rx.recv() => {
                    let rx_queue_len = rx.len();
                    let batch_started = TokioInstant::now();
                    // 先根据 .git 过滤一遍，如果最终没有需要处理的路径，就直接丢弃事件并不打印日志
                    let mut filtered_ev = ev;
                    filtered_ev.paths.retain(|p| !is_in_git_dir(p));
                    if filtered_ev.paths.is_empty() {
                        continue;
                    }
                    // debug!("[fs_indexer] 收到文件系统事件: kind={:?}, paths={:?}", filtered_ev.kind, filtered_ev.paths);
                    let (paths_count, pending_added, skipped_inactive) = handle_event_batch(
                        filtered_ev,
                        &root_path,
                        &mut pending,
                        &active_scopes,
                    );
                    win_events = win_events.saturating_add(1);
                    win_paths = win_paths.saturating_add(paths_count as u64);
                    win_pending_added = win_pending_added.saturating_add(pending_added as u64);
                    win_skipped_inactive =
                        win_skipped_inactive.saturating_add(skipped_inactive as u64);
                    if !pending.is_empty() {
                        // debug!("[fs_indexer] pending 队列: {} 个目录待刷新", pending.len());
                        if flush_deadline.is_none() {
                            flush_deadline = Some(TokioInstant::now() + debounce);
                        }
                    }
                    if pending.len() > 64 {
                        let flush_started = TokioInstant::now();
                        flush_pending(&app, version, &root_path, &mut pending);
                        let flush_ms = flush_started.elapsed().as_millis();
                        win_flushes = win_flushes.saturating_add(1);
                        win_flush_ms_total = win_flush_ms_total.saturating_add(flush_ms);
                        win_flush_ms_max = win_flush_ms_max.max(flush_ms);
                        if flush_ms >= 50 || rx_queue_len >= 200 {
                            let now = TokioInstant::now();
                            if now.duration_since(last_fs_metrics_log) >= TokioDuration::from_secs(1) {
                                last_fs_metrics_log = now;
                                log::info!(
                                    "fs_indexer metrics: rx_queue_len={} pending_dirs={} event_paths={} event_ms={} flush_ms={} active_scopes={}",
                                    rx_queue_len,
                                    pending.len(),
                                    paths_count,
                                    batch_started.elapsed().as_millis(),
                                    flush_ms,
                                    active_scopes.len()
                                );
                            }
                        }
                        flush_deadline = None;
                    } else {
                        let event_ms = batch_started.elapsed().as_millis();
                        if rx_queue_len >= 200 || pending.len() >= 200 || event_ms >= 20 {
                            let now = TokioInstant::now();
                            if now.duration_since(last_fs_metrics_log) >= TokioDuration::from_secs(1) {
                                last_fs_metrics_log = now;
                                log::info!(
                                    "fs_indexer metrics: rx_queue_len={} pending_dirs={} event_paths={} event_ms={} active_scopes={}",
                                    rx_queue_len,
                                    pending.len(),
                                    paths_count,
                                    event_ms,
                                    active_scopes.len()
                                );
                            }
                        }
                    }

                    // Once-per-second summary when there is meaningful FS activity.
                    // This catches high throughput even if the in-memory queue stays small.
                    if win_started.elapsed() >= TokioDuration::from_secs(1) {
                        let events = win_events;
                        let paths = win_paths;
                        let pending_added = win_pending_added;
                        let skipped = win_skipped_inactive;
                        let flushes = win_flushes;
                        let flush_total = win_flush_ms_total;
                        let flush_max = win_flush_ms_max;

                        win_started = TokioInstant::now();
                        win_events = 0;
                        win_paths = 0;
                        win_pending_added = 0;
                        win_skipped_inactive = 0;
                        win_flushes = 0;
                        win_flush_ms_total = 0;
                        win_flush_ms_max = 0;

                        if events >= 200 || paths >= 2000 || flushes > 0 || rx_queue_len > 0 {
                            log::info!(
                                "fs_indexer rate: events_per_s={} paths_per_s={} pending_added_per_s={} skipped_inactive_per_s={} rx_queue_len={} pending_dirs={} flushes_per_s={} flush_ms_total={} flush_ms_max={} active_scopes={}",
                                events,
                                paths,
                                pending_added,
                                skipped,
                                rx_queue_len,
                                pending.len(),
                                flushes,
                                flush_total,
                                flush_max,
                                active_scopes.len()
                            );
                        }
                    }
                }
                _ = wait_for_deadline(flush_deadline) => {
                    if !pending.is_empty() {
                        let rx_queue_len = rx.len();
                        let flush_started = TokioInstant::now();
                        flush_pending(&app, version, &root_path, &mut pending);
                        let flush_ms = flush_started.elapsed().as_millis();
                        win_flushes = win_flushes.saturating_add(1);
                        win_flush_ms_total = win_flush_ms_total.saturating_add(flush_ms);
                        win_flush_ms_max = win_flush_ms_max.max(flush_ms);
                        if flush_ms >= 50 || rx_queue_len >= 200 {
                            let now = TokioInstant::now();
                            if now.duration_since(last_fs_metrics_log) >= TokioDuration::from_secs(1) {
                                last_fs_metrics_log = now;
                                log::info!(
                                    "fs_indexer metrics: rx_queue_len={} pending_dirs={} flush_ms={} active_scopes={}",
                                    rx_queue_len,
                                    pending.len(),
                                    flush_ms,
                                    active_scopes.len()
                                );
                            }
                        }
                    }
                    flush_deadline = None;
                }
                else => {
                    break;
                }
            }
        }
    });

    Ok(())
}

#[tauri::command]
pub async fn stop_fs_indexer(app: AppHandle, version: u64) -> Result<(), String> {
    let state: tauri::State<'_, FsIndexerState> = app.state();
    let mut guard = match state.0.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    };
    if let Some(inner) = guard.as_ref() {
        if inner.version != version {
            return Ok(());
        }
        if let Some(tx) = inner.control_tx.clone() {
            let _ = tx.send(FsIndexerControl::Shutdown);
        }
    }
    *guard = None;
    Ok(())
}

#[tauri::command]
#[allow(non_snake_case)]
pub async fn list_children(
    _app: AppHandle,
    parentPath: String,
) -> Result<Vec<DirEntrySummary>, String> {
    read_children(Path::new(&parentPath)).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn update_fs_watch_scope(
    app: AppHandle,
    path: String,
    watch: bool,
) -> Result<(), String> {
    let path_buf = PathBuf::from(&path);
    // 完全忽略任何位于 .git 下的监听请求
    if is_in_git_dir(&path_buf) {
        return Ok(());
    }
    let state: tauri::State<'_, FsIndexerState> = app.state();
    let guard = match state.0.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    };
    let Some(inner) = guard.as_ref() else {
        return Err("fs indexer not running".into());
    };
    if !path_buf.starts_with(&inner.root) {
        return Err("path outside of workspace".into());
    }
    let Some(tx) = inner.control_tx.clone() else {
        return Err("indexer control unavailable".into());
    };
    let msg = if watch {
        FsIndexerControl::AddScope(path_buf)
    } else {
        FsIndexerControl::RemoveScope(PathBuf::from(path))
    };
    tx.send(msg).map_err(|e| e.to_string())
}

fn next_seq<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Option<u64> {
    let state: tauri::State<'_, FsIndexerState> = app.state();
    let mut guard = match state.0.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    };
    let inner = guard.as_mut()?;
    inner.seq += 1;
    Some(inner.seq)
}

fn emit_diff<R: tauri::Runtime, T: Serialize + Clone>(app: &tauri::AppHandle<R>, payload: T) {
    let _ = app.emit("fs_diff", payload);
}

fn emit_err<R: tauri::Runtime>(app: &tauri::AppHandle<R>, msg: String) {
    let _ = app.emit("fs_diff", serde_json::json!({"kind":"error","message":msg}));
}

fn handle_event_batch(
    ev: notify::Event,
    root: &PathBuf,
    pending: &mut HashSet<PathBuf>,
    active_scopes: &HashSet<PathBuf>,
) -> (usize, usize, usize) {
    let mut total_paths = 0usize;
    let mut pending_added = 0usize;
    let mut skipped_inactive_scope = 0usize;

    for p in ev.paths {
        total_paths += 1;
        if let Some(parent) = p.parent() {
            let parent_buf = parent.to_path_buf();
            // 忽略任何层级中的 .git 目录
            if is_in_git_dir(&parent_buf) {
                continue;
            }
            // 仅统计当前工作区下的事件；工作区外路径直接忽略
            if !parent_buf.starts_with(root) {
                continue;
            }
            // 仅在父目录在激活作用域集合中时，才触发刷新；否则统计为“未激活”跳过
            if active_scopes.contains(&parent_buf) {
                if pending.insert(parent_buf) {
                    pending_added += 1;
                }
            } else {
                skipped_inactive_scope += 1;
            }
        }
    }

    (total_paths, pending_added, skipped_inactive_scope)
}

fn flush_pending<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    version: u64,
    root: &PathBuf,
    pending: &mut HashSet<PathBuf>,
) {
    use log::warn;
    if pending.is_empty() {
        return;
    }
    let parents: Vec<PathBuf> = pending.drain().collect();
    // debug!(
    //     "[fs_indexer] flush_pending: 处理 {} 个父目录",
    //     parents.len()
    // );
    let mut emitted = false;
    for parent in parents {
        if !parent.starts_with(root) {
            continue;
        }
        // 忽略任何层级中的 .git 目录
        if is_in_git_dir(&parent) {
            continue;
        }
        match read_children(&parent) {
            Ok(entries) => {
                let Some(seq) = next_seq(app) else {
                    return;
                };
                // debug!(
                //     "[fs_indexer] 发送 UpsertChildren: parent={:?}, entries={}",
                //     parent,
                //     entries.len()
                // );
                emit_diff(
                    app,
                    FsDiff::UpsertChildren {
                        version,
                        parent_path: parent.to_string_lossy().into_owned(),
                        entries,
                        seq,
                    },
                );
                emitted = true;
            }
            Err(e) => {
                warn!("[fs_indexer] 读取目录失败: {:?}, error={}", parent, e);
            }
        }
    }
    if emitted {
        let Some(seq) = next_seq(app) else {
            return;
        };
        emit_diff(app, FsDiff::Checkpoint { version, seq });
    }
}

async fn wait_for_deadline(deadline: Option<TokioInstant>) {
    if let Some(when) = deadline {
        time::sleep_until(when).await;
    } else {
        future::pending::<()>().await;
    }
}

pub fn emit_remove_paths<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    removals: Vec<RemovalSummary>,
) -> Result<(), String> {
    if removals.is_empty() {
        return Ok(());
    }
    let state: tauri::State<'_, FsIndexerState> = app.state();
    let mut guard = match state.0.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    };
    let Some(inner) = guard.as_mut() else {
        return Err("fs indexer not running".into());
    };
    inner.seq += 1;
    let seq = inner.seq;
    let version = inner.version;
    drop(guard);
    let mut payload = removals;
    emit_diff(
        app,
        FsDiff::RemovePaths {
            version,
            paths: payload.drain(..).collect(),
            seq,
        },
    );
    Ok(())
}
