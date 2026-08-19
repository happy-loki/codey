import { writable } from "svelte/store";
import Mousetrap  from "mousetrap";
import { getKeybinds } from "./commands";
import { path } from "@tauri-apps/api";
import { sep as sepFunc } from "@tauri-apps/api/path";
const sep = sepFunc();
import { invoke } from "@tauri-apps/api/core"
import { openInExplorer } from "../lib/File";

import { loadTheme } from "./themehandler";
// import { Store } from "tauri-plugin-store-api";
// import { LazyStore } from '@tauri-apps/plugin-store';
import { Store } from '@tauri-apps/plugin-store';
import { setEditorFontFamily, setEditorFontSize, setEditorLetterSpacing, setEditorLineHeight, setEditorLineWrapping, setEditorTabSize } from "../lib/Editor.svelte";
import { readDir, watch, exists, writeTextFile } from '@tauri-apps/plugin-fs';
// import { info } from "tauri-plugin-log-api";
import { info } from '@tauri-apps/plugin-log';
import { termOptions, updateTermOptions } from "../lib/Terminal.svelte";
import { ensureTypographyDefaults, setAiFontFamily, setAiFontSize, setUiFontFamily, setUiFontSize } from "./typography";
import { DEFAULT_MARKDOWN_CSS } from "./defaultMarkdownCss";
import defaultSettings from "./defaultSettings.json";
import { normalizeMonoFontFamily, SYSTEM_MONO_FONT_STACK } from "./fontStacks";
import { setUpdatePreferences } from "../lib/updater";
import {
    DEFAULT_SYSTEM_DICTATION_SETTINGS,
    sanitizeSystemDictationSettings,
    systemDictationSettings as systemDictationSettingsStore,
} from "../lib/system_dictation/settings";

export const systemfonts = writable([]);
export const editorfont = writable("");
export const windowtheme = writable("");


async function ensureMarkdownCss(baseDir: string) {
    try {
        let cssPath = "";
        try {
            cssPath = await path.join(baseDir, "markdown.css");
        }
        catch {
            cssPath = `${baseDir}markdown.css`;
        }

        const alreadyExists = await exists(cssPath).catch(() => false);
        if (alreadyExists) {
            return;
        }

        await writeTextFile(cssPath, DEFAULT_MARKDOWN_CSS);
    }
    catch (error) {
        console.warn("Failed to ensure markdown.css", error);
    }
}

// mousetrap is outdated and i hate the lowercase keymaps but cba to go into the code and fix everything so this will do
const COMBO_ID = (value: string) => value.toLowerCase().replace(/\s+/g, "");

const TEXT_EDIT_SHORTCUTS = (() => {
    const combos: string[] = [];
    const modifiers = ["ctrl", "command", "meta"];
    const keys = ["x", "c", "v", "a", "z"];
    for (const mod of modifiers) {
        for (const key of keys) {
            combos.push(`${mod}+${key}`);
        }
        combos.push(`${mod}+shift+z`);
    }
    return new Set(combos.map(COMBO_ID));
})();

const DELETE_SHORTCUTS = new Set(["del", "backspace"].map(COMBO_ID));

function parseKeybind(keybind: string) {
    const keys = keybind.split("+");
    const keymap = {
        "Shift": "shift",
        "Control": "ctrl",
        "Ctrl": "ctrl",
        "Alt": "alt",
        "Option": "alt",
        "Meta": "meta",
        "Command": "command",
        "Cmd": "command",
        "Backspace": "backspace",
        "Tab": "tab",
        "Enter": "enter",
        "Capslock": "capslock",
        "Escape": "escape",
        "Esc": "escape",
        "Space": "space",
        "Pageup": "pageup",
        "Pagedown": "pagedown",
        "Home": "home",
        "Delete": "del",
        "Del": "del",
        "End": "end",
        "+": "up",
        "-": "down"
    };
    for (const key of keys) {
        const trimmed = key.trim();
        if (!trimmed.length) {
            continue;
        }
        if (keymap[trimmed]) {
            keybind = keybind.replace(key, keymap[trimmed]);
        }
        else if (keymap[trimmed.toLowerCase()]) {
            keybind = keybind.replace(key, keymap[trimmed.toLowerCase()]);
        }
        else {
            keybind = keybind.replace(key, trimmed.toLowerCase());
        }
    }
    return keybind;
}

function buildKeybindVariants(keybind: string): string[] {
    if (typeof keybind !== "string" || keybind.trim().length === 0) {
        return [];
    }
    const variants = new Set<string>();
    const base = parseKeybind(keybind);
    if (base) {
        variants.add(base);
    }
    const ctrlPattern = /(ctrl|control)/i;
    if (ctrlPattern.test(keybind)) {
        const commandVariant = parseKeybind(keybind.replace(/(ctrl|control)/gi, "Command"));
        if (commandVariant) {
            variants.add(commandVariant);
        }
        const metaVariant = parseKeybind(keybind.replace(/(ctrl|control)/gi, "Meta"));
        if (metaVariant) {
            variants.add(metaVariant);
        }
    }
    return Array.from(variants);
}

const GLOBAL_MOUSTRAP_COMBOS = new Set(
    buildKeybindVariants("Control+Shift+F").map((combo) => COMBO_ID(combo))
);

// Combos that are handled by the native app menu (Tauri accelerators / predefined items).
// Avoid binding them via Mousetrap to prevent double-triggering (e.g. Cmd+N firing twice on macOS).
const NATIVE_MENU_COMBOS = new Set(
    [
        ...buildKeybindVariants("Control+N"),
        ...buildKeybindVariants("Control+O"),
        ...buildKeybindVariants("Control+K"),
        ...buildKeybindVariants("Control+S"),
        ...buildKeybindVariants("Control+Shift+S"),
        // Common macOS native menu items
        ...buildKeybindVariants("Control+Q"),
        ...buildKeybindVariants("Control+,"),
        ...buildKeybindVariants("Control+M"),
    ].map((combo) => COMBO_ID(combo))
);

const MONACO_RESERVED_COMBOS = new Set(
    [
        ...buildKeybindVariants("Control+F"),
        ...buildKeybindVariants("Control+Shift+G"),
    ].map((combo) => COMBO_ID(combo))
);

function isMonacoEditorContext(element?: Element | null): boolean {
    if (element && "closest" in element && typeof element.closest === "function") {
        const monacoContainer = element.closest(".monaco-editor");
        if (monacoContainer) {
            return true;
        }
    }
    const active = (typeof document !== "undefined" ? document.activeElement : null) as HTMLElement | null;
    return Boolean(active?.closest?.(".monaco-editor"));
}

const originalStopCallback = Mousetrap.prototype.stopCallback;
Mousetrap.prototype.stopCallback = function (e, element, combo, sequence) {
    const raw = COMBO_ID(combo || sequence || "");
    if (GLOBAL_MOUSTRAP_COMBOS.has(raw)) {
        return false;
    }
    if (isMonacoEditorContext(element as HTMLElement | null)) {
        return false;
    }
    return originalStopCallback.call(this, e, element, combo, sequence);
};

export async function getShortcuts() {
    info("Intializing shortcut bindings...", {file: "config.ts", line: 50});
    const shortcuts = getKeybinds();
    const shouldLetBrowserHandleShortcut = (comboId: string): boolean => {
        const active = (typeof document !== "undefined" ? document.activeElement : null) as HTMLElement | null;
        if (isMonacoEditorContext(active) && MONACO_RESERVED_COMBOS.has(comboId)) {
            return true;
        }
        const isEditable = isTextEditableElement(active);
        const isTerminalHelper = active?.classList?.contains?.("xterm-helper-textarea");
        const isTerminal = Boolean(isTerminalHelper || active?.closest?.(".terminal"));
        if (isEditable && TEXT_EDIT_SHORTCUTS.has(comboId)) {
            return true;
        }
        if ((isEditable || isTerminal) && DELETE_SHORTCUTS.has(comboId)) {
            return true;
        }
        return false;
    };

    const isTextEditableElement = (element: HTMLElement | null): boolean => {
        if (!element) {
            return false;
        }
        const tag = (element.tagName || "").toLowerCase();
        if (tag === "input" || tag === "textarea") {
            return true;
        }
        if (element.isContentEditable) {
            return true;
        }
        if (element.closest?.(".monaco-editor")) {
            return true;
        }
        if (element.dataset?.allowBrowserShortcuts === "true") {
            return true;
        }
        return false;
    };
    for (const shortcut of shortcuts) {
        // skip binding shorcuts that are disabled
        if (shortcut.disabled === "true") {
            info(`The keybind "${shortcut.keybind}" is disabled. Skipping and/or falling back to default...`, {file: "config.ts", line: 55});
            continue;
        }
        const combos = buildKeybindVariants(shortcut.keybind);
        if (!combos.length) {
            continue;
        }
        Mousetrap.bind(combos, async (e, triggeredCombo) => {
            const comboId = COMBO_ID(triggeredCombo || combos[0] || "");
            if (NATIVE_MENU_COMBOS.has(comboId)) {
                return;
            }
            if (shouldLetBrowserHandleShortcut(comboId)) {
                return;
            }
            e.preventDefault();
            await fireAction(shortcut.command);
        });
    }
    info("Shortcuts loaded successfully.", {file: "config.ts", line: 64});
}

async function fireAction(callback: () => Promise<void>, args = []) {
    await callback();
    return false;
}

export let appSettings: Promise<Store>;

export async function loadDefaultSettings() {
    const appdataLocal = await path.appLocalDataDir();
    await ensureMarkdownCss(appdataLocal);
    let settingsPath = `${appdataLocal}settings.json`;
    try {
        settingsPath = await path.join(appdataLocal, "settings.json");
    } catch {
        // fall back to naive string concat; appLocalDataDir already ends with separator
        settingsPath = `${appdataLocal}settings.json`;
    }
    appSettings = Store.load(settingsPath);
    const settings = await appSettings;   // 拿到真正的 Store 实例
    ensureTypographyDefaults();
    // 文件监视功能
    watch(
        settingsPath,
        () => {
            settings.reload();   // 重新加载设置
        }
    )

    await getShortcuts();

    const ensureObject = (value: unknown): Record<string, any> => {
        if (value && typeof value === "object" && !Array.isArray(value)) {
            return { ...(value as Record<string, any>) };
        }
        return {};
    };

    const toNumber = (value: unknown, fallback: number): number => {
        if (typeof value === "number" && Number.isFinite(value)) return value;
        const numeric = Number(value);
        return Number.isFinite(numeric) ? numeric : fallback;
    };

    const defaultsAny: Record<string, any> = defaultSettings as any;
    const editorDefaults = ensureObject(defaultsAny.editor);
    const uiDefaults = ensureObject(defaultsAny.ui);
    const aiDefaults = ensureObject(defaultsAny.ai);
    const terminalDefaults = ensureObject(defaultsAny.terminal);
    const updatesDefaults = ensureObject(defaultsAny.updates);
    const codeyDefaults = ensureObject(defaultsAny.codey);
    const systemDictationDefaults = ensureObject(defaultsAny.system_dictation);

    const applyCodeySettings = async (raw: unknown) => {
        const obj = { ...codeyDefaults, ...ensureObject(raw) };
        const themeValue = typeof obj.theme === "string" && obj.theme.trim().length ? obj.theme : (codeyDefaults.theme ?? "Light");
        await loadTheme(themeValue);
    };

    const applyUpdateSettings = (raw: unknown) => {
        const obj = { ...updatesDefaults, ...ensureObject(raw) };
        const autoCheck = Boolean(
            Object.prototype.hasOwnProperty.call(obj, "autoCheck") ? obj.autoCheck : updatesDefaults.autoCheck ?? true
        );
        const autoInstall = Boolean(
            Object.prototype.hasOwnProperty.call(obj, "autoInstall") ? obj.autoInstall : updatesDefaults.autoInstall ?? false
        );
        setUpdatePreferences({ autoCheck, autoInstall });
    };

    const applySystemDictationSettings = (raw: unknown) => {
        const merged = { ...DEFAULT_SYSTEM_DICTATION_SETTINGS, ...systemDictationDefaults, ...ensureObject(raw) };
        systemDictationSettingsStore.set(sanitizeSystemDictationSettings(merged));
    };

    const applyUiSettings = (raw: unknown) => {
        const obj = { ...uiDefaults, ...ensureObject(raw) };
        setUiFontFamily(obj.fontFamily ?? uiDefaults.fontFamily);
        setUiFontSize(obj.fontSize ?? uiDefaults.fontSize);
    };

    const applyAiSettings = (raw: unknown) => {
        const obj = { ...aiDefaults, ...ensureObject(raw) };
        setAiFontFamily(obj.fontFamily ?? aiDefaults.fontFamily);
        setAiFontSize(obj.fontSize ?? aiDefaults.fontSize);
    };

    const applyEditorSettings = (raw: unknown) => {
        const obj = { ...editorDefaults, ...ensureObject(raw) };
        const fontSizeValue = toNumber(obj.fontSize ?? editorDefaults.fontSize ?? 16, 16);
        const tabSizeValue = toNumber(obj.tabSize ?? editorDefaults.tabSize ?? 4, 4);
        const lineHeightValue = obj.lineHeight ?? editorDefaults.lineHeight ?? "1.618";
        const letterSpacingValue = toNumber(obj.letterSpacing ?? editorDefaults.letterSpacing ?? 0, 0);
        const editorFontFamilyValue = normalizeMonoFontFamily(
            obj.fontFamily ?? editorDefaults.fontFamily,
            SYSTEM_MONO_FONT_STACK
        );

        setEditorFontSize(fontSizeValue);
        setEditorFontFamily(editorFontFamilyValue);
        setEditorLineHeight(String(lineHeightValue));
        setEditorLetterSpacing(letterSpacingValue);
        setEditorLineWrapping(Boolean(obj.lineWrapping ?? editorDefaults.lineWrapping));
        setEditorTabSize(tabSizeValue);
    };

    const sanitizeTerminalSettings = (raw: unknown) => {
        const obj = { ...terminalDefaults, ...ensureObject(raw) };
        if (Object.prototype.hasOwnProperty.call(obj, "fontWeight")) {
            delete obj.fontWeight;
        }
        obj.fontFamily = normalizeMonoFontFamily(
            obj.fontFamily ?? terminalDefaults.fontFamily,
            SYSTEM_MONO_FONT_STACK
        );
        obj.profile = { ...ensureObject(obj.profile) };
        return obj;
    };

    const applyTerminalSettings = (raw: unknown) => {
        const sanitized = sanitizeTerminalSettings(raw);
        termOptions.set(sanitized);
        updateTermOptions();
    };

    const migrateMonoFontSettingsIfNeeded = async () => {
        let dirty = false;

        const editorRaw = ensureObject(await settings.get("editor"));
        const normalizedEditorFontFamily = normalizeMonoFontFamily(
            editorRaw.fontFamily ?? editorDefaults.fontFamily,
            SYSTEM_MONO_FONT_STACK
        );
        const nextEditorRaw = { ...editorRaw };
        if (normalizedEditorFontFamily !== editorRaw.fontFamily) {
            nextEditorRaw.fontFamily = normalizedEditorFontFamily;
            dirty = true;
        }
        if (!Object.prototype.hasOwnProperty.call(editorRaw, "letterSpacing")) {
            nextEditorRaw.letterSpacing = editorDefaults.letterSpacing ?? 0.5;
            dirty = true;
        }
        if (dirty) {
            await settings.set("editor", nextEditorRaw);
        }

        const terminalRaw = ensureObject(await settings.get("terminal"));
        const normalizedTerminalFontFamily = normalizeMonoFontFamily(
            terminalRaw.fontFamily ?? terminalDefaults.fontFamily,
            SYSTEM_MONO_FONT_STACK
        );
        if (normalizedTerminalFontFamily !== terminalRaw.fontFamily) {
            await settings.set("terminal", { ...terminalRaw, fontFamily: normalizedTerminalFontFamily });
            dirty = true;
        }

        if (dirty) {
            await settings.save();
        }
    };

    await migrateMonoFontSettingsIfNeeded();

    await applyCodeySettings(await settings.get("codey"));
    applyUiSettings(await settings.get("ui"));
    applyAiSettings(await settings.get("ai"));
    applyEditorSettings(await settings.get("editor"));
    applyTerminalSettings(await settings.get("terminal"));
    applyUpdateSettings(await settings.get("updates"));
    applySystemDictationSettings(await settings.get("system_dictation"));

    settings.onKeyChange("codey", applyCodeySettings);
    settings.onKeyChange("ui", applyUiSettings);
    settings.onKeyChange("ai", applyAiSettings);
    settings.onKeyChange("editor", applyEditorSettings);
    settings.onKeyChange("terminal", applyTerminalSettings);
    settings.onKeyChange("updates", applyUpdateSettings);
    settings.onKeyChange("system_dictation", applySystemDictationSettings);

    info("Settings initialized", {file: "config.ts", line: 97});
}

export async function openLogFiles() {
    const logDir = await path.appLogDir();
    const recentLog = (await readDir(logDir)).at(-1);
    if (!recentLog) return;
    await openInExplorer(await path.join(logDir, recentLog.name));
}

export function getTime() {
    let time = new Intl.DateTimeFormat('en-US', {dateStyle: "short", timeStyle: "long"}).format();
    return time;
}
