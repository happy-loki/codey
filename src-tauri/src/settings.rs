use log::{info, warn};
use serde_json::{json, Map, Value};
use std::collections::HashMap;
use std::fs;
use std::path::Path;
use tauri::Manager;

const DEFAULT_SETTINGS_RAW: &str = include_str!("../../src/config/defaultSettings.json");

pub fn load_settings(app: &mut tauri::App) {
    info!("Loading default settings:");

    let mut default_settings: Value = serde_json::from_str(DEFAULT_SETTINGS_RAW)
        .expect("defaultSettings.json must be valid JSON");

    normalize_terminal_defaults(&mut default_settings);

    let appdata_local = app.path().app_local_data_dir().unwrap();
    let settings_path = appdata_local.join("settings.json");
    let legacy_path = appdata_local.join("default_settings.json");

    // Ensure the settings directory exists before we try to read/write any files.
    if let Err(err) = fs::create_dir_all(&appdata_local) {
        warn!(
            "Unable to create settings directory {:?}: {}. Skipping settings load.",
            appdata_local, err
        );
        return;
    }

    // Migrate legacy file name if present and new file missing
    if !settings_path.try_exists().unwrap_or(false) && legacy_path.try_exists().unwrap_or(false) {
        match fs::copy(&legacy_path, &settings_path) {
            Ok(_) => info!(
                "Migrated legacy settings from {:?} to {:?}",
                legacy_path, settings_path
            ),
            Err(err) => warn!(
                "Failed to migrate legacy settings file from {:?} to {:?}: {}",
                legacy_path, settings_path, err
            ),
        }
    }

    if !settings_path.try_exists().unwrap() {
        if let Err(err) = write_settings_pretty(&settings_path, &default_settings) {
            warn!(
                "Failed to create default settings file at {:?}: {}",
                &settings_path, err
            );
            return;
        }
        info!(
            "Default settings file not found. Created a new default settings file. Path: {:?}",
            &settings_path
        );
    } else {
        info!("Settings path: {:?}:", settings_path);
        if let Err(err) = backfill_missing_settings(&settings_path, &default_settings) {
            warn!(
                "Failed to merge new default settings into existing file {:?}: {}",
                settings_path, err
            );
        }
    }

    let defaults: HashMap<String, Value> = default_settings
        .as_object()
        .expect("default settings JSON must be an object")
        .iter()
        .map(|(key, value)| (key.clone(), value.clone()))
        .collect();

    let _settings_store = tauri_plugin_store::StoreBuilder::new(app.handle(), settings_path)
        .defaults(defaults)
        .build()
        .unwrap();
}

fn write_settings_pretty(path: &Path, value: &serde_json::Value) -> Result<(), std::io::Error> {
    let mut json = serde_json::to_string_pretty(value)
        .map_err(|err| std::io::Error::new(std::io::ErrorKind::Other, err.to_string()))?;
    json.push('\n');
    fs::write(path, json)
}

fn backfill_missing_settings(path: &Path, defaults: &Value) -> Result<(), std::io::Error> {
    let existing_contents = fs::read_to_string(path).unwrap_or_default();
    let mut existing: Value = serde_json::from_str(&existing_contents)
        .unwrap_or_else(|_| Value::Object(serde_json::Map::new()));

    if !existing.is_object() {
        // if structure is unexpected, overwrite with defaults to avoid corruption
        write_settings_pretty(path, defaults)?;
        return Ok(());
    }

    let mut changed = false;
    merge_defaults(&mut existing, defaults, &mut changed);

    if fix_windows_busybox_profile(&mut existing) {
        changed = true;
    }

    if changed {
        write_settings_pretty(path, &existing)?;
    }

    Ok(())
}

fn merge_defaults(existing: &mut Value, defaults: &Value, changed: &mut bool) {
    match (existing, defaults) {
        (Value::Object(existing_map), Value::Object(default_map)) => {
            for (key, default_value) in default_map {
                match existing_map.get_mut(key) {
                    Some(existing_value) => {
                        merge_defaults(existing_value, default_value, changed);
                    }
                    None => {
                        existing_map.insert(key.clone(), default_value.clone());
                        *changed = true;
                    }
                }
            }
        }
        // primitives/arrays: nothing to merge if key exists
        _ => {}
    }
}

fn normalize_terminal_defaults(settings: &mut Value) -> bool {
    let map = match settings.as_object_mut() {
        Some(m) => m,
        None => return false,
    };

    let terminal_value = map
        .entry("terminal")
        .or_insert_with(|| Value::Object(Map::new()));

    let terminal_map = match terminal_value.as_object_mut() {
        Some(map) => map,
        None => return false,
    };

    apply_terminal_defaults(terminal_map)
}

fn apply_terminal_defaults(map: &mut Map<String, Value>) -> bool {
    match std::env::consts::OS {
        "windows" => apply_windows_defaults(map),
        "macos" => apply_unix_defaults(map, "zsh", "/bin/zsh", &["--login", "-i"]),
        "linux" => apply_unix_defaults(map, "bash", "/bin/bash", &["--login", "-i"]),
        _ => apply_unix_defaults(map, "sh", "/bin/sh", &["-i"]),
    }
}

fn apply_windows_defaults(map: &mut Map<String, Value>) -> bool {
    set_profile_object(map, "busybox", Some("busybox"), &["sh"])
}

fn apply_unix_defaults(
    map: &mut Map<String, Value>,
    profile: &str,
    program: &str,
    args: &[&str],
) -> bool {
    set_profile_object(map, profile, Some(program), args)
}

fn set_profile_object(
    map: &mut Map<String, Value>,
    name: &str,
    program: Option<&str>,
    args: &[&str],
) -> bool {
    let mut profile_map = Map::new();
    profile_map.insert("name".into(), Value::String(name.into()));
    if let Some(p) = program {
        profile_map.insert("program".into(), Value::String(p.into()));
    }
    if !args.is_empty() {
        profile_map.insert("args".into(), json!(args));
    }
    let new_value = Value::Object(profile_map);
    match map.get("profile") {
        Some(existing) if *existing == new_value => false,
        _ => {
            map.insert("profile".into(), new_value);
            true
        }
    }
}

#[cfg(target_os = "windows")]
fn fix_windows_busybox_profile(settings: &mut Value) -> bool {
    let settings_map = match settings.as_object_mut() {
        Some(map) => map,
        None => return false,
    };

    let terminal_value = match settings_map.get_mut("terminal") {
        Some(value) => value,
        None => return false,
    };

    let terminal_map = match terminal_value.as_object_mut() {
        Some(map) => map,
        None => return false,
    };

    let profile_value = match terminal_map.get_mut("profile") {
        Some(value) => value,
        None => return false,
    };

    let profile_map = match profile_value.as_object_mut() {
        Some(map) => map,
        None => return false,
    };

    let name_raw = profile_map
        .get("name")
        .and_then(|value| value.as_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    let program = match profile_map.get("program").and_then(|value| value.as_str()) {
        Some(p) => p,
        None => return false,
    };

    let normalized_program = program.to_ascii_lowercase();
    let name_is_busybox = name_raw == "busybox" || name_raw == "busybox.exe";
    let program_is_busybox = normalized_program == "busybox"
        || normalized_program == "busybox.exe"
        || normalized_program.ends_with("busybox64u.exe")
        || normalized_program.ends_with("busybox.exe");
    let program_exists = Path::new(program).exists();
    let program_is_virtual = normalized_program == "busybox" || normalized_program == "busybox.exe";

    if (name_is_busybox || program_is_busybox) && !program_exists && !program_is_virtual {
        profile_map.insert("program".into(), Value::String("busybox".into()));
        if !profile_map.contains_key("args") {
            profile_map.insert("args".into(), json!(["sh"]));
        }
        return true;
    }

    false
}

#[cfg(not(target_os = "windows"))]
fn fix_windows_busybox_profile(_: &mut Value) -> bool {
    false
}
