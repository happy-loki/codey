<script lang="ts">
    import { onMount, onDestroy } from "svelte";
    import { get } from "svelte/store";
    import SettingsNav, { type SettingsItem } from "./SettingsNav.svelte";
    import GeneralSection from "./settings/sections/GeneralSection.svelte";
    import NetworkSection from "./settings/sections/NetworkSection.svelte";
    import UiSection from "./settings/sections/UiSection.svelte";
    import EditorSection from "./settings/sections/EditorSection.svelte";
    import TerminalSection from "./settings/sections/TerminalSection.svelte";
    let availableShells: any[] = [];
    onMount(async () => { availableShells = await invoke<any[]>("list_available_shells").catch(() => []); });
    import AssistantSection from "./settings/sections/AssistantSection.svelte";
    import SystemDictationSection from "./settings/sections/SystemDictationSection.svelte";
    import WechatSection from "./settings/sections/WechatSection.svelte";
    import AboutSection from "./settings/sections/AboutSection.svelte";
    import { NAV_DEFINITIONS, type NavDefinition } from "./settings/nav";
    import {
        ensureObject,
        sanitizeFontFamily,
        buildBuiltinFontItems,
        sanitizeUpdateSettings,
        normalizeWechatString,
        sanitizeWechatSettings,
        mergeWechatSettings
    } from "./settings/utils";
    import {
        DEFAULT_AI_FONT_FAMILY,
        DEFAULT_EDITOR_FONT_FAMILY,
        DEFAULT_TERMINAL_FONT_FAMILY,
        DEFAULT_UI_FONT_FAMILY,
        DEFAULT_UPDATE_SETTINGS,
        DEFAULT_WECHAT_SETTINGS,
        DEFAULT_PROXY_SETTINGS,
        BUILTIN_FONT_VALUES
    } from "./settings/constants";
    import type { FontItem, ProxyMode, ProxySettings, WechatConnectionState, WechatSettings } from "./settings/types";
    import { appSettings } from "../config/config";
    import { MIN_UI_FONT_PX, MAX_UI_FONT_PX } from "../config/typography";
    import { getThemes } from "../config/themehandler";
    import { addEditorTab } from "./EditorTabList.svelte";
    import { setEditorLineWrapping as applyLineWrappingToEditors } from "./Editor.svelte";
    import { appLocalDataDir, join } from "@tauri-apps/api/path";
    import { invoke } from "@tauri-apps/api/core";
    import { getVersion } from "@tauri-apps/api/app";
    import { t, lang as uiLangStore, initLang, setLang } from "./i18n";
    import { addNotification, NotifType } from "./Notifications/notifications";
    import type { UnlistenFn } from "@tauri-apps/api/event";
    import { listen } from "@tauri-apps/api/event";
    import { termOptions as terminalStore, updateTermOptions as refreshTerminalOptions } from "./Terminal.svelte";
    import {
        checkForUpdates,
        downloadPendingUpdate,
        restartToApplyUpdate,
        updaterState,
        setUpdatePreferences
    } from "./updater";
    import type { UpdateState, UpdatePreferences } from "./updater";
    import { updatesDisabled } from "./env";
    import { DEFAULT_SYSTEM_DICTATION_SETTINGS, sanitizeSystemDictationSettings } from "./system_dictation/settings";

    export let hidden = true;

    let editorFontSize: number | string = "";
    let editorFontFamily: string = DEFAULT_EDITOR_FONT_FAMILY;
    let editorLineHeight: string = "";
    let editorLetterSpacing: number | string = "";
    let editorTabSize: number | string = "";
    let editorLineWrapping = false;
    let codeyTheme: string = "";
    let terminalOptions: any = {};
    let uiFontSize: string | number = "";
    let uiFontFamily: string = DEFAULT_UI_FONT_FAMILY;
    let aiFontSize: string = "";
    let aiFontFamily: string = DEFAULT_AI_FONT_FAMILY;
    let uiLang: string = "en";
    let settingsFilePath = "";
    let translator: (key: string, params?: Record<string, string | number>) => string;
    let builtinFontItems: FontItem[] = [];
    let dynamicFontItems: FontItem[] = [];
    let fontFamilyItems: FontItem[] = [];
    let editorSettingsObj: Record<string, any> = {};
    let uiSettingsObj: Record<string, any> = {};
    let aiSettingsObj: Record<string, any> = {};
    let terminalSettingsObj: Record<string, any> = {};
    let codeySettingsObj: Record<string, any> = {};
    let updateSettingsObj: UpdatePreferences = { ...DEFAULT_UPDATE_SETTINGS };
    let autoCheckUpdates = DEFAULT_UPDATE_SETTINGS.autoCheck;
    let updateStatus: string = "";
    let updateState: UpdateState = { phase: "idle" };
    type ProxyField = "http" | "https" | "noProxy";
    let proxyMode: ProxyMode = DEFAULT_PROXY_SETTINGS.mode;
    let proxyHttp: string = DEFAULT_PROXY_SETTINGS.http;
    let proxyHttps: string = DEFAULT_PROXY_SETTINGS.https;
    let proxyNoProxy: string = DEFAULT_PROXY_SETTINGS.noProxy;
    let updatesUnlisten: UnlistenFn | null = null;
    let lastCheckedLabel = "";
    let appVersion = "";
    let navItems: SettingsItem[] = [];
    let activeNavId: number | string | null = NAV_DEFINITIONS[0]?.id ?? null;
    let systemDictationSettingsObj: Record<string, any> = { ...DEFAULT_SYSTEM_DICTATION_SETTINGS };
    let systemDictationUnlisten: UnlistenFn | null = null;
    let themeOptions = getThemes();
    const sectionRefs = new Map<number | string, HTMLElement>();
    const createSectionAnchor = (id: number | string) => (node: HTMLElement) => {
        sectionRefs.set(id, node);
        return {
            destroy() {
                sectionRefs.delete(id);
            }
        };
    };
    const sectionAnchors = {
        generalCategory: createSectionAnchor(0),
        generalTheme: createSectionAnchor(1),
        generalLanguage: createSectionAnchor(100),
        networkCategory: createSectionAnchor(40),
        uiCategory: createSectionAnchor(10),
        uiFontSize: createSectionAnchor(11),
        uiFontFamily: createSectionAnchor(12),
        editorCategory: createSectionAnchor(2),
        editorFontSize: createSectionAnchor(3),
        editorFontFamily: createSectionAnchor(4),
        editorLineHeight: createSectionAnchor(5),
        editorLetterSpacing: createSectionAnchor(106),
        editorLineWrapping: createSectionAnchor(105),
        terminalCategory: createSectionAnchor(6),
        terminalFontSize: createSectionAnchor(7),
        terminalFontFamily: createSectionAnchor(8),
        assistantCategory: createSectionAnchor(20),
        assistantFontSize: createSectionAnchor(21),
        assistantFontFamily: createSectionAnchor(22),
        systemDictationCategory: createSectionAnchor(24),
        systemDictationMacShortcut: createSectionAnchor(241),
        wechatCategory: createSectionAnchor(30),
        wechatCredentials: createSectionAnchor(31),
        wechatConnection: createSectionAnchor(32),
        aboutCategory: createSectionAnchor(90),
        aboutOverview: createSectionAnchor(91)
    };
    function mapNavItems(defs: NavDefinition[], translateFn: (key: string) => string): SettingsItem[] {
        return defs.map(def => ({
            id: def.id,
            name: translateFn(def.key),
            children: def.children ? mapNavItems(def.children, translateFn) : undefined
        }));
    }

    const cloneTerminalSettings = () => {
        const base = { ...terminalSettingsObj };
        if (Object.prototype.hasOwnProperty.call(base, "fontWeight")) {
            delete base.fontWeight;
        }
        const profile = ensureObject(base.profile);
        base.profile = { ...profile };
        return base;
    };

    function normalizeProxyMode(value: unknown): ProxyMode {
        if (typeof value === "string") {
            const lowered = value.trim().toLowerCase();
            if (lowered === "manual" || lowered === "direct") {
                return lowered as ProxyMode;
            }
        }
        return "auto";
    }

    function sanitizeProxyValue(value: unknown): string {
        if (typeof value === "string") {
            return value.trim();
        }
        return "";
    }

    function sanitizeProxySettings(raw: unknown): ProxySettings {
        const source = ensureObject(raw);
        return {
            mode: normalizeProxyMode(source.mode),
            http: sanitizeProxyValue(source.http),
            https: sanitizeProxyValue(source.https),
            noProxy: sanitizeProxyValue(source.noProxy)
        };
    }

    function proxySettingsEqualRaw(raw: unknown, sanitized: ProxySettings): boolean {
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
            return false;
        }
        const source = raw as Record<string, unknown>;
        const mode = normalizeProxyMode(source.mode);
        const http = sanitizeProxyValue(source.http);
        const https = sanitizeProxyValue(source.https);
        const noProxy = sanitizeProxyValue(source.noProxy);
        return (
            mode === sanitized.mode &&
            http === sanitized.http &&
            https === sanitized.https &&
            noProxy === sanitized.noProxy
        );
    }

    function setProxyState(next: ProxySettings) {
        proxyMode = next.mode;
        proxyHttp = next.http;
        proxyHttps = next.https;
        proxyNoProxy = next.noProxy;
    }

    function updateProxyFieldState(field: ProxyField, value: string) {
        switch (field) {
            case "http":
                proxyHttp = value;
                break;
            case "https":
                proxyHttps = value;
                break;
            case "noProxy":
                proxyNoProxy = value;
                break;
        }
    }

    function syncTerminalOptionsStore() {
        const next = cloneTerminalSettings();
        terminalOptions = { ...next, profile: { ...ensureObject(next.profile) } };
        terminalStore.set(next);
        refreshTerminalOptions();
    }

    async function persistTerminalSettings() {
        const settings = await appSettings;
        await settings.set("terminal", cloneTerminalSettings());
        await settings.save();
    }

    async function persistProxySettings(next: ProxySettings) {
        codeySettingsObj = { ...codeySettingsObj, proxy: next };
        const settings = await appSettings;
        await settings.set("codey", codeySettingsObj);
        await settings.save();
    }

    async function persistSystemDictationSettings(next: Record<string, any>) {
        systemDictationSettingsObj = { ...systemDictationSettingsObj, ...next };
        const settings = await appSettings;
        await settings.set("system_dictation", systemDictationSettingsObj);
        await settings.save();
    }

    async function handleMacosDictationShortcutSelect(event: CustomEvent) {
        const value = (event as any)?.detail?.value ?? (event as any)?.detail;
        const macosShortcut = typeof value === "string" ? value : String(value ?? "");
        await persistSystemDictationSettings({ macosShortcut });
    }

    async function updateTerminalSettings(patch: Record<string, any>) {
        const next = { ...terminalSettingsObj };
        if (Object.prototype.hasOwnProperty.call(next, "fontWeight")) {
            delete next.fontWeight;
        }
        if (Object.prototype.hasOwnProperty.call(patch, "profile")) {
            next.profile = { ...ensureObject(patch.profile) };
        }
        for (const [key, value] of Object.entries(patch)) {
            if (key === "profile") continue;
            if (key === "fontWeight") continue;
            next[key] = value;
        }
        terminalSettingsObj = next;
        syncTerminalOptionsStore();
        await persistTerminalSettings();
    }

    let wechatSettings: WechatSettings = { ...DEFAULT_WECHAT_SETTINGS };
    let wechatSettingsUnlisten: UnlistenFn | null = null;
    let wechatConnectionState: WechatConnectionState = "idle";
    let wechatConnectionError = "";
    let wechatConnecting = false;
    let wechatConnectionLabel = "";

    onMount(() => {
        // 初始化应用内语言（与 cline webview 解耦；使用 localStorage['uiLang']）
        uiLang = initLang();
        const unsub = uiLangStore.subscribe(v => uiLang = v);
        (async () => {
        const settings = await appSettings;
        let editorDirty = false;
        let uiDirty = false;
        let aiDirty = false;
        let terminalDirty = false;
        let codeyDirty = false;
        let updatesDirty = false;

        editorSettingsObj = ensureObject(await settings.get("editor"));
        editorFontSize = editorSettingsObj.fontSize ?? "";
        const normalizedEditorFont = sanitizeFontFamily(editorSettingsObj.fontFamily, DEFAULT_EDITOR_FONT_FAMILY);
        if (normalizedEditorFont !== editorSettingsObj.fontFamily) {
            editorSettingsObj.fontFamily = normalizedEditorFont;
            editorDirty = true;
        }
        editorFontFamily = normalizedEditorFont;
        editorLineHeight = editorSettingsObj.lineHeight != null ? String(editorSettingsObj.lineHeight) : "";
        editorLetterSpacing = editorSettingsObj.letterSpacing != null ? String(editorSettingsObj.letterSpacing) : "";
        editorTabSize = editorSettingsObj.tabSize ?? "";
        editorLineWrapping = Boolean(editorSettingsObj.lineWrapping);
        if (editorSettingsObj.letterSpacing == null) {
            editorSettingsObj.letterSpacing = 0.5;
            editorLetterSpacing = "0.5";
            editorDirty = true;
        }

        codeySettingsObj = ensureObject(await settings.get("codey"));
        codeyTheme = typeof codeySettingsObj.theme === "string" && codeySettingsObj.theme.trim().length ? codeySettingsObj.theme : "Light";
        if (codeySettingsObj.theme !== codeyTheme) {
            codeySettingsObj.theme = codeyTheme;
            codeyDirty = true;
        }

        const proxySettings = sanitizeProxySettings(
            Object.prototype.hasOwnProperty.call(codeySettingsObj, "proxy") ? codeySettingsObj.proxy : DEFAULT_PROXY_SETTINGS
        );
        if (!proxySettingsEqualRaw(codeySettingsObj.proxy, proxySettings)) {
            codeyDirty = true;
        }
        codeySettingsObj = { ...codeySettingsObj, proxy: proxySettings };
        setProxyState(proxySettings);

        const rawUpdates = await settings.get("updates");
        const sanitizedUpdates = sanitizeUpdateSettings(rawUpdates);
        updateSettingsObj = sanitizedUpdates;
        autoCheckUpdates = sanitizedUpdates.autoCheck;
        setUpdatePreferences(sanitizedUpdates);
        if (
            !rawUpdates ||
            typeof rawUpdates !== "object" ||
            Array.isArray(rawUpdates) ||
            (rawUpdates as Record<string, unknown>).autoCheck !== sanitizedUpdates.autoCheck ||
            (rawUpdates as Record<string, unknown>).autoInstall !== sanitizedUpdates.autoInstall
        ) {
            updatesDirty = true;
        }

        terminalSettingsObj = ensureObject(await settings.get("terminal"));
        const rawTerminalFont = terminalSettingsObj.fontFamily;
        const normalizedTerminalFont = sanitizeFontFamily(rawTerminalFont, DEFAULT_TERMINAL_FONT_FAMILY);
        if (normalizedTerminalFont !== rawTerminalFont) {
            terminalSettingsObj.fontFamily = normalizedTerminalFont;
            terminalDirty = true;
        }
        const rawProfile = terminalSettingsObj.profile;
        if (Object.prototype.hasOwnProperty.call(terminalSettingsObj, "fontWeight")) {
            delete terminalSettingsObj.fontWeight;
            terminalDirty = true;
        }
        if (!rawProfile || typeof rawProfile !== "object" || Array.isArray(rawProfile)) {
            terminalSettingsObj.profile = {};
            terminalDirty = true;
        } else {
            terminalSettingsObj.profile = { ...(rawProfile as Record<string, any>) };
        }
        syncTerminalOptionsStore();

        uiSettingsObj = ensureObject(await settings.get("ui"));
        const normalizedUiFontSize = coerceUiFontSize(uiSettingsObj.fontSize);
        uiFontSize = normalizedUiFontSize;
        if (normalizedUiFontSize !== uiSettingsObj.fontSize) {
            uiSettingsObj.fontSize = normalizedUiFontSize;
            uiDirty = true;
        }
        const normalizedUiFont = sanitizeFontFamily(uiSettingsObj.fontFamily, DEFAULT_UI_FONT_FAMILY);
        if (normalizedUiFont !== uiSettingsObj.fontFamily) {
            uiSettingsObj.fontFamily = normalizedUiFont;
            uiDirty = true;
        }
        uiFontFamily = normalizedUiFont;

        aiSettingsObj = ensureObject(await settings.get("ai"));
        aiFontSize = aiSettingsObj.fontSize ?? "";
        const normalizedAiFont = sanitizeFontFamily(aiSettingsObj.fontFamily, DEFAULT_AI_FONT_FAMILY);
        if (normalizedAiFont !== aiSettingsObj.fontFamily) {
            aiSettingsObj.fontFamily = normalizedAiFont;
            aiDirty = true;
        }
        aiFontFamily = normalizedAiFont;

        const writes: Array<[string, any]> = [];
        if (editorDirty) writes.push(["editor", editorSettingsObj]);
        if (uiDirty) writes.push(["ui", uiSettingsObj]);
        if (aiDirty) writes.push(["ai", aiSettingsObj]);
        if (terminalDirty) writes.push(["terminal", terminalSettingsObj]);
        if (codeyDirty) writes.push(["codey", codeySettingsObj]);
        if (updatesDirty) writes.push(["updates", updateSettingsObj]);

        if (writes.length) {
            for (const [key, value] of writes) {
                await settings.set(key, value);
            }
            await settings.save();
        }

        wechatSettings = sanitizeWechatSettings(await settings.get("wechat"));
        systemDictationSettingsObj = sanitizeSystemDictationSettings(await settings.get("system_dictation"));
        if (!systemDictationUnlisten) {
            try {
                systemDictationUnlisten = await settings.onKeyChange("system_dictation", (value: unknown) => {
                    systemDictationSettingsObj = sanitizeSystemDictationSettings(value);
                });
            } catch (err) {
                console.warn("Failed to listen system_dictation settings", err);
            }
        }

        if (!updatesUnlisten) {
            try {
                updatesUnlisten = await settings.onKeyChange("updates", (value: unknown) => {
                    const next = sanitizeUpdateSettings(value);
                    updateSettingsObj = next;
                    autoCheckUpdates = next.autoCheck;
                    setUpdatePreferences(next);
                });
            } catch (err) {
                console.warn("Failed to listen updates settings", err);
            }
        }
        if (!wechatSettingsUnlisten) {
            try {
                wechatSettingsUnlisten = await settings.onKeyChange("wechat", (value: unknown) => {
                    const next = sanitizeWechatSettings(value);
                    const credentialsChanged = next.appId !== wechatSettings.appId || next.appSecret !== wechatSettings.appSecret;
                    wechatSettings = next;
                    if (credentialsChanged) {
                        wechatConnectionState = "idle";
                        wechatConnectionError = "";
                    }
                });
            } catch (err) {
                console.warn("Failed to listen wechat settings", err);
            }
        }

        settingsFilePath = await resolveSettingsFilePath(settings);
        await loadSystemFonts();
        try {
            appVersion = await getVersion();
        } catch (err) {
            console.warn("Failed to resolve app version", err);
            appVersion = "";
        }
        })();
        return () => unsub();
    })

    $: translator = $t;
    $: updateState = $updaterState;
    $: lastCheckedLabel = updateState?.lastChecked
        ? new Date(updateState.lastChecked).toLocaleString()
        : "";
    $: {
        translator;
        updateState;
        wechatConnecting;
        wechatConnectionState;
        navItems = mapNavItems(NAV_DEFINITIONS, (key: string) => translate(key));
        builtinFontItems = buildBuiltinFontItems((key: string) => translate(key));
        themeOptions = getThemes();
        wechatConnectionLabel = wechatConnecting
            ? translate("settings.wechatConnecting")
            : wechatConnectionState === "success"
                ? translate("settings.wechatStatusConnected")
                : wechatConnectionState === "error"
                    ? translate("settings.wechatStatusFailed")
                    : translate("settings.wechatStatusIdle");
        updateStatus = deriveUpdateStatus(updateState);
    }
    $: fontFamilyItems = [...builtinFontItems, ...dynamicFontItems];

    function deriveUpdateStatus(state: UpdateState): string {
        const phase = state?.phase ?? "idle";
        switch (phase) {
            case "checking":
                return translate("settings.updateStatusChecking");
            case "available":
                return translate("settings.updateStatusAvailable", { version: state.version ?? "" });
            case "downloading":
                if (typeof state.progress === "number") {
                    return translate("settings.updateStatusDownloadingWithProgress", {
                        progress: Math.round(state.progress)
                    });
                }
                return translate("settings.updateStatusDownloading");
            case "ready":
                return translate("settings.updateStatusReady");
            case "error":
                return translate("settings.updateStatusIdle");
            case "upToDate":
                return translate("settings.updateStatusUpToDate");
            case "restarting":
                return translate("settings.updateStatusRestarting");
            case "disabled":
                return translate("settings.updateStatusDisabled");
            case "idle":
            default:
                return translate("settings.updateStatusIdle");
        }
    }
    async function persistUpdateSettings(patch: Partial<UpdatePreferences>) {
        const settings = await appSettings;
        if (updatesDisabled) {
            updateSettingsObj = { autoCheck: false, autoInstall: false };
            autoCheckUpdates = false;
            await settings.set("updates", updateSettingsObj);
            await settings.save();
            setUpdatePreferences(updateSettingsObj);
            return;
        }
        updateSettingsObj = sanitizeUpdateSettings({ ...updateSettingsObj, ...patch });
        autoCheckUpdates = updateSettingsObj.autoCheck;
        await settings.set("updates", updateSettingsObj);
        await settings.save();
        setUpdatePreferences(updateSettingsObj);
    }
    async function persistWechatSettings(patch: Partial<WechatSettings>) {
        const settings = await appSettings;
        wechatSettings = mergeWechatSettings(wechatSettings, patch);
        await settings.set("wechat", wechatSettings);
        await settings.save();
        if (patch.appId !== undefined || patch.appSecret !== undefined) {
            wechatConnectionState = "idle";
            wechatConnectionError = "";
        }
    }

    async function loadSystemFonts() {
        try {
            const fonts = await invoke<string[]>("list_system_fonts");
            if (!Array.isArray(fonts)) {
                return;
            }
            const seen = new Set<string>([...BUILTIN_FONT_VALUES]);
            const normalized: FontItem[] = [];
            for (const raw of fonts) {
                if (typeof raw !== "string") continue;
                const trimmed = sanitizeFontFamily(raw);
                if (!trimmed) continue;
                const lower = trimmed.toLowerCase();
                if (seen.has(lower)) continue;
                seen.add(lower);
                normalized.push({ id: `font-${normalized.length}`, name: trimmed });
            }
            normalized.sort((a, b) => a.name.localeCompare(b.name));
            const ensureSelections = [
                { value: uiFontFamily, fallback: DEFAULT_UI_FONT_FAMILY },
                { value: editorFontFamily, fallback: DEFAULT_EDITOR_FONT_FAMILY },
                { value: terminalOptions?.fontFamily, fallback: DEFAULT_TERMINAL_FONT_FAMILY },
                { value: aiFontFamily, fallback: DEFAULT_AI_FONT_FAMILY },
            ];
            for (const entry of ensureSelections) {
                const { value, fallback } = entry;
                const trimmed = sanitizeFontFamily(value, fallback);
                if (!trimmed) continue;
                const lower = trimmed.toLowerCase();
                if (seen.has(lower)) continue;
                normalized.push({ id: `custom-${lower}`, name: trimmed });
                seen.add(lower);
            }
            dynamicFontItems = normalized;
        } catch (err) {
            console.warn("Failed to load system fonts", err);
        }
    }

    async function resolveSettingsFilePath(store) {
        if (settingsFilePath) {
            return settingsFilePath;
        }
        try {
            const dir = await appLocalDataDir();
            let candidate = "";
            try {
                candidate = await join(dir, "settings.json");
            } catch {
                candidate = `${dir}settings.json`;
            }
            let exists = false;
            try {
                exists = await invoke("is_file", { path: candidate });
            } catch {
                exists = false;
            }
            if (!exists) {
                // Ensure store data is flushed to disk, then recheck.
                try { await store.save(); } catch {}
                try {
                    exists = await invoke("is_file", { path: candidate });
                } catch {
                    exists = false;
                }
            }
            if (!exists) {
                try {
                    const legacy = await join(dir, "default_settings.json");
                    const legacyExists = await invoke("is_file", { path: legacy }).catch(() => false);
                    if (legacyExists) {
                        settingsFilePath = legacy;
                        return settingsFilePath;
                    }
                } catch {}
                settingsFilePath = "";
                return settingsFilePath;
            }
            settingsFilePath = candidate;
            return settingsFilePath;
        } catch (e) {
            console.warn("Failed to resolve settings.json path", e);
            settingsFilePath = "";
            return settingsFilePath;
        }
    }

    onDestroy(() => {
        if (wechatSettingsUnlisten) {
            try {
                wechatSettingsUnlisten();
            } catch (err) {
                console.warn("Failed to dispose wechat settings listener", err);
            }
            wechatSettingsUnlisten = null;
        }
        if (systemDictationUnlisten) {
            try {
                systemDictationUnlisten();
            } catch (err) {
                console.warn("Failed to dispose system_dictation settings listener", err);
            }
            systemDictationUnlisten = null;
        }
        if (updatesUnlisten) {
            try {
                updatesUnlisten();
            } catch (err) {
                console.warn("Failed to dispose updates settings listener", err);
            }
            updatesUnlisten = null;
        }
    })

    function handleNavSelect(event: CustomEvent<{ id: number | string }>) {
        const id = event?.detail?.id;
        if (id === undefined || id === null) {
            return;
        }
        activeNavId = id;
        const target = sectionRefs.get(id);
        if (target) {
            target.scrollIntoView({ behavior: "smooth", block: "start" });
        }
    }

    function clampUiFontPx(value: number): number {
        if (!Number.isFinite(value)) {
            return MIN_UI_FONT_PX;
        }
        if (value < MIN_UI_FONT_PX) {
            return MIN_UI_FONT_PX;
        }
        if (value > MAX_UI_FONT_PX) {
            return MAX_UI_FONT_PX;
        }
        return value;
    }

    function coerceUiFontSize(raw: unknown): string | number {
        if (typeof raw === "number") {
            return clampUiFontPx(raw);
        }
        if (raw == null) {
            return "";
        }
        const str = String(raw).trim();
        if (!str.length) {
            return "";
        }
        if (/^\d+(?:\.\d+)?px$/i.test(str)) {
            const pxValue = parseFloat(str);
            return `${clampUiFontPx(pxValue)}px`;
        }
        const numeric = Number(str);
        if (!Number.isNaN(numeric)) {
            return clampUiFontPx(numeric);
        }
        return str;
    }

    async function handleOpenSettingsJson() {
        try {
            const settings = await appSettings;
            const path = await resolveSettingsFilePath(settings);
            if (!path) {
                console.warn("No settings.json file found to open");
                return;
            }
            const parts = path.split(/[/\\]/);
            const label = parts[parts.length - 1] ?? "settings.json";
            await addEditorTab(path, label);
        } catch (err) {
            console.warn("Failed to open settings.json", err);
        }
    }

    async function handleThemeSelect(e) {
        const settings = await appSettings;
        const name = e.detail.selection.name;
        codeyTheme = name;
        codeySettingsObj = { ...codeySettingsObj, theme: name };
        await settings.set("codey", codeySettingsObj);
        await settings.save();
    }

    async function handleProxyModeChange(value: string) {
        const normalized = normalizeProxyMode(value);
        const current = sanitizeProxySettings(codeySettingsObj.proxy);
        if (current.mode === normalized) {
            if (proxyMode !== normalized) {
                setProxyState({ ...current, mode: normalized });
            }
            return;
        }
        const next = { ...current, mode: normalized };
        setProxyState(next);
        await persistProxySettings(next);
    }

    function handleProxyFieldInput(field: ProxyField, value: string) {
        updateProxyFieldState(field, value);
    }

    async function handleProxyFieldCommit(field: ProxyField) {
        const current = sanitizeProxySettings(codeySettingsObj.proxy);
        const rawValue = field === "http" ? proxyHttp : field === "https" ? proxyHttps : proxyNoProxy;
        const trimmed = sanitizeProxyValue(rawValue);
        if (trimmed !== rawValue) {
            updateProxyFieldState(field, trimmed);
        }
        if (current[field] === trimmed) {
            return;
        }
        const next = { ...current, [field]: trimmed };
        setProxyState(next);
        await persistProxySettings(next);
    }
    async function handleUiFontSize(e) {
        const settings = await appSettings;
        const raw = e.detail.value;
        const toSave = coerceUiFontSize(raw);
        uiFontSize = toSave;
        uiSettingsObj = { ...uiSettingsObj, fontSize: toSave };
        await settings.set("ui", uiSettingsObj);
        await settings.save();
    }
    async function handleUiFontFamily(e) {
        const selectedValue = e?.detail?.value ?? e?.detail?.selection?.name;
        const font = sanitizeFontFamily(selectedValue ?? DEFAULT_UI_FONT_FAMILY, DEFAULT_UI_FONT_FAMILY);
        uiFontFamily = font;
        uiSettingsObj = { ...uiSettingsObj, fontFamily: font };
        const settings = await appSettings;
        await settings.set("ui", uiSettingsObj);
        await settings.save();
    }
    async function handleEditorFontSize(e) {
        const settings = await appSettings;
        editorFontSize = e.detail.value;
        editorSettingsObj = { ...editorSettingsObj, fontSize: e.detail.value };
        await settings.set("editor", editorSettingsObj);
        await settings.save();
    }
    async function handleEditorFontFamily(e) {
        const selectedValue = e?.detail?.value ?? e?.detail?.selection?.name;
        const font = sanitizeFontFamily(selectedValue ?? DEFAULT_EDITOR_FONT_FAMILY, DEFAULT_EDITOR_FONT_FAMILY);
        editorFontFamily = font;
        editorSettingsObj = { ...editorSettingsObj, fontFamily: font };
        const settings = await appSettings;
        await settings.set("editor", editorSettingsObj);
        await settings.save();
    }
    async function handleEditorLineHeight(e) {
        const settings = await appSettings;
        editorLineHeight = e.detail.value;
        editorSettingsObj = { ...editorSettingsObj, lineHeight: e.detail.value };
        await settings.set("editor", editorSettingsObj);
        await settings.save();
    }
    async function handleEditorLetterSpacing(e) {
        const settings = await appSettings;
        editorLetterSpacing = e.detail.value;
        editorSettingsObj = { ...editorSettingsObj, letterSpacing: e.detail.value };
        await settings.set("editor", editorSettingsObj);
        await settings.save();
    }
    async function handleEditorTabSize(e) {
        const settings = await appSettings;
        editorTabSize = e.detail.value;
        editorSettingsObj = { ...editorSettingsObj, tabSize: e.detail.value };
        await settings.set("editor", editorSettingsObj);
        await settings.save();
    }
    async function handleEditorLineWrapping(e) {
        const selection = e?.detail?.selection;
        const enabled = selection?.id === "on";
        editorLineWrapping = enabled;
        editorSettingsObj = { ...editorSettingsObj, lineWrapping: enabled };
        try {
            applyLineWrappingToEditors(enabled);
        } catch (error) {
            console.warn("Failed to apply editor line wrapping immediately", error);
        }
        const settings = await appSettings;
        await settings.set("editor", editorSettingsObj);
        await settings.save();
    }
    async function handleUpdateAutoCheck(e) {
        if (updatesDisabled) {
            return;
        }
        const selection = e?.detail?.selection;
        const enabled = selection?.id === "on";
        await persistUpdateSettings({ autoCheck: enabled, autoInstall: enabled });
    }
    function handleSettingsCheckUpdates() {
        if (updatesDisabled) {
            return;
        }
        void checkForUpdates({ silent: false });
    }
    function handleSettingsInstallUpdate() {
        if (updatesDisabled) {
            return;
        }
        void downloadPendingUpdate({ showProgressNotification: true });
    }
    function handleSettingsRestartUpdate() {
        if (updatesDisabled) {
            return;
        }
        void restartToApplyUpdate();
    }
    function handleSettingsRetryUpdate() {
        if (updatesDisabled) {
            return;
        }
        void checkForUpdates({ silent: false });
    }
    async function handleTerminalFontSize(e) {
        await updateTerminalSettings({ fontSize: e.detail.value });
    }
    async function handleTerminalFontFamily(e) {
        const selectedValue = e?.detail?.value ?? e?.detail?.selection?.name;
        const font = sanitizeFontFamily(selectedValue ?? DEFAULT_TERMINAL_FONT_FAMILY, DEFAULT_TERMINAL_FONT_FAMILY);
        await updateTerminalSettings({ fontFamily: font });
    }
    async function handleTerminalLineHeight(e) {
        await updateTerminalSettings({ lineHeight: e.detail.value });
    }
    async function handleTerminalCursorStyle(e) {
        await updateTerminalSettings({ cursorStyle: e.detail.selection.name });

    }
    async function handleTerminalShellSelect(e: CustomEvent<any>) {
        const name = e?.detail?.selection?.name ?? e?.detail?.value;
        if (!name) return;
        const profiles: Record<string, { name: string; program: string; args: string[] }> = {
            powershell: { name, program: "powershell.exe", args: ["-NoExit", "-NoLogo"] },
            "git bash": { name, program: "C:/Program Files/Git/bin/bash.exe", args: ["--login", "-i"] },
            cmd: { name, program: "cmd.exe", args: ["/K"] },
            zsh: { name, program: "/bin/zsh", args: ["--login", "-i"] },
            bash: { name, program: "/bin/bash", args: ["--login", "-i"] },
            sh: { name, program: "/bin/sh", args: ["-i"] },
        };
        const detected = availableShells.find((shell) => shell.name === name);
        if (detected) profiles[name] = { name, program: detected.program, args: detected.args ?? [] };
        await updateTerminalSettings({ profile: profiles[name] ?? { name } });
    }
    async function handleAiFontSize(e) {
        const settings = await appSettings;
        aiFontSize = e.detail.value;
        aiSettingsObj = { ...aiSettingsObj, fontSize: e.detail.value };
        await settings.set("ai", aiSettingsObj);
        await settings.save();
    }
    async function handleAiFontFamily(e) {
        const selectedValue = e?.detail?.value ?? e?.detail?.selection?.name;
        const font = sanitizeFontFamily(selectedValue ?? DEFAULT_AI_FONT_FAMILY, DEFAULT_AI_FONT_FAMILY);
        aiFontFamily = font;
        aiSettingsObj = { ...aiSettingsObj, fontFamily: font };
        const settings = await appSettings;
        await settings.set("ai", aiSettingsObj);
        await settings.save();
    }
    function handleLanguageSelect(e) {
        // Select 组件以 item.name 作为值，这里约定 name 即为语言代码
        const code = e?.detail?.selection?.name;
        if (code === 'en' || code === 'zh-CN') {
            // 1) 应用内语言（独立）
            setLang(code);
            // 2) 同步给 ClinePanel 使用的宿主键，触发整体切换 cline webview 路径
            try {
                localStorage.setItem('appLang', code);
                localStorage.setItem('clineUiLangHost', code);
                // 3) 同步 cline 覆盖翻译脚本所用键，避免在 EN 包上仍然套用中文覆盖
                //    overlay 仅在 localStorage['clineUiLang'] 为 zh-CN 时启用；设为 'en' 可显式关闭
                localStorage.setItem('clineUiLang', code === 'zh-CN' ? 'zh-CN' : 'en');
                // 在同文档内手动派发 storage 事件，促使 ClinePanel 监听器立即响应
                const evt = new StorageEvent('storage', { key: 'clineUiLangHost', newValue: code });
                window.dispatchEvent(evt);
            } catch {}
        }
    }

    async function handleWechatAppId(e) {
        await persistWechatSettings({ appId: normalizeWechatString(e?.detail?.value) });
    }

    async function handleWechatAppSecret(e) {
        await persistWechatSettings({ appSecret: normalizeWechatString(e?.detail?.value) });
    }

    type VerifyWechatResponse = {
        connected?: boolean;
        message?: string;
    };

    function translate(key: string, params?: Record<string, string | number>): string {
        try {
            const fn = translator ?? get(t);
            return fn(key, params);
        } catch {
            return key;
        }
    }

    async function handleWechatConnect() {
        if (wechatConnecting) {
            return;
        }
        if (!wechatSettings.appId || !wechatSettings.appSecret) {
            addNotification(NotifType.Warning, translate("settings.wechat"), [], translate("settings.wechatMissingCredentials"));
            return;
        }
        wechatConnecting = true;
        wechatConnectionError = "";
        try {
            const result = await invoke<VerifyWechatResponse>("verify_wechat_credentials");
            wechatConnectionState = "success";
            wechatConnectionError = "";
            const detail = result.message ?? translate("settings.wechatConnectionOk");
            addNotification(NotifType.Success, translate("settings.wechat"), [], detail);
        } catch (err) {
            wechatConnectionState = "error";
            wechatConnectionError = err instanceof Error ? err.message : String(err);
            addNotification(NotifType.Error, translate("settings.wechat"), [], wechatConnectionError);
        } finally {
            wechatConnecting = false;
        }
    }

</script>

<div class="settings-container" class:hidden={hidden}>
    <div class="settings-directory">
        <SettingsNav items={navItems} activeId={activeNavId} on:select={handleNavSelect}>
            <button id="json" type="button" on:click={handleOpenSettingsJson}>
                {translate("settings.openSettingsJson")}
            </button>
        </SettingsNav>
    </div>
    <div class="settings">
        <div class="settings-list">
            {#key uiLang}
                <GeneralSection
                    {translate}
                    themes={themeOptions}
                    codeyTheme={codeyTheme}
                    uiLang={uiLang}
                    onThemeSelect={handleThemeSelect}
                    onLanguageSelect={handleLanguageSelect}
                    categoryAnchor={sectionAnchors.generalCategory}
                    themeAnchor={sectionAnchors.generalTheme}
                    languageAnchor={sectionAnchors.generalLanguage}
                />
                <NetworkSection
                    {translate}
                    categoryAnchor={sectionAnchors.networkCategory}
                    proxyMode={proxyMode}
                    proxyHttp={proxyHttp}
                    proxyHttps={proxyHttps}
                    proxyNoProxy={proxyNoProxy}
                    onProxyModeChange={handleProxyModeChange}
                    onProxyFieldInput={handleProxyFieldInput}
                    onProxyFieldCommit={handleProxyFieldCommit}
                />
                <UiSection
                    {translate}
                    uiFontSize={uiFontSize}
                    uiFontFamily={uiFontFamily}
                    fontFamilyItems={fontFamilyItems}
                    defaultFontFamily={DEFAULT_UI_FONT_FAMILY}
                    onFontSizeInput={handleUiFontSize}
                    onFontFamilySelect={handleUiFontFamily}
                    categoryAnchor={sectionAnchors.uiCategory}
                    fontSizeAnchor={sectionAnchors.uiFontSize}
                    fontFamilyAnchor={sectionAnchors.uiFontFamily}
                />
                <EditorSection
                    {translate}
                    editorFontSize={editorFontSize}
                    editorFontFamily={editorFontFamily}
                    editorLineHeight={editorLineHeight}
                    editorLetterSpacing={editorLetterSpacing}
                    editorTabSize={editorTabSize}
                    editorLineWrapping={editorLineWrapping}
                    fontFamilyItems={fontFamilyItems}
                    defaultFontFamily={DEFAULT_EDITOR_FONT_FAMILY}
                    onFontSizeInput={handleEditorFontSize}
                    onFontFamilySelect={handleEditorFontFamily}
                    onLineHeightInput={handleEditorLineHeight}
                    onLetterSpacingInput={handleEditorLetterSpacing}
                    onTabSizeInput={handleEditorTabSize}
                    onLineWrappingSelect={handleEditorLineWrapping}
                    categoryAnchor={sectionAnchors.editorCategory}
                    fontSizeAnchor={sectionAnchors.editorFontSize}
                    fontFamilyAnchor={sectionAnchors.editorFontFamily}
                    lineHeightAnchor={sectionAnchors.editorLineHeight}
                    letterSpacingAnchor={sectionAnchors.editorLetterSpacing}
                    lineWrappingAnchor={sectionAnchors.editorLineWrapping}
                />
                <TerminalSection
                    shellItems={availableShells.map((s, i) => ({ id: i, name: s.name }))}
                    {translate}
                    {terminalOptions}
                    fontFamilyItems={fontFamilyItems}
                    defaultFontFamily={DEFAULT_TERMINAL_FONT_FAMILY}
                    onFontSizeInput={handleTerminalFontSize}
                    onFontFamilySelect={handleTerminalFontFamily}
                    onLineHeightInput={handleTerminalLineHeight}
                    onCursorStyleSelect={handleTerminalCursorStyle}
                    onShellSelect={handleTerminalShellSelect}
                    categoryAnchor={sectionAnchors.terminalCategory}
                    fontSizeAnchor={sectionAnchors.terminalFontSize}
                    fontFamilyAnchor={sectionAnchors.terminalFontFamily}
                />
                <AssistantSection
                    {translate}
                    aiFontSize={aiFontSize}
                    aiFontFamily={aiFontFamily}
                    fontFamilyItems={fontFamilyItems}
                    defaultFontFamily={DEFAULT_AI_FONT_FAMILY}
                    onFontSizeInput={handleAiFontSize}
                    onFontFamilySelect={handleAiFontFamily}
                    categoryAnchor={sectionAnchors.assistantCategory}
                    fontSizeAnchor={sectionAnchors.assistantFontSize}
                    fontFamilyAnchor={sectionAnchors.assistantFontFamily}
                />
                <SystemDictationSection
                    {translate}
                    macosShortcut={systemDictationSettingsObj.macosShortcut ?? "fn_double"}
                    onMacosShortcutSelect={handleMacosDictationShortcutSelect}
                    categoryAnchor={sectionAnchors.systemDictationCategory}
                    macShortcutAnchor={sectionAnchors.systemDictationMacShortcut}
                />
                <WechatSection
                    {translate}
                    {wechatSettings}
                    wechatConnectionState={wechatConnectionState}
                    wechatConnectionError={wechatConnectionError}
                    wechatConnecting={wechatConnecting}
                    wechatConnectionLabel={wechatConnectionLabel}
                    onAppIdInput={handleWechatAppId}
                    onAppSecretInput={handleWechatAppSecret}
                    onConnect={handleWechatConnect}
                    categoryAnchor={sectionAnchors.wechatCategory}
                    credentialsAnchor={sectionAnchors.wechatCredentials}
                    connectionAnchor={sectionAnchors.wechatConnection}
                />
                <AboutSection
                    {translate}
                    appVersion={appVersion}
                    autoCheckUpdates={autoCheckUpdates}
                    updateStatus={updateStatus}
                    lastCheckedLabel={lastCheckedLabel}
                    updateState={updateState}
                    onAutoCheckSelect={handleUpdateAutoCheck}
                    onCheckUpdates={handleSettingsCheckUpdates}
                    onInstallUpdate={handleSettingsInstallUpdate}
                    onRestartUpdate={handleSettingsRestartUpdate}
                    onRetryUpdate={handleSettingsRetryUpdate}
                    categoryAnchor={sectionAnchors.aboutCategory}
                    overviewAnchor={sectionAnchors.aboutOverview}
                    {updatesDisabled}
                />
            {/key}
        </div>
    </div>
</div>

<style lang="scss">
    .hidden {
        display: none !important;
    }
    .settings-container {
        height: 100%;
        display: flex;
    }
    .settings {
        width: 100%;
        height: 100%;
        overflow: auto;
        display: flex;
        flex-direction: column;
        justify-content: space-between;
    }
    .settings-list {
        padding: 24px 32px;
        display: flex;
        flex-direction: column;
        max-width: 600px;
    }
    .settings-directory {
        min-width: 18rem;
        height: 100%;
        overflow: auto;
        display: flex;
        align-items: center;
        flex-direction: column;
        #json {
            font-size: 0.9rem;
            color: var(--window-descriptionForeground);
            cursor: pointer;
            text-decoration: underline;
            &:hover {
                color: var(--window-linkForeground);
            }
            padding: 10px 0;
        }
    }
    :global(.settings-category) {
        margin-bottom: 32px;
    }
    :global(.settings-category:last-child) {
        margin-bottom: 0;
    }
    :global(.settings-category .content) {
        display: flex;
        flex-direction: column;
        gap: 20px;
    }

    :global(.updates-content) {
        gap: 16px;
    }

    :global(.updates-hint) {
        margin-top: -8px;
        margin-bottom: 4px;
        color: var(--text-muted, #9ca3af);
        font-size: 12px;
    }

    :global(.updates-status-block) {
        display: flex;
        flex-direction: column;
        gap: 6px;
        padding: 12px;
        border: 1px solid var(--window-borderColor);
        border-radius: 8px;
        background: var(--window-subtleBackground, rgba(148, 163, 184, 0.06));
    }

    :global(.updates-status-line) {
        display: flex;
        gap: 8px;
        font-size: 13px;
        color: var(--text-secondary, #94a3b8);
    }
    :global(.updates-status-line.muted) {
        color: var(--text-muted, #9ca3af);
    }
    :global(.updates-status-line .status-label) {
        font-weight: 600;
        color: var(--text-primary, #e2e8f0);
        min-width: 90px;
    }

    :global(.status-value) {
        flex: 1;
    }

    :global(.about-version) {
        margin: 0;
        font-size: 13px;
        color: var(--text-secondary, #94a3b8);
    }

    :global(.updates-actions) {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
    }
    :global(.updates-actions .primary),
    :global(.updates-actions .secondary) {
        padding: 8px 16px;
        border-radius: 6px;
        border: 1px solid transparent;
        font-size: 13px;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.2s ease;
    }
    :global(.updates-actions .primary) {
        background: var(--accent-color, #3b82f6);
        color: #fff;
    }
    :global(.updates-actions .primary:hover:not(:disabled)) {
        background: var(--accent-hover, #2563eb);
    }
    :global(.updates-actions .primary:disabled) {
        opacity: 0.5;
        cursor: not-allowed;
    }
    :global(.updates-actions .secondary) {
        background: transparent;
        color: var(--text-secondary, #94a3b8);
        border-color: var(--border-color, #334155);
    }
    :global(.updates-actions .secondary:hover:not(:disabled)) {
        background: var(--background-hover, rgba(148, 163, 184, 0.1));
    }
    :global(.updates-actions .secondary:disabled) {
        opacity: 0.6;
        cursor: not-allowed;
    }

    :global(.update-notes) {
        font-size: 13px;
        color: var(--text-secondary, #94a3b8);
    }
    :global(.update-notes summary) {
        cursor: pointer;
        font-weight: 600;
        margin-bottom: 4px;
        color: var(--text-primary, #e2e8f0);
    }
    :global(.update-notes p) {
        margin: 0;
        white-space: pre-wrap;
    }

    :global(.settings-group) {
        display: flex;
        flex-direction: column;
        gap: 12px;
    }
    :global(.settings-group .group-title) {
        font-size: 14px;
        font-weight: 600;
        color: var(--text-secondary, #6b7280);
        margin-bottom: 12px;
        text-transform: uppercase;
        letter-spacing: 0.05em;
    }
    :global(.settings-group .group-hint) {
        font-size: 13px;
        color: var(--text-muted, #9ca3af);
        margin: 0 0 12px 0;
        line-height: 1.4;
    }
    :global(.settings-group .hint-text) {
        font-size: 12px;
        color: var(--text-muted, #9ca3af);
        margin-top: 4px;
        display: block;
    }
    :global(.settings-group .hint-text.warning) {
        color: var(--warning-color, #f59e0b);
    }
    :global(.settings-group .button-group) {
        display: flex;
        gap: 8px;
        margin-top: 12px;
        flex-wrap: wrap;
    }
    :global(.settings-group .button-group button) {
        padding: 8px 16px;
        border-radius: 6px;
        border: none;
        font-size: 13px;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.2s ease;
    }
    :global(.settings-group .button-group button:not(.secondary)) {
        background: var(--accent-color, #3b82f6);
        color: white;
    }
    :global(.settings-group .button-group button:not(.secondary):hover:not(:disabled)) {
        background: var(--accent-hover, #2563eb);
    }
    :global(.settings-group .button-group button.secondary) {
        background: transparent;
        color: var(--text-secondary, #6b7280);
        border: 1px solid var(--border-color, #d1d5db);
    }
    :global(.settings-group .button-group button.secondary:hover:not(:disabled)) {
        background: var(--background-hover, #f3f4f6);
    }
    :global(.settings-group .button-group button:disabled) {
        opacity: 0.5;
        cursor: not-allowed;
    }
    :global(.settings-group .button-group button.busy) {
        opacity: 0.7;
        cursor: not-allowed;
    }
    :global(.heading) {
        font-weight: 600;
        font-size: 20px;
        color: var(--window-foreground);
    }
    :global(.heading::after) {
        height: 0.05rem;
        width: 100%;
        content: "";
        display: block;
        margin-top: 10px;
        background-color: var(--window-borderColor);
    }
    :global(.settings-input) {
        margin: 8px 0;
    }
    
    :global(.settings-input input),
    :global(.settings-input select) {
        border-radius: 6px;
        border: 1px solid var(--window-inputBorder);
        transition: border-color 0.2s ease, box-shadow 0.2s ease;
    }
    
    :global(.settings-input input:focus),
    :global(.settings-input select:focus) {
        border-color: var(--window-inputFocusBorder);
        box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.1);
        outline: none;
    }

    :global(.settings-input .number-input-wrapper) {
        border-radius: 6px;
        border: 1px solid var(--window-inputBorder);
        transition: border-color 0.2s ease, box-shadow 0.2s ease;
    }
    
    :global(.settings-input .number-input-wrapper:focus-within) {
        border-color: var(--window-inputFocusBorder);
        box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.1);
    }
    :global(.wechat-credentials) {
        display: flex;
        flex-direction: column;
        gap: 12px;
    }
    :global(.wechat-connect-row) {
        display: flex;
        gap: 12px;
        align-items: flex-start;
        flex-wrap: wrap;
    }
    :global(.wechat-connect-row .connect-button) {
        padding: 8px 16px;
        border-radius: 6px;
        border: none;
        font-size: 13px;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.2s ease;
        background: var(--accent-color, #3b82f6);
        color: white;
    }
    :global(.wechat-connect-row .connect-button:hover:not(:disabled)) {
        background: var(--accent-hover, #2563eb);
    }
    :global(.wechat-connect-row .connect-button:disabled) {
        opacity: 0.5;
        cursor: not-allowed;
    }
    :global(.wechat-connect-row .connect-button.busy) {
        opacity: 0.7;
    }
    
    :global(.connection-status) {
        display: flex;
        flex-direction: column;
        gap: 4px;
    }
    :global(.connection-status .status-text) {
        font-size: 13px;
        font-weight: 500;
        color: var(--text-secondary, #6b7280);
    }
    :global(.connection-status .error-text) {
        font-size: 12px;
        color: var(--error-color, #dc2626);
        line-height: 1.3;
    }
    :global(.connection-status.success .status-text) {
        color: var(--success-color, #16a34a);
    }
    :global(.connection-status.error .status-text) {
        color: var(--error-color, #dc2626);
    }
    :global(.wechat-cover) {
        display: flex;
        flex-direction: column;
        gap: 12px;
    }
    :global(.wechat-cover .wechat-hint) {
        margin: 0;
        font-size: 0.9rem;
        opacity: 0.85;
    }
    :global(.wechat-cover .hint-inline) {
        font-size: 0.85rem;
        opacity: 0.75;
    }
    :global(.wechat-cover .hint-inline.warning) {
        color: #dc2626;
        opacity: 1;
    }
    :global(.wechat-cover-actions) {
        display: flex;
        gap: 12px;
        flex-wrap: wrap;
    }
    :global(.wechat-cover-actions button) {
        padding: 0.4rem 0.8rem;
        border-radius: 6px;
        border: none;
        background: var(--button-secondary-bg, #4b5563);
        color: var(--button-secondary-fg, #fff);
        cursor: pointer;
        font-weight: 500;
    }
    :global(.wechat-cover-actions button.busy),
    :global(.wechat-cover-actions button:disabled) {
        opacity: 0.65;
        cursor: not-allowed;
    }
    :global(.wechat-cover-actions .link) {
        background: transparent;
        color: var(--button-link-fg, inherit);
        text-decoration: underline;
        padding: 0;
        cursor: pointer;
    }
    :global(.wechat-cover-actions .link:disabled) {
        opacity: 0.4;
        text-decoration: none;
        cursor: not-allowed;
    }
</style>
