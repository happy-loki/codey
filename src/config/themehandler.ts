import { themes } from "./extensionhandler";
// import { info } from "tauri-plugin-log-api";
import { info } from '@tauri-apps/plugin-log';
import { get, writable } from "svelte/store";
import { setColorScheme, setEditorTheme } from "../lib/Editor.svelte";
import { updateThemeAll } from "../lib/terminalRegistry";
import { applyMonacoTheme } from "../lib/monaco/theme";

export function getThemes() {
    return get(themes);
}

const THEME_SCHEME_KEY = "codey-theme-scheme";
const THEME_NAME_KEY = "codey-theme-name";

function getInitialScheme(): boolean {
    if (typeof window === "undefined") {
        return false;
    }
    try {
        const cachedScheme = window.localStorage.getItem(THEME_SCHEME_KEY);
        if (cachedScheme === "dark") return true;
        if (cachedScheme === "light") return false;
        const prefersDark = window.matchMedia?.("(prefers-color-scheme: dark)")?.matches;
        if (prefersDark) return true;
    } catch {}
    return false;
}

const initialScheme = getInitialScheme();

// Use documentElement style so theme variables always apply globally,
// independent of stylesheet load/order.
const rootStyle = document.documentElement.style;

try {
    document.documentElement.setAttribute('data-theme', initialScheme ? 'dark' : 'light');
} catch {}

export const is_dark_theme = writable(initialScheme);
const builtinThemes = import.meta.glob("./extensions/default_themes/themes/*.json", {
    import: "default",
    eager: true
}) as Record<string, any>;

export async function loadTheme(name: string) {
    let theme = get(themes).find(n => n.name === name);
    if (!theme) {
        console.error(`Theme "${name}" not found`);
        return;
    }
    info(`Loading theme: ${name}... [themehandler.ts:16]`);
    const dark = theme.scheme === "dark";
    is_dark_theme.set(dark);
    try {
        if (typeof window !== "undefined") {
            window.localStorage.setItem(THEME_SCHEME_KEY, dark ? "dark" : "light");
            window.localStorage.setItem(THEME_NAME_KEY, theme.name);
        }
    } catch {}

    const normalizedPath = typeof theme.path === "string"
        ? theme.path.replace(/^\.\//, "")
        : theme.path;
    const moduleKey = `./extensions/default_themes/${normalizedPath}`;
    const json = builtinThemes[moduleKey];
    if (!json) {
        console.error(`Theme file "${moduleKey}" not bundled; ensure it matches glob in themehandler.ts.`);
        return;
    }

    processStyles(json);

    // Map terminal color variables to ANSI variables for xterm
    const copyVar = (from: string, to: string) => {
        const v = getComputedStyle(document.documentElement).getPropertyValue(from).trim();
        if (v) rootStyle.setProperty(to, v);
    };
    const base = ['black','red','green','yellow','blue','magenta','cyan','white'] as const;
    for (const k of base) copyVar(`--terminal-${k}`, `--ansi-${k}`);
    const bright = ['brightBlack','brightRed','brightGreen','brightYellow','brightBlue','brightMagenta','brightCyan','brightWhite'] as const;
    for (const k of bright) copyVar(`--terminal-${k}`, `--ansi-${k}`);
    // Optional cursor/selection variables if provided by theme JSON
    copyVar(`--terminal-cursor`, `--ansi-cursor`);
    copyVar(`--terminal-selectionBackground`, `--ansi-selectionBackground`);

    // load custom theme if it exists
    //const path = await join(await homeDir(), ".codey", "extensions");
    //if (await exists(path)) {
        //const custom_themes = await readDir(path);
    //}

    setColorScheme();

    const useDark = get(is_dark_theme);
    applyMonacoTheme(useDark);

    setEditorTheme();

    // Unified theme propagation: html[data-theme] + terminals + iframe
    try {
        document.documentElement.setAttribute('data-theme', get(is_dark_theme) ? 'dark' : 'light');
    } catch {}
    try {
        updateThemeAll();
    } catch {}
    info("Theme loaded sucessfully. [themehandler.ts:35]");
}
function processStyles(json) {
    const theme: any = Object.entries(json.theme);
    for (const entries of theme) {
        const [category, component] = entries[0].split(".");
        const property = `--${category}-${component}`;
        const raw = entries[1];
        const value = raw === "transparent" || raw === "" ? "transparent" : raw;
        rootStyle.setProperty(property, value);
    }
}
export function getThemeProperty(styleName: string) {
    const value = getComputedStyle(document.documentElement).getPropertyValue(`--${styleName}`);
    return value?.trim() || "purple";
}
