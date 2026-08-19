use log::debug;
use serde_json::Value;
use std::collections::HashSet;
use std::fs;
use std::path::Path;
use tauri::{AppHandle, Manager};
use tauri_plugin_shell::process::Command;

#[derive(Debug, Clone, Default)]
pub struct ProxyEnv {
    pub http: Option<String>,
    pub https: Option<String>,
    pub no_proxy: Option<String>,
}

impl ProxyEnv {
    pub fn is_empty(&self) -> bool {
        self.http.is_none() && self.https.is_none() && self.no_proxy.is_none()
    }

    fn fill_missing(&mut self, other: ProxyEnv) {
        if self.http.is_none() {
            self.http = other.http;
        }
        if self.https.is_none() {
            self.https = other.https;
        }
        if self.no_proxy.is_none() {
            self.no_proxy = other.no_proxy;
        }
    }

    fn ensure_https_fallback(&mut self) {
        if self.https.is_none() {
            self.https = self.http.clone();
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProxyMode {
    Auto,
    Manual,
    Direct,
}

impl Default for ProxyMode {
    fn default() -> Self {
        ProxyMode::Auto
    }
}

impl ProxyMode {
    fn from_str(value: &str) -> Self {
        match value.trim().to_ascii_lowercase().as_str() {
            "manual" => ProxyMode::Manual,
            "direct" | "off" => ProxyMode::Direct,
            _ => ProxyMode::Auto,
        }
    }
}

#[derive(Debug, Clone, Default)]
struct ProxySettings {
    mode: ProxyMode,
    http: Option<String>,
    https: Option<String>,
    no_proxy: Option<String>,
}

pub fn resolve_proxy_mode<R: tauri::Runtime>(app: &AppHandle<R>) -> ProxyMode {
    let settings_path = app
        .path()
        .app_local_data_dir()
        .map(|dir| dir.join("settings.json"))
        .ok();
    let settings = settings_path
        .as_ref()
        .map(|path| read_proxy_settings(path.as_path()))
        .unwrap_or_default();
    settings.mode
}

pub fn resolve_proxy_env<R: tauri::Runtime>(app: &AppHandle<R>) -> ProxyEnv {
    let settings_path = app
        .path()
        .app_local_data_dir()
        .map(|dir| dir.join("settings.json"))
        .ok();

    let settings = settings_path
        .as_ref()
        .map(|path| read_proxy_settings(path.as_path()))
        .unwrap_or_default();

    let mut env = match settings.mode {
        ProxyMode::Direct => ProxyEnv::default(),
        ProxyMode::Manual => {
            let mut env = ProxyEnv {
                http: normalize_endpoint(settings.http.clone()),
                https: normalize_endpoint(settings.https.clone()),
                no_proxy: settings.no_proxy.clone(),
            };
            env.ensure_https_fallback();
            env
        }
        ProxyMode::Auto => detect_system_proxy(),
    };

    env.ensure_https_fallback();
    env
}

pub fn apply_proxy_to_process_env(mode: ProxyMode, proxy: &ProxyEnv) {
    fn set_or_remove(key: &str, value: Option<&str>) {
        match value {
            Some(v) => std::env::set_var(key, v),
            None => std::env::remove_var(key),
        }
    }

    fn remove_keys(keys: &[&str]) {
        for key in keys {
            std::env::remove_var(key);
        }
    }

    match mode {
        ProxyMode::Direct => {
            // Codex core uses this flag to disable proxy usage in its default reqwest client.
            // On Windows, this is the most reliable way to ignore system proxy.
            std::env::set_var("CODEX_SANDBOX", "seatbelt");
            remove_keys(&[
                "HTTP_PROXY",
                "http_proxy",
                "HTTPS_PROXY",
                "https_proxy",
                "ALL_PROXY",
                "all_proxy",
                "NO_PROXY",
                "no_proxy",
            ]);
            // Force bypass even when system proxy (e.g. Clash) is enabled.
            std::env::set_var("NO_PROXY", "*");
            std::env::set_var("no_proxy", "*");
        }
        ProxyMode::Manual => {
            std::env::remove_var("CODEX_SANDBOX");
            set_or_remove("HTTP_PROXY", proxy.http.as_deref());
            set_or_remove("http_proxy", proxy.http.as_deref());
            set_or_remove("HTTPS_PROXY", proxy.https.as_deref());
            set_or_remove("https_proxy", proxy.https.as_deref());
            // Avoid leaking any existing ALL_PROXY into manual mode unless explicitly set elsewhere.
            remove_keys(&["ALL_PROXY", "all_proxy"]);
            set_or_remove("NO_PROXY", proxy.no_proxy.as_deref());
            set_or_remove("no_proxy", proxy.no_proxy.as_deref());
        }
        ProxyMode::Auto => {
            std::env::remove_var("CODEX_SANDBOX");
            // Respect system proxy automatically, but ignore any pre-existing proxy env vars.
            // This keeps behavior consistent with the app's config even when other tools
            // (e.g. Clash) inject *_PROXY into the environment.
            remove_keys(&[
                "HTTP_PROXY",
                "http_proxy",
                "HTTPS_PROXY",
                "https_proxy",
                "ALL_PROXY",
                "all_proxy",
                "NO_PROXY",
                "no_proxy",
            ]);
        }
    }
}

pub fn apply_proxy_env(mut command: Command, proxy: &ProxyEnv) -> Command {
    if let Some(ref http) = proxy.http {
        command = command.env("HTTP_PROXY", http).env("http_proxy", http);
    }
    if let Some(ref https) = proxy.https {
        command = command.env("HTTPS_PROXY", https).env("https_proxy", https);
    }
    if let Some(ref no_proxy) = proxy.no_proxy {
        command = command.env("NO_PROXY", no_proxy).env("no_proxy", no_proxy);
    }
    command
}

fn read_proxy_settings(path: &Path) -> ProxySettings {
    let mut settings = ProxySettings::default();
    let contents = match fs::read_to_string(path) {
        Ok(text) => text,
        Err(err) => {
            debug!("Proxy: failed to read settings file {:?}: {}", path, err);
            return settings;
        }
    };

    let json: Value = match serde_json::from_str(&contents) {
        Ok(value) => value,
        Err(err) => {
            debug!("Proxy: settings file {:?} is not valid JSON: {}", path, err);
            return settings;
        }
    };

    let Some(codey) = json.get("codey") else {
        return settings;
    };

    let Some(proxy) = codey.get("proxy") else {
        return settings;
    };

    if let Some(mode_value) = proxy.get("mode").and_then(Value::as_str) {
        settings.mode = ProxyMode::from_str(mode_value);
    }
    if let Some(http_value) = proxy.get("http").and_then(Value::as_str) {
        settings.http = sanitize_string(http_value);
    }
    if let Some(https_value) = proxy.get("https").and_then(Value::as_str) {
        settings.https = sanitize_string(https_value);
    }
    if let Some(no_proxy_value) = proxy.get("noProxy").and_then(Value::as_str) {
        settings.no_proxy = sanitize_no_proxy_str(no_proxy_value);
    }

    settings
}

fn detect_system_proxy() -> ProxyEnv {
    let mut env = read_env_proxy();

    #[cfg(target_os = "windows")]
    {
        env.fill_missing(read_windows_registry_proxy());
    }

    #[cfg(target_os = "macos")]
    {
        env.fill_missing(read_macos_proxy());
    }

    env
}

fn read_env_proxy() -> ProxyEnv {
    let http = env_var_any(&["HTTP_PROXY", "http_proxy"]);
    let https = env_var_any(&["HTTPS_PROXY", "https_proxy"]);
    let no_proxy =
        env_var_any(&["NO_PROXY", "no_proxy"]).and_then(|value| sanitize_no_proxy_str(&value));

    ProxyEnv {
        http,
        https,
        no_proxy,
    }
}

fn env_var_any(keys: &[&str]) -> Option<String> {
    for key in keys {
        if let Ok(value) = std::env::var(key) {
            if let Some(clean) = sanitize_string(&value) {
                return Some(clean);
            }
        }
    }
    None
}

fn sanitize_string(value: &str) -> Option<String> {
    let trimmed = value.trim().trim_matches('"');
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn sanitize_no_proxy_str(value: &str) -> Option<String> {
    let base = sanitize_string(value)?;
    let mut seen = HashSet::new();
    let mut result: Vec<String> = Vec::new();

    for token in base.split(|c| c == ',' || c == ';') {
        let trimmed = token.trim();
        if trimmed.is_empty() {
            continue;
        }
        if trimmed.eq_ignore_ascii_case("<local>") {
            for alias in ["localhost", "127.0.0.1"] {
                if seen.insert(alias.to_string()) {
                    result.push(alias.to_string());
                }
            }
            continue;
        }
        let cleaned = trimmed.trim_matches('"');
        if cleaned.is_empty() {
            continue;
        }
        let entry = cleaned.to_string();
        if seen.insert(entry.clone()) {
            result.push(entry);
        }
    }

    if result.is_empty() {
        None
    } else {
        Some(result.join(","))
    }
}

fn normalize_endpoint(input: Option<String>) -> Option<String> {
    input.and_then(|value| {
        let sanitized = sanitize_string(&value)?;
        if sanitized.contains("://") {
            Some(sanitized)
        } else {
            Some(format!("http://{}", sanitized))
        }
    })
}

#[cfg(target_os = "windows")]
fn read_windows_registry_proxy() -> ProxyEnv {
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;

    let mut result = ProxyEnv::default();
    let key = match RegKey::predef(HKEY_CURRENT_USER)
        .open_subkey("Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings")
    {
        Ok(key) => key,
        Err(err) => {
            debug!(
                "Proxy: failed to open Internet Settings registry key: {}",
                err
            );
            return result;
        }
    };

    let enabled: u32 = key.get_value("ProxyEnable").unwrap_or(0);
    if enabled != 0 {
        if let Ok(server) = key.get_value::<String, _>("ProxyServer") {
            result.fill_missing(parse_windows_proxy_server(&server));
        }
        if let Ok(overrides) = key.get_value::<String, _>("ProxyOverride") {
            if result.no_proxy.is_none() {
                result.no_proxy = sanitize_no_proxy_str(&overrides);
            }
        }
    }
    result
}

#[cfg(target_os = "windows")]
fn parse_windows_proxy_server(raw: &str) -> ProxyEnv {
    let mut env = ProxyEnv::default();
    let Some(cleaned) = sanitize_string(raw) else {
        return env;
    };

    if !cleaned.contains('=') {
        let endpoint = normalize_endpoint(Some(cleaned));
        env.http = endpoint.clone();
        env.https = endpoint;
        return env;
    }

    for part in cleaned.split(';') {
        let trimmed = part.trim();
        if trimmed.is_empty() {
            continue;
        }
        let mut kv = trimmed.splitn(2, '=');
        let key = kv.next().unwrap_or("").trim().to_ascii_lowercase();
        let value = kv.next().unwrap_or("").trim();
        if value.is_empty() {
            continue;
        }
        if let Some(endpoint) = normalize_endpoint(Some(value.to_string())) {
            match key.as_str() {
                "http" => env.http = Some(endpoint),
                "https" | "ssl" => env.https = Some(endpoint),
                "socks" => {
                    if env.http.is_none() {
                        env.http = Some(endpoint.clone());
                    }
                    if env.https.is_none() {
                        env.https = Some(endpoint);
                    }
                }
                _ => {}
            }
        }
    }

    env
}

#[cfg(target_os = "macos")]
fn read_macos_proxy() -> ProxyEnv {
    use std::process::Command;

    let mut result = ProxyEnv::default();
    let output = match Command::new("scutil").arg("--proxy").output() {
        Ok(out) => out,
        Err(err) => {
            debug!("Proxy: failed to invoke scutil --proxy: {}", err);
            return result;
        }
    };
    if !output.status.success() {
        return result;
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut http_enable = false;
    let mut http_host: Option<String> = None;
    let mut http_port: Option<u16> = None;
    let mut https_enable = false;
    let mut https_host: Option<String> = None;
    let mut https_port: Option<u16> = None;
    let mut exclude_simple = false;

    for line in stdout.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("HTTPEnable") {
            http_enable = parse_flag(trimmed);
        } else if trimmed.starts_with("HTTPProxy") {
            http_host = parse_value(trimmed);
        } else if trimmed.starts_with("HTTPPort") {
            http_port = parse_value(trimmed).and_then(|v| v.parse::<u16>().ok());
        } else if trimmed.starts_with("HTTPSEnable") {
            https_enable = parse_flag(trimmed);
        } else if trimmed.starts_with("HTTPSProxy") {
            https_host = parse_value(trimmed);
        } else if trimmed.starts_with("HTTPSPort") {
            https_port = parse_value(trimmed).and_then(|v| v.parse::<u16>().ok());
        } else if trimmed.starts_with("ExcludeSimpleHostnames") {
            exclude_simple = parse_flag(trimmed);
        }
    }

    if http_enable {
        result.http = compose_endpoint(http_host.as_deref(), http_port);
    }
    if https_enable {
        result.https = compose_endpoint(https_host.as_deref(), https_port);
    }
    if exclude_simple {
        result.no_proxy = Some("localhost,127.0.0.1".into());
    }

    result
}

#[cfg(target_os = "macos")]
fn parse_flag(line: &str) -> bool {
    matches!(parse_value(line).as_deref(), Some("1"))
}

#[cfg(target_os = "macos")]
fn parse_value(line: &str) -> Option<String> {
    let mut parts = line.splitn(2, ':');
    parts.next()?;
    let value = parts.next()?.trim();
    if value.is_empty() {
        None
    } else {
        Some(value.trim_matches('"').to_string())
    }
}

#[cfg(target_os = "macos")]
fn compose_endpoint(host: Option<&str>, port: Option<u16>) -> Option<String> {
    let host = host?;
    if host.trim().is_empty() {
        return None;
    }
    let endpoint = if let Some(port) = port {
        format!("{}:{}", host.trim(), port)
    } else {
        host.trim().to_string()
    };
    normalize_endpoint(Some(endpoint))
}
