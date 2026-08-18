import type { UpdatePreferences } from "../updater";
import {
    DEFAULT_AI_FONT_FAMILY,
    DEFAULT_EDITOR_FONT_FAMILY,
    DEFAULT_TERMINAL_FONT_FAMILY,
    DEFAULT_UI_FONT_FAMILY,
    DEFAULT_UPDATE_SETTINGS,
    DEFAULT_WECHAT_SETTINGS,
    BUILTIN_FONT_VALUES
} from "./constants";
import type { FontItem, WechatSettings } from "./types";
import { updatesDisabled } from "../env";

export function ensureObject<T extends Record<string, unknown>>(value: unknown): Record<string, unknown> {
    if (value && typeof value === "object" && !Array.isArray(value)) {
        return { ...(value as Record<string, unknown>) };
    }
    return {};
}

export function sanitizeFontFamily(value: unknown, fallback: string = DEFAULT_UI_FONT_FAMILY): string {
    if (typeof value === "string") {
        const trimmed = value.trim();
        if (trimmed.length) {
            return trimmed;
        }
    }
    return fallback;
}

export function buildBuiltinFontItems(translate: (key: string) => string): FontItem[] {
    const tfn = typeof translate === "function" ? translate : ((key: string) => key);
    const candidates: FontItem[] = [
        {
            id: "default-ui-font",
            name: DEFAULT_UI_FONT_FAMILY,
            value: DEFAULT_UI_FONT_FAMILY,
            label: tfn("settings.systemFontStack")
        },
        {
            id: "default-editor-font",
            name: DEFAULT_EDITOR_FONT_FAMILY,
            value: DEFAULT_EDITOR_FONT_FAMILY,
            label: tfn("settings.systemMonospaceStack")
        },
        {
            id: "default-terminal-font",
            name: DEFAULT_TERMINAL_FONT_FAMILY,
            value: DEFAULT_TERMINAL_FONT_FAMILY,
            label: tfn("settings.systemMonospaceStack")
        },
        {
            id: "default-ai-font",
            name: DEFAULT_AI_FONT_FAMILY,
            value: DEFAULT_AI_FONT_FAMILY,
            label: tfn("settings.systemFontStack")
        }
    ];
    const seen = new Set<string>();
    const deduped: FontItem[] = [];
    for (const item of candidates) {
        const value = (item.value ?? item.name).toLowerCase();
        if (seen.has(value)) continue;
        seen.add(value);
        deduped.push(item);
    }
    return deduped;
}

export function sanitizeUpdateSettings(raw: unknown): UpdatePreferences {
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
        const source = raw as Record<string, unknown>;
        const legacyAutoCheck = typeof source.autoCheck === "boolean" ? source.autoCheck : undefined;
        const legacyAutoInstall = typeof source.autoInstall === "boolean" ? source.autoInstall : undefined;
        const enabled =
            legacyAutoCheck !== undefined
                ? legacyAutoCheck
                : legacyAutoInstall !== undefined
                    ? legacyAutoInstall
                    : DEFAULT_UPDATE_SETTINGS.autoCheck;
        if (updatesDisabled) {
            return { autoCheck: false, autoInstall: false };
        }
        return { autoCheck: enabled, autoInstall: enabled };
    }
    if (updatesDisabled) {
        return { autoCheck: false, autoInstall: false };
    }
    return { ...DEFAULT_UPDATE_SETTINGS };
}

export function normalizeWechatString(value: unknown): string {
    if (typeof value === "string") {
        return value.trim();
    }
    return "";
}

export function sanitizeWechatSettings(raw: unknown): WechatSettings {
    if (raw && typeof raw === "object") {
        const source = raw as Record<string, unknown>;
        return {
            appId: normalizeWechatString(source.appId),
            appSecret: normalizeWechatString(source.appSecret)
        };
    }
    return { ...DEFAULT_WECHAT_SETTINGS };
}

export function mergeWechatSettings(base: WechatSettings, patch: Partial<WechatSettings>): WechatSettings {
    return sanitizeWechatSettings({ ...base, ...patch });
}
