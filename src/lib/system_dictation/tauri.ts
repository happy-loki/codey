import { invoke } from "@tauri-apps/api/core";

export async function isSystemDictationSupported(): Promise<boolean> {
    return invoke<boolean>("system_dictation_is_supported");
}

export async function triggerSystemDictation(macosShortcut?: string | null): Promise<void> {
    // Use snake_case payload keys to match Rust command parameter naming.
    await invoke("system_dictation_trigger", macosShortcut ? { macos_shortcut: macosShortcut } : {});
}

export async function dismissSystemDictation(): Promise<void> {
    await invoke("system_dictation_dismiss");
}
