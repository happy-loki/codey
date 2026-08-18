<script lang="ts">
    import { onDestroy, onMount } from "svelte";
    import { get } from "svelte/store";
    import ExcalidrawCanvas from "./ExcalidrawCanvas.svelte";
    import { dirname } from "@tauri-apps/api/path";
    import { exists, mkdir, readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
    import { open as openExternal } from "@tauri-apps/plugin-shell";
    import { t, lang as uiLang } from "./i18n";
    import { addNotification, NotifType } from "./Notifications/notifications";
    import { closeTabByPath } from "./EditorTabList.svelte";
    import {
        WHITEBOARD_TAB_PATH,
        whiteboardTarget,
        type WhiteboardTarget,
        setWhiteboardGlobal,
        setWhiteboardFile,
        isWhiteboardSaveSuppressed,
    } from "./whiteboard/state";
    import { ensureDefaultWhiteboardFile, createNewWhiteboardFile } from "./whiteboard/defaultFile";
    import { ensureWhiteboardTab } from "./whiteboard/tabManager";
    import {
        setActivePathStatus,
        clearActivePathStatus,
        type ActivePathStatusLevel,
    } from "./activePathStatus";
    import { getSceneVersion, serializeAsJSON } from "@excalidraw/excalidraw";

    const AUTO_SAVE_DELAY = 1500;
    const WHITEBOARD_BASE_FONT_PX = 16;
    const WHITEBOARD_MIN_SCALE = 1;
    const WHITEBOARD_MAX_SCALE = 1.6;

    type SceneState = {
        elements: any;
        appState: any;
        files: Record<string, any>;
    };

    function sanitizeElements(raw: any): any[] {
        if (!Array.isArray(raw)) return [];
        const safeElements: any[] = [];
        for (const element of raw) {
            if (!element || typeof element !== "object" || element.isDeleted) continue;
            if (typeof element.type !== "string" || typeof element.id !== "string") continue;
            const cloned: any = { ...element, isDeleted: false };
            if (Array.isArray(cloned.points)) {
                cloned.points = cloned.points.filter(
                    (pt) => Array.isArray(pt) && pt.length === 2 && pt.every(Number.isFinite),
                );
            }
            if (typeof cloned.text !== "string") {
                cloned.text = "";
            }
            safeElements.push(cloned);
        }
        return safeElements;
    }

    function ensureTrailingNewline(value: string): string {
        return value.endsWith("\n") ? value : `${value}\n`;
    }

    function buildSceneSnapshot(scene: SceneState | null): string | null {
        if (!scene) return null;
        const serialized = serializeAsJSON(
            sanitizeElements(scene.elements),
            serializeAppState(scene.appState),
            scene.files ?? {},
            "local",
        );
        return ensureTrailingNewline(serialized);
    }

    function computeFilesFingerprint(files: Record<string, any> | null | undefined): number {
        if (!files) return 0;
        let acc = 0;
        for (const file of Object.values(files)) {
            if (!file) continue;
            if (typeof file.version === "number") {
                acc += file.version;
                continue;
            }
            if (typeof file.dataURL === "string") {
                acc += file.dataURL.length;
                continue;
            }
            if (typeof file.id === "string") {
                acc += file.id.length;
            }
        }
        return acc;
    }

    function buildContentFingerprint(scene: SceneState | null): string | null {
        if (!scene) return null;
        const elementsVersion = Array.isArray(scene.elements)
            ? getSceneVersion(scene.elements)
            : 0;
        const filesVersion = computeFilesFingerprint(scene.files);
        return `${elementsVersion}:${filesVersion}`;
    }

    export let hidden = false;

    let initialData: SceneState | null = null;
    let storagePath = "";
    let status: "loading" | "ready" | "dirty" | "saving" | "saved" | "error" = "loading";
    let error: string | null = null;
    let lastSavedAt: Date | null = null;
    let saveTimer: ReturnType<typeof setTimeout> | null = null;
    let latestScene: SceneState | null = null;
    let pendingContentFingerprint: string | null = null;
    let lastSavedContentFingerprint: string | null = null;
    let tabviewEl: HTMLElement | null = null;
    let overflowApplied = false;
    let whiteboardScale = 1;
    let whiteboardScaleCss = "1";
    let rootFontObserver: MutationObserver | null = null;
    let targetUnsubscribe: (() => void) | null = null;
    let activeTarget: WhiteboardTarget = { kind: "global" };
    let loadToken = 0;
    let currentTargetKey = "";
    let canvasKey = 0;
    let canvasVisible = false;
    let statusLevelIndicator: ActivePathStatusLevel = "neutral";
    let crashClosePending = false;
    let newWhiteboardMenuLabel = "";
    $: newWhiteboardMenuLabel = $t("whiteboard.menu.newBlank");

    function restoreCollaborators(raw: any): Map<string, any> {
        if (raw instanceof Map) return raw;
        if (Array.isArray(raw)) {
            try {
                return new Map(raw);
            } catch {
                return new Map();
            }
        }
        if (raw && typeof raw === "object") {
            return new Map(Object.entries(raw));
        }
        return new Map();
    }

    function serializeCollaborators(raw: any): Record<string, any> {
        if (raw instanceof Map) {
            return Object.fromEntries(raw);
        }
        if (Array.isArray(raw)) {
            return Object.fromEntries(raw);
        }
        if (raw && typeof raw === "object") {
            return raw as Record<string, any>;
        }
        return {};
    }

    function serializeAppState(appState: any): Record<string, any> {
        if (!appState || typeof appState !== "object") {
            return { collaborators: {} };
        }
        const { collaborators, ...rest } = appState;
        return {
            ...rest,
            collaborators: serializeCollaborators(collaborators),
        };
    }

    class WhiteboardFormatError extends Error {
        constructor(message: string) {
            super(message);
            this.name = "WhiteboardFormatError";
        }
    }

    function buildInvalidFileMessage(reasonKey: string, fallback: string): string {
        const translator = get(t);
        return translator("whiteboard.invalidFile", {
            reason: translator(reasonKey, { reason: fallback }) ?? fallback,
        });
    }

    function validateWhiteboardData(parsed: any) {
        const translator = get(t);
        const throwFormat = (reasonKey: string, fallback: string) => {
            throw new WhiteboardFormatError(buildInvalidFileMessage(reasonKey, fallback));
        };

        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            throwFormat("whiteboard.invalidReasonNotObject", "文件内容不是有效的 JSON 对象");
        }
        if (parsed.type && parsed.type !== "excalidraw") {
            throwFormat("whiteboard.invalidReasonWrongType", "并非 Excalidraw 文件");
        }
        if (!Array.isArray(parsed.elements)) {
            throwFormat("whiteboard.invalidReasonElements", "缺少 elements 数组");
        }
        if (
            typeof parsed.appState !== "undefined" &&
            (parsed.appState === null || typeof parsed.appState !== "object" || Array.isArray(parsed.appState))
        ) {
            throwFormat("whiteboard.invalidReasonAppState", "appState 必须是对象");
        }
        if (
            typeof parsed.files !== "undefined" &&
            (parsed.files === null || typeof parsed.files !== "object" || Array.isArray(parsed.files))
        ) {
            throwFormat("whiteboard.invalidReasonFiles", "files 必须是对象");
        }
    }

    function normalizeInitialData(parsed: any): SceneState {
        return {
            elements: sanitizeElements(parsed?.elements ?? []),
            appState: {
                ...(parsed?.appState ?? {}),
                collaborators: restoreCollaborators(parsed?.appState?.collaborators),
            },
            files: parsed?.files ?? {},
        };
    }

    function notifyWhiteboardCrash(rawReason?: string | null) {
        const translator = get(t);
        const title = translator("whiteboard.notificationTitle");
        const fallbackReason = rawReason && rawReason.trim()
            ? rawReason
            : translator("whiteboard.status.error");
        const message = translator("whiteboard.crashAutoClosed", { reason: fallbackReason });
        addNotification(NotifType.Error, title, [], message);
    }

    function closeWhiteboardAfterCrash(reason?: string | null) {
        if (crashClosePending) return;
        crashClosePending = true;
        loadToken += 1;
        if (saveTimer) {
            clearTimeout(saveTimer);
            saveTimer = null;
        }
        latestScene = null;
        initialData = null;
        lastSavedContentFingerprint = null;
        pendingContentFingerprint = null;
        canvasVisible = false;
        const translator = get(t);
        const fallbackReason = reason && reason.trim()
            ? reason
            : translator("whiteboard.status.error");
        error = fallbackReason;
        status = "error";
        setTabOverflow(false);
        if (targetUnsubscribe) {
            targetUnsubscribe();
            targetUnsubscribe = null;
        }
        clearActivePathStatus();
        setWhiteboardGlobal();
        notifyWhiteboardCrash(fallbackReason);
        setTimeout(() => {
            void closeTabByPath(WHITEBOARD_TAB_PATH, { force: true });
        }, 0);
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

    async function handleCreateNewWhiteboard() {
        try {
            const newPath = await createNewWhiteboardFile();
            const label = newPath.split(/[/\\]/).pop() ?? newPath;
            setWhiteboardFile(newPath, { label });
            ensureWhiteboardTab();
        } catch (err) {
            console.error("[ExcalidrawTab] failed to create new whiteboard", err);
            const translator = get(t);
            const title = translator("whiteboard.notificationTitle");
            const message =
                err instanceof Error ? err.message : translator("whiteboard.status.error");
            addNotification(NotifType.Error, title, [], message);
        }
    }

    async function loadInitialScene(targetPath: string): Promise<SceneState | null> {
        lastSavedAt = null;
        lastSavedContentFingerprint = null;
        if (!(await exists(targetPath))) {
            return null;
        }
        try {
            const raw = await readTextFile(targetPath);
            if (!raw.trim()) {
                return null;
            }
            const parsed = JSON.parse(raw);
            validateWhiteboardData(parsed);
            let normalizedScene: SceneState;
            try {
                normalizedScene = normalizeInitialData(parsed);
            } catch (err) {
                const translator = get(t);
                const reason = err instanceof Error ? err.message : "invalid elements";
                throw new WhiteboardFormatError(
                    translator("whiteboard.invalidFile", {
                        reason,
                    }),
                );
            }
            lastSavedAt = new Date();
            lastSavedContentFingerprint = buildContentFingerprint(normalizedScene);
            pendingContentFingerprint = lastSavedContentFingerprint;
            return normalizedScene;
        } catch (e) {
            console.error("[ExcalidrawTab] failed to load whiteboard", e);
            if (e instanceof SyntaxError) {
                const translator = get(t);
                throw new WhiteboardFormatError(
                    translator("whiteboard.invalidFile", {
                        reason: translator("whiteboard.invalidReasonSyntax", {
                            reason: "无法解析白板文件内容",
                        }),
                    }),
                );
            }
            throw e instanceof Error ? e : new Error(String(e));
        }
    }

    function scheduleSave() {
        if (!storagePath || !latestScene || !pendingContentFingerprint) return;
        if (isWhiteboardSaveSuppressed(storagePath)) {
            return;
        }
        status = "dirty";
        if (saveTimer) clearTimeout(saveTimer);
        saveTimer = setTimeout(() => {
            saveTimer = null;
            void flushSave();
        }, AUTO_SAVE_DELAY);
    }

    async function flushSave() {
        if (!storagePath || !latestScene) return;
        if (isWhiteboardSaveSuppressed(storagePath)) {
            status = "ready";
            return;
        }
        const fingerprint = pendingContentFingerprint ?? buildContentFingerprint(latestScene);
        if (!fingerprint) {
            status = "ready";
            return;
        }
        if (lastSavedContentFingerprint && fingerprint === lastSavedContentFingerprint) {
            pendingContentFingerprint = fingerprint;
            status = "saved";
            return;
        }
        console.info("[ExcalidrawTab] serializeAsJSON triggered", {
            fingerprint,
        });
        const serialized = buildSceneSnapshot(latestScene);
        if (!serialized) {
            status = "ready";
            return;
        }
        status = "saving";
        try {
            try {
                const parent = await dirname(storagePath);
                if (parent && !(await exists(parent))) {
                    await mkdir(parent, { recursive: true });
                }
            } catch (_) {
                // parent directory ensure best-effort
            }
            await writeTextFile(storagePath, serialized);
            lastSavedContentFingerprint = fingerprint;
            pendingContentFingerprint = fingerprint;
            lastSavedAt = new Date();
            status = "saved";
        } catch (e) {
            console.error("[ExcalidrawTab] failed to save whiteboard", e);
            error = e instanceof Error ? e.message : String(e);
            status = "error";
        }
    }

    function handleSceneChange(elements: any, appState: any, files: Record<string, any>) {
        latestScene = {
            elements,
            appState,
            files,
        };
        const fingerprint = buildContentFingerprint(latestScene);
        if (!fingerprint) {
            return;
        }
        if (pendingContentFingerprint && fingerprint === pendingContentFingerprint) {
            return;
        }
        pendingContentFingerprint = fingerprint;
        if (lastSavedContentFingerprint && fingerprint === lastSavedContentFingerprint) {
            if (saveTimer) {
                clearTimeout(saveTimer);
                saveTimer = null;
            }
            status = "saved";
            return;
        }
        scheduleSave();
    }

    function getTabviewElement(): HTMLElement | null {
        if (typeof document === "undefined") return null;
        if (tabviewEl && tabviewEl.isConnected) return tabviewEl;
        tabviewEl = document.getElementById("tabview");
        return tabviewEl;
    }

    function setTabOverflow(enable: boolean) {
        // Excalidraw 的调色板等浮层会溢出画布容器，需要暂时移除 tabview 的 overflow 限制
        const host = getTabviewElement();
        if (!host) return;
        if (enable) {
            if (!overflowApplied) {
                host.classList.add("whiteboard-overflow");
                overflowApplied = true;
            }
        } else if (overflowApplied) {
            host.classList.remove("whiteboard-overflow");
            overflowApplied = false;
        }
    }

    function makeTargetKey(target: WhiteboardTarget): string {
        return target.kind === "file" ? `file:${target.path}` : "global";
    }

    function readRootFontPx(): number {
        if (typeof document === "undefined") return WHITEBOARD_BASE_FONT_PX;
        const computed = getComputedStyle(document.documentElement);
        const parsed = parseFloat(computed.fontSize || `${WHITEBOARD_BASE_FONT_PX}px`);
        if (Number.isFinite(parsed) && parsed > 0) {
            return parsed;
        }
        return WHITEBOARD_BASE_FONT_PX;
    }

    function refreshWhiteboardScale() {
        if (typeof document === "undefined") return;
        const rootPx = readRootFontPx();
        const ratio = WHITEBOARD_BASE_FONT_PX / rootPx;
        const clamped = Math.min(WHITEBOARD_MAX_SCALE, Math.max(WHITEBOARD_MIN_SCALE, ratio));
        if (!Number.isFinite(clamped)) return;
        if (Math.abs(clamped - whiteboardScale) > 0.001) {
            whiteboardScale = clamped;
            whiteboardScaleCss = clamped.toFixed(3);
        }
    }

    async function applyTarget(target: WhiteboardTarget) {
        const key = makeTargetKey(target);
        const nextToken = ++loadToken;
        const sameTarget = key === currentTargetKey && storagePath;
        currentTargetKey = key;
        activeTarget = target;
        if (crashClosePending) {
            return;
        }

        if (sameTarget) {
            return;
        }

        canvasVisible = false;
        if (saveTimer) {
            clearTimeout(saveTimer);
            saveTimer = null;
        }
        await flushSave();
        lastSavedContentFingerprint = null;
        pendingContentFingerprint = null;
        latestScene = null;
        initialData = null;
        lastSavedAt = null;

        status = "loading";
        error = null;

        try {
            const nextPath =
                target.kind === "file"
                    ? target.path
                    : await ensureDefaultWhiteboardFile();
            if (loadToken !== nextToken) return;
            storagePath = nextPath;
            const scene = await loadInitialScene(nextPath);
            if (loadToken !== nextToken) return;
            initialData = scene;
            latestScene = scene;
            status = scene ? "saved" : "ready";
            error = null;
            canvasKey += 1;
            canvasVisible = true;
        } catch (e) {
            if (loadToken !== nextToken) return;
            console.error("[ExcalidrawTab] failed to switch whiteboard target", e);
            if (e instanceof WhiteboardFormatError) {
                const translator = get(t);
                const title = translator("whiteboard.notificationTitle");
                const message = e.message;
                addNotification(NotifType.Error, title, [], message);
                status = "error";
                error = message;
                canvasVisible = false;
                return;
            }
            status = "error";
            error = e instanceof Error ? e.message : String(e);
            canvasVisible = false;
            closeWhiteboardAfterCrash(error);
        }
    }

    onMount(async () => {
        refreshWhiteboardScale();
        enableExternalLinkInterceptor();
        if (typeof MutationObserver !== "undefined" && typeof document !== "undefined") {
            rootFontObserver = new MutationObserver(() => refreshWhiteboardScale());
            rootFontObserver.observe(document.documentElement, {
                attributes: true,
                attributeFilter: ["style"],
            });
        }
        setTabOverflow(!hidden);
        targetUnsubscribe = whiteboardTarget.subscribe((target) => {
            void applyTarget(target);
        });
    });

    onDestroy(() => {
        if (detachExternalLinkInterceptor) {
            detachExternalLinkInterceptor();
        }
        if (rootFontObserver) {
            rootFontObserver.disconnect();
            rootFontObserver = null;
        }
        if (targetUnsubscribe) {
            targetUnsubscribe();
            targetUnsubscribe = null;
        }
        setTabOverflow(false);
        if (saveTimer) {
            clearTimeout(saveTimer);
            saveTimer = null;
        }
        void flushSave();
        clearActivePathStatus();
    });

    $: setTabOverflow(!hidden);

    $: statusLabel = (() => {
        switch (status) {
            case "loading":
                return $t("whiteboard.status.loading");
            case "ready":
                return $t("whiteboard.status.ready");
            case "dirty":
                return $t("whiteboard.status.dirty");
            case "saving":
                return $t("whiteboard.status.saving");
            case "saved":
                return lastSavedAt
                    ? $t("whiteboard.status.savedAt", { time: formatTime(lastSavedAt) })
                    : $t("whiteboard.status.saved");
            case "error":
                return error
                    ? `${$t("whiteboard.status.error")}: ${error}`
                    : $t("whiteboard.status.error");
            default:
                return "";
        }
    })();

    $: statusLevelIndicator = resolveStatusLevel(status);

    $: {
        if (hidden) {
            clearActivePathStatus();
        } else if (statusLabel) {
            setActivePathStatus({ message: statusLabel, level: statusLevelIndicator });
        } else {
            clearActivePathStatus();
        }
    }

    function resolveStatusLevel(currentStatus: typeof status): ActivePathStatusLevel {
        if (currentStatus === "error") {
            return "error";
        }
        if (currentStatus === "saving" || currentStatus === "loading") {
            return "info";
        }
        if (currentStatus === "dirty") {
            return "warning";
        }
        if (currentStatus === "ready" || currentStatus === "saved") {
            return "success";
        }
        return "neutral";
    }

    function handleCanvasFatal(event: CustomEvent<{ reason?: string }>) {
        const detailReason = event?.detail?.reason ?? null;
        closeWhiteboardAfterCrash(detailReason);
    }

    function resolveAnchorForExternalOpen(event: MouseEvent): HTMLAnchorElement | null {
        if (event.defaultPrevented) return null;
        if (event.button !== 0) return null;
        if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return null;
        const rawTarget = event.target;
        if (!(rawTarget instanceof Element)) return null;
        const anchor = rawTarget.closest("a[href]");
        if (!anchor) return null;
        const href = anchor.getAttribute("href");
        if (!href || href.startsWith("#")) return null;
        if (/^javascript:/i.test(href)) return null;
        return anchor as HTMLAnchorElement;
    }

    async function openLinkExternally(href: string) {
        try {
            const base = typeof window !== "undefined" ? window.location.href : "https://localhost";
            const absolute = new URL(href, base).toString();
            await openExternal(absolute);
        } catch (err) {
            console.warn("[ExcalidrawTab] failed to open external link via shell", err);
            if (typeof window !== "undefined") {
                window.open(href, "_blank", "noopener");
            }
        }
    }

    let detachExternalLinkInterceptor: (() => void) | null = null;

    function interceptExternalLinks(event: MouseEvent) {
        const anchor = resolveAnchorForExternalOpen(event);
        if (!anchor) return;
        const href = anchor.getAttribute("href");
        if (!href) return;
        event.preventDefault();
        event.stopPropagation();
        void openLinkExternally(href);
    }

    function enableExternalLinkInterceptor() {
        if (typeof document === "undefined") return;
        const handler = (event: MouseEvent) => interceptExternalLinks(event);
        document.addEventListener("click", handler, true);
        detachExternalLinkInterceptor = () => {
            document.removeEventListener("click", handler, true);
            detachExternalLinkInterceptor = null;
        };
    }

</script>

<div class="whiteboard-tab" class:is-hidden={hidden}>
    <div
        class="whiteboard-body"
        style={`--whiteboard-scale: ${whiteboardScaleCss}`}
        on:click|capture={interceptExternalLinks}
    >
        {#if canvasVisible}
            {#key canvasKey}
                <ExcalidrawCanvas
                    hidden={hidden}
                    {initialData}
                    onChange={handleSceneChange}
                    langCode={$uiLang}
                    loadingLabel={$t("whiteboard.status.loading")}
                    errorLabel={$t("whiteboard.status.error")}
                    newWhiteboardLabel={newWhiteboardMenuLabel}
                    onCreateNewWhiteboard={handleCreateNewWhiteboard}
                    on:fatalError={handleCanvasFatal}
                />
            {/key}
        {:else if status === "error"}
            <div class="whiteboard-error">{statusLabel}</div>
        {/if}
    </div>
</div>

<style>
    .whiteboard-tab {
        position: relative;
        width: 100%;
        height: 100%;
        display: flex;
        flex-direction: column;
        background: var(--editor-background, #fff);
    }

    .whiteboard-tab.is-hidden {
        display: none;
    }

    .whiteboard-body {
        flex: 1 1 auto;
        min-height: 0;
        display: flex;
        position: relative;
        align-items: stretch;
        justify-content: center;
    }

    .whiteboard-error {
        margin: auto;
        padding: 12px 16px;
        border-radius: 8px;
        background: rgba(220, 38, 38, 0.12);
        color: rgba(127, 29, 29, 0.88);
        font-size: 14px;
        text-align: center;
        max-width: 420px;
        line-height: 1.5;
    }

    :global(#tabview.whiteboard-overflow) {
        overflow: visible;
    }

    :global(.whiteboard-body .excalidraw) {
        font-size: calc(1rem * var(--whiteboard-scale, 1));
        --excalidraw-scale: var(--whiteboard-scale, 1);
        --space-factor: calc(0.25rem * var(--excalidraw-scale));
        --default-button-size: calc(2rem * var(--excalidraw-scale));
        --default-icon-size: calc(1rem * var(--excalidraw-scale));
        --lg-button-size: calc(2.25rem * var(--excalidraw-scale));
        --lg-icon-size: calc(1rem * var(--excalidraw-scale));
        --editor-container-padding: calc(1rem * var(--excalidraw-scale));
    }

    :global(.whiteboard-body .excalidraw .App-menu__left .color-picker-container) {
        display: flex;
        align-items: center;
        width: 100%;
        gap: calc(0.5rem * var(--whiteboard-scale, 1));
        padding: calc(0.5rem * var(--whiteboard-scale, 1));
        overflow: visible;
        flex-wrap: nowrap;
    }

    :global(.whiteboard-body .excalidraw .App-menu__left .color-picker__top-picks) {
        display: flex;
        gap: calc(0.5rem * var(--whiteboard-scale, 1));
        flex-shrink: 0;
    }

    :global(.whiteboard-body .excalidraw .App-menu__left .color-picker__button) {
        width: calc(1.65rem * var(--whiteboard-scale, 1));
        height: calc(1.65rem * var(--whiteboard-scale, 1));
        flex-shrink: 0;
    }

    :global(.whiteboard-body .excalidraw .App-menu__left .color-picker__button--large) {
        width: calc(1.95rem * var(--whiteboard-scale, 1));
        height: calc(1.95rem * var(--whiteboard-scale, 1));
        flex-shrink: 0;
    }

    :global(.whiteboard-body .excalidraw .App-menu__left .color-picker__button.active-color) {
        width: calc(1.8rem * var(--whiteboard-scale, 1));
        height: calc(1.8rem * var(--whiteboard-scale, 1));
        flex-shrink: 0;
    }

    :global(.whiteboard-body .excalidraw .App-menu__left .color-picker-content--default) {
        grid-template-columns: repeat(5, calc(1.9rem * var(--whiteboard-scale, 1)));
        grid-gap: calc(0.25rem * var(--whiteboard-scale, 1));
    }

    :global(.whiteboard-body .excalidraw .App-menu) {
        overflow: visible;
    }

    :global(.whiteboard-body .excalidraw .Island.App-menu__left) {
        box-sizing: border-box;
        width: min(calc(16rem * var(--whiteboard-scale, 1)), 90vw);
        min-width: calc(13.5rem * var(--whiteboard-scale, 1));
        overflow-x: hidden;
        overflow-y: auto;
        padding-inline: calc(0.5rem * var(--whiteboard-scale, 1));
        border: 1px solid rgba(15, 23, 42, 0.28);
        background: var(--editor-surface, #ffffff);
        box-shadow: none;
    }

    :global(.whiteboard-body .excalidraw .Island.App-menu__left .panelColumn) {
        min-width: 0;
        width: 100%;
        overflow: visible;
        gap: calc(0.5rem * var(--whiteboard-scale, 1));
    }

    :global(.whiteboard-body .excalidraw .Island.App-menu__left .panelColumn > div) {
        width: 100%;
        padding: calc(0.5rem * var(--whiteboard-scale, 1)) 0;
    }

    :global(.whiteboard-body .excalidraw .Island.App-menu__left .buttonList) {
        display: flex;
        gap: calc(0.5rem * var(--whiteboard-scale, 1));
        padding: calc(0.5rem * var(--whiteboard-scale, 1));
    }

    :global(.whiteboard-body .excalidraw .Island.App-menu__left fieldset) {
        padding: calc(0.5rem * var(--whiteboard-scale, 1));
        min-width: 0;
    }

    :global(.whiteboard-body .excalidraw .Island.App-menu__left .range-wrapper) {
        padding-left: calc(0.75rem * var(--whiteboard-scale, 1));
        padding-right: calc(1.25rem * var(--whiteboard-scale, 1));
    }

    :global(
        .whiteboard-body
            .excalidraw
            .Island.App-menu__left
            .color-picker-container
            > div[style*="width: 1px"][style*="margin: 0px auto"]
    ) {
        margin: 0 calc(0.25rem * var(--whiteboard-scale, 1)) !important;
    }

    :global(.whiteboard-body .excalidraw .App-toolbar .Island),
    :global(.whiteboard-body .excalidraw .App-toolbar-content .Island),
    :global(.whiteboard-body .excalidraw .layer-ui__wrapper .Island:not(.App-menu__left)) {
        border: 1px solid rgba(15, 23, 42, 0.28);
        background: var(--editor-surface, #ffffff);
        box-shadow: none;
    }
</style>
