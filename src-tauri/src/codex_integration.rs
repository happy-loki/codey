/// Codex integration using an external `codex app-server` process.
///
/// Codey is only a desktop client here. Codex runtime, home directory,
/// config, skills, plugins, and auth are owned by the user's global Codex CLI.
use anyhow::{Context, Result};
use log::{debug, error, info, warn};
use std::collections::HashMap;
use std::env;
use std::ffi::{OsStr, OsString};
use std::io::ErrorKind;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, Command};
use tokio::sync::{oneshot, Mutex, Notify};

use crate::codex_protocol_types::RequestId;
use crate::proxy::{apply_proxy_to_process_env, resolve_proxy_env, resolve_proxy_mode, ProxyMode};

const CODEY_CODEX_CLIENT_INFO_NAME: &str = "Codey";
const CODEY_CODEX_CLIENT_INFO_VERSION: &str = env!("CARGO_PKG_VERSION");

#[cfg(windows)]
use std::os::windows::process::CommandExt;

fn codex_environment_write_disabled_message() -> String {
    "Codey no longer modifies Codex global config, skills, plugins, or marketplaces. Use the Codex CLI/global config directly.".to_string()
}

fn codex_appx_access_denied_message(candidate: &Path) -> String {
    format!(
        "ChatGPT/Codex AppX CLI was found at `{}`, but the current Codey process cannot execute binaries from WindowsApps without the app package identity. Put a runnable `codex.exe`/`codex.cmd` on PATH, or set CODEY_CODEX_BIN to a runnable global Codex CLI. Do not change WindowsApps permissions.",
        candidate.display()
    )
}

fn is_windows_appx_codex_path(path: &Path) -> bool {
    #[cfg(target_os = "windows")]
    {
        let components = path.components().collect::<Vec<_>>();
        return components.iter().any(|component| {
            component
                .as_os_str()
                .to_string_lossy()
                .eq_ignore_ascii_case("WindowsApps")
        }) && components.iter().any(|component| {
            let name = component.as_os_str().to_string_lossy();
            name.starts_with("OpenAI.Codex_") || name.starts_with("OpenAI.ChatGPT_")
        });
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = path;
        false
    }
}

fn is_permission_denied(error: &std::io::Error) -> bool {
    error.kind() == ErrorKind::PermissionDenied || error.raw_os_error() == Some(5)
}

fn hide_console_on_windows(_command: &mut Command) {
    #[cfg(windows)]
    {
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        _command.as_std_mut().creation_flags(CREATE_NO_WINDOW);
    }
}

fn codex_tokio_command(program: impl AsRef<OsStr>) -> Command {
    let mut command = Command::new(program);
    hide_console_on_windows(&mut command);
    command
}

fn summarize_thread_resume_response(response: &serde_json::Value) -> (String, usize) {
    let thread = response.get("thread").unwrap_or(&serde_json::Value::Null);
    let thread_id = thread
        .get("id")
        .and_then(|v| v.as_str())
        .unwrap_or("<unknown>")
        .to_string();
    let turns_count = thread
        .get("turns")
        .and_then(|v| v.as_array())
        .map(|v| v.len())
        .unwrap_or(0);
    (thread_id, turns_count)
}

fn truncate_chars(input: &str, max_chars: usize) -> String {
    if max_chars == 0 {
        return String::new();
    }
    let mut out = String::with_capacity(input.len().min(max_chars));
    let mut count = 0usize;
    for ch in input.chars() {
        if count >= max_chars {
            out.push_str("…");
            break;
        }
        out.push(ch);
        count += 1;
    }
    out
}

fn summarize_thread_list_response(
    response: &serde_json::Value,
    max_preview_chars: usize,
) -> serde_json::Value {
    let data = response.get("data").and_then(|v| v.as_array());
    let items = data
        .map(|arr| {
            arr.iter()
                .map(|thread| {
                    let id = thread.get("id").and_then(|v| v.as_str());
                    let created_at = thread.get("createdAt").and_then(|v| v.as_i64());
                    let cwd = thread.get("cwd").and_then(|v| v.as_str());
                    let preview = thread.get("preview").and_then(|v| v.as_str()).unwrap_or("");
                    serde_json::json!({
                        "id": id,
                        "createdAt": created_at,
                        "cwd": cwd,
                        "previewChars": preview.chars().count(),
                        "previewTruncated": truncate_chars(preview, max_preview_chars),
                    })
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    serde_json::json!({
        "count": items.len(),
        "nextCursor": response.get("nextCursor"),
        "data": items,
    })
}

/// State for managing Codex integration
pub struct CodexState {
    inner: Mutex<CodexStateInner>,
    ready_notify: Notify,
}

struct CodexStateInner {
    client: Option<Arc<ExternalCodexClient>>,
    init_error: Option<String>,
}

struct ExternalCodexClient {
    child: Mutex<Child>,
    stdin: Mutex<ChildStdin>,
    pending: Mutex<HashMap<String, oneshot::Sender<serde_json::Value>>>,
    next_id: AtomicU64,
}

impl ExternalCodexClient {
    fn new(child: Child, stdin: ChildStdin) -> Self {
        Self {
            child: Mutex::new(child),
            stdin: Mutex::new(stdin),
            pending: Mutex::new(HashMap::new()),
            next_id: AtomicU64::new(1),
        }
    }

    async fn write_message(&self, value: serde_json::Value) -> Result<()> {
        let mut line =
            serde_json::to_string(&value).context("failed to serialize Codex message")?;
        line.push('\n');
        let mut stdin = self.stdin.lock().await;
        stdin
            .write_all(line.as_bytes())
            .await
            .context("failed to write Codex message")?;
        stdin.flush().await.context("failed to flush Codex stdin")?;
        Ok(())
    }

    async fn send_request(
        &self,
        method: String,
        params: Option<serde_json::Value>,
    ) -> Result<serde_json::Value> {
        let id = self.next_id.fetch_add(1, Ordering::SeqCst);
        let id_key = id.to_string();
        let method_name = method.clone();
        let (tx, rx) = oneshot::channel();
        self.pending.lock().await.insert(id_key.clone(), tx);

        let mut request = serde_json::json!({
            "id": id,
            "method": method,
        });
        if let Some(params) = params {
            request["params"] = params;
        }

        let started = std::time::Instant::now();
        debug!(
            "Codex external send_request start: method={} id={}",
            method_name, id_key
        );

        if let Err(err) = self.write_message(request).await {
            self.pending.lock().await.remove(&id_key);
            return Err(err).with_context(|| {
                format!(
                    "Codex request transport failed before send (method={} id={})",
                    method_name, id_key
                )
            });
        }

        let request_timeout = if method_name == "thread/list" {
            Duration::from_secs(300)
        } else {
            Duration::from_secs(60)
        };

        let envelope = match tokio::time::timeout(request_timeout, rx).await {
            Ok(Ok(value)) => value,
            Ok(Err(_)) => {
                anyhow::bail!(
                    "Codex request canceled (method={} id={})",
                    method_name,
                    id_key
                );
            }
            Err(_) => {
                self.pending.lock().await.remove(&id_key);
                anyhow::bail!("Request timeout (method={} id={})", method_name, id_key);
            }
        };

        if let Some(error) = envelope.get("error") {
            let message = error
                .get("message")
                .and_then(|value| value.as_str())
                .map(str::to_string)
                .unwrap_or_else(|| error.to_string());
            let code = error
                .get("code")
                .map(|value| value.to_string())
                .unwrap_or_else(|| "<unknown>".to_string());
            warn!(
                "Codex external send_request error: method={} id={} code={} message={} elapsed_ms={}",
                method_name,
                id_key,
                code,
                message,
                started.elapsed().as_millis()
            );
            anyhow::bail!(
                "Codex request failed (method={} id={} code={}): {}",
                method_name,
                id_key,
                code,
                message
            );
        }

        debug!(
            "Codex external send_request done: method={} id={} elapsed_ms={}",
            method_name,
            id_key,
            started.elapsed().as_millis()
        );

        Ok(envelope
            .get("result")
            .cloned()
            .unwrap_or(serde_json::Value::Null))
    }

    async fn send_response(
        &self,
        request_id: RequestId,
        response: serde_json::Value,
    ) -> Result<()> {
        self.write_message(serde_json::json!({
            "id": request_id.as_json_value(),
            "result": response,
        }))
        .await
    }

    async fn clear_pending(&self) {
        self.pending.lock().await.clear();
    }
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexInterruptGuardState {
    pub requires_confirmation: bool,
    pub thread_id: Option<String>,
    pub thread_name: Option<String>,
    pub turn_id: Option<String>,
}

impl CodexState {
    fn pending() -> Self {
        Self {
            inner: Mutex::new(CodexStateInner {
                client: None,
                init_error: None,
            }),
            ready_notify: Notify::new(),
        }
    }

    async fn mark_ready(&self, client: Arc<ExternalCodexClient>) {
        let mut inner = self.inner.lock().await;
        inner.client = Some(client);
        inner.init_error = None;
        drop(inner);
        self.ready_notify.notify_waiters();
    }

    async fn mark_failed(&self, error: String) {
        let mut inner = self.inner.lock().await;
        inner.client = None;
        inner.init_error = Some(error);
        drop(inner);
        self.ready_notify.notify_waiters();
    }

    async fn client(&self) -> Result<Arc<ExternalCodexClient>> {
        loop {
            let notified = self.ready_notify.notified();
            {
                let inner = self.inner.lock().await;
                if let Some(client) = &inner.client {
                    return Ok(Arc::clone(client));
                }
                if let Some(error) = &inner.init_error {
                    anyhow::bail!("Codex initialization failed: {error}");
                }
            }
            notified.await;
        }
    }

    /// Send a request to Codex and wait for response
    pub async fn send_request(
        &self,
        method: String,
        params: Option<serde_json::Value>,
    ) -> Result<serde_json::Value> {
        let client = self.client().await?;
        client.send_request(method, params).await
    }

    pub async fn send_response(
        &self,
        request_id: RequestId,
        response: serde_json::Value,
    ) -> Result<()> {
        let client = self.client().await?;
        client.send_response(request_id, response).await
    }
}

/// Initialize Codex integration using an external stdio JSON-RPC app-server process.
pub async fn init_codex<R: tauri::Runtime>(app: &AppHandle<R>) -> Result<()> {
    if app.try_state::<CodexState>().is_none() {
        app.manage(CodexState::pending());
    }

    match init_codex_inner(app).await {
        Ok(()) => Ok(()),
        Err(err) => {
            let err_msg = format!("{:#}", err);
            error!("Failed to initialize Codex: {}", err_msg);
            if let Some(state) = app.try_state::<CodexState>() {
                state.mark_failed(err_msg).await;
            }
            Err(err)
        }
    }
}

async fn init_codex_inner<R: tauri::Runtime>(app: &AppHandle<R>) -> Result<()> {
    info!("Initializing Codex external app-server");

    let proxy_mode = resolve_proxy_mode(app);
    let proxy_env = resolve_proxy_env(app);
    apply_proxy_to_process_env(proxy_mode, &proxy_env);
    if proxy_mode == ProxyMode::Direct {
        info!("Codey proxy mode=direct; disabling proxy for Codex child process.");
    }
    ensure_no_proxy_for_localhost();
    debug!(
        "Codex child env prepared mode={:?} CODEX_HOME_removed_for_child={} HTTP_PROXY_set={} HTTPS_PROXY_set={} ALL_PROXY_set={} NO_PROXY_set={}",
        proxy_mode,
        std::env::var("CODEX_HOME").is_ok(),
        std::env::var("HTTP_PROXY").is_ok() || std::env::var("http_proxy").is_ok(),
        std::env::var("HTTPS_PROXY").is_ok() || std::env::var("https_proxy").is_ok(),
        std::env::var("ALL_PROXY").is_ok() || std::env::var("all_proxy").is_ok(),
        std::env::var("NO_PROXY").is_ok() || std::env::var("no_proxy").is_ok(),
    );

    let client = start_external_codex_app_server(app.clone()).await?;
    let app_state: tauri::State<'_, CodexState> = app.state();
    app_state.mark_ready(client).await;

    info!("Codex external app-server client initialized successfully");
    Ok(())
}

fn configured_codex_bin() -> Option<String> {
    env::var("CODEY_CODEX_BIN")
        .ok()
        .or_else(|| env::var("CODEX_BIN").ok())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn push_node_version_bin_dirs(extras: &mut Vec<PathBuf>, node_versions_dir: PathBuf) {
    if let Ok(entries) = std::fs::read_dir(node_versions_dir) {
        for entry in entries.flatten() {
            let bin_path = entry.path().join("bin");
            if bin_path.is_dir() {
                extras.push(bin_path);
            }
        }
    }
}

fn push_fnm_install_dirs(extras: &mut Vec<PathBuf>, fnm_dir: PathBuf) {
    let node_versions_dir = fnm_dir.join("node-versions");
    if let Ok(entries) = std::fs::read_dir(node_versions_dir) {
        for entry in entries.flatten() {
            let installation = entry.path().join("installation");
            let bin_path = installation.join("bin");
            if bin_path.is_dir() {
                extras.push(bin_path);
            }
            #[cfg(target_os = "windows")]
            if installation.is_dir() {
                extras.push(installation);
            }
        }
    }
}

fn build_codex_path_env(codex_bin: Option<&str>) -> Option<OsString> {
    let mut paths: Vec<PathBuf> = env::var_os("PATH")
        .map(|value| env::split_paths(&value).collect())
        .unwrap_or_default();
    let mut extras: Vec<PathBuf> = Vec::new();

    if let Ok(value) = env::var("NVM_BIN") {
        extras.push(PathBuf::from(value));
    }
    if let Ok(value) = env::var("FNM_MULTISHELL_PATH") {
        extras.push(PathBuf::from(value));
    }
    if let Ok(value) = env::var("VOLTA_HOME") {
        extras.push(Path::new(&value).join("bin"));
    }
    if let Ok(value) = env::var("BUN_INSTALL") {
        extras.push(Path::new(&value).join("bin"));
    }
    if let Ok(value) = env::var("ASDF_DATA_DIR") {
        extras.push(Path::new(&value).join("shims"));
    }
    if let Ok(value) = env::var("MISE_DATA_DIR") {
        extras.push(Path::new(&value).join("shims"));
    }
    if let Ok(value) = env::var("NVM_DIR") {
        let nvm_dir = PathBuf::from(value);
        extras.push(nvm_dir.join("current").join("bin"));
        push_node_version_bin_dirs(&mut extras, nvm_dir.join("versions").join("node"));
    }
    if let Ok(value) = env::var("FNM_DIR") {
        push_fnm_install_dirs(&mut extras, PathBuf::from(value));
    }

    #[cfg(target_os = "windows")]
    {
        if let Ok(appdata) = env::var("APPDATA") {
            let appdata_path = Path::new(&appdata);
            extras.push(appdata_path.join("npm"));
            push_fnm_install_dirs(&mut extras, appdata_path.join("fnm"));
        }
        if let Ok(local_app_data) = env::var("LOCALAPPDATA") {
            extras.push(
                Path::new(&local_app_data)
                    .join("Microsoft")
                    .join("WindowsApps"),
            );
            push_fnm_install_dirs(&mut extras, Path::new(&local_app_data).join("fnm"));
        }
        if let Ok(home) = env::var("USERPROFILE").or_else(|_| env::var("HOME")) {
            let home_path = Path::new(&home);
            extras.push(home_path.join(".cargo").join("bin"));
            extras.push(home_path.join("scoop").join("shims"));
            extras.push(home_path.join(".volta").join("bin"));
            extras.push(home_path.join(".bun").join("bin"));
            extras.push(home_path.join(".nvm").join("current").join("bin"));

            // nvm-sh can also be installed on Windows (for example through Git Bash).
            // Each Node version owns a separate bin directory.
            push_node_version_bin_dirs(
                &mut extras,
                home_path.join(".nvm").join("versions").join("node"),
            );
            push_fnm_install_dirs(&mut extras, home_path.join(".fnm"));
            push_fnm_install_dirs(
                &mut extras,
                home_path.join(".local").join("share").join("fnm"),
            );
        }
        if let Ok(value) = env::var("NVM_SYMLINK") {
            extras.push(PathBuf::from(value));
        }
        if let Ok(value) = env::var("NVM_HOME") {
            extras.push(PathBuf::from(value));
        }
        if let Ok(local_app_data) = env::var("LOCALAPPDATA") {
            extras.push(Path::new(&local_app_data).join("Volta").join("bin"));
            extras.push(Path::new(&local_app_data).join("fnm"));
        }
        if let Ok(program_data) = env::var("PROGRAMDATA") {
            extras.push(Path::new(&program_data).join("chocolatey").join("bin"));
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        extras.extend(
            [
                "/opt/homebrew/bin",
                "/usr/local/bin",
                "/usr/bin",
                "/bin",
                "/usr/sbin",
                "/sbin",
            ]
            .into_iter()
            .map(PathBuf::from),
        );
        if let Ok(home) = env::var("HOME") {
            let home_path = Path::new(&home);
            extras.push(home_path.join(".local").join("bin"));
            extras.push(home_path.join(".cargo").join("bin"));
            extras.push(home_path.join(".bun").join("bin"));
            extras.push(home_path.join(".volta").join("bin"));
            extras.push(home_path.join(".asdf").join("shims"));
            extras.push(
                home_path
                    .join(".local")
                    .join("share")
                    .join("mise")
                    .join("shims"),
            );
            extras.push(home_path.join(".nvm").join("current").join("bin"));

            push_node_version_bin_dirs(
                &mut extras,
                home_path.join(".nvm").join("versions").join("node"),
            );
            push_fnm_install_dirs(&mut extras, home_path.join(".fnm"));
            push_fnm_install_dirs(
                &mut extras,
                home_path.join(".local").join("share").join("fnm"),
            );
        }
    }

    if let Some(bin_path) = codex_bin.filter(|value| !value.trim().is_empty()) {
        if let Some(parent) = Path::new(bin_path).parent() {
            extras.push(parent.to_path_buf());
        }
    }

    for extra in extras {
        if !paths.iter().any(|path| path == &extra) {
            paths.push(extra);
        }
    }

    env::join_paths(paths).ok()
}

fn codex_command_candidates() -> Vec<PathBuf> {
    if let Some(configured) = configured_codex_bin() {
        return vec![PathBuf::from(configured)];
    }

    let path_env = build_codex_path_env(None);
    let path_dirs = path_env
        .as_ref()
        .map(|value| env::split_paths(value).collect::<Vec<_>>())
        .unwrap_or_default();
    let mut candidates = Vec::new();

    #[cfg(target_os = "windows")]
    let executable_names = ["codex.exe", "codex.cmd", "codex.bat", "codex"];
    #[cfg(not(target_os = "windows"))]
    let executable_names = ["codex"];

    for directory in path_dirs {
        for executable_name in executable_names {
            let candidate = directory.join(executable_name);
            if candidate.is_file() && !candidates.iter().any(|item| item == &candidate) {
                candidates.push(candidate);
            }
        }
    }

    // Keep the bare command as the final fallback so the operating system can
    // resolve shell aliases or installation-specific command shims.
    candidates.push(PathBuf::from("codex"));
    candidates
}

#[cfg(target_os = "windows")]
fn discover_windows_appx_codex() -> Option<PathBuf> {
    let program_files = env::var_os("ProgramFiles")
        .or_else(|| env::var_os("PROGRAMFILES"))
        .map(PathBuf::from)?;
    let windows_apps = program_files.join("WindowsApps");
    let mut package_dirs = std::fs::read_dir(windows_apps)
        .ok()?
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.path())
        .filter(|path| {
            path.file_name()
                .and_then(|name| name.to_str())
                .map(|name| {
                    name.starts_with("OpenAI.Codex_") || name.starts_with("OpenAI.ChatGPT_")
                })
                .unwrap_or(false)
        })
        .collect::<Vec<_>>();

    // Package folder names contain the version. Reverse lexical order keeps
    // the newest installed package first without hard-coding a version.
    package_dirs.sort_by(|left, right| {
        right
            .file_name()
            .map(|name| name.to_string_lossy())
            .cmp(&left.file_name().map(|name| name.to_string_lossy()))
    });

    for package_dir in package_dirs {
        let candidates = [
            package_dir.join("app").join("resources").join("codex.exe"),
            package_dir.join("app").join("Codex.exe"),
        ];
        for candidate in candidates {
            if candidate.is_file() {
                debug!("Discovered Codex AppX binary at {}", candidate.display());
                return Some(candidate);
            }
        }
    }

    None
}

#[cfg(target_os = "windows")]
fn resolve_windows_executable(program: &Path, path_env: Option<&OsStr>) -> Option<PathBuf> {
    let raw = program.to_string_lossy();
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }

    let program = trimmed
        .strip_prefix('"')
        .and_then(|value| value.strip_suffix('"'))
        .unwrap_or(trimmed)
        .trim();
    if program.is_empty() {
        return None;
    }

    let has_separators = program.contains('\\') || program.contains('/');
    let has_drive = matches!(program.as_bytes().get(1), Some(b':'));
    let looks_like_path = has_separators || has_drive;
    let path_candidates = if Path::new(program).extension().is_some() {
        vec![PathBuf::from(program)]
    } else {
        ["exe", "cmd", "bat", "com"]
            .into_iter()
            .map(|extension| PathBuf::from(format!("{program}.{extension}")))
            .collect()
    };

    if looks_like_path {
        return path_candidates.into_iter().find(|path| path.is_file());
    }

    let paths: Vec<PathBuf> = path_env
        .map(|value| env::split_paths(value).collect())
        .or_else(|| env::var_os("PATH").map(|value| env::split_paths(&value).collect()))
        .unwrap_or_default();

    for root in paths {
        for candidate in &path_candidates {
            let path = root.join(candidate);
            if path.is_file() {
                return Some(path);
            }
        }
    }

    None
}

#[cfg(target_os = "windows")]
fn is_windows_batch_file(path: &Path) -> bool {
    matches!(
        path.extension()
            .and_then(|extension| extension.to_str())
            .map(|extension| extension.to_ascii_lowercase())
            .as_deref(),
        Some("cmd" | "bat")
    )
}

#[cfg(target_os = "windows")]
fn validate_cmd_token(value: &str) -> Result<()> {
    if value.contains('\0') {
        anyhow::bail!("Windows cmd wrapper does not support NUL bytes.");
    }
    if value.contains('\n') || value.contains('\r') {
        anyhow::bail!("Windows cmd wrapper does not support newline characters.");
    }
    Ok(())
}

#[cfg(target_os = "windows")]
fn quote_cmd_token(value: &str) -> Result<String> {
    validate_cmd_token(value)?;
    let mut escaped = String::with_capacity(value.len());
    for ch in value.chars() {
        match ch {
            '^' => escaped.push_str("^^"),
            '"' => escaped.push_str("^\""),
            '%' => escaped.push_str("^%"),
            '!' => escaped.push_str("^!"),
            _ => escaped.push(ch),
        }
    }
    Ok(format!("\"{escaped}\""))
}

#[cfg(target_os = "windows")]
fn build_cmd_c_command(program: &Path, args: &[String]) -> Result<String> {
    let mut parts = Vec::with_capacity(args.len() + 1);
    parts.push(quote_cmd_token(program.to_string_lossy().as_ref())?);
    for arg in args {
        parts.push(quote_cmd_token(arg)?);
    }
    Ok(format!("\"{}\"", parts.join(" ")))
}

fn sanitize_codex_child_environment(command: &mut Command) {
    if env::var_os("CODEX_HOME").is_some() {
        info!("Removing CODEX_HOME for external Codex child so codex-cli uses its official default home.");
    }
    command.env_remove("CODEX_HOME");
}

fn build_codex_command_for_bin(bin: &Path, args: &[&str]) -> Result<Command> {
    let configured_bin = configured_codex_bin();
    let path_env = build_codex_path_env(configured_bin.as_deref());

    #[cfg(target_os = "windows")]
    let mut command = {
        let resolved_bin = resolve_windows_executable(bin, path_env.as_deref())
            .unwrap_or_else(|| bin.to_path_buf());
        if is_windows_batch_file(&resolved_bin) {
            let mut command = codex_tokio_command("cmd");
            let command_args = args
                .iter()
                .map(|arg| (*arg).to_string())
                .collect::<Vec<_>>();
            let command_line = build_cmd_c_command(&resolved_bin, &command_args)?;
            command.arg("/D").arg("/S").arg("/C");
            command.as_std_mut().raw_arg(command_line);
            command
        } else {
            let mut command = codex_tokio_command(&resolved_bin);
            command.args(args);
            command
        }
    };

    #[cfg(not(target_os = "windows"))]
    let mut command = {
        let mut command = codex_tokio_command(bin);
        command.args(args);
        command
    };

    if let Some(path_env) = path_env {
        command.env("PATH", path_env);
    }
    sanitize_codex_child_environment(&mut command);
    Ok(command)
}

async fn check_codex_installation() -> Result<(PathBuf, Option<String>)> {
    let candidates = codex_command_candidates();
    let configured = configured_codex_bin().is_some();
    let mut last_error = None;

    for candidate in candidates {
        let candidate_display = candidate.display().to_string();
        let mut command = build_codex_command_for_bin(&candidate, &["--version"])?;
        command.stdout(Stdio::piped());
        command.stderr(Stdio::piped());

        let output = match tokio::time::timeout(Duration::from_secs(5), command.output()).await {
            Ok(Ok(output)) => output,
            Ok(Err(err)) => {
                let message =
                    if is_windows_appx_codex_path(&candidate) && is_permission_denied(&err) {
                        codex_appx_access_denied_message(&candidate)
                    } else if err.kind() == ErrorKind::NotFound {
                        format!("Codex CLI candidate not found: {candidate_display}")
                    } else {
                        format!("Codex CLI candidate failed to start ({candidate_display}): {err}")
                    };
                debug!("{message}");
                last_error = Some(message);
                if configured {
                    break;
                }
                continue;
            }
            Err(_) => {
                let message =
                    format!("Timed out while checking Codex CLI candidate: {candidate_display}");
                debug!("{message}");
                last_error = Some(message);
                if configured {
                    break;
                }
                continue;
            }
        };

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            let stdout = String::from_utf8_lossy(&output.stdout);
            let detail = if stderr.trim().is_empty() {
                stdout.trim()
            } else {
                stderr.trim()
            };
            let message = if detail.is_empty() {
                format!("Codex CLI candidate failed: {candidate_display}")
            } else {
                format!("Codex CLI candidate failed ({candidate_display}): {detail}")
            };
            debug!("{message}");
            last_error = Some(message);
            if configured {
                break;
            }
            continue;
        }

        let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
        return Ok((candidate, (!version.is_empty()).then_some(version)));
    }

    #[cfg(target_os = "windows")]
    if let Some(candidate) = discover_windows_appx_codex() {
        anyhow::bail!("{}", codex_appx_access_denied_message(&candidate));
    }

    let detail = last_error.unwrap_or_else(|| {
        "Codex CLI was not found among the configured PATH locations.".to_string()
    });
    anyhow::bail!(
        "{detail}. Install Codex and ensure `codex --version` works, or set CODEY_CODEX_BIN."
    );
}

fn build_initialize_params() -> serde_json::Value {
    serde_json::json!({
        "clientInfo": {
            "name": CODEY_CODEX_CLIENT_INFO_NAME,
            "title": "Codey",
            "version": CODEY_CODEX_CLIENT_INFO_VERSION,
        },
        "capabilities": {
            "experimentalApi": true,
            "requestAttestation": false,
        },
    })
}

async fn start_external_codex_app_server<R: tauri::Runtime>(
    app: AppHandle<R>,
) -> Result<Arc<ExternalCodexClient>> {
    let (codex_bin, version) = check_codex_installation().await?;
    info!(
        "Codex CLI detected: {}",
        version.unwrap_or_else(|| "<unknown version>".to_string())
    );

    let mut command = build_codex_command_for_bin(&codex_bin, &["app-server"])?;
    command.stdin(Stdio::piped());
    command.stdout(Stdio::piped());
    command.stderr(Stdio::piped());

    let mut child = command.spawn().map_err(|err| {
        if is_windows_appx_codex_path(&codex_bin) && is_permission_denied(&err) {
            anyhow::anyhow!(codex_appx_access_denied_message(&codex_bin))
        } else {
            anyhow::Error::new(err).context(
                "failed to spawn `codex app-server`; ensure Codex CLI is installed and runnable",
            )
        }
    })?;
    let stdin = child
        .stdin
        .take()
        .context("Codex app-server missing stdin")?;
    let stdout = child
        .stdout
        .take()
        .context("Codex app-server missing stdout")?;
    let stderr = child
        .stderr
        .take()
        .context("Codex app-server missing stderr")?;

    let client = Arc::new(ExternalCodexClient::new(child, stdin));

    let stdout_client = Arc::clone(&client);
    let stdout_app = app.clone();
    tauri::async_runtime::spawn(async move {
        let mut lines = BufReader::new(stdout).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            if line.trim().is_empty() {
                continue;
            }
            let value: serde_json::Value = match serde_json::from_str(&line) {
                Ok(value) => value,
                Err(err) => {
                    warn!("Failed to parse Codex app-server stdout JSON: {err}; raw={line}");
                    let value = serde_json::json!({
                        "method": "codex/parseError",
                        "params": { "error": err.to_string(), "raw": line },
                    });
                    handle_codex_notification_value(value, &stdout_app).await;
                    continue;
                }
            };

            let has_method = value.get("method").is_some();
            let has_response = value.get("result").is_some() || value.get("error").is_some();
            if has_response {
                if let Some(id_key) = value.get("id").and_then(jsonrpc_id_key) {
                    if let Some(tx) = stdout_client.pending.lock().await.remove(&id_key) {
                        let _ = tx.send(value);
                    } else {
                        warn!("Codex app-server response had no pending request: id={id_key}");
                    }
                    continue;
                }
            }

            if has_method && value.get("id").is_some() {
                handle_codex_request_value(value, &stdout_app).await;
            } else if has_method {
                handle_codex_notification_value(value, &stdout_app).await;
            } else {
                debug!("Ignoring Codex app-server message without method/result/error: {value}");
            }
        }
        stdout_client.clear_pending().await;
        warn!("Codex external app-server stdout stream exited");
    });

    tauri::async_runtime::spawn(async move {
        let mut lines = BufReader::new(stderr).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            if !line.trim().is_empty() {
                warn!("Codex app-server stderr: {line}");
            }
        }
    });

    let init_result = tokio::time::timeout(
        Duration::from_secs(15),
        client.send_request("initialize".to_string(), Some(build_initialize_params())),
    )
    .await;
    match init_result {
        Ok(Ok(_)) => {}
        Ok(Err(err)) => {
            let mut child = client.child.lock().await;
            let _ = child.kill().await;
            return Err(err).context("Codex app-server initialize failed");
        }
        Err(_) => {
            let mut child = client.child.lock().await;
            let _ = child.kill().await;
            anyhow::bail!("Codex app-server did not respond to initialize within 15 seconds");
        }
    }

    client
        .write_message(serde_json::json!({ "method": "initialized" }))
        .await
        .context("failed to send Codex initialized notification")?;

    Ok(client)
}

fn ensure_no_proxy_for_localhost() {
    let mut no_proxy_values: Vec<String> = std::env::var("NO_PROXY")
        .or_else(|_| std::env::var("no_proxy"))
        .unwrap_or_default()
        .split(',')
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();
    for host in &["127.0.0.1", "localhost"] {
        if !no_proxy_values.iter().any(|v| v == host) {
            no_proxy_values.push((*host).to_string());
        }
    }
    let joined = no_proxy_values.join(",");
    std::env::set_var("NO_PROXY", &joined);
    std::env::set_var("no_proxy", &joined);
    info!("NO_PROXY updated for embedded services: {}", joined);
}

fn jsonrpc_id_key(value: &serde_json::Value) -> Option<String> {
    if let Some(value) = value.as_str() {
        return Some(value.to_string());
    }
    if let Some(value) = value.as_i64() {
        return Some(value.to_string());
    }
    if let Some(value) = value.as_u64() {
        return Some(value.to_string());
    }
    None
}

async fn handle_codex_notification_value<R: tauri::Runtime>(
    value: serde_json::Value,
    app: &AppHandle<R>,
) {
    let method = value
        .get("method")
        .and_then(|v| v.as_str())
        .unwrap_or("<unknown>")
        .to_string();
    let params = value.get("params").cloned();
    debug!("Received Codex notification: {method}");
    let _ = app.emit("codex:notification", &value);
    let _ = (method, params);
}

async fn handle_codex_request_value<R: tauri::Runtime>(
    value: serde_json::Value,
    app: &AppHandle<R>,
) {
    let request_id = value
        .get("id")
        .and_then(jsonrpc_id_key)
        .unwrap_or_else(|| "<missing>".to_string());
    let method = value
        .get("method")
        .and_then(|v| v.as_str())
        .unwrap_or("<unknown>")
        .to_string();
    let params = value.get("params").cloned();
    if method == "mcpServer/elicitation/request" {
        let server_name = value
            .get("params")
            .and_then(|params| params.get("serverName"))
            .and_then(|value| value.as_str())
            .unwrap_or("<unknown>");
        let mode = value
            .get("params")
            .and_then(|params| params.get("mode"))
            .and_then(|value| value.as_str())
            .unwrap_or("<unknown>");
        info!(
            "Forwarding Codex MCP elicitation request to frontend: id={} server={} mode={}",
            request_id, server_name, mode
        );
    } else {
        debug!("Received Codex request: {method}");
    }
    let _ = app.emit("codex:request", &value);
    let _ = (method, request_id, params);
}

// ============================================================================
// Tauri commands
// ============================================================================

#[tauri::command]
pub async fn codex_initialize(
    _state: tauri::State<'_, CodexState>,
    _params: serde_json::Value,
) -> Result<serde_json::Value, String> {
    // The external app-server performs initialize -> initialized during startup.
    Ok(serde_json::json!({}))
}

#[tauri::command]
pub async fn codex_thread_start(
    _app: tauri::AppHandle,
    state: tauri::State<'_, CodexState>,
    params: serde_json::Value,
) -> Result<serde_json::Value, String> {
    info!("codex_thread_start params: {}", params);
    let response = state
        .send_request("thread/start".to_string(), Some(params))
        .await
        .map_err(|e| e.to_string())?;
    let response_bytes = serde_json::to_vec(&response).map(|v| v.len()).unwrap_or(0);
    info!(
        "codex_thread_start metrics: response_bytes={} has_thread_id={}",
        response_bytes,
        response
            .get("thread")
            .and_then(|t| t.get("id"))
            .and_then(|v| v.as_str())
            .is_some()
    );
    info!("codex_thread_start response: {}", response);
    Ok(response)
}

#[tauri::command]
pub async fn codex_thread_resume(
    _app: tauri::AppHandle,
    state: tauri::State<'_, CodexState>,
    params: serde_json::Value,
) -> Result<serde_json::Value, String> {
    info!("codex_thread_resume params: {}", params);
    let response = state
        .send_request("thread/resume".to_string(), Some(params))
        .await
        .map_err(|e| e.to_string())?;
    let (thread_id, turns_count) = summarize_thread_resume_response(&response);
    info!(
        "codex_thread_resume response: thread_id={} turns={}",
        thread_id, turns_count
    );
    Ok(response)
}

#[tauri::command]
pub async fn codex_thread_list(
    state: tauri::State<'_, CodexState>,
    params: serde_json::Value,
) -> Result<serde_json::Value, String> {
    // Normalize ThreadListParams.cwd across platforms so UI callers can pass a regular
    // workspace path (e.g. `D:\repo` or `/Users/me/repo`) and still match Codex's stored cwd.
    let params = normalize_thread_list_params(params);
    info!("codex_thread_list params: {}", params);
    let response = state
        .send_request("thread/list".to_string(), Some(params))
        .await
        .map_err(|e| e.to_string())?;
    let response = normalize_thread_list_response(response);

    // Diagnostics: help identify UI stalls caused by unusually large thread payloads
    // (e.g. very long `preview` fields).
    let (threads_count, max_preview_chars, total_preview_chars) = response
        .get("data")
        .and_then(|v| v.as_array())
        .map(|arr| {
            let mut max_len = 0usize;
            let mut sum_len = 0usize;
            for item in arr {
                if let Some(preview) = item.get("preview").and_then(|p| p.as_str()) {
                    let len = preview.chars().count();
                    sum_len = sum_len.saturating_add(len);
                    max_len = max_len.max(len);
                }
            }
            (arr.len(), max_len, sum_len)
        })
        .unwrap_or((0, 0, 0));

    let response_bytes = serde_json::to_vec(&response).map(|v| v.len()).unwrap_or(0);
    let has_next_cursor = response.get("nextCursor").is_some();
    info!(
        "codex_thread_list metrics: threads={} response_bytes={} max_preview_chars={} total_preview_chars={} has_next_cursor={}",
        threads_count, response_bytes, max_preview_chars, total_preview_chars, has_next_cursor
    );
    let response_summary = summarize_thread_list_response(&response, 240);
    info!("codex_thread_list response_summary: {}", response_summary);
    Ok(response)
}

fn normalize_thread_list_params(mut params: serde_json::Value) -> serde_json::Value {
    let obj = match params.as_object_mut() {
        Some(v) => v,
        None => return params,
    };

    let cwd_value = match obj.get("cwd") {
        Some(v) => v.clone(),
        None => return params,
    };

    let cwd = match cwd_value.as_str() {
        Some(v) => v.trim(),
        None => return params,
    };

    if cwd.is_empty() {
        return params;
    }

    let original_cwd = cwd.to_string();

    #[cfg(windows)]
    {
        let normalized = normalize_windows_thread_list_request_cwd(cwd);

        obj.insert("cwd".to_string(), serde_json::Value::String(normalized));
        let normalized_cwd = obj
            .get("cwd")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string();
        log::info!(
            "thread_list_cwd_normalized platform=windows original={:?} raw={:?} normalized={:?}",
            original_cwd,
            cwd,
            normalized_cwd
        );
        return params;
    }

    #[cfg(not(windows))]
    {
        // On Unix-like platforms, codex stores regular absolute paths.
        obj.insert(
            "cwd".to_string(),
            serde_json::Value::String(cwd.to_string()),
        );
        log::info!(
            "thread_list_cwd_normalized platform=unix original={:?} normalized={:?}",
            original_cwd,
            cwd
        );
        return params;
    }
}

fn normalize_thread_list_response(mut response: serde_json::Value) -> serde_json::Value {
    #[cfg(windows)]
    {
        if let Some(items) = response
            .get_mut("data")
            .and_then(|value| value.as_array_mut())
        {
            for item in items {
                if let Some(cwd) = item.get_mut("cwd") {
                    if let Some(raw) = cwd.as_str() {
                        *cwd =
                            serde_json::Value::String(normalize_windows_thread_list_api_cwd(raw));
                    }
                }
            }
        }
    }

    response
}

#[cfg(windows)]
fn normalize_windows_thread_list_request_cwd(raw: &str) -> String {
    let mut normalized = raw.trim().replace('/', "\\");
    while normalized.len() > 3 && normalized.ends_with('\\') {
        normalized.pop();
    }

    if normalized.starts_with(r"\\?\") {
        return normalized;
    }

    if let Some(rest) = normalized.strip_prefix(r"\\") {
        return format!(r"\\?\UNC\{}", rest);
    }

    if normalized.len() >= 3
        && normalized.as_bytes()[1] == b':'
        && normalized.as_bytes()[2] == b'\\'
    {
        return format!(r"\\?\{}", normalized);
    }

    normalized
}

#[cfg(windows)]
fn normalize_windows_thread_list_api_cwd(raw: &str) -> String {
    let mut normalized = raw.trim().replace('/', "\\");
    if let Some(rest) = normalized.strip_prefix(r"\\?\UNC\") {
        normalized = format!(r"\\{}", rest);
    } else if let Some(rest) = normalized.strip_prefix(r"\\?\") {
        normalized = rest.to_string();
    }
    while normalized.len() > 3 && normalized.ends_with('\\') {
        normalized.pop();
    }
    normalized
}

#[cfg(test)]
mod thread_list_path_tests {
    #[cfg(windows)]
    use super::normalize_thread_list_params;
    #[cfg(windows)]
    use super::normalize_windows_thread_list_request_cwd;

    #[cfg(windows)]
    #[test]
    fn thread_list_request_cwd_uses_extended_length_windows_path() {
        assert_eq!(
            normalize_windows_thread_list_request_cwd(r"D:/自媒体/"),
            r"\\?\D:\自媒体"
        );
        assert_eq!(
            normalize_windows_thread_list_request_cwd(r"\\?\D:\自媒体"),
            r"\\?\D:\自媒体"
        );
        assert_eq!(
            normalize_windows_thread_list_request_cwd(r"\\?\UNC\server\share\repo\"),
            r"\\?\UNC\server\share\repo"
        );
    }

    #[cfg(windows)]
    #[test]
    fn thread_list_params_add_extended_length_prefix() {
        let params = serde_json::json!({
            "cwd": "D:/自媒体/",
            "limit": 30
        });
        let normalized = normalize_thread_list_params(params);
        assert_eq!(
            normalized.get("cwd").and_then(serde_json::Value::as_str),
            Some(r"\\?\D:\自媒体")
        );
    }
}

#[cfg(test)]
mod codex_ui_preferences_tests {
    use super::{
        prefer_local_ui_preferences, read_codex_ui_preferences_from_path,
        write_codex_ui_preferences_to_path, CodexUiPreferences,
    };
    use std::fs;

    #[test]
    fn local_preferences_take_priority_over_legacy_values() {
        let local = CodexUiPreferences {
            rules: Some("local rules".to_string()),
            access_mode: None,
            selected_model: Some("local-model".to_string()),
            selected_effort: None,
        };
        let legacy = CodexUiPreferences {
            rules: Some("legacy rules".to_string()),
            access_mode: Some("workspaceNever".to_string()),
            selected_model: Some("legacy-model".to_string()),
            selected_effort: Some("high".to_string()),
        };

        let effective = prefer_local_ui_preferences(local, legacy);

        assert_eq!(effective.rules.as_deref(), Some("local rules"));
        assert_eq!(effective.access_mode.as_deref(), Some("workspaceNever"));
        assert_eq!(effective.selected_model.as_deref(), Some("local-model"));
        assert_eq!(effective.selected_effort.as_deref(), Some("high"));
    }

    #[test]
    fn missing_local_preferences_fall_back_to_legacy_values() {
        let effective = prefer_local_ui_preferences(
            CodexUiPreferences::default(),
            CodexUiPreferences {
                rules: Some("legacy rules".to_string()),
                access_mode: Some("workspaceOnRequest".to_string()),
                selected_model: Some("legacy-model".to_string()),
                selected_effort: Some("medium".to_string()),
            },
        );

        assert_eq!(effective.rules.as_deref(), Some("legacy rules"));
        assert_eq!(effective.access_mode.as_deref(), Some("workspaceOnRequest"));
        assert_eq!(effective.selected_model.as_deref(), Some("legacy-model"));
        assert_eq!(effective.selected_effort.as_deref(), Some("medium"));
    }

    #[test]
    fn saving_ui_preferences_does_not_modify_global_codex_config() {
        let temp_dir = tempfile::tempdir().expect("temporary directory");
        let config_path = temp_dir.path().join("config.toml");
        let original_config = "[codey]\nrules = \"legacy\"\n";
        fs::write(&config_path, original_config).expect("write config");

        let preferences_path = temp_dir.path().join("codex_ui_settings.json");
        let preferences = CodexUiPreferences {
            rules: Some("local".to_string()),
            access_mode: Some("workspaceOnRequest".to_string()),
            selected_model: Some("model".to_string()),
            selected_effort: Some("low".to_string()),
        };
        write_codex_ui_preferences_to_path(&preferences_path, &preferences)
            .expect("write UI preferences");

        assert_eq!(
            fs::read_to_string(&config_path).expect("read config"),
            original_config
        );
        assert_eq!(
            read_codex_ui_preferences_from_path(&preferences_path)
                .expect("read UI preferences")
                .rules
                .as_deref(),
            Some("local")
        );
    }
}

#[tauri::command]
pub async fn codex_turn_start(
    _app: tauri::AppHandle,
    state: tauri::State<'_, CodexState>,
    params: serde_json::Value,
) -> Result<serde_json::Value, String> {
    info!("codex_turn_start params: {}", params);
    let response = state
        .send_request("turn/start".to_string(), Some(params))
        .await
        .map_err(|e| e.to_string())?;
    info!("codex_turn_start response: {}", response);
    Ok(response)
}

#[tauri::command]
pub async fn codex_review_start(
    _app: tauri::AppHandle,
    state: tauri::State<'_, CodexState>,
    params: serde_json::Value,
) -> Result<serde_json::Value, String> {
    info!("codex_review_start params: {}", params);
    let response = state
        .send_request("review/start".to_string(), Some(params))
        .await
        .map_err(|e| e.to_string())?;
    info!("codex_review_start response: {}", response);
    Ok(response)
}

#[tauri::command]
pub async fn codex_turn_interrupt(
    state: tauri::State<'_, CodexState>,
    params: serde_json::Value,
) -> Result<serde_json::Value, String> {
    info!("codex_turn_interrupt params: {}", params);
    let response = state
        .send_request("turn/interrupt".to_string(), Some(params))
        .await
        .map_err(|e| e.to_string())?;
    info!("codex_turn_interrupt response: {}", response);
    Ok(response)
}

#[tauri::command]
pub async fn codex_interrupt_guard_state(
    app: tauri::AppHandle,
) -> Result<CodexInterruptGuardState, String> {
    codex_interrupt_guard_state_for_app(&app).await
}

pub async fn codex_interrupt_guard_state_for_app<R: tauri::Runtime>(
    _app: &tauri::AppHandle<R>,
) -> Result<CodexInterruptGuardState, String> {
    Ok(CodexInterruptGuardState {
        requires_confirmation: false,
        thread_id: None,
        thread_name: None,
        turn_id: None,
    })
}

#[tauri::command]
pub async fn codex_thread_archive(
    state: tauri::State<'_, CodexState>,
    params: serde_json::Value,
) -> Result<serde_json::Value, String> {
    state
        .send_request("thread/archive".to_string(), Some(params))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn codex_thread_name_set(
    state: tauri::State<'_, CodexState>,
    params: serde_json::Value,
) -> Result<serde_json::Value, String> {
    state
        .send_request("thread/name/set".to_string(), Some(params))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn codex_thread_goal_set(
    state: tauri::State<'_, CodexState>,
    params: serde_json::Value,
) -> Result<serde_json::Value, String> {
    state
        .send_request("thread/goal/set".to_string(), Some(params))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn codex_thread_goal_get(
    state: tauri::State<'_, CodexState>,
    params: serde_json::Value,
) -> Result<serde_json::Value, String> {
    state
        .send_request("thread/goal/get".to_string(), Some(params))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn codex_thread_goal_clear(
    state: tauri::State<'_, CodexState>,
    params: serde_json::Value,
) -> Result<serde_json::Value, String> {
    state
        .send_request("thread/goal/clear".to_string(), Some(params))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn codex_model_list(
    state: tauri::State<'_, CodexState>,
    params: Option<serde_json::Value>,
) -> Result<serde_json::Value, String> {
    state
        .send_request("model/list".to_string(), params)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn codex_account_login(
    _app: tauri::AppHandle,
    _state: tauri::State<'_, CodexState>,
    _params: serde_json::Value,
) -> Result<serde_json::Value, String> {
    Err(codex_environment_write_disabled_message())
}

#[tauri::command]
pub async fn codex_account_logout(
    _app: tauri::AppHandle,
    _state: tauri::State<'_, CodexState>,
) -> Result<serde_json::Value, String> {
    Err(codex_environment_write_disabled_message())
}

#[tauri::command]
pub async fn codex_account_read(
    state: tauri::State<'_, CodexState>,
    params: serde_json::Value,
) -> Result<serde_json::Value, String> {
    state
        .send_request("account/read".to_string(), Some(params))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn codex_cancel_login_account(
    _state: tauri::State<'_, CodexState>,
    _params: serde_json::Value,
) -> Result<serde_json::Value, String> {
    Err(codex_environment_write_disabled_message())
}

#[tauri::command]
pub async fn codex_get_account(
    state: tauri::State<'_, CodexState>,
    params: serde_json::Value,
) -> Result<serde_json::Value, String> {
    state
        .send_request("account/read".to_string(), Some(params))
        .await
        .map_err(|e| e.to_string())
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpServerUi {
    pub name: String,
    /// "stdio" | "http"
    pub transport: String,
    pub enabled: Option<bool>,
    pub command: Option<String>,
    pub args: Option<Vec<String>>,
    pub cwd: Option<String>,
    pub env: Option<HashMap<String, String>>,
    pub env_vars: Option<Vec<String>>,
    pub url: Option<String>,
    pub bearer_token_env_var: Option<String>,
    pub http_headers: Option<HashMap<String, String>>,
    pub env_http_headers: Option<HashMap<String, String>>,
    pub startup_timeout_sec: Option<u64>,
    pub tool_timeout_sec: Option<u64>,
    pub enabled_tools: Option<Vec<String>>,
    pub disabled_tools: Option<Vec<String>>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexGuiSettings {
    pub rules: String,
    #[serde(default)]
    pub responses_websocket_enabled: Option<bool>,
    #[serde(default)]
    pub memory_generate_enabled: Option<bool>,
    #[serde(default)]
    pub memory_use_enabled: Option<bool>,
    #[serde(default)]
    pub memory_disable_on_external_context_enabled: Option<bool>,
    pub mcp_servers: Vec<McpServerUi>,
    #[serde(default)]
    pub access_mode: Option<String>,
    #[serde(default)]
    pub selected_model: Option<String>,
    #[serde(default)]
    pub selected_effort: Option<String>,
}

const CODEX_UI_SETTINGS_FILE: &str = "codex_ui_settings.json";

#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct CodexUiPreferences {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    rules: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    access_mode: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    selected_model: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    selected_effort: Option<String>,
}

pub(crate) fn codex_home_dir<R: tauri::Runtime>(
    _app: &tauri::AppHandle<R>,
) -> Result<std::path::PathBuf, String> {
    default_codex_home_dir().ok_or_else(|| {
        "Unable to resolve Codex home. Ensure USERPROFILE/HOME is available.".to_string()
    })
}

fn codex_config_path(codex_home: &std::path::Path) -> std::path::PathBuf {
    codex_home.join("config.toml")
}

fn codex_ui_settings_path<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
) -> Result<std::path::PathBuf, String> {
    app.path()
        .app_local_data_dir()
        .map(|dir| dir.join(CODEX_UI_SETTINGS_FILE))
        .map_err(|err| format!("Unable to resolve Codey UI settings directory: {err}"))
}

fn read_codex_ui_preferences_from_path(
    path: &std::path::Path,
) -> Result<CodexUiPreferences, String> {
    let raw = match std::fs::read_to_string(path) {
        Ok(raw) => raw,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(Default::default()),
        Err(err) => {
            return Err(format!(
                "Unable to read Codey Codex UI preferences `{}`: {err}",
                path.display()
            ))
        }
    };

    if raw.trim().is_empty() {
        return Ok(Default::default());
    }

    serde_json::from_str(&raw).map_err(|err| {
        format!(
            "Unable to parse Codey Codex UI preferences `{}`: {err}",
            path.display()
        )
    })
}

fn read_codex_ui_preferences<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
) -> Result<CodexUiPreferences, String> {
    let path = codex_ui_settings_path(app)?;
    read_codex_ui_preferences_from_path(&path)
}

fn write_codex_ui_preferences_to_path(
    path: &std::path::Path,
    preferences: &CodexUiPreferences,
) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|err| {
            format!(
                "Unable to create Codey Codex UI preferences directory `{}`: {err}",
                parent.display()
            )
        })?;
    }

    let mut raw = serde_json::to_string_pretty(preferences)
        .map_err(|err| format!("Unable to serialize Codey Codex UI preferences: {err}"))?;
    raw.push('\n');
    std::fs::write(path, raw).map_err(|err| {
        format!(
            "Unable to save Codey Codex UI preferences `{}`: {err}",
            path.display()
        )
    })
}

fn write_codex_ui_preferences<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    preferences: &CodexUiPreferences,
) -> Result<(), String> {
    let path = codex_ui_settings_path(app)?;
    write_codex_ui_preferences_to_path(&path, preferences)
}

fn legacy_codex_ui_preferences(doc: &toml_edit::DocumentMut) -> CodexUiPreferences {
    let codey = doc.get("codey").and_then(|value| value.as_table());
    CodexUiPreferences {
        rules: codey
            .and_then(|table| table.get("rules"))
            .and_then(|value| value.as_str())
            .map(ToString::to_string),
        access_mode: codey
            .and_then(|table| table.get("access_mode"))
            .and_then(|value| value.as_str())
            .map(ToString::to_string),
        selected_model: codey
            .and_then(|table| table.get("selected_model"))
            .and_then(|value| value.as_str())
            .map(ToString::to_string),
        selected_effort: codey
            .and_then(|table| table.get("selected_effort"))
            .and_then(|value| value.as_str())
            .map(ToString::to_string),
    }
}

fn prefer_local_ui_preferences(
    local: CodexUiPreferences,
    legacy: CodexUiPreferences,
) -> CodexUiPreferences {
    CodexUiPreferences {
        rules: local.rules.or(legacy.rules),
        access_mode: local.access_mode.or(legacy.access_mode),
        selected_model: local.selected_model.or(legacy.selected_model),
        selected_effort: local.selected_effort.or(legacy.selected_effort),
    }
}

fn parse_string_array(item: Option<&toml_edit::Item>) -> Option<Vec<String>> {
    let arr = item?.as_array()?;
    let mut out = Vec::new();
    for v in arr.iter() {
        if let Some(s) = v.as_str() {
            out.push(s.to_string());
        }
    }
    Some(out)
}

fn parse_string_map(item: Option<&toml_edit::Item>) -> Option<HashMap<String, String>> {
    let mut out = HashMap::new();
    let item = item?;

    if let Some(table) = item.as_table() {
        for (k, v) in table.iter() {
            if let Some(s) = v.as_str() {
                out.insert(k.to_string(), s.to_string());
            }
        }
    } else if let Some(inline) = item.as_inline_table() {
        for (k, v) in inline.iter() {
            if let Some(s) = v.as_str() {
                out.insert(k.to_string(), s.to_string());
            }
        }
    }

    if out.is_empty() {
        None
    } else {
        Some(out)
    }
}

pub(crate) fn read_config_doc(path: &std::path::Path) -> Result<toml_edit::DocumentMut, String> {
    let raw = std::fs::read_to_string(path).unwrap_or_default();
    if raw.trim().is_empty() {
        Ok(toml_edit::DocumentMut::new())
    } else {
        raw.parse::<toml_edit::DocumentMut>()
            .map_err(|e| e.to_string())
    }
}

fn codey_responses_websocket_enabled(doc: &toml_edit::DocumentMut) -> bool {
    doc.get("codey")
        .and_then(|v| v.as_table())
        .and_then(|t| t.get("responses_websocket_enabled"))
        .and_then(|v| v.as_bool())
        .unwrap_or(false)
}

fn codex_memory_settings(doc: &toml_edit::DocumentMut) -> (bool, bool, bool) {
    let memories = doc.get("memories").and_then(|v| v.as_table());
    let memory_generate_enabled = memories
        .and_then(|t| t.get("generate_memories"))
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let memory_use_enabled = memories
        .and_then(|t| t.get("use_memories"))
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let memory_disable_on_external_context_enabled = memories
        .and_then(|t| t.get("disable_on_external_context"))
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    (
        memory_generate_enabled,
        memory_use_enabled,
        memory_disable_on_external_context_enabled,
    )
}

fn is_default_openai_base_url(base_url: &str) -> bool {
    base_url
        .trim_end_matches('/')
        .eq_ignore_ascii_case("https://api.openai.com")
}

fn normalize_custom_provider_base_url(base_url: &str) -> Result<String, String> {
    let trimmed = base_url.trim().trim_end_matches('/').to_string();
    if trimmed.is_empty() {
        return Ok(String::new());
    }
    if let Some(stripped) = trimmed.strip_suffix("/v1") {
        let normalized = stripped.trim_end_matches('/').to_string();
        return Ok(normalized);
    }
    Ok(trimmed)
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomProviderConfig {
    pub provider: String,
    pub base_url: String,
}

#[tauri::command]
pub async fn codex_custom_provider_load(
    app: tauri::AppHandle,
) -> Result<CustomProviderConfig, String> {
    let codex_home = codex_home_dir(&app)?;
    let config_path = codex_config_path(&codex_home);
    let doc = read_config_doc(&config_path)?;
    let model_provider = doc
        .get("model_provider")
        .and_then(|v| v.as_str())
        .unwrap_or("openai")
        .to_string();
    let provider = model_provider
        .strip_prefix("custom_")
        .unwrap_or("openai")
        .to_string();
    let base_url = if let Some(custom_provider_id) = model_provider.strip_prefix("custom_") {
        doc.get("model_providers")
            .and_then(|v| v.as_table())
            .and_then(|providers| providers.get(&format!("custom_{}", custom_provider_id)))
            .and_then(|v| v.as_table())
            .and_then(|provider| provider.get("base_url"))
            .and_then(|v| v.as_str())
            .map(normalize_custom_provider_base_url)
            .transpose()?
            .map(|base_url| {
                if provider == "openai" && is_default_openai_base_url(&base_url) {
                    String::new()
                } else {
                    base_url
                }
            })
            .unwrap_or_default()
    } else {
        String::new()
    };
    Ok(CustomProviderConfig { provider, base_url })
}

#[tauri::command]
pub async fn codex_model_provider_load(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let codex_home = codex_home_dir(&app)?;
    let config_path = codex_config_path(&codex_home);
    let doc = read_config_doc(&config_path)?;
    Ok(doc
        .get("model_provider")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string()))
}

pub(crate) fn load_codex_rules<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
) -> Result<String, String> {
    let codex_home = codex_home_dir(app)?;
    let config_path = codex_config_path(&codex_home);
    let doc = read_config_doc(&config_path)?;
    let preferences = prefer_local_ui_preferences(
        read_codex_ui_preferences(app)?,
        legacy_codex_ui_preferences(&doc),
    );
    Ok(preferences.rules.unwrap_or_default())
}

#[tauri::command]
pub async fn codex_settings_load(app: tauri::AppHandle) -> Result<CodexGuiSettings, String> {
    let codex_home = codex_home_dir(&app)?;
    let config_path = codex_config_path(&codex_home);
    let doc = read_config_doc(&config_path)?;

    let preferences = prefer_local_ui_preferences(
        read_codex_ui_preferences(&app)?,
        legacy_codex_ui_preferences(&doc),
    );
    let responses_websocket_enabled = codey_responses_websocket_enabled(&doc);
    let (memory_generate_enabled, memory_use_enabled, memory_disable_on_external_context_enabled) =
        codex_memory_settings(&doc);

    let mut mcp_servers = Vec::new();
    if let Some(mcp_table) = doc.get("mcp_servers").and_then(|v| v.as_table()) {
        for (name, item) in mcp_table.iter() {
            let server = match item.as_table() {
                Some(t) => t,
                None => continue,
            };

            let command = server
                .get("command")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            let url = server
                .get("url")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            let transport = if command.is_some() {
                "stdio"
            } else if url.is_some() {
                "http"
            } else {
                // If the user's global config defines an `codey` MCP entry with only tool filters,
                // keep it grouped as HTTP in the UI. Codey does not inject a runtime URL here.
                if name == "codey" {
                    "http"
                } else {
                    "stdio"
                }
            };

            mcp_servers.push(McpServerUi {
                name: name.to_string(),
                transport: transport.to_string(),
                enabled: server.get("enabled").and_then(|v| v.as_bool()),
                command,
                args: parse_string_array(server.get("args")),
                cwd: server
                    .get("cwd")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string()),
                env: parse_string_map(server.get("env")),
                env_vars: parse_string_array(server.get("env_vars")),
                url,
                bearer_token_env_var: server
                    .get("bearer_token_env_var")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string()),
                http_headers: parse_string_map(server.get("http_headers")),
                env_http_headers: parse_string_map(server.get("env_http_headers")),
                startup_timeout_sec: server
                    .get("startup_timeout_sec")
                    .and_then(|v| v.as_integer())
                    .map(|i| i as u64),
                tool_timeout_sec: server
                    .get("tool_timeout_sec")
                    .and_then(|v| v.as_integer())
                    .map(|i| i as u64),
                enabled_tools: parse_string_array(server.get("enabled_tools")),
                disabled_tools: parse_string_array(server.get("disabled_tools")),
            });
        }
    }

    Ok(CodexGuiSettings {
        rules: preferences.rules.unwrap_or_default(),
        responses_websocket_enabled: Some(responses_websocket_enabled),
        memory_generate_enabled: Some(memory_generate_enabled),
        memory_use_enabled: Some(memory_use_enabled),
        memory_disable_on_external_context_enabled: Some(
            memory_disable_on_external_context_enabled,
        ),
        mcp_servers,
        access_mode: preferences.access_mode,
        selected_model: preferences.selected_model,
        selected_effort: preferences.selected_effort,
    })
}

#[tauri::command]
pub async fn codex_settings_save(
    app: tauri::AppHandle,
    settings: CodexGuiSettings,
) -> Result<(), String> {
    let preferences = CodexUiPreferences {
        rules: Some(settings.rules),
        access_mode: settings.access_mode,
        selected_model: settings.selected_model,
        selected_effort: settings.selected_effort,
    };
    write_codex_ui_preferences(&app, &preferences)
}

#[tauri::command]
pub async fn codex_mcp_server_status_list(
    state: tauri::State<'_, CodexState>,
    params: Option<serde_json::Value>,
) -> Result<serde_json::Value, String> {
    state
        .send_request("mcpServerStatus/list".to_string(), params)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn codex_skills_list(
    state: tauri::State<'_, CodexState>,
    params: Option<serde_json::Value>,
) -> Result<serde_json::Value, String> {
    state
        .send_request("skills/list".to_string(), params)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn codex_skills_config_write(
    _state: tauri::State<'_, CodexState>,
    _params: Option<serde_json::Value>,
) -> Result<serde_json::Value, String> {
    Err(codex_environment_write_disabled_message())
}

#[tauri::command]
pub async fn codex_plugin_list(
    state: tauri::State<'_, CodexState>,
    params: Option<serde_json::Value>,
) -> Result<serde_json::Value, String> {
    state
        .send_request("plugin/list".to_string(), params)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn codex_plugin_read(
    state: tauri::State<'_, CodexState>,
    params: Option<serde_json::Value>,
) -> Result<serde_json::Value, String> {
    state
        .send_request("plugin/read".to_string(), params)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn codex_plugin_install(
    _state: tauri::State<'_, CodexState>,
    _params: Option<serde_json::Value>,
) -> Result<serde_json::Value, String> {
    Err(codex_environment_write_disabled_message())
}

#[tauri::command]
pub async fn codex_plugin_uninstall(
    _state: tauri::State<'_, CodexState>,
    _params: Option<serde_json::Value>,
) -> Result<serde_json::Value, String> {
    Err(codex_environment_write_disabled_message())
}

#[tauri::command]
pub async fn codex_plugin_set_enabled(
    _app: tauri::AppHandle,
    _state: tauri::State<'_, CodexState>,
    _plugin_id: String,
    _enabled: bool,
) -> Result<serde_json::Value, String> {
    Err(codex_environment_write_disabled_message())
}

#[tauri::command]
pub async fn codex_marketplace_add(
    _state: tauri::State<'_, CodexState>,
    _params: Option<serde_json::Value>,
) -> Result<serde_json::Value, String> {
    Err(codex_environment_write_disabled_message())
}

#[tauri::command]
pub async fn codex_marketplace_remove(
    _state: tauri::State<'_, CodexState>,
    _params: Option<serde_json::Value>,
) -> Result<serde_json::Value, String> {
    Err(codex_environment_write_disabled_message())
}

#[tauri::command]
pub async fn codex_marketplace_upgrade(
    _state: tauri::State<'_, CodexState>,
    _params: Option<serde_json::Value>,
) -> Result<serde_json::Value, String> {
    Err(codex_environment_write_disabled_message())
}

#[tauri::command]
pub async fn codex_official_bundled_plugins_status(
    _app: tauri::AppHandle,
) -> Result<serde_json::Value, String> {
    Ok(serde_json::json!({
        "plugins": [{
            "id": "chrome@openai-bundled",
            "name": "chrome",
            "marketplaceName": "openai-bundled",
            "installed": false,
            "sourceAvailable": false,
            "managedByCodey": false,
            "writeDisabled": true,
            "message": codex_environment_write_disabled_message(),
        }],
    }))
}

#[tauri::command]
pub async fn codex_official_chrome_plugin_install_or_repair(
    _app: tauri::AppHandle,
    _state: tauri::State<'_, CodexState>,
) -> Result<serde_json::Value, String> {
    Err(codex_environment_write_disabled_message())
}

fn user_home_dir() -> Option<std::path::PathBuf> {
    std::env::var_os("USERPROFILE")
        .or_else(|| {
            let drive = std::env::var_os("HOMEDRIVE")?;
            let path = std::env::var_os("HOMEPATH")?;
            let mut combined = std::ffi::OsString::from(drive);
            combined.push(path);
            Some(combined)
        })
        .or_else(|| std::env::var_os("HOME"))
        .map(std::path::PathBuf::from)
}

fn default_codex_home_dir() -> Option<std::path::PathBuf> {
    user_home_dir().map(|home| home.join(".codex"))
}

#[cfg(test)]
mod codex_external_environment_tests {
    use super::default_codex_home_dir;
    use std::env;
    use std::ffi::OsString;
    use std::sync::{Mutex as StdMutex, OnceLock as StdOnceLock};

    static ENV_LOCK: StdOnceLock<StdMutex<()>> = StdOnceLock::new();

    struct EnvVarGuard {
        key: &'static str,
        previous: Option<OsString>,
    }

    impl EnvVarGuard {
        fn set(key: &'static str, value: Option<OsString>) -> Self {
            let previous = env::var_os(key);
            match value {
                Some(value) => env::set_var(key, value),
                None => env::remove_var(key),
            }
            Self { key, previous }
        }
    }

    impl Drop for EnvVarGuard {
        fn drop(&mut self) {
            match &self.previous {
                Some(value) => env::set_var(self.key, value),
                None => env::remove_var(self.key),
            }
        }
    }

    #[test]
    fn default_codex_home_uses_official_cli_default() {
        let _guard = ENV_LOCK.get_or_init(|| StdMutex::new(())).lock().unwrap();
        let temp = tempfile::tempdir().expect("temporary directory");
        let user_home = temp.path().join("user");
        let custom = temp.path().join("custom-codex-home");
        let _user_profile =
            EnvVarGuard::set("USERPROFILE", Some(user_home.as_os_str().to_os_string()));
        let _home = EnvVarGuard::set("HOME", None);
        let _codex_home = EnvVarGuard::set("CODEX_HOME", Some(custom.as_os_str().to_os_string()));

        assert_eq!(default_codex_home_dir(), Some(user_home.join(".codex")));
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn cmd_wrapper_quotes_batch_file_and_arguments() {
        use super::build_cmd_c_command;
        use std::path::Path;

        let command_line = build_cmd_c_command(
            Path::new(r"C:\Program Files\Codex & Tools\codex.cmd"),
            &["app-server".to_string(), "x%y".to_string()],
        )
        .expect("command line");

        assert!(command_line.contains(r#""C:\Program Files\Codex & Tools\codex.cmd""#));
        assert!(command_line.contains(r#""app-server""#));
        assert!(command_line.contains(r#""x^%y""#));
    }
}

#[tauri::command]
pub async fn codex_skills_import(
    _app: tauri::AppHandle,
    _source_path: String,
    _scope: String,
    _cwd: Option<String>,
) -> Result<(), String> {
    Err(codex_environment_write_disabled_message())
}

#[tauri::command]
pub async fn codex_skills_delete(
    _app: tauri::AppHandle,
    _path: String,
    _scope: String,
    _cwd: Option<String>,
) -> Result<(), String> {
    Err(codex_environment_write_disabled_message())
}

#[tauri::command]
pub async fn codex_respond_to_request(
    state: tauri::State<'_, CodexState>,
    request_id: String,
    response: serde_json::Value,
) -> Result<(), String> {
    info!(
        "codex_respond_to_request: id={}, response={}",
        request_id, response
    );

    // Send response back to Codex
    let request_id_obj = if request_id.parse::<i64>().is_ok() {
        RequestId::Integer(request_id.parse().unwrap())
    } else {
        RequestId::String(request_id)
    };

    state
        .send_response(request_id_obj, response)
        .await
        .map_err(|e| format!("Failed to send response: {}", e))?;

    Ok(())
}
