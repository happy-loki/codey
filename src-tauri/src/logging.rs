use log::{Level, LevelFilter};
use tauri::plugin::TauriPlugin;
use tauri::Manager;
use tauri::Wry;
use tauri_plugin_log::{RotationStrategy, Target, TargetKind};
use tracing_subscriber::layer::SubscriberExt;
use tracing_subscriber::util::SubscriberInitExt;

fn env_truthy(name: &str) -> bool {
    match std::env::var(name) {
        Ok(v) => {
            let s = v.trim().to_ascii_lowercase();
            matches!(s.as_str(), "1" | "true" | "yes" | "on")
        }
        Err(_) => false,
    }
}

fn parse_level_filter_from_env() -> Option<LevelFilter> {
    let raw = std::env::var("RUST_LOG").ok()?;
    let s = raw.trim().to_ascii_lowercase();
    // Only handle simple global levels like "error|warn|info|debug|trace".
    // Module directives (e.g., "h2=info,hyper=warn") are ignored here.
    match s.as_str() {
        "off" => Some(LevelFilter::Off),
        "error" => Some(LevelFilter::Error),
        "warn" | "warning" => Some(LevelFilter::Warn),
        "info" => Some(LevelFilter::Info),
        "debug" => Some(LevelFilter::Debug),
        "trace" => Some(LevelFilter::Trace),
        _ => None,
    }
}

fn allow_by_threshold(level: Level, threshold: LevelFilter) -> bool {
    match threshold {
        LevelFilter::Off => false,
        LevelFilter::Error => matches!(level, Level::Error),
        LevelFilter::Warn => matches!(level, Level::Warn | Level::Error),
        LevelFilter::Info => matches!(level, Level::Info | Level::Warn | Level::Error),
        LevelFilter::Debug => matches!(
            level,
            Level::Debug | Level::Info | Level::Warn | Level::Error
        ),
        LevelFilter::Trace => true,
    }
}

pub fn configure_log() -> TauriPlugin<Wry> {
    #[cfg(debug_assertions)]
    let targets = [
        Target::new(TargetKind::Stdout),
        Target::new(TargetKind::Webview),
    ];

    #[cfg(not(debug_assertions))]
    let targets = [
        Target::new(TargetKind::Stdout),
        Target::new(TargetKind::LogDir { file_name: None }),
    ];

    // Determine the effective minimum level threshold:
    // - If RUST_LOG is set to a simple level, use it.
    // - Otherwise fall back to: Info in dev builds, Error in release builds.
    //
    // Why Info in dev?
    // Some dependencies (e.g. ignore/grep crates) emit extremely chatty DEBUG logs during
    // workspace search/walk operations. Because we also mirror logs into the Webview in dev,
    // that debug flood can stall the UI. Developers can still opt into DEBUG via RUST_LOG=debug.
    let default_threshold = if cfg!(debug_assertions) {
        LevelFilter::Info
    } else {
        LevelFilter::Error
    };
    let threshold = parse_level_filter_from_env().unwrap_or(default_threshold);

    tauri_plugin_log::Builder::default()
        .format(move |out, message, record| {
            let format = time::format_description::parse(
                "[[[year]-[month]-[day]][[[hour]:[minute]:[second]]",
            )
            .unwrap();
            let file_info = record
                .file()
                .map(|location| format!("::{}", location.split("\\").last().unwrap().to_owned()))
                .unwrap_or("".to_string());
            let line_info = record
                .line()
                .map(|line| format!(":{}", line))
                .unwrap_or("".to_string());
            out.finish(format_args!(
                "{}[{}][{}{}{}] {}",
                time::OffsetDateTime::now_local()
                    .unwrap()
                    .format(&format)
                    .unwrap(),
                record.level(),
                record.target(),
                file_info,
                line_info,
                message
            ))
        })
        .targets(targets)
        .filter(move |entry| allow_by_threshold(entry.level(), threshold))
        .rotation_strategy(RotationStrategy::KeepAll)
        .build()
}

pub fn configure_log_path(app: &mut tauri::App) {
    use std::fs;
    use std::path::Path;

    let app_log_dir = app.path().app_log_dir().unwrap();
    let old_log_path = app_log_dir.join("arthas.log");
    if !Path::exists(&old_log_path) {
        return;
    }

    let format = time::format_description::parse("[year]-[month]-[day]-[hour][minute]").unwrap();
    let time = time::OffsetDateTime::now_local()
        .unwrap()
        .format(&format)
        .unwrap();
    let log_name = format!("arthas_log-{}.log", time);

    let new_log_path = app_log_dir.join(log_name);
    fs::rename(old_log_path, new_log_path).unwrap();
}

/// Optional debugging aid: capture Codex `tracing` logs to a file in the same directory as
/// Arthas logs, with ANSI disabled (so files do not contain escape sequences).
///
/// Enable via: `ARTHAS_CAPTURE_CODEX_STDERR=1` (legacy name) or `ARTHAS_CAPTURE_CODEX_TRACING=1`
/// Optional file name override: `ARTHAS_CODEX_STDERR_LOG_FILE=<name.log>` (legacy name)
pub fn maybe_capture_codex_tracing(app: &mut tauri::App) {
    if !(env_truthy("ARTHAS_CAPTURE_CODEX_TRACING") || env_truthy("ARTHAS_CAPTURE_CODEX_STDERR")) {
        return;
    }

    let app_log_dir = match app.path().app_log_dir() {
        Ok(p) => p,
        Err(err) => {
            log::warn!(
                "Failed to get app_log_dir for codex tracing capture: {}",
                err
            );
            return;
        }
    };

    let file_name = std::env::var("ARTHAS_CODEX_STDERR_LOG_FILE")
        .ok()
        .filter(|s| !s.trim().is_empty());
    let path = if let Some(file_name) = file_name {
        app_log_dir.join(file_name)
    } else {
        let format =
            time::format_description::parse("[year]-[month]-[day]-[hour][minute][second]").unwrap();
        let time = time::OffsetDateTime::now_local()
            .unwrap_or_else(|_| time::OffsetDateTime::now_utc())
            .format(&format)
            .unwrap_or_else(|_| "unknown-time".to_string());
        app_log_dir.join(format!("codex_tracing-{}.log", time))
    };

    let file = match std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
    {
        Ok(f) => f,
        Err(err) => {
            log::warn!(
                "Failed to open codex tracing capture file {}: {}",
                path.display(),
                err
            );
            return;
        }
    };

    let writer = SharedFileWriter::new(file);
    let env_filter = tracing_subscriber::EnvFilter::from_default_env();
    let fmt_layer = tracing_subscriber::fmt::layer()
        .with_ansi(false)
        .with_writer(writer);

    // Install once for the Arthas process. The external Codex app-server has its own process
    // and stderr capture path.
    if tracing_subscriber::registry()
        .with(env_filter)
        .with(fmt_layer)
        .try_init()
        .is_ok()
    {
        log::info!(
            "Codex tracing capture enabled (ARTHAS_CAPTURE_CODEX_TRACING/STDERR=1): {}",
            path.display()
        );
    } else {
        log::warn!(
            "Codex tracing capture requested but tracing subscriber was already initialized; skipping (file would have been: {}).",
            path.display()
        );
    }
}

#[derive(Clone)]
struct SharedFileWriter {
    file: std::sync::Arc<std::sync::Mutex<std::fs::File>>,
}

impl SharedFileWriter {
    fn new(file: std::fs::File) -> Self {
        Self {
            file: std::sync::Arc::new(std::sync::Mutex::new(file)),
        }
    }
}

struct SharedFileWriteGuard {
    file: std::sync::Arc<std::sync::Mutex<std::fs::File>>,
}

impl std::io::Write for SharedFileWriteGuard {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        let mut file = self.file.lock().map_err(|_| {
            std::io::Error::new(std::io::ErrorKind::Other, "log file lock poisoned")
        })?;
        file.write(buf)
    }

    fn flush(&mut self) -> std::io::Result<()> {
        let mut file = self.file.lock().map_err(|_| {
            std::io::Error::new(std::io::ErrorKind::Other, "log file lock poisoned")
        })?;
        file.flush()
    }
}

impl<'a> tracing_subscriber::fmt::writer::MakeWriter<'a> for SharedFileWriter {
    type Writer = SharedFileWriteGuard;

    fn make_writer(&'a self) -> Self::Writer {
        SharedFileWriteGuard {
            file: self.file.clone(),
        }
    }
}
