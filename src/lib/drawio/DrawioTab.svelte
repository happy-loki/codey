<script lang="ts">
    import { onDestroy } from "svelte";
    import { addNotification, NotifType } from "../Notifications/notifications";
    import { basename, dirname, join } from "@tauri-apps/api/path";
    import { readTextFile, writeTextFile, exists, mkdir, writeFile } from "@tauri-apps/plugin-fs";
    import { save as saveDialog } from "@tauri-apps/plugin-dialog";
    import { lang as uiLang, t } from "../i18n";
    import { closeTabByPath } from "../EditorTabList.svelte";
    import { drawioTarget, type DrawioTarget, clearDrawioTarget, DRAWIO_TAB_PATH, setDrawioFile } from "./state";
    import { createNewDrawioFile } from "./defaultWorkspace";
    import type { Lang } from "../i18n";
    import { get } from "svelte/store";
    import {
        setActivePathStatus,
        clearActivePathStatus,
        type ActivePathStatusLevel,
    } from "../activePathStatus";

    export let hidden = false;

    const DRAWIO_THEME_LIGHT = "light";
    const READY_TIMEOUT_MS = 10000;
    const AUTO_SAVE_DELAY_MS = 3000;

    type DrawioStatus = "idle" | "loading" | "ready" | "saving" | "error";

    let filePath = "";
    let fileLabel = "";
    let frameReady = false;
    let iframeEl: HTMLIFrameElement | null = null;
    let iframeVersion = Date.now();
    let pendingInitialXml: string | null = null;
    let readyTimeout: ReturnType<typeof setTimeout> | null = null;
    let loadToken = 0;
    let status: DrawioStatus = "idle";
    let error: string | null = null;
    let dirty = false;
    let saving = false;
    let inflightSavePath: string | null = null;
    let currentLang: Lang = "en";
    let langPreference: Lang = "en";
    let currentTheme: "light" = DRAWIO_THEME_LIGHT;
    let suppressNextDirty = false;
    let lastSavedAt: Date | null = null;
    let autoSaveTimer: ReturnType<typeof setTimeout> | null = null;
    let lastSavedXml: string | null = null;
    let latestSnapshotFromEditor: string | null = null;
    let statusLevelIndicator: ActivePathStatusLevel = "neutral";
    let crashCloseScheduled = false;
    type SaveMode = "normal" | "saveAs";
    type ExportPayload = {
        format?: string;
        filename?: string;
        mimeType?: string;
        encoding?: "base64" | "utf8";
        data?: string;
    };
    type NormalizedExportPayload = {
        data: string;
        encoding: "base64" | "utf8";
        filename: string;
        extension: string;
    };
    let pendingSaveMode: SaveMode = "normal";
    let pendingSaveAsLabel: string | null = null;

    const targetOrigin = typeof window !== "undefined" ? window.location.origin : "*";

    const targetUnsubscribe = drawioTarget.subscribe((value) => {
        if (value.kind === "file") {
            void switchToFile(value.path, value.label ?? null);
            clearActivePathStatus();
        } else {
            resetState();
            clearActivePathStatus();
        }
    });

    const langUnsubscribe = uiLang.subscribe((value) => {
        langPreference = value;
        if (!frameReady) {
            applyLanguagePreference();
        }
    });

    if (typeof window !== "undefined") {
        window.addEventListener("message", handleMessage);
    }

    onDestroy(() => {
        if (typeof window !== "undefined") {
            window.removeEventListener("message", handleMessage);
        }
        targetUnsubscribe();
        langUnsubscribe();
        // draw.io is always light themed now; nothing to unsubscribe
        clearReadyTimeout();
        clearAutoSaveTimer();
        clearActivePathStatus();
    });

    export async function triggerSave(): Promise<void> {
        await handleSave();
    }

    export function hasUnsavedChanges(): boolean {
        return Boolean(filePath && dirty);
    }

    export function getDiagramLabel(): string {
        if (fileLabel) {
            return fileLabel;
        }
        if (filePath) {
            const parts = filePath.split(/[/\\]/);
            return parts.pop() || filePath;
        }
        return "";
    }

    function resetState() {
        cancelPendingSave();
        clearAutoSaveTimer();
        clearActivePathStatus();
        filePath = "";
        fileLabel = "";
        status = "idle";
        error = null;
        dirty = false;
        pendingInitialXml = null;
        frameReady = false;
        lastSavedXml = null;
        latestSnapshotFromEditor = null;
        applyLanguagePreference();
    }

    async function switchToFile(path: string, customLabel: string | null) {
        const normalized = (path || "").trim();
        if (!normalized) {
            resetState();
            clearActivePathStatus();
            return;
        }

        if (normalized === filePath && status !== "error") {
            if (customLabel !== null) {
                fileLabel = customLabel;
            }
            return;
        }

        const hadError = status === "error";
        const shouldReloadFrame = !frameReady || hadError;
        const token = ++loadToken;
        cancelPendingSave();
        clearAutoSaveTimer();
        status = "loading";
        error = null;
        dirty = false;
        frameReady = false;
        applyLanguagePreference();
        pendingInitialXml = null;
        lastSavedAt = null;
        lastSavedXml = null;
        latestSnapshotFromEditor = null;

        filePath = normalized;
        fileLabel = customLabel ?? (await resolveFileLabel(normalized));

        let content = "";
        try {
            content = await readTextFile(normalized);
        } catch (err) {
            if (!isFileMissingError(err)) {
                status = "error";
                error = formatError(err);
                notifyError("drawioWorkspace.loadFailed", error);
                return;
            }
            content = "";
        }

        if (token !== loadToken) {
            return;
        }

        lastSavedXml = content ? normalizeXmlSnapshot(content) : null;
        latestSnapshotFromEditor = lastSavedXml;
        pendingInitialXml = content;
        if (shouldReloadFrame) {
            iframeVersion = Date.now();
        }
        suppressNextDirty = true;

        if (typeof window !== "undefined") {
            setTimeout(() => {
                if (token !== loadToken) return;
                postMessage("ready?");
                sendConfiguration();
                trySyncInitialContent();
            }, 0);
        }

        startReadyTimeout(token);
    }

    function postMessage(eventName: string, value?: unknown) {
        const targetWindow = iframeEl?.contentWindow;
        if (!targetWindow) return;
        try {
            targetWindow.postMessage({ eventName, value }, targetOrigin || "*");
        } catch (err) {
            console.warn("[DrawioTab] postMessage failed", err);
        }
    }

    function sendConfiguration() {
        if (!frameReady) return;
        postMessage("configure", {
            language: currentLang,
            theme: currentTheme,
        });
    }

    function trySyncInitialContent() {
        if (!frameReady) return;
        const xml = pendingInitialXml ?? "";
        suppressNextDirty = true;
        postMessage("setData", xml);
        pendingInitialXml = null;
        lastSavedAt = null;
    }

    function handleMessage(event: MessageEvent<any>) {
        if (!iframeEl || event.source !== iframeEl.contentWindow) {
            return;
        }
        const data = event.data;
        if (!data || typeof data !== "object" || typeof data.eventName !== "string") {
            return;
        }

        switch (data.eventName) {
            case "ready":
                handleFrameReady();
                break;
            case "setData:success":
                handleInitialSyncSuccess();
                break;
            case "getData:success":
                void handleSaveSuccess(data.value);
                break;
            case "fatal-error":
                handleFatalError(data.value);
                break;
            case "content-changed":
                handleContentChanged(data.value);
                break;
            case "request-new-file":
                void handleNewFileRequest();
                break;
            case "request-save":
                void handleSave();
                break;
            case "request-save-as":
                void handleSaveAsRequest();
                break;
            case "export-diagram":
                void handleExportRequest(data.value as ExportPayload);
                break;
            default:
                break;
        }
    }

    function handleFrameReady() {
        frameReady = true;
        clearReadyTimeout();
        sendConfiguration();
        trySyncInitialContent();
        if (status === "loading") {
            status = filePath ? "ready" : "idle";
        }
    }

    function handleInitialSyncSuccess() {
        if (status === "loading") {
            status = "ready";
        }
        dirty = false;
        suppressNextDirty = false;
    }

    async function handleSave(options: { targetPath?: string | null; mode?: SaveMode } = {}) {
        if (!frameReady || saving) {
            return;
        }
        const targetPath = options.targetPath ?? filePath;
        if (!targetPath || !iframeEl) {
            return;
        }
        clearAutoSaveTimer();
        pendingSaveMode = options.mode ?? "normal";
        inflightSavePath = targetPath;
        saving = true;
        try {
            postMessage("getData");
        } catch (err) {
            saving = false;
            inflightSavePath = null;
            pendingSaveMode = "normal";
            status = "error";
            error = formatError(err);
            notifyError("drawioWorkspace.saveFailed", error);
        }
    }

    async function handleSaveSuccess(payload: any) {
        if (!saving || !inflightSavePath) {
            return;
        }
        saving = false;
        const targetPath = inflightSavePath;
        const saveMode = pendingSaveMode;
        inflightSavePath = null;
        pendingSaveMode = "normal";

        try {
            const xmlData = String(payload?.xmlData ?? "");
            if (!xmlData) {
                throw new Error("draw.io 未返回有效的图形数据");
            }
            await persistSnapshot(xmlData, targetPath, saveMode);
        } catch (err) {
            pendingSaveAsLabel = null;
            status = "error";
            error = formatError(err);
            notifyError("drawioWorkspace.saveFailed", error);
        }
    }

    async function persistSnapshot(xmlData: string, targetPath: string, mode: SaveMode) {
        if (!targetPath) {
            throw new Error("无法确定保存路径");
        }
        const normalizedXml = normalizeXmlSnapshot(xmlData);
        const canSkipWrite =
            mode === "normal" &&
            targetPath === filePath &&
            lastSavedXml !== null &&
            normalizedXml === lastSavedXml;
        latestSnapshotFromEditor = normalizedXml;
        if (canSkipWrite) {
            dirty = false;
            autoSaveTimer = null;
            pendingSaveAsLabel = null;
            status = "ready";
            return;
        }
        status = "saving";
        await writeTextFile(targetPath, normalizedXml);
        dirty = false;
        status = "ready";
        lastSavedXml = normalizedXml;
        lastSavedAt = new Date();
        autoSaveTimer = null;
        if (mode === "saveAs") {
            const nextLabel = pendingSaveAsLabel ?? (await resolveFileLabel(targetPath));
            pendingSaveAsLabel = null;
            setDrawioFile(targetPath, { label: nextLabel });
        } else {
            pendingSaveAsLabel = null;
        }
    }

    async function handleNewFileRequest() {
        if (saving) {
            return;
        }
        try {
            const nextPath = await createNewDrawioFile();
            const label = await resolveFileLabel(nextPath);
            setDrawioFile(nextPath, { label });
        } catch (err) {
            const reason = formatError(err);
            notifyError("drawioWorkspace.loadFailed", reason);
        }
    }

    async function handleSaveAsRequest() {
        if (saving) {
            return;
        }
        const targetPath = await promptSaveAsPath();
        if (!targetPath) {
            pendingSaveAsLabel = null;
            return;
        }
        pendingSaveAsLabel = await resolveFileLabel(targetPath);
        await handleSave({ targetPath, mode: "saveAs" });
    }

    async function handleExportRequest(payload: ExportPayload | null) {
        const normalized = normalizeExportPayload(payload);
        if (!normalized) {
            const fallbackReason = langPreference === "zh" ? "导出数据不可用" : "Export data unavailable";
            notifyExportError(fallbackReason);
            return;
        }
        try {
            const defaultPath = await resolveExportDefaultPath(normalized.filename);
            const filter = buildExportFilter(normalized.extension);
            const targetPath = await saveDialog({
                defaultPath,
                filters: filter ? [filter] : undefined,
            });
            if (!targetPath) {
                return;
            }
            if (normalized.encoding === "base64") {
                await writeFile(targetPath, base64ToUint8Array(normalized.data));
            } else {
                await writeTextFile(targetPath, normalized.data);
            }
            notifyExportSuccess(targetPath);
        } catch (err) {
            notifyExportError(formatError(err));
        }
    }

    function ensureDrawioExtension(rawPath: string): string {
        const lower = rawPath.toLowerCase();
        if (lower.endsWith(".drawio")) {
            return rawPath;
        }
        return `${rawPath}.drawio`;
    }

    function normalizeXmlSnapshot(xml: string): string {
        return xml.endsWith("\n") ? xml : `${xml}\n`;
    }

    async function promptSaveAsPath(): Promise<string | null> {
        try {
            const suggestedName = fileLabel && fileLabel.trim() ? fileLabel.trim() : "diagram.drawio";
            const selected = await saveDialog({
                defaultPath: suggestedName,
                filters: [{ name: "draw.io", extensions: ["drawio"] }],
            });
            if (!selected) {
                return null;
            }
            const normalized = ensureDrawioExtension(selected);
            try {
                const parentDir = await dirname(normalized);
                if (parentDir && !(await exists(parentDir))) {
                    await mkdir(parentDir, { recursive: true });
                }
            } catch {
                // best-effort directory ensure
            }
            return normalized;
        } catch (err) {
            const reason = formatError(err);
            notifyError("drawioWorkspace.saveFailed", reason);
            return null;
        }
    }

    function handleFatalError(value: unknown) {
        saving = false;
        inflightSavePath = null;
        status = "error";
        latestSnapshotFromEditor = null;
        const reason =
            typeof value === "string"
                ? value
                : value && typeof value === "object" && "reason" in value
                    ? String((value as { reason?: unknown }).reason ?? "")
                    : "";
        error = reason || "draw.io 编辑器出现未知错误";
        notifyError("drawioWorkspace.crashAutoClosed", error);
        closeWorkspaceAfterCrash();
    }

    type ContentChangedPayload = {
        xmlData?: string | null;
    };

    function handleContentChanged(payload?: ContentChangedPayload) {
        if (suppressNextDirty) {
            suppressNextDirty = false;
            return;
        }
        const xmlData = typeof payload?.xmlData === "string" ? payload.xmlData : null;
        if (xmlData !== null) {
            const normalized = normalizeXmlSnapshot(xmlData);
            if (latestSnapshotFromEditor === normalized) {
                return;
            }
            latestSnapshotFromEditor = normalized;
            if (lastSavedXml && normalized === lastSavedXml) {
                dirty = false;
                clearAutoSaveTimer();
                status = "ready";
                return;
            }
        }
        dirty = true;
        scheduleAutoSave();
    }

    function cancelPendingSave() {
        saving = false;
        inflightSavePath = null;
    }

    function startReadyTimeout(token: number) {
        clearReadyTimeout();
        readyTimeout = setTimeout(() => {
            if (token !== loadToken) return;
            if (frameReady) return;
            status = "error";
            error = "draw.io 编辑器未响应";
            notifyError("drawioWorkspace.loadFailed", error);
        }, READY_TIMEOUT_MS);
    }

    function clearReadyTimeout() {
        if (readyTimeout) {
            clearTimeout(readyTimeout);
            readyTimeout = null;
        }
    }

    function clearAutoSaveTimer() {
        if (autoSaveTimer) {
            clearTimeout(autoSaveTimer);
            autoSaveTimer = null;
        }
    }

    function formatTime(date: Date | null): string {
        if (!date) return "";
        try {
            return new Intl.DateTimeFormat(undefined, {
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
            }).format(date);
        } catch {
            return date.toLocaleTimeString();
        }
    }

    function scheduleAutoSave() {
        clearAutoSaveTimer();
        if (!filePath || !frameReady || saving || !dirty) {
            return;
        }
        autoSaveTimer = setTimeout(() => {
            autoSaveTimer = null;
            void handleAutoSaveTick();
        }, AUTO_SAVE_DELAY_MS);
    }

    async function handleAutoSaveTick() {
        if (!filePath || saving || !dirty) {
            return;
        }
        if (latestSnapshotFromEditor) {
            try {
                saving = true;
                await persistSnapshot(latestSnapshotFromEditor, filePath, "normal");
            } catch (err) {
                status = "error";
                error = formatError(err);
                notifyError("drawioWorkspace.saveFailed", error);
            } finally {
                saving = false;
            }
            return;
        }
        await handleSave();
    }

    $: statusKey = (() => {
        if (status === "error") return "error";
        if (status === "saving") return "saving";
        if (status === "loading") return "loading";
        if (dirty) return "dirty";
        if (status === "ready") return "ready";
        return "idle";
    })();

    $: statusMessage = (() => {
        if (!filePath) return "";
        const base = $t(`drawioWorkspace.status.${statusKey}`);
        if (status === "error" && error) {
            return `${base} · ${error}`;
        }
        if (status === "ready" && lastSavedAt && !dirty) {
            const saved = $t("drawioWorkspace.savedAt", { time: formatTime(lastSavedAt) });
            return `${base} · ${saved}`;
        }
        return base;
    })();

    $: statusLevelIndicator = resolveStatusLevel(status, dirty);

    $: {
        if (hidden || !filePath) {
            clearActivePathStatus();
        } else if (statusMessage) {
            setActivePathStatus({ message: statusMessage, level: statusLevelIndicator });
        } else {
            clearActivePathStatus();
        }
    }

    function closeWorkspaceAfterCrash() {
        if (crashCloseScheduled) {
            return;
        }
        crashCloseScheduled = true;
        cancelPendingSave();
        clearAutoSaveTimer();
        clearReadyTimeout();
        clearActivePathStatus();
        lastSavedXml = null;
        latestSnapshotFromEditor = null;
        clearDrawioTarget();
        setTimeout(() => {
            void closeTabByPath(DRAWIO_TAB_PATH, { force: true });
        }, 0);
    }

    function formatError(err: unknown): string {
        if (err instanceof Error) {
            return err.message;
        }
        return String(err ?? "");
    }

    function notifyError(messageKey: string, fallback: string) {
        const translator = get(t);
        const title = translator("drawioWorkspace.notificationTitle");
        const message = translator(messageKey, { reason: fallback });
        addNotification(NotifType.Error, title, [], message);
    }

    function notifyExportSuccess(path: string) {
        const translator = get(t);
        const title = translator("drawioWorkspace.notificationTitle");
        const message = translator("drawioWorkspace.exportSuccess", { path });
        addNotification(NotifType.Success, title, [], message);
    }

    function notifyExportError(reason: string) {
        const translator = get(t);
        const title = translator("drawioWorkspace.notificationTitle");
        const message = translator("drawioWorkspace.exportFailed", { reason });
        addNotification(NotifType.Error, title, [], message);
    }

    function normalizeExportPayload(payload: ExportPayload | null | undefined): NormalizedExportPayload | null {
        if (!payload || typeof payload !== "object") {
            return null;
        }
        if (typeof payload.data !== "string" || payload.data.length === 0) {
            return null;
        }
        const encoding: "base64" | "utf8" = payload.encoding === "utf8" ? "utf8" : "base64";
        const extension = resolveExportExtension(payload.filename, payload.format);
        const filename = ensureExtension(resolveExportFilename(payload.filename), extension);
        return {
            data: payload.data,
            encoding,
            filename,
            extension,
        };
    }

    function resolveExportFilename(candidate?: string | null): string {
        const sanitized = sanitizeExportFilename(candidate);
        if (sanitized) {
            return sanitized;
        }
        if (fileLabel) {
            const fallback = sanitizeExportFilename(fileLabel);
            if (fallback) {
                return fallback;
            }
        }
        return "diagram";
    }

    function sanitizeExportFilename(name?: string | null): string {
        if (!name || typeof name !== "string") {
            return "";
        }
        return name.replace(/[\\/]+/g, "").trim();
    }

    function ensureExtension(name: string, ext: string): string {
        const trimmed = name.trim() || "diagram";
        const normalizedExt = ext ? ext.toLowerCase() : "";
        if (!normalizedExt) {
            return trimmed;
        }
        if (trimmed.toLowerCase().endsWith(`.${normalizedExt}`)) {
            return trimmed;
        }
        const base = trimmed.replace(/\.[^.]+$/, "");
        return `${base || trimmed}.${normalizedExt}`;
    }

    function resolveExportExtension(filename?: string | null, format?: string): string {
        const fromName = extractExtensionFromName(filename);
        if (fromName) {
            return fromName === "jpeg" ? "jpg" : fromName;
        }
        const normalized = typeof format === "string" ? format.toLowerCase() : "";
        if (normalized === "jpeg" || normalized === "jpg") {
            return "jpg";
        }
        if (normalized === "svg") {
            return "svg";
        }
        if (normalized === "xml") {
            return "drawio";
        }
        if (normalized === "png") {
            return "png";
        }
        return "png";
    }

    function extractExtensionFromName(name?: string | null): string | null {
        if (!name || typeof name !== "string") {
            return null;
        }
        const sanitized = sanitizeExportFilename(name);
        const dotIndex = sanitized.lastIndexOf(".");
        if (dotIndex <= 0 || dotIndex === sanitized.length - 1) {
            return null;
        }
        return sanitized.substring(dotIndex + 1).toLowerCase();
    }

    async function resolveExportDefaultPath(filename: string): Promise<string> {
        if (!filePath) {
            return filename;
        }
        try {
            const parentDir = await dirname(filePath);
            if (parentDir) {
                return await join(parentDir, filename);
            }
        } catch {
            // ignore failures and fall back to filename only
        }
        return filename;
    }

    function buildExportFilter(ext: string | null): { name: string; extensions: string[] } | null {
        if (!ext) {
            return null;
        }
        const normalized = ext.toLowerCase();
        const label = (() => {
            switch (normalized) {
                case "jpg":
                    return "JPEG Image";
                case "png":
                    return "PNG Image";
                case "svg":
                    return "SVG File";
                case "drawio":
                    return "draw.io";
                default:
                    return normalized.toUpperCase();
            }
        })();
        return { name: label, extensions: [normalized] };
    }

    function base64ToUint8Array(base64: string): Uint8Array {
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i += 1) {
            bytes[i] = binary.charCodeAt(i);
        }
        return bytes;
    }

    function resolveStatusLevel(nextStatus: DrawioStatus, isDirty: boolean): ActivePathStatusLevel {
        if (nextStatus === "error") {
            return "error";
        }
        if (nextStatus === "saving" || nextStatus === "loading") {
            return "info";
        }
        if (isDirty) {
            return "warning";
        }
        if (nextStatus === "ready" && !isDirty) {
            return "success";
        }
        return "neutral";
    }

    function applyLanguagePreference() {
        if (currentLang === langPreference) {
            return;
        }
        currentLang = langPreference;
    }

    async function resolveFileLabel(path: string): Promise<string> {
        try {
            return await basename(path);
        } catch {
            const parts = path.split(/[/\\]/);
            return parts.pop() || path;
        }
    }

    function isFileMissingError(err: unknown): boolean {
        const message = formatError(err).toLowerCase();
        return message.includes("not found") || message.includes("no such file");
    }

</script>

<div class="drawio-tab" class:is-hidden={hidden}>
    <div class="drawio-body">
        {#if filePath}
            <iframe
                class="drawio-frame"
                title="draw.io editor"
                bind:this={iframeEl}
                src={`/drawio/index.html?lang=${currentLang}&theme=${currentTheme}&v=${iframeVersion}`}
                allow="clipboard-write"
                allowfullscreen
            />
            {#if status === "error" && error}
                <div class="drawio-error">{error}</div>
            {/if}
        {:else}
            <div class="drawio-placeholder">
                <p>{$t("drawioWorkspace.placeholder")}</p>
            </div>
        {/if}
    </div>
</div>

<style lang="scss">
    .drawio-tab {
        display: flex;
        flex-direction: column;
        width: 100%;
        height: 100%;
        background: var(--editor-background, #f8fafc);
        color: var(--editor-foreground, #0f172a);
    }

    .drawio-tab.is-hidden {
        display: none !important;
    }

    .drawio-body {
        position: relative;
        flex: 1 1 auto;
        min-height: 0;
        background: var(--editor-background, #f8fafc);
    }

    .drawio-frame {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        border: none;
        background: transparent;
    }

    .drawio-error {
        position: absolute;
        top: 16px;
        right: 16px;
        max-width: 320px;
        padding: 12px 16px;
        border-radius: 10px;
        background: rgba(220, 38, 38, 0.12);
        color: #991b1b;
        box-shadow: 0 10px 24px rgba(220, 38, 38, 0.18);
        font-size: 13px;
    }

    .drawio-placeholder {
        position: absolute;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 15px;
        color: var(--window-descriptionForeground, #64748b);
        padding: 24px;
        text-align: center;
    }

    @media (prefers-color-scheme: dark) {
        .drawio-tab {
            background: var(--editor-background, #0f172a);
            color: var(--editor-foreground, #f8fafc);
        }

        .drawio-error {
            background: rgba(248, 113, 113, 0.16);
            color: #fecaca;
        }
    }
</style>
