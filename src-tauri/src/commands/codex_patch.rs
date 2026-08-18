use std::collections::HashMap;
use std::path::{Path, PathBuf};

use once_cell::sync::Lazy;
use path_clean::PathClean;
use serde::Deserialize;
use tauri::{AppHandle, Emitter, State};
use tokio::fs;
use tokio::sync::Mutex as AsyncMutex;

use crate::codex_protocol_types::{FileUpdateChange, PatchChangeKind};
use crate::workspace_state::WorkspaceState;

// Simple in‑memory undo snapshot store, keyed by snapshotId (e.g. turnId).
#[derive(Debug, Clone)]
enum UndoRecordKind {
    /// Restore a file's previous content at the same path.
    RestoreFile { path: PathBuf, content: String },
    /// Delete a file that was newly created.
    DeleteFile { path: PathBuf },
    /// Restore a file that was moved/renamed (and possibly edited).
    /// `src` is the original path, `dest` is the new path after apply.
    RestoreMove {
        src: PathBuf,
        dest: PathBuf,
        content: String,
    },
}

static UNDO_SNAPSHOTS: Lazy<AsyncMutex<HashMap<String, Vec<UndoRecordKind>>>> =
    Lazy::new(|| AsyncMutex::new(HashMap::new()));

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyFileChangesPayload {
    pub grant_root: Option<String>,
    pub changes: Vec<FileUpdateChange>,
    /// Optional logical snapshot id, typically derived from Codex turn id.
    pub snapshot_id: Option<String>,
}

#[derive(Debug, serde::Serialize)]
pub struct ApplyFileChangesResult {
    pub stdout: String,
    pub stderr: String,
}

#[tauri::command]
pub async fn codex_apply_file_changes(
    app: AppHandle,
    workspace: State<'_, WorkspaceState>,
    payload: ApplyFileChangesPayload,
) -> Result<ApplyFileChangesResult, String> {
    if payload.changes.is_empty() {
        return Ok(ApplyFileChangesResult {
            stdout: String::new(),
            stderr: String::new(),
        });
    }

    let root = match resolve_grant_root(&payload.grant_root) {
        Some(path) => path,
        None => current_workspace_root(&workspace)
            .await
            .ok_or_else(|| "workspace directory not set".to_string())?,
    };

    let mut touched_paths = Vec::new();
    let mut stdout_lines = Vec::new();
    let mut undo_records: Vec<UndoRecordKind> = Vec::new();

    for change in &payload.changes {
        let resolved_path = resolve_target_path(&change.path, Some(&root))?;
        let display_path = match &change.kind {
            PatchChangeKind::Update { move_path } => move_path
                .as_ref()
                .and_then(|p| resolve_target_path(p.to_string_lossy().as_ref(), Some(&root)).ok())
                .unwrap_or_else(|| resolved_path.clone()),
            _ => resolved_path.clone(),
        };

        match &change.kind {
            PatchChangeKind::Add => {
                // 创建新文件
                let pre_existed = fs::metadata(&resolved_path).await.is_ok();
                let previous_content = if pre_existed {
                    Some(read_strict_file(&resolved_path).await?)
                } else {
                    None
                };

                let content = change
                    .diff
                    .lines()
                    .filter_map(|line| line.strip_prefix('+'))
                    .collect::<Vec<_>>()
                    .join("\n");

                if let Some(parent) = resolved_path.parent() {
                    fs::create_dir_all(parent)
                        .await
                        .map_err(|e| format!("Failed to create parent dir: {}", e))?;
                }

                fs::write(
                    &resolved_path,
                    if content.is_empty() {
                        &change.diff
                    } else {
                        &content
                    },
                )
                .await
                .map_err(|e| format!("Failed to write file {}: {}", resolved_path.display(), e))?;

                // Snapshot for undo: if there was existing content, restore it,
                // otherwise delete the newly created file.
                if let Some(prev) = previous_content {
                    undo_records.push(UndoRecordKind::RestoreFile {
                        path: resolved_path.clone(),
                        content: prev,
                    });
                } else {
                    undo_records.push(UndoRecordKind::DeleteFile {
                        path: resolved_path.clone(),
                    });
                }

                stdout_lines.push(format!("A {}", display_path.display()));
                touched_paths.push(display_path);
            }
            PatchChangeKind::Delete => {
                // 删除文件（先捕获原始内容以便撤销时恢复）
                let existed = fs::metadata(&resolved_path).await.is_ok();
                let original = if existed {
                    Some(read_strict_file(&resolved_path).await?)
                } else {
                    None
                };

                if existed {
                    fs::remove_file(&resolved_path).await.map_err(|e| {
                        format!("Failed to delete file {}: {}", resolved_path.display(), e)
                    })?;
                }

                if let Some(content) = original {
                    undo_records.push(UndoRecordKind::RestoreFile {
                        path: resolved_path.clone(),
                        content,
                    });
                }

                stdout_lines.push(format!("D {}", display_path.display()));
                touched_paths.push(display_path);
            }
            PatchChangeKind::Update { move_path } => {
                // 更新文件（可能包含重命名）
                let original = read_strict_file(&resolved_path).await?;
                let updated = apply_unified_diff(&original, &change.diff)?;

                if let Some(target_path) = move_path {
                    let target =
                        resolve_target_path(target_path.to_string_lossy().as_ref(), Some(&root))?;
                    if let Some(parent) = target.parent() {
                        fs::create_dir_all(parent)
                            .await
                            .map_err(|e| format!("Failed to create parent dir: {}", e))?;
                    }
                    fs::write(&target, updated)
                        .await
                        .map_err(|e| format!("Failed to write file {}: {}", target.display(), e))?;
                    fs::remove_file(&resolved_path).await.map_err(|e| {
                        format!(
                            "Failed to remove original {}: {}",
                            resolved_path.display(),
                            e
                        )
                    })?;

                    undo_records.push(UndoRecordKind::RestoreMove {
                        src: resolved_path.clone(),
                        dest: target.clone(),
                        content: original,
                    });

                    stdout_lines.push(format!(
                        "R {} -> {}",
                        resolved_path.display(),
                        target.display()
                    ));
                    touched_paths.push(target);
                } else {
                    fs::write(&resolved_path, updated).await.map_err(|e| {
                        format!("Failed to write file {}: {}", resolved_path.display(), e)
                    })?;

                    undo_records.push(UndoRecordKind::RestoreFile {
                        path: resolved_path.clone(),
                        content: original,
                    });

                    stdout_lines.push(format!("M {}", display_path.display()));
                    touched_paths.push(display_path);
                }
            }
        }
    }

    // Persist undo snapshot (grouped by snapshot_id, typically per turn).
    if let Some(id) = payload.snapshot_id {
        if !undo_records.is_empty() {
            let mut guard = UNDO_SNAPSHOTS.lock().await;
            guard.entry(id).or_default().extend(undo_records);
        }
    }

    for path in touched_paths.iter() {
        let _ = app.emit(
            "hostbridge://file",
            serde_json::json!({
                "type": "saved",
                "path": path.to_string_lossy()
            }),
        );
    }

    Ok(ApplyFileChangesResult {
        stdout: stdout_lines.join("\n"),
        stderr: String::new(),
    })
}

async fn current_workspace_root(state: &WorkspaceState) -> Option<PathBuf> {
    let guard = state.current.read().await;
    guard.as_ref().map(|p| PathBuf::from(p).clean())
}

fn resolve_grant_root(root: &Option<String>) -> Option<PathBuf> {
    root.as_ref().map(|r| PathBuf::from(r).clean())
}

fn resolve_target_path(path: &str, root: Option<&Path>) -> Result<PathBuf, String> {
    let candidate = PathBuf::from(path);
    if candidate.is_absolute() {
        return Ok(candidate.clean());
    }

    let Some(root_path) = root else {
        return Err(format!(
            "Relative path '{}' provided without grantRoot/workspace context",
            path
        ));
    };

    let combined = root_path.join(path).clean();
    if !is_within_root(&combined, root_path) {
        return Err(format!(
            "Path '{}' escapes the allowed root '{}'",
            combined.display(),
            root_path.display()
        ));
    }
    Ok(combined)
}

fn is_within_root(path: &Path, root: &Path) -> bool {
    path.starts_with(root)
}

fn append_add_section(buf: &mut String, path: &Path, contents: &str) {
    buf.push_str("*** Add File: ");
    buf.push_str(&path.to_string_lossy());
    buf.push('\n');
    if contents.is_empty() {
        buf.push_str("+\n");
        return;
    }
    for line in contents.split('\n') {
        buf.push('+');
        buf.push_str(line);
        buf.push('\n');
    }
}

fn append_delete_section(buf: &mut String, path: &Path) {
    buf.push_str("*** Delete File: ");
    buf.push_str(&path.to_string_lossy());
    buf.push('\n');
}

fn apply_unified_diff(original: &str, diff: &str) -> Result<String, String> {
    // 简单的 unified diff 应用逻辑
    // 解析 diff 并逐行应用变更
    let mut result_lines: Vec<&str> = original.lines().collect();
    let mut line_offset: i32 = 0;
    let mut current_pos = 0;

    for line in diff.lines() {
        // 解析 hunk 头部 @@ -start,count +start,count @@
        if line.starts_with("@@") {
            if let Some(header) = line.strip_prefix("@@").and_then(|s| s.split("@@").next()) {
                // 提取 -start,count
                if let Some(old_part) = header.trim().split_whitespace().next() {
                    if let Some(start_str) = old_part.strip_prefix('-') {
                        if let Some(start) = start_str
                            .split(',')
                            .next()
                            .and_then(|s| s.parse::<usize>().ok())
                        {
                            let hunk_old_start = start.saturating_sub(1); // 转换为 0-based
                            current_pos = (hunk_old_start as i32 + line_offset) as usize;
                        }
                    }
                }
            }
            continue;
        }

        // 跳过文件头
        if line.starts_with("---") || line.starts_with("+++") {
            continue;
        }

        // 处理内容行
        if line.starts_with('-') {
            // 删除行
            if current_pos < result_lines.len() {
                result_lines.remove(current_pos);
                line_offset -= 1;
            }
        } else if line.starts_with('+') {
            // 添加行
            let content = &line[1..];
            result_lines.insert(current_pos, content);
            current_pos += 1;
            line_offset += 1;
        } else if line.starts_with(' ') {
            // 上下文行,跳过
            current_pos += 1;
        }
    }

    Ok(result_lines.join("\n"))
}

fn append_update_section(buf: &mut String, path: &Path, move_to: Option<&PathBuf>, diff: &str) {
    buf.push_str("*** Update File: ");
    buf.push_str(&path.to_string_lossy());
    buf.push('\n');
    if let Some(target) = move_to {
        buf.push_str("*** Move to: ");
        buf.push_str(&target.to_string_lossy());
        buf.push('\n');
    }
    buf.push_str(diff);
    if !diff.ends_with('\n') {
        buf.push('\n');
    }
}

#[derive(Debug)]
struct PreparedChange {
    source_path: PathBuf,
    display_path: PathBuf,
    kind: PatchChangeKind,
}

#[derive(Debug)]
struct PreparedPatch {
    script: String,
    entries: Vec<PreparedChange>,
}

fn build_patch_script(
    changes: &[FileUpdateChange],
    root: Option<&Path>,
) -> Result<PreparedPatch, String> {
    let mut patch_script = String::from("*** Begin Patch\n");
    let mut entries = Vec::new();

    for change in changes {
        let resolved_path = resolve_target_path(&change.path, root)?;
        let display_path = match change.kind {
            PatchChangeKind::Update { ref move_path } => move_path
                .as_ref()
                .and_then(|p| resolve_target_path(p.to_string_lossy().as_ref(), root).ok())
                .unwrap_or_else(|| resolved_path.clone()),
            _ => resolved_path.clone(),
        };

        match &change.kind {
            PatchChangeKind::Add => {
                append_add_section(&mut patch_script, &resolved_path, &change.diff)
            }
            PatchChangeKind::Delete => append_delete_section(&mut patch_script, &resolved_path),
            PatchChangeKind::Update { move_path } => {
                let move_target = move_path
                    .as_deref()
                    .map(|p| resolve_target_path(p.to_string_lossy().as_ref(), root))
                    .transpose()?;
                append_update_section(
                    &mut patch_script,
                    &resolved_path,
                    move_target.as_ref(),
                    &change.diff,
                );
            }
        }

        entries.push(PreparedChange {
            source_path: resolved_path,
            display_path,
            kind: change.kind.clone(),
        });
    }

    patch_script.push_str("*** End Patch\n");
    Ok(PreparedPatch {
        script: patch_script,
        entries,
    })
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewFileChangesPayload {
    pub request_id: String,
    pub grant_root: Option<String>,
    pub changes: Vec<FileUpdateChange>,
    /// Optional logical snapshot id (e.g. turn-based) used for undo.
    pub snapshot_id: Option<String>,
}

#[tauri::command]
pub async fn codex_preview_file_changes(
    app: AppHandle,
    workspace: State<'_, WorkspaceState>,
    payload: PreviewFileChangesPayload,
) -> Result<Vec<String>, String> {
    if payload.changes.is_empty() {
        return Ok(vec![]);
    }

    let root = match resolve_grant_root(&payload.grant_root) {
        Some(path) => path,
        None => current_workspace_root(&workspace)
            .await
            .ok_or_else(|| "workspace directory not set".to_string())?,
    };

    let mut diff_ids = Vec::new();
    let mut undo_records: Vec<UndoRecordKind> = Vec::new();
    for (idx, change) in payload.changes.iter().enumerate() {
        let resolved_path = resolve_target_path(&change.path, Some(&root))?;
        let display_path = match &change.kind {
            PatchChangeKind::Update { move_path } => move_path
                .as_ref()
                .and_then(|p| resolve_target_path(p.to_string_lossy().as_ref(), Some(&root)).ok())
                .unwrap_or_else(|| resolved_path.clone()),
            _ => resolved_path.clone(),
        };

        let diff_id = format!("preview-{}-{}", payload.request_id, idx);

        let preview = match &change.kind {
            PatchChangeKind::Add => {
                // 对于新增文件,diff 字段包含的是文件内容(带 + 前缀)
                let content = change
                    .diff
                    .lines()
                    .filter_map(|line| line.strip_prefix('+'))
                    .collect::<Vec<_>>()
                    .join("\n");
                let updated = if content.is_empty() {
                    change.diff.clone()
                } else {
                    content
                };
                let first_change_line = first_changed_line("", &updated);

                // Undo: new file → delete on undo
                undo_records.push(UndoRecordKind::DeleteFile {
                    path: display_path.clone(),
                });

                PreviewDiff {
                    diff_id: diff_id.clone(),
                    path: display_path,
                    original: String::new(),
                    updated,
                    first_change_line,
                }
            }
            PatchChangeKind::Delete => {
                // 对于删除文件,读取当前文件内容
                let original = read_strict_file(&resolved_path).await?;
                let first_change_line = first_changed_line(&original, "");

                // Undo: deleted file → restore original content
                undo_records.push(UndoRecordKind::RestoreFile {
                    path: resolved_path.clone(),
                    content: original.clone(),
                });

                PreviewDiff {
                    diff_id: diff_id.clone(),
                    path: display_path,
                    original,
                    updated: String::new(),
                    first_change_line,
                }
            }
            PatchChangeKind::Update { .. } => {
                // 对于更新文件,使用 unified diff 来计算新内容
                let original = read_strict_file(&resolved_path).await?;
                let updated = apply_unified_diff(&original, &change.diff)?;
                let first_change_line = first_changed_line(&original, &updated);

                // Undo: update（含 rename）→ 恢复旧内容 / 旧路径
                match &change.kind {
                    PatchChangeKind::Update { move_path } if move_path.is_some() => {
                        undo_records.push(UndoRecordKind::RestoreMove {
                            src: resolved_path.clone(),
                            dest: display_path.clone(),
                            content: original.clone(),
                        });
                    }
                    _ => {
                        undo_records.push(UndoRecordKind::RestoreFile {
                            path: resolved_path.clone(),
                            content: original.clone(),
                        });
                    }
                }

                PreviewDiff {
                    diff_id: diff_id.clone(),
                    path: display_path,
                    original,
                    updated,
                    first_change_line,
                }
            }
        };

        emit_diff_events(&app, &preview)?;
        diff_ids.push(diff_id);
    }

    // Persist undo snapshot if requested.
    if let Some(id) = payload.snapshot_id {
        if !undo_records.is_empty() {
            let mut guard = UNDO_SNAPSHOTS.lock().await;
            // 每次预览覆盖该 snapshotId 的旧记录，保持“当前这一轮”的快照。
            guard.insert(id, undo_records);
        }
    }

    Ok(diff_ids)
}

#[tauri::command]
pub async fn codex_close_file_change_previews(
    app: AppHandle,
    diff_ids: Vec<String>,
) -> Result<(), String> {
    for diff_id in diff_ids {
        let _ = app.emit(
            "hostbridge://diff",
            serde_json::json!({
                "type": "close",
                "diffId": diff_id,
            }),
        );
    }
    Ok(())
}

#[derive(Debug)]
struct PreviewDiff {
    diff_id: String,
    path: PathBuf,
    original: String,
    updated: String,
    first_change_line: usize,
}

fn emit_diff_events(app: &AppHandle, preview: &PreviewDiff) -> Result<(), String> {
    app.emit(
        "hostbridge://diff",
        serde_json::json!({
            "type": "open",
            "diffId": preview.diff_id,
            "path": preview.path.to_string_lossy(),
            "original": preview.original,
        }),
    )
    .map_err(|e| format!("Failed to emit diff open event: {}", e))?;

    let end_line = preview.original.lines().count() as i32;
    app.emit(
        "hostbridge://diff",
        serde_json::json!({
            "type": "replace",
            "diffId": preview.diff_id,
            "startLine": 0,
            "endLine": end_line,
            "content": preview.updated,
        }),
    )
    .map_err(|e| format!("Failed to emit diff replace event: {}", e))?;

    if preview.original != preview.updated {
        let line = preview.first_change_line.min(i32::MAX as usize) as i32;
        app.emit(
            "hostbridge://diff",
            serde_json::json!({
                "type": "scroll",
                "diffId": preview.diff_id,
                "line": line,
            }),
        )
        .map_err(|e| format!("Failed to emit diff scroll event: {}", e))?;
    }

    Ok(())
}

fn normalize_newlines(input: &str) -> std::borrow::Cow<'_, str> {
    if input.contains("\r\n") {
        std::borrow::Cow::Owned(input.replace("\r\n", "\n"))
    } else {
        std::borrow::Cow::Borrowed(input)
    }
}

fn first_changed_line(original: &str, updated: &str) -> usize {
    let original_norm = normalize_newlines(original);
    let updated_norm = normalize_newlines(updated);
    let mut idx: usize = 0;
    let mut orig_iter = original_norm.split('\n');
    let mut updated_iter = updated_norm.split('\n');

    loop {
        match (orig_iter.next(), updated_iter.next()) {
            (Some(o), Some(u)) => {
                if o != u {
                    return idx;
                }
            }
            (Some(_), None) | (None, Some(_)) => {
                return idx;
            }
            (None, None) => {
                return 0;
            }
        }
        idx += 1;
    }
}

async fn read_strict_file(path: &Path) -> Result<String, String> {
    fs::read_to_string(path)
        .await
        .map_err(|err| format!("Failed to read {}: {}", path.display(), err))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UndoSnapshotPayload {
    pub snapshot_id: String,
}

/// Apply a previously recorded undo snapshot (typically for a single Codex turn).
#[tauri::command]
pub async fn codex_apply_undo_snapshot(
    app: AppHandle,
    payload: UndoSnapshotPayload,
) -> Result<ApplyFileChangesResult, String> {
    let mut guard = UNDO_SNAPSHOTS.lock().await;
    let Some(mut records) = guard.remove(&payload.snapshot_id) else {
        return Err(format!(
            "No undo snapshot found for id '{}'",
            payload.snapshot_id
        ));
    };
    drop(guard);

    // Apply in reverse order to better mirror original mutations.
    records.reverse();

    let mut stdout_lines = Vec::new();
    let mut touched_paths: Vec<PathBuf> = Vec::new();

    for record in records {
        match record {
            UndoRecordKind::RestoreFile { path, content } => {
                if let Some(parent) = path.parent() {
                    if let Err(e) = fs::create_dir_all(parent).await {
                        return Err(format!(
                            "Failed to create parent dir for undo {}: {}",
                            path.display(),
                            e
                        ));
                    }
                }
                if let Err(e) = fs::write(&path, &content).await {
                    return Err(format!(
                        "Failed to restore file during undo {}: {}",
                        path.display(),
                        e
                    ));
                }
                stdout_lines.push(format!("U {}", path.display()));
                touched_paths.push(path);
            }
            UndoRecordKind::DeleteFile { path } => {
                if fs::metadata(&path).await.is_ok() {
                    if let Err(e) = fs::remove_file(&path).await {
                        return Err(format!(
                            "Failed to delete file during undo {}: {}",
                            path.display(),
                            e
                        ));
                    }
                    stdout_lines.push(format!("D {}", path.display()));
                    touched_paths.push(path);
                }
            }
            UndoRecordKind::RestoreMove { src, dest, content } => {
                // Best‑effort: remove the moved/renamed path, then restore the original.
                if fs::metadata(&dest).await.is_ok() {
                    if let Err(e) = fs::remove_file(&dest).await {
                        return Err(format!(
                            "Failed to remove moved file during undo {}: {}",
                            dest.display(),
                            e
                        ));
                    }
                }
                if let Some(parent) = src.parent() {
                    if let Err(e) = fs::create_dir_all(parent).await {
                        return Err(format!(
                            "Failed to create parent dir for undo {}: {}",
                            src.display(),
                            e
                        ));
                    }
                }
                if let Err(e) = fs::write(&src, &content).await {
                    return Err(format!(
                        "Failed to restore moved file during undo {}: {}",
                        src.display(),
                        e
                    ));
                }
                stdout_lines.push(format!("R {} <- {}", src.display(), dest.display()));
                touched_paths.push(src);
            }
        }
    }

    for path in touched_paths {
        let _ = app.emit(
            "hostbridge://file",
            serde_json::json!({
                "type": "saved",
                "path": path.to_string_lossy()
            }),
        );
    }

    Ok(ApplyFileChangesResult {
        stdout: stdout_lines.join("\n"),
        stderr: String::new(),
    })
}
