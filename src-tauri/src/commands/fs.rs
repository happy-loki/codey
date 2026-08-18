use crate::encoding::{convert_to_u16, BOM};
use crate::fs_indexer::{self, RemovalSummary};
use crate::window_state::WindowState;
use chardetng::EncodingDetector;
use log::{error, info, warn};
use std::collections;
use std::fs::{self, File};
use std::io::Write;
use std::path::{Path, PathBuf};
use tauri::State;
use tokio::task;

#[derive(Hash, Eq, PartialEq, Debug, serde::Serialize)]
pub struct FileData {
    pub text: String,
    pub encoding: String,
    pub extension: String,
    pub bom: bool,
    pub spaces: usize,
}

#[tauri::command]
pub fn is_file(path: &str) -> bool {
    let p = path.trim();
    if p.is_empty() || p.starts_with("data:") || p.starts_with("blob:") || p.contains("://") {
        return false;
    }

    match fs::metadata(p) {
        Ok(r) => r.is_file(),
        Err(_) => false,
    }
}

#[tauri::command]
pub fn is_folder(path: &str) -> bool {
    let p = path.trim();
    if p.is_empty() || p.starts_with("data:") || p.starts_with("blob:") || p.contains("://") {
        return false;
    }

    match fs::metadata(p) {
        Ok(r) => r.is_dir(),
        Err(_) => false,
    }
}

#[tauri::command]
pub fn file_size(path: &str) -> u64 {
    let p = path.trim();
    if p.is_empty() || p.starts_with("data:") || p.starts_with("blob:") || p.contains("://") {
        return 0;
    }
    match fs::metadata(p) {
        Ok(meta) if meta.is_file() => meta.len(),
        _ => 0,
    }
}

#[tauri::command]
pub fn attempt_file_access(_app_handle: tauri::AppHandle, _p: &str) {}

fn perform_delete(path: &str, perm: bool) -> Result<(), String> {
    if perm {
        if is_file(path) {
            fs::remove_file(path)
                .map_err(|err| format!("Cannot remove {}. Error: {}.", path, err))?;
            info!("{:?} sucessfully deleted.", PathBuf::from(path).file_name());
        } else {
            fs::remove_dir_all(path)
                .map_err(|err| format!("Cannot remove {}. Error: {}.", path, err))?;
            info!("Path {} deleted sucessfully.", path);
        }
    } else {
        trash::delete(path).map_err(|err| format!("Cannot remove {}. Error: {}.", path, err))?;
        info!(
            "{:?} sucessfully moved to trash.",
            PathBuf::from(path).file_name()
        );
    }
    Ok(())
}

#[tauri::command]
pub async fn delete_file(
    app_handle: tauri::AppHandle,
    path: String,
    perm: bool,
    fingerprint: Option<String>,
) {
    let path_for_join_log = path.clone();
    let notify_path = path.clone();
    let handle = app_handle.clone();
    tauri::async_runtime::spawn(async move {
        let perm_flag = perm;
        let owned_path = path;
        let join_path = path_for_join_log;
        let notify_fp = fingerprint.clone();
        let result = task::spawn_blocking(move || perform_delete(&owned_path, perm_flag)).await;
        match result {
            Ok(Ok(())) => {
                if let Err(err) = fs_indexer::emit_remove_paths(
                    &handle,
                    vec![RemovalSummary {
                        path: notify_path.clone(),
                        fingerprint: notify_fp.clone(),
                    }],
                ) {
                    warn!(
                        "[delete_file] notify remove failed for {}: {}",
                        notify_path, err
                    );
                }
            }
            Ok(Err(err_msg)) => error!("{}", err_msg),
            Err(join_err) => error!("Delete task join error for {}: {}", join_path, join_err),
        }
    });
}

#[tauri::command]
pub fn read_file(state: State<'_, WindowState>, path: &str) -> FileData {
    // info!("Attempting to read file in {}.", path);

    let mut bytes: Vec<u8> = vec![];
    match fs::read(path) {
        Ok(b) => bytes = b,
        Err(err) => error!("Cannot read {}. Error: {}", path, err),
    }

    let ext = match Path::new(path).extension() {
        Some(v) => v.to_str().unwrap_or_default(),
        None => {
            error!("No extension found for {}", path);
            ""
        }
    };

    let file_data: FileData;

    let filename = Path::new(path)
        .file_name()
        .and_then(|v| v.to_str())
        .unwrap_or(path);

    if let Some(data) = encoding_rs::Encoding::for_bom(&bytes) {
        let (text, encoding, _) = data.0.decode(&bytes);
        let t = text.to_string();
        let lines: Vec<&str> = t.lines().collect();
        let space_count = detect_indent(&lines).unwrap_or(0);

        file_data = FileData {
            text: text.to_string(),
            encoding: encoding.name().to_string(),
            extension: ext.to_string(),
            bom: true,
            spaces: space_count,
        };
        info!(
            "File BOM found for {}. Encoding with {}...",
            filename,
            encoding.name()
        );
    } else {
        let (text, encoding) = if std::str::from_utf8(&bytes).is_ok() {
            let (text, encoding, _) = encoding_rs::UTF_8.decode(&bytes);
            (text, encoding)
        } else {
            let mut detector = EncodingDetector::new();
            detector.feed(&bytes, true);
            let guessed = detector.guess(None, true);
            let (text, _, _) = guessed.decode(&bytes);
            (text, guessed)
        };
        let t = text.to_string();
        let lines: Vec<&str> = t.lines().collect();
        let space_count = detect_indent(&lines).unwrap_or(0);

        file_data = FileData {
            text: text.to_string(),
            encoding: encoding.name().to_string(),
            extension: ext.to_string(),
            bom: false,
            spaces: space_count,
        };
        // info!(
        //     "No file BOM found for {}. Decoded as {}...",
        //     filename,
        //     encoding.name()
        // );
    }
    {
        let p = path.to_string();
        tauri::async_runtime::block_on(async {
            let mut tabs = state.open_tabs.write().await;
            if !tabs.iter().any(|t| t == &p) {
                tabs.push(p.clone());
            }
            let mut active = state.active_editor.write().await;
            *active = Some(crate::window_state::ActiveEditorState {
                path: p.clone(),
                cursor: crate::window_state::CursorPosition { line: 0, column: 0 },
                selection: None,
            });
        });
        // info!(
        //     "UI fallback → WindowState: add open_tab and set active: {}",
        //     path
        // );
    }

    file_data
}

#[tauri::command]
pub fn write_file(path: &str, content: &str, enc: &str, has_bom: bool) {
    info!("Attempting to write file to {}.", path);

    let mut output = Vec::new();
    if let Some(data) = encoding_rs::Encoding::for_label(enc.as_bytes()) {
        let (bytes, _, _) = data.encode(content);
        let mut c_bytes = bytes.to_vec();
        let mut bom: Vec<u8> = Vec::new();
        if has_bom {
            info!("Encoding file to {} encoding...", enc);
            if enc == "UTF-8" {
                bom = b"\xEF\xBB\xBF".to_vec();
            } else if enc == "UTF-16BE" {
                c_bytes = convert_to_u16(content, BOM::BigEndian);
            } else if enc == "UTF-16LE" {
                c_bytes = convert_to_u16(content, BOM::LittleEndian);
            }
        }
        output = [bom.as_slice(), c_bytes.as_slice()].concat();
    }

    if !PathBuf::from(path).exists() {
        info!("{} not found. Creating new file...", path);
    }

    let file = File::create(path);
    match file {
        Ok(mut f) => {
            f.write_all(&output).unwrap();
        }
        Err(err) => error!("Cannot write to {}. Error: {}", path, err),
    }
}

#[tauri::command]
pub fn read_file_bytes(path: &str) -> Result<Vec<u8>, String> {
    match fs::read(path) {
        Ok(bytes) => Ok(bytes),
        Err(err) => Err(err.to_string()),
    }
}

fn looks_textual_bytes(sample: &[u8]) -> bool {
    if sample.is_empty() {
        return true;
    }
    // VSCode-like: treat NUL bytes as a strong binary signal.
    if sample.iter().any(|b| *b == 0x00) {
        return false;
    }
    // Heuristic "binary" detection:
    // If we see a lot of control bytes (excluding TAB/CR/LF), it's likely binary.
    let mut suspicious_controls = 0usize;
    for &b in sample {
        let is_suspicious =
            b < 0x09 || b == 0x0B || b == 0x0C || (b > 0x0D && b < 0x20) || b == 0x7F;
        if is_suspicious {
            suspicious_controls += 1;
        }
    }
    // If >5% of bytes are suspicious controls, treat as non-textual.
    suspicious_controls * 100 <= sample.len().saturating_mul(5)
}

fn looks_textual_file(path: &str) -> bool {
    let p = path.trim();
    if p.is_empty() || p.starts_with("data:") || p.starts_with("blob:") || p.contains("://") {
        return false;
    }
    match std::fs::read(p) {
        Ok(bytes) => {
            if encoding_rs::Encoding::for_bom(&bytes).is_some() {
                return true;
            }
            let n = bytes.len().min(8192);
            looks_textual_bytes(&bytes[..n])
        }
        Err(_) => false,
    }
}

fn is_textual_mime(mime: &str) -> bool {
    if mime.contains("text") {
        return true;
    }
    if mime.starts_with("image/") {
        return true;
    }
    matches!(
        mime,
        "application/json"
            | "application/ndjson"
            | "application/javascript"
            | "application/x-javascript"
            | "application/xml"
            | "application/x-sh"
            | "application/x-shellscript"
            | "application/x-python"
            | "application/x-ruby"
            | "application/x-perl"
            | "application/x-php"
            | "application/sql"
            | "application/x-sql"
            | "application/yaml"
            | "application/x-yaml"
            | "application/toml"
    )
}

#[tauri::command]
pub fn is_supported(path: &str) -> bool {
    let p = path.trim();
    if p.is_empty() || p.starts_with("data:") || p.starts_with("blob:") || p.contains("://") {
        return false;
    }
    match infer::get_from_path(p) {
        Ok(Some(info)) => {
            let mime = info.mime_type();
            if is_textual_mime(mime) {
                return true;
            }
            if mime.starts_with("application/") {
                return looks_textual_file(p);
            }
            false
        }
        Ok(None) => looks_textual_file(p),
        Err(e) => {
            error!("infer error on {}: {}", p, e);
            looks_textual_file(p)
        }
    }
}

fn detect_indent(lines: &[&str]) -> Option<usize> {
    let mut indents: collections::HashMap<usize, usize> = collections::HashMap::new();
    let mut last = 0;

    for &text in lines.iter() {
        let width = text.find(|c: char| c != ' ').unwrap_or_else(|| text.len());

        let indent = (width as isize - last as isize).abs() as usize;
        if indent > 1 {
            *indents.entry(indent).or_insert(0) += 1;
        }
        last = width;
    }

    let mut max = 0;
    let mut indent = None;
    for (&width, &tally) in &indents {
        if tally > max {
            max = tally;
            indent = Some(width);
        }
    }

    indent
}
