#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

use log::{error, info};
#[cfg(all(target_os = "windows", not(debug_assertions)))]
use std::sync::Once;
use std::sync::{Mutex, OnceLock};
use tauri::menu::{Menu, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder};
use tauri::{Emitter, Manager, State};
use tokio::time::{sleep, Duration};

// mod cline_core;  // Removed - using Codex instead
mod codex_integration;
mod codex_protocol_types;
mod commands;
mod encoding;
mod fs_indexer;
// mod hostbridge;  // Removed - was for Cline gRPC
// mod http_bridge; // Removed - was for Cline gRPC
mod logging;
mod proxy;
mod settings;
mod wechat;
mod window_state;
mod workspace_state;

const MENU_FILE_OPEN_FOLDER: &str = "menu.file.open-folder";
const MENU_WORKSPACE_RECENT_PREFIX: &str = "menu.workspace.recent.";
#[cfg(target_os = "macos")]
const MENU_APP_PREFERENCES: &str = "menu.app.preferences";
const CODEX_TOKIO_WORKER_STACK_SIZE_BYTES: usize = 16 * 1024 * 1024;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum MenuLanguage {
    En,
    ZhCn,
}

impl Default for MenuLanguage {
    fn default() -> Self {
        MenuLanguage::En
    }
}

impl MenuLanguage {
    fn from_tag(tag: &str) -> Option<Self> {
        let lower = tag.trim().to_ascii_lowercase();
        if lower.starts_with("zh") {
            Some(MenuLanguage::ZhCn)
        } else if lower.starts_with("en") {
            Some(MenuLanguage::En)
        } else {
            None
        }
    }

    fn detect() -> Self {
        let candidates = [
            std::env::var("ARTHAS_MENU_LANG").ok(),
            std::env::var("ARTHAS_LANG").ok(),
            std::env::var("LANG").ok(),
            std::env::var("LC_ALL").ok(),
        ];

        for candidate in candidates.into_iter().flatten() {
            if let Some(lang) = MenuLanguage::from_tag(&candidate) {
                return lang;
            }
        }

        MenuLanguage::default()
    }

    fn labels(self) -> MenuLabels {
        match self {
            MenuLanguage::En => MenuLabels {
                workspace_menu: "Workspace".into(),
                new_workspace: "New Workspace".into(),
                recent_workspaces: "Recent Workspaces".into(),
                no_recent_workspaces: "No recent workspaces".into(),
                edit_menu: "Edit".into(),
                cut: "Cut".into(),
                copy: "Copy".into(),
                paste: "Paste".into(),
                select_all: "Select All".into(),
                #[cfg(target_os = "macos")]
                preferences: "Preferences…".into(),
            },
            MenuLanguage::ZhCn => {
                let edit_menu = if cfg!(target_os = "windows") {
                    "编辑(&E)".to_string()
                } else {
                    "编辑".to_string()
                };

                MenuLabels {
                    workspace_menu: "工作空间".into(),
                    new_workspace: "新建工作空间".into(),
                    recent_workspaces: "最近工作空间".into(),
                    no_recent_workspaces: "暂无最近工作空间".into(),
                    edit_menu,
                    cut: "剪切".into(),
                    copy: "复制".into(),
                    paste: "粘贴".into(),
                    select_all: "全选".into(),
                    #[cfg(target_os = "macos")]
                    preferences: "偏好设置…".into(),
                }
            }
        }
    }
}

struct MenuLabels {
    workspace_menu: String,
    new_workspace: String,
    recent_workspaces: String,
    no_recent_workspaces: String,
    edit_menu: String,
    cut: String,
    copy: String,
    paste: String,
    select_all: String,
    #[cfg(target_os = "macos")]
    preferences: String,
}

static MENU_EVENT_HANDLER: OnceLock<()> = OnceLock::new();

#[derive(Clone)]
struct NativeMenuState {
    lang: MenuLanguage,
    recent_workspaces: Vec<String>,
}

impl Default for NativeMenuState {
    fn default() -> Self {
        Self {
            lang: MenuLanguage::detect(),
            recent_workspaces: Vec::new(),
        }
    }
}

#[derive(Default)]
struct SetupState {
    frontend_task_done: bool,
    backend_task_done: bool,
}

fn install_tauri_async_runtime() -> tokio::runtime::Runtime {
    let mut builder = tokio::runtime::Builder::new_multi_thread();
    builder.enable_all();
    builder.thread_stack_size(CODEX_TOKIO_WORKER_STACK_SIZE_BYTES);
    let runtime = builder
        .build()
        .expect("failed to initialize Tauri async runtime");
    tauri::async_runtime::set(runtime.handle().clone());
    runtime
}

// Note: Protobuf modules removed - were for Cline gRPC
// Codex uses JSON-RPC, no protobuf needed

async fn graceful_shutdown<R: tauri::Runtime>(app_handle: tauri::AppHandle<R>) {
    println!("[INFO] Signal-triggered shutdown: notifying webview...");
    if let Some(window) = app_handle.get_webview_window("main") {
        let _ = window.emit("app-will-close", ());
    }
    // small grace period for UI flush
    std::thread::sleep(std::time::Duration::from_millis(120));
    // Note: Cline sidecar stop removed - using Codex instead
    // request app exit; idempotent if already exiting
    app_handle.exit(0);
}

#[cfg(all(target_os = "windows", not(debug_assertions)))]
fn hide_attached_console_window() {
    use windows_sys::Win32::System::Console::GetConsoleWindow;
    use windows_sys::Win32::UI::WindowsAndMessaging::{ShowWindow, SW_HIDE};

    static INIT: Once = Once::new();
    INIT.call_once(|| unsafe {
        let hwnd = GetConsoleWindow();
        if !hwnd.is_null() {
            ShowWindow(hwnd, SW_HIDE);
        }
    });
}

#[cfg(all(target_os = "windows", not(debug_assertions)))]
fn ensure_hidden_console_pool() {
    use windows_sys::Win32::System::Console::{AllocConsole, GetConsoleWindow};
    use windows_sys::Win32::UI::WindowsAndMessaging::{ShowWindow, SW_HIDE};

    static INIT: Once = Once::new();
    INIT.call_once(|| unsafe {
        let mut hwnd = GetConsoleWindow();
        if hwnd.is_null() {
            if AllocConsole() == 0 {
                return;
            }
            hwnd = GetConsoleWindow();
        }
        if !hwnd.is_null() {
            ShowWindow(hwnd, SW_HIDE);
        }
    });
}

fn spawn_signal_handlers<R: tauri::Runtime>(app_handle: tauri::AppHandle<R>) {
    // UNIX: listen for SIGINT/SIGTERM/SIGQUIT/SIGHUP
    #[cfg(unix)]
    {
        use tokio::signal::unix::{signal, SignalKind};
        let ah = app_handle.clone();
        tauri::async_runtime::spawn(async move {
            let mut sigint = signal(SignalKind::interrupt()).expect("sigint");
            let mut sigterm = signal(SignalKind::terminate()).expect("sigterm");
            let mut sigquit = signal(SignalKind::quit()).expect("sigquit");
            let mut sighup = signal(SignalKind::hangup()).expect("sighup");
            tokio::select! {
                _ = sigint.recv() => info!("Received SIGINT"),
                _ = sigterm.recv() => info!("Received SIGTERM"),
                _ = sigquit.recv() => info!("Received SIGQUIT"),
                _ = sighup.recv() => info!("Received SIGHUP"),
            }
            graceful_shutdown(ah).await;
        });
    }

    // Windows / cross-platform: Ctrl+C
    {
        let ah = app_handle.clone();
        tauri::async_runtime::spawn(async move {
            if tokio::signal::ctrl_c().await.is_ok() {
                info!("Received Ctrl+C");
                graceful_shutdown(ah).await;
            }
        });
    }
}

fn configure_native_menu<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    state: &NativeMenuState,
) -> tauri::Result<()> {
    let labels = state.lang.labels();

    #[cfg(target_os = "macos")]
    let app_menu = {
        let name = app.package_info().name.clone();
        let about = PredefinedMenuItem::about(app, None, None)?;
        let preferences = MenuItemBuilder::with_id(MENU_APP_PREFERENCES, &labels.preferences)
            .accelerator("Cmd+,")
            .build(app)?;
        let services = PredefinedMenuItem::services(app, None)?;
        let hide = PredefinedMenuItem::hide(app, None)?;
        let hide_others = PredefinedMenuItem::hide_others(app, None)?;
        let show_all = PredefinedMenuItem::show_all(app, None)?;
        let quit = PredefinedMenuItem::quit(app, None)?;
        SubmenuBuilder::new(app, name)
            .item(&about)
            .separator()
            .item(&preferences)
            .separator()
            .item(&services)
            .separator()
            .item(&hide)
            .item(&hide_others)
            .item(&show_all)
            .separator()
            .item(&quit)
            .build()?
    };

    let new_workspace = MenuItemBuilder::with_id(MENU_FILE_OPEN_FOLDER, &labels.new_workspace)
        .accelerator("CmdOrCtrl+K")
        .build(app)?;
    let recent_header = MenuItemBuilder::new(&labels.recent_workspaces)
        .enabled(false)
        .build(app)?;
    let no_recent_workspaces = MenuItemBuilder::new(&labels.no_recent_workspaces)
        .enabled(false)
        .build(app)?;
    let workspace_menu = SubmenuBuilder::new(app, &labels.workspace_menu)
        .item(&new_workspace)
        .separator()
        .item(&recent_header);
    let workspace_menu = if state.recent_workspaces.is_empty() {
        workspace_menu.item(&no_recent_workspaces)
    } else {
        let mut menu = workspace_menu;
        for (index, workspace_path) in state.recent_workspaces.iter().take(10).enumerate() {
            let item = MenuItemBuilder::with_id(
                format!("{MENU_WORKSPACE_RECENT_PREFIX}{index}"),
                workspace_path,
            )
            .build(app)?;
            menu = menu.item(&item);
        }
        menu
    }
    .build()?;

    // Use predefined edit menu items so the OS/WebView can handle clipboard shortcuts
    // (especially on macOS, avoiding WKWebView clipboard permission prompts).
    let undo = PredefinedMenuItem::undo(app, None)?;
    let redo = PredefinedMenuItem::redo(app, None)?;
    let cut = PredefinedMenuItem::cut(app, Some(labels.cut.as_str()))?;
    let copy = PredefinedMenuItem::copy(app, Some(labels.copy.as_str()))?;
    let paste = PredefinedMenuItem::paste(app, Some(labels.paste.as_str()))?;
    let select_all = PredefinedMenuItem::select_all(app, Some(labels.select_all.as_str()))?;
    let edit_menu = SubmenuBuilder::new(app, &labels.edit_menu)
        .item(&undo)
        .item(&redo)
        .separator()
        .item(&cut)
        .item(&copy)
        .item(&paste)
        .separator()
        .item(&select_all)
        .build()?;

    #[cfg(target_os = "macos")]
    let view_menu = {
        let fullscreen = PredefinedMenuItem::fullscreen(app, None)?;
        SubmenuBuilder::new(app, "View").item(&fullscreen).build()?
    };

    #[cfg(target_os = "macos")]
    let window_menu = {
        let minimize = PredefinedMenuItem::minimize(app, None)?;
        SubmenuBuilder::new(app, "Window").item(&minimize).build()?
    };

    let menu = Menu::new(app)?;
    #[cfg(target_os = "macos")]
    menu.append(&app_menu)?;
    menu.append(&workspace_menu)?;
    menu.append(&edit_menu)?;
    #[cfg(target_os = "macos")]
    menu.append(&view_menu)?;
    #[cfg(target_os = "macos")]
    menu.append(&window_menu)?;
    let _ = app.set_menu(menu);

    Ok(())
}

fn ensure_menu_event_handler<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    let _ = MENU_EVENT_HANDLER.get_or_init(|| {
        app.on_menu_event(|handle, event| {
            let Some(window) = handle.get_webview_window("main") else {
                return;
            };

            let event_id = event.id().as_ref();
            let payload = if let Some(index) = event_id.strip_prefix(MENU_WORKSPACE_RECENT_PREFIX) {
                Some(format!("{MENU_WORKSPACE_RECENT_PREFIX}{index}"))
            } else {
                match event_id {
                    MENU_FILE_OPEN_FOLDER => Some(MENU_FILE_OPEN_FOLDER.to_string()),
                    #[cfg(target_os = "macos")]
                    MENU_APP_PREFERENCES => Some(MENU_APP_PREFERENCES.to_string()),
                    _ => None,
                }
            };

            if let Some(action) = payload {
                if let Err(err) = window.emit("app://menu", action.as_str()) {
                    log::warn!("Failed to emit menu action '{}': {}", action, err);
                }
            }
        });
        ()
    });
}

fn with_native_menu_state<R, F>(app: &tauri::AppHandle<R>, update: F) -> Result<(), String>
where
    R: tauri::Runtime,
    F: FnOnce(&mut NativeMenuState),
{
    let state = app.state::<Mutex<NativeMenuState>>();
    let snapshot = {
        let mut guard = state
            .lock()
            .map_err(|_| "native menu state poisoned".to_string())?;
        update(&mut guard);
        guard.clone()
    };
    ensure_menu_event_handler(app);
    configure_native_menu(app, &snapshot).map_err(|err| err.to_string())
}

fn setup_native_menu<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> tauri::Result<()> {
    let snapshot = {
        let state = app.state::<Mutex<NativeMenuState>>();
        let guard = state
            .lock()
            .map_err(|_| tauri::Error::Anyhow(anyhow::anyhow!("native menu state poisoned")))?;
        guard.clone()
    };
    configure_native_menu(app, &snapshot)?;
    ensure_menu_event_handler(app);
    Ok(())
}

#[tauri::command]
fn set_menu_language(app: tauri::AppHandle, lang: String) -> Result<(), String> {
    let target = MenuLanguage::from_tag(&lang).unwrap_or_else(MenuLanguage::detect);
    with_native_menu_state(&app, |state| {
        state.lang = target;
    })
}

#[tauri::command]
fn set_recent_workspaces_menu(
    app: tauri::AppHandle,
    recent_workspaces: Vec<String>,
) -> Result<(), String> {
    let sanitized = recent_workspaces
        .into_iter()
        .map(|item| item.trim().to_string())
        .filter(|item| !item.is_empty())
        .take(10)
        .collect::<Vec<_>>();
    with_native_menu_state(&app, |state| {
        state.recent_workspaces = sanitized;
    })
}

#[tauri::command]
async fn set_complete(
    app: tauri::AppHandle,
    state: State<'_, Mutex<SetupState>>,
    task: String,
) -> Result<(), String> {
    let mut lock = state
        .lock()
        .map_err(|_| "setup state poisoned".to_string())?;
    match task.as_str() {
        "frontend" => lock.frontend_task_done = true,
        "backend" => lock.backend_task_done = true,
        other => return Err(format!("unknown task '{}'.", other)),
    }
    let ready = lock.frontend_task_done && lock.backend_task_done;
    drop(lock);

    if ready {
        if let Some(splash) = app.get_webview_window("splashscreen") {
            let _ = splash.close();
        }
        if let Some(main) = app.get_webview_window("main") {
            let _ = main.show();
            let _ = main.set_focus();
        }
    }

    Ok(())
}

#[tauri::command]
fn close_splashscreen(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(splash) = app.get_webview_window("splashscreen") {
        splash.close().map_err(|e| e.to_string())?;
    }
    Ok(())
}

async fn run_backend_setup(app: tauri::AppHandle) {
    info!("Performing backend setup task...");
    sleep(Duration::from_secs(3)).await;
    info!("Backend setup task completed.");
    if let Err(err) = set_complete(
        app.clone(),
        app.state::<Mutex<SetupState>>(),
        "backend".to_string(),
    )
    .await
    {
        log::warn!("Failed to mark backend setup complete: {}", err);
    }
}

fn main() {
    let _ = rustls::crypto::ring::default_provider().install_default();

    #[cfg(all(target_os = "windows", not(debug_assertions)))]
    hide_attached_console_window();

    let args: Vec<String> = std::env::args().collect();

    // Windows: allocate a single hidden console *only* for the long-lived main UI process.
    //
    // This provides a shared hidden console for console-subsystem children to inherit,
    // preventing "console pop" windows when running shell commands. We intentionally
    // skip this for the short-lived apply_patch helper, because allocating a console
    // there can create a visible flash (conhost) in full-agent mode.
    #[cfg(all(target_os = "windows", not(debug_assertions)))]
    ensure_hidden_console_pool();

    // Codex can use deeper async call stacks during app-server startup and request handling.
    // Match the Codex CLI runtime stack size instead of Tauri's default Tokio runtime.
    let _tauri_runtime = install_tauri_async_runtime();

    let original = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        original(info);
        error!("[FATAL]: {:?}", info.to_string());
    }));
    // Note: cline_core::wire_lifecycle removed - was for Cline
    let builder = tauri::Builder::default();
    #[cfg(not(debug_assertions))]
    let builder = builder.plugin(tauri_plugin_updater::Builder::new().build());
    #[cfg(debug_assertions)]
    let builder = builder;
    builder
        .invoke_handler(tauri::generate_handler![
            // File commands
            commands::fs::delete_file,
            commands::fs::attempt_file_access,
            commands::fs::is_file,
            commands::fs::is_folder,
            commands::fs::file_size,
            commands::fs::read_file,
            commands::fs::read_file_bytes,
            commands::fs::write_file,
            commands::fs::is_supported,
            // System commands
            commands::system::open_in_default,
            commands::system::open_terminal,
            commands::system::reveal_in_file_manager,
            commands::system::export_animation_gif,
            commands::system::list_system_fonts,
            // Workspace commands
            commands::workspace::set_workspace_dir,
            commands::workspace::get_workspace_dir,
            commands::workspace::search_workspace,
            commands::workspace::hostbridge_update_tabs,
            commands::workspace::get_editor_context,
            // System dictation (OS voice typing)
            commands::system_dictation::system_dictation_is_supported,
            commands::system_dictation::system_dictation_trigger,
            commands::system_dictation::system_dictation_dismiss,
            // commands::add_to_cline,  // Removed - was for Cline
            // commands::get_cline_client_id,  // Removed - was for Cline
            fs_indexer::start_fs_indexer,
            fs_indexer::stop_fs_indexer,
            fs_indexer::list_children,
            fs_indexer::update_fs_watch_scope,
            wechat::publish_wechat_draft,
            wechat::verify_wechat_credentials,
            wechat::upload_wechat_thumb,
            codex_integration::codex_interrupt_guard_state,
            set_complete,
            set_menu_language,
            set_recent_workspaces_menu,
            close_splashscreen,
            // Codex commands
            codex_integration::codex_initialize,
            codex_integration::codex_thread_start,
            codex_integration::codex_thread_resume,
            codex_integration::codex_thread_list,
            codex_integration::codex_turn_start,
            codex_integration::codex_review_start,
            codex_integration::codex_turn_interrupt,
            codex_integration::codex_thread_archive,
            codex_integration::codex_thread_name_set,
            codex_integration::codex_thread_goal_set,
            codex_integration::codex_thread_goal_get,
            codex_integration::codex_thread_goal_clear,
            codex_integration::codex_model_list,
            codex_integration::codex_account_login,
            codex_integration::codex_account_logout,
            codex_integration::codex_account_read,
            codex_integration::codex_cancel_login_account,
            codex_integration::codex_get_account,
            codex_integration::codex_custom_provider_load,
            codex_integration::codex_model_provider_load,
            codex_integration::codex_settings_load,
            codex_integration::codex_settings_save,
            codex_integration::codex_mcp_server_status_list,
            codex_integration::codex_skills_list,
            codex_integration::codex_skills_config_write,
            codex_integration::codex_plugin_list,
            codex_integration::codex_plugin_read,
            codex_integration::codex_plugin_install,
            codex_integration::codex_plugin_uninstall,
            codex_integration::codex_plugin_set_enabled,
            codex_integration::codex_marketplace_add,
            codex_integration::codex_marketplace_remove,
            codex_integration::codex_marketplace_upgrade,
            codex_integration::codex_official_bundled_plugins_status,
            codex_integration::codex_official_chrome_plugin_install_or_repair,
            codex_integration::codex_skills_import,
            codex_integration::codex_skills_delete,
            codex_integration::codex_respond_to_request,
            commands::codex_patch::codex_apply_file_changes,
            commands::codex_patch::codex_preview_file_changes,
            commands::codex_patch::codex_apply_undo_snapshot,
            commands::codex_patch::codex_close_file_change_previews,
            commands::git::list_git_branches,
            commands::git::git_branch_overview,
        ])
        .manage(Mutex::new(SetupState::default()))
        .manage(workspace_state::WorkspaceState::default())
        .manage(window_state::WindowState::default())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(logging::configure_log())
        .plugin(tauri_plugin_pty::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            logging::configure_log_path(app);
            logging::maybe_capture_codex_tracing(app);
            settings::load_settings(app);
            app.manage(Mutex::new(NativeMenuState::default()));

            // Note: Port configuration removed - was for Cline bridges
            // Codex doesn't need external ports

            if let Err(err) = setup_native_menu(&app.handle()) {
                log::warn!("Failed to configure native menu: {}", err);
            }

            #[cfg(target_os = "macos")]
            {
                use tauri::TitleBarStyle;

                if let Some(main_window) = app.get_webview_window("main") {
                    let _ = main_window.set_title_bar_style(TitleBarStyle::Overlay);
                }
            }

            #[cfg(not(target_os = "macos"))]
            {
                if let Some(main_window) = app.get_webview_window("main") {
                    let _ = main_window.set_decorations(false);
                }
            }
            // OS signal handlers (SIGINT/SIGTERM/Ctrl+C) → graceful shutdown
            spawn_signal_handlers(app.handle().clone());

            // Note: HostBridge and HTTP Bridge removed - they were for Cline.
            // Codex now runs as an external `codex app-server` subprocess.

            // Note: Cline sidecar startup removed - using Codex instead

            // Initialize Codex integration (external app-server mode)
            {
                let handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    if let Err(e) = codex_integration::init_codex(&handle).await {
                        log::error!("Failed to initialize Codex: {}", e);
                    } else {
                        log::info!("Codex initialized successfully");
                    }
                });
            }

            let setup_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                run_backend_setup(setup_handle).await;
            });
            Ok(())
        })
        .manage(fs_indexer::FsIndexerState::default())
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(|app_handle, event| {
            if let tauri::RunEvent::ExitRequested { .. } = event {
                println!("[INFO] Exit requested. Notifying webview and stopping sidecars...");

                // 1) Notify the webview so it can persist UI state, etc.
                if let Some(window) = app_handle.get_webview_window("main") {
                    let _ = window.emit("app-will-close", ());
                    println!("[INFO] Emitted 'app-will-close' to webview 'main'.");
                }

                // 2) Give the webview a short moment to react
                std::thread::sleep(std::time::Duration::from_millis(120));

                // Note: Cline sidecar cleanup removed - using Codex instead

                println!("[INFO] Shutdown sequence completed for ExitRequested.");
            }
        });
}
