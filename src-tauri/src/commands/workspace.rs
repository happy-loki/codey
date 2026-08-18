use crate::window_state::WindowState;
use crate::workspace_state::WorkspaceState;
use globset::{Glob, GlobSetBuilder};
use grep_matcher::Matcher;
use grep_regex::RegexMatcherBuilder;
use grep_searcher::{sinks::UTF8, Searcher};
use ignore::WalkBuilder;
use log::info;
use serde::Serialize;
use std::collections::BTreeMap;
use std::path::{Component, Path, PathBuf};
use tauri::{AppHandle, Emitter, State};
use tokio::task;

#[derive(Debug, Clone, Serialize)]
pub struct SearchSubmatch {
    pub start: usize,
    pub end: usize,
    pub text: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct SearchMatch {
    pub line_number: u64,
    pub column: usize,
    pub line: String,
    pub submatches: Vec<SearchSubmatch>,
}

#[derive(Debug, Clone, Serialize)]
pub struct SearchFileResult {
    pub path: String,
    pub relative_path: String,
    pub matches: Vec<SearchMatch>,
}

#[tauri::command]
pub async fn set_workspace_dir(
    app_handle: AppHandle,
    state: State<'_, WorkspaceState>,
    path: Option<String>,
) -> Result<(), String> {
    let mut guard = state.current.write().await;
    let previous = guard.clone();
    *guard = path.clone();
    drop(guard);
    info!(
        "workspace_state_changed previous={:?} next={:?}",
        previous, path
    );

    let _ = app_handle.emit("workspace-dir-changed", path);

    Ok(())
}

#[tauri::command]
pub async fn get_workspace_dir(state: State<'_, WorkspaceState>) -> Result<Option<String>, String> {
    let guard = state.current.read().await;
    Ok(guard.clone())
}

use crate::window_state::{ActiveEditorState, CursorPosition};

/// Get editor context for Auto Context feature
#[tauri::command]
pub async fn get_editor_context(
    state: State<'_, WindowState>,
    context_lines: Option<usize>,
    max_chars: Option<usize>,
) -> Result<serde_json::Value, String> {
    let lines_before_after = context_lines.unwrap_or(50);
    let max_context_chars = max_chars.unwrap_or(10000); // Default 10k chars max
    let cursor_char_radius = 200; // 200 chars on each side of cursor

    let open_tabs = {
        let tabs = state.open_tabs.read().await;
        tabs.clone()
    };

    let active_editor = {
        let active = state.active_editor.read().await;
        active.clone()
    };

    // Collect tab metadata
    let tabs_with_metadata: Vec<serde_json::Value> = open_tabs
        .iter()
        .map(|path| {
            let metadata = std::fs::metadata(path).ok();
            let (line_count, char_count) = if let Ok(content) = std::fs::read_to_string(path) {
                (content.lines().count(), content.chars().count())
            } else {
                (0, 0)
            };

            serde_json::json!({
                "path": path,
                "lines": line_count,
                "chars": char_count,
                "size": metadata.as_ref().map(|m| m.len()).unwrap_or(0),
            })
        })
        .collect();

    let mut context = serde_json::json!({
        "openTabs": tabs_with_metadata,
        "activeEditor": null,
        "activeContent": null,
    });

    if let Some(editor) = active_editor {
        context["activeEditor"] = serde_json::json!({
            "path": editor.path,
            "cursor": {
                "line": editor.cursor.line,
                "column": editor.cursor.column,
            },
        });

        // Read file content around cursor
        if let Ok(content) = std::fs::read_to_string(&editor.path) {
            let lines: Vec<&str> = content.lines().collect();
            let total_lines = lines.len();

            // Try line-based context first
            let start_line = editor.cursor.line.saturating_sub(lines_before_after);
            let end_line = (editor.cursor.line + lines_before_after + 1).min(total_lines);

            let line_context: Vec<&str> = lines[start_line..end_line].to_vec();
            let line_context_str = line_context.join("\n");

            // Check if line-based context is too large
            let context_str = if line_context_str.chars().count() > max_context_chars {
                // Fall back to character-based context around cursor
                let cursor_offset = lines[..editor.cursor.line]
                    .iter()
                    .map(|l| l.chars().count() + 1) // +1 for newline
                    .sum::<usize>()
                    + editor.cursor.column;

                let char_vec: Vec<char> = content.chars().collect();
                let start_char = cursor_offset.saturating_sub(cursor_char_radius);
                let end_char = (cursor_offset + cursor_char_radius).min(char_vec.len());

                let snippet: String = char_vec[start_char..end_char].iter().collect();
                format!(
                    "... (showing {} chars around cursor position) ...\n{}",
                    end_char - start_char,
                    snippet
                )
            } else {
                // Use line-based context with line numbers
                line_context
                    .iter()
                    .enumerate()
                    .map(|(idx, line)| {
                        let line_num = start_line + idx;
                        format!("{:4} | {}", line_num + 1, line)
                    })
                    .collect::<Vec<String>>()
                    .join("\n")
            };

            context["activeContent"] = serde_json::json!({
                "startLine": start_line,
                "endLine": end_line,
                "cursorLine": editor.cursor.line,
                "totalLines": total_lines,
                "totalChars": content.chars().count(),
                "content": context_str,
                "truncated": line_context_str.chars().count() > max_context_chars,
            });
        }
    }

    Ok(context)
}

#[tauri::command]
pub async fn hostbridge_update_tabs(
    state: State<'_, WindowState>,
    paths: Vec<String>,
    active: Option<String>,
    cursor_line: Option<usize>,
    cursor_column: Option<usize>,
) -> Result<(), String> {
    let active_path = active;
    // Update open tabs
    {
        let mut tabs = state.open_tabs.write().await;
        *tabs = paths;
    }

    // Update active editor with cursor position
    {
        let mut active = state.active_editor.write().await;
        *active = if let Some(path) = active_path {
            Some(ActiveEditorState {
                path,
                cursor: CursorPosition {
                    line: cursor_line.unwrap_or(0),
                    column: cursor_column.unwrap_or(0),
                },
                selection: None, // TODO: Add selection support later
            })
        } else {
            None
        };
    }

    Ok(())
}

#[tauri::command]
pub async fn search_workspace(
    _app_handle: AppHandle,
    state: State<'_, WorkspaceState>,
    query: String,
    case_sensitive: Option<bool>,
    limit: Option<usize>,
    globs: Option<Vec<String>>,
    include_hidden: Option<bool>,
) -> Result<Vec<SearchFileResult>, String> {
    let trimmed = query.trim();
    if trimmed.is_empty() {
        return Ok(vec![]);
    }

    let guard = state.current.read().await;
    let root = guard
        .clone()
        .ok_or_else(|| "workspace directory not set".to_string())?;
    drop(guard);

    let search_query = trimmed.to_string();
    let glob_vec = globs.unwrap_or_default();
    let case_sensitive_flag = case_sensitive.unwrap_or(true);
    let max_count = limit.unwrap_or(200);
    let include_hidden_flag = include_hidden.unwrap_or(false);
    let root_path = PathBuf::from(root.clone());

    // Run search in blocking task
    let results = task::spawn_blocking(move || {
        search_workspace_native(
            &root_path,
            &search_query,
            case_sensitive_flag,
            max_count,
            &glob_vec,
            include_hidden_flag,
        )
    })
    .await
    .map_err(|e| format!("search task failed: {}", e))??;

    Ok(results)
}

fn search_workspace_native(
    root_path: &Path,
    query: &str,
    case_sensitive: bool,
    max_count: usize,
    globs: &[String],
    include_hidden: bool,
) -> Result<Vec<SearchFileResult>, String> {
    // Guardrails: workspace search results are returned over IPC and rendered in the Webview.
    // Some workspaces contain huge single-line/minified files where a short query like "ai"
    // can produce *thousands* of matches in one line. If we collect every submatch and return
    // the full line, both backend and UI can effectively stall due to allocations/IPC payload.
    const MAX_SUBMATCHES_PER_LINE: usize = 32;
    const MAX_SUBMATCH_TEXT_BYTES: usize = 256;
    const MAX_LINE_BYTES_FOR_FULL_SCAN: usize = 16 * 1024;
    const MAX_SNIPPET_BYTES: usize = 8 * 1024;
    const SNIPPET_CONTEXT_BYTES: usize = 2 * 1024;

    // Build regex matcher
    let matcher = RegexMatcherBuilder::new()
        .case_insensitive(!case_sensitive)
        .build(query)
        .map_err(|e| format!("Invalid regex pattern: {}", e))?;

    // Build glob set if provided
    let glob_set = if !globs.is_empty() {
        let mut builder = GlobSetBuilder::new();
        for pattern in globs.iter().filter(|g| !g.trim().is_empty()) {
            let glob = Glob::new(pattern)
                .map_err(|e| format!("Invalid glob pattern '{}': {}", pattern, e))?;
            builder.add(glob);
        }
        Some(
            builder
                .build()
                .map_err(|e| format!("Failed to build glob set: {}", e))?,
        )
    } else {
        None
    };

    let mut results: BTreeMap<String, SearchFileResult> = BTreeMap::new();
    let mut total_matches = 0usize;

    // Build walker with .gitignore support.
    // 默认行为与 ripgrep 保持一致：忽略隐藏文件/目录，除非显式要求包含。
    let walker = {
        let mut builder = WalkBuilder::new(root_path);
        if include_hidden {
            builder.hidden(false);
        }
        builder
            .git_ignore(true)
            .git_global(true)
            .git_exclude(true)
            .build()
    };

    for entry in walker {
        if total_matches >= max_count {
            break;
        }

        let entry = match entry {
            Ok(e) => e,
            Err(_) => continue,
        };

        if !entry.file_type().map_or(false, |ft| ft.is_file()) {
            continue;
        }

        let path = entry.path();

        // Apply glob filter if provided
        if let Some(ref gs) = glob_set {
            if !gs.is_match(path) {
                continue;
            }
        }

        // Search file content
        let mut searcher = Searcher::new();
        let mut file_matches: Vec<SearchMatch> = Vec::new();

        let search_result = searcher.search_path(
            &matcher,
            path,
            UTF8(|line_num, line_text| {
                if total_matches >= max_count {
                    return Ok(false); // Stop searching
                }

                let clean_line = line_text.trim_end_matches(['\r', '\n']);

                // For very large lines, avoid re-scanning the entire line for all submatches and
                // avoid returning huge strings to the UI. Instead, take a bounded byte-window
                // around the first match and only collect a capped number of submatches.
                let scan_line = if clean_line.as_bytes().len() > MAX_LINE_BYTES_FOR_FULL_SCAN {
                    match matcher.find(clean_line.as_bytes()) {
                        Ok(Some(mat)) => {
                            let mut start = mat.start().saturating_sub(SNIPPET_CONTEXT_BYTES);
                            let mut end = (mat.end() + SNIPPET_CONTEXT_BYTES).min(clean_line.len());

                            // Enforce an absolute max snippet size.
                            if end.saturating_sub(start) > MAX_SNIPPET_BYTES {
                                start = mat.start().saturating_sub(MAX_SNIPPET_BYTES / 2);
                                end = (start + MAX_SNIPPET_BYTES).min(clean_line.len());
                            }

                            // Make sure we slice on UTF-8 char boundaries.
                            while start < clean_line.len() && !clean_line.is_char_boundary(start) {
                                start += 1;
                            }
                            while end > 0 && !clean_line.is_char_boundary(end) {
                                end -= 1;
                            }
                            if end <= start {
                                clean_line
                            } else {
                                &clean_line[start..end]
                            }
                        }
                        _ => clean_line,
                    }
                } else {
                    clean_line
                };

                // Find all matches in this line
                let mut submatches = Vec::new();
                let mut column = 1usize;

                let _ = matcher.find_iter(scan_line.as_bytes(), |mat| {
                    if submatches.len() >= MAX_SUBMATCHES_PER_LINE {
                        return false;
                    }

                    let start = mat.start();
                    let end = mat.end();

                    if submatches.is_empty() {
                        column = compute_column_from_offset(scan_line, start);
                    }

                    let text_end = end.min(start.saturating_add(MAX_SUBMATCH_TEXT_BYTES));
                    let text =
                        String::from_utf8_lossy(&scan_line.as_bytes()[start..text_end]).to_string();

                    submatches.push(SearchSubmatch {
                        // Offsets are relative to the returned `line` string (which may be a snippet).
                        start,
                        end,
                        text,
                    });

                    true
                });

                if !submatches.is_empty() {
                    file_matches.push(SearchMatch {
                        line_number: line_num,
                        column,
                        // Return a bounded line snippet for huge/minified lines to keep payloads small.
                        line: scan_line.to_string(),
                        submatches,
                    });
                    total_matches += 1;
                }

                Ok(true) // Continue searching
            }),
        );

        if search_result.is_err() || file_matches.is_empty() {
            continue;
        }

        // Add to results
        let absolute_path = normalize_path_buf(path.to_path_buf());
        let key = absolute_path.to_string_lossy().to_string();
        let relative_path =
            make_relative_path(&root_path.to_string_lossy(), &path.to_string_lossy());

        results.insert(
            key.clone(),
            SearchFileResult {
                path: key,
                relative_path,
                matches: file_matches,
            },
        );
    }

    Ok(results.into_values().collect())
}

fn compute_column_from_offset(line: &str, offset: usize) -> usize {
    if offset == 0 {
        return 1;
    }
    let mut count = 0usize;
    for (idx, _) in line.char_indices() {
        if idx >= offset {
            break;
        }
        count += 1;
    }
    count + 1
}

fn normalize_path_buf(input: PathBuf) -> PathBuf {
    let mut normalized = PathBuf::new();
    for component in input.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                let _ = normalized.pop();
            }
            Component::Prefix(prefix) => normalized.push(prefix.as_os_str()),
            Component::RootDir => normalized.push(component.as_os_str()),
            Component::Normal(_) => normalized.push(component.as_os_str()),
        }
    }
    if normalized.as_os_str().is_empty() {
        input
    } else {
        normalized
    }
}

fn make_relative_path(root: &str, path: &str) -> String {
    let full = Path::new(path);
    if full.is_absolute() {
        let root_path = Path::new(root);
        if let Ok(rel) = full.strip_prefix(root_path) {
            return rel.to_string_lossy().to_string();
        }
        return path.to_string();
    }
    let mut rel = path.to_string();
    while rel.starts_with("./") || rel.starts_with(".\\") {
        rel = rel.split_off(2);
    }
    rel
}
