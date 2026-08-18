import { writable } from "svelte/store";

export type MacosSystemDictationShortcut = "fn_double" | "ctrl_double";

export type SystemDictationSettings = {
    macosShortcut: MacosSystemDictationShortcut;
};

export const DEFAULT_SYSTEM_DICTATION_SETTINGS: SystemDictationSettings = {
    macosShortcut: "fn_double",
};

export function sanitizeSystemDictationSettings(raw: unknown): SystemDictationSettings {
    const obj = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
    const v = typeof obj.macosShortcut === "string" ? obj.macosShortcut : "";
    const macosShortcut: MacosSystemDictationShortcut = v === "ctrl_double" ? "ctrl_double" : "fn_double";
    return { macosShortcut };
}

export const systemDictationSettings = writable<SystemDictationSettings>({
    ...DEFAULT_SYSTEM_DICTATION_SETTINGS,
});

