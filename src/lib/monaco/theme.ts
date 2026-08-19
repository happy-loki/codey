import { monaco } from "./instance";
import darkDimmed from "./themes/dark-dimmed.json";
import lightColorblind from "./themes/light.json";

const MONACO_DARK_ID = "codey-dark-dimmed";
const MONACO_LIGHT_ID = "codey-light";

const prefersDark =
    typeof window !== "undefined"
        ? Boolean(window.matchMedia?.("(prefers-color-scheme: dark)")?.matches)
        : false;

let monacoThemesRegistered = false;
let currentThemeId = prefersDark ? MONACO_DARK_ID : MONACO_LIGHT_ID;

function ensureThemesRegistered(): void {
    if (monacoThemesRegistered) return;
    const normalizeMonacoTheme = (raw: any): monaco.editor.IStandaloneThemeData => {
        const expand = (color: string | undefined): string | undefined => {
            if (!color) return color;
            const c = String(color).trim();
            if (!c.startsWith("#")) return c;
            if (c.length === 4) {
                const [, r, g, b] = c;
                return `#${r}${r}${g}${g}${b}${b}`;
            }
            if (c.length === 5) {
                const [, r, g, b, a] = c;
                return `#${r}${r}${g}${g}${b}${b}${a}${a}`;
            }
            return c;
        };

        const clone: any = JSON.parse(JSON.stringify(raw));
        // 让缺失的 token 继承 Monaco 内置高亮，避免在未使用 TextMate 的语言上“全灰”。
        clone.inherit = true;

        if (clone.colors && typeof clone.colors === "object") {
            for (const key of Object.keys(clone.colors)) {
                clone.colors[key] = expand(clone.colors[key]);
            }
        }

        if (Array.isArray(clone.rules)) {
            clone.rules = clone.rules.map((rule: any) => {
                if (rule.foreground) rule.foreground = expand(rule.foreground);
                if (rule.background) rule.background = expand(rule.background);
                return rule;
            });
        }

        if (clone.encodedTokensColors && Array.isArray(clone.encodedTokensColors)) {
            clone.encodedTokensColors = clone.encodedTokensColors.map((c: string) => expand(c));
        }

        return clone as monaco.editor.IStandaloneThemeData;
    };

    monaco.editor.defineTheme(MONACO_LIGHT_ID, normalizeMonacoTheme(lightColorblind));
    monaco.editor.defineTheme(MONACO_DARK_ID, normalizeMonacoTheme(darkDimmed));
    monacoThemesRegistered = true;
}

export function applyMonacoTheme(isDark: boolean): void {
    ensureThemesRegistered();
    currentThemeId = isDark ? MONACO_DARK_ID : MONACO_LIGHT_ID;
    monaco.editor.setTheme(currentThemeId);
}

export function getMonacoThemeId(): string {
    ensureThemesRegistered();
    return currentThemeId;
}
