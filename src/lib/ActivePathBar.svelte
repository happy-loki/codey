<script lang="ts">
    import { tabs, hidden } from "./EditorTabList.svelte";
    import { activeInfo } from "./editorBus";
    import { isMarkdownActive, previewMode, showMarkdownToolbar } from "./preview";
    import { onDestroy } from "svelte";
    import { writeText } from "@tauri-apps/plugin-clipboard-manager";
    import { openContextMenu } from "./utility/contextMenuService";
    import { commands } from "../config/commands";
    import {
        PencilLine,
        Columns,
        Eye,
        PenTool,
        Shapes,
        Webhook,
        WebhookOff,
        PlayCircle,
    } from "lucide-svelte";
    import { getRootPath } from "./tree/normalizedStore";
    import {
        whiteboardTarget,
        setWhiteboardFile,
        isExcalidrawPath,
        WHITEBOARD_TAB_PATH,
    } from "./whiteboard/state";
    import { ensureWhiteboardTab } from "./whiteboard/tabManager";
    import {
        drawioTarget,
        setDrawioFile,
        isDrawioPath,
        DRAWIO_TAB_PATH,
    } from "./drawio/state";
    import { ensureDrawioTab } from "./drawio/tabManager";
    import { animationTarget, setAnimationFile, ANIMATION_TAB_PATH } from "./excalidrawAnimate/state";
    import { ensureAnimationTab } from "./excalidrawAnimate/tabManager";
import {
    activePathStatus,
    clearActivePathStatus,
    resolveActivePathStatus,
    type ActivePathStatusLevel,
} from "./activePathStatus";

    const toggleToolbarVisibility = () => {
        showMarkdownToolbar.update((value) => !value);
    };

    function getActiveTab(list: any[]) {
        if (!Array.isArray(list) || list.length === 0) {
            return null;
        }
        return list.find((t) => t?.active) ?? list[0];
    }

    let statusLevel: ActivePathStatusLevel = "neutral";
    const isWindows = typeof navigator !== "undefined" && /win/i.test(navigator.platform || "");

    function looksLikeFsPath(path: string): boolean {
        if (typeof path !== "string") return false;
        const trimmed = path.trim();
        if (!trimmed) return false;
        const lower = trimmed.toLowerCase();
        if (lower.startsWith("file://") || lower.startsWith("vscode-file://")) {
            return true;
        }
        if (lower.includes("://")) {
            return false;
        }
        if (/[\\/]/.test(trimmed)) {
            return true;
        }
        if (/^[a-zA-Z]:/.test(trimmed)) {
            return true;
        }
        return false;
    }

    $: activeTab = getActiveTab($tabs);
    $: infoPath = activeTab?.isfile && typeof $activeInfo?.path === "string" ? $activeInfo.path.trim() : "";
    $: tabPath = typeof activeTab?.path === "string" ? activeTab.path.trim() : "";
    $: tabLabel = typeof activeTab?.label === "string" ? activeTab.label.trim() : "";
    $: isDrawioTab = tabPath === DRAWIO_TAB_PATH;
    $: isWhiteboardTab = tabPath === WHITEBOARD_TAB_PATH;
    $: animationTabIsActive = tabPath === ANIMATION_TAB_PATH;
    $: drawioPath = isDrawioTab && $drawioTarget.kind === "file" ? $drawioTarget.path : "";
    $: whiteboardPath = isWhiteboardTab && $whiteboardTarget.kind === "file" ? $whiteboardTarget.path : "";
    $: animationPath = animationTabIsActive && $animationTarget.kind === "file" ? $animationTarget.path : "";
    $: defaultPath = infoPath || (activeTab?.isfile ? (tabPath || tabLabel) : (tabLabel || tabPath));
    $: resolvedPath = isDrawioTab
        ? drawioPath || defaultPath || ""
        : isWhiteboardTab
            ? whiteboardPath || defaultPath || ""
            : animationTabIsActive
                ? animationPath || defaultPath || ""
                : defaultPath;
    $: displayedPath = isWindows && looksLikeFsPath(resolvedPath) ? resolvedPath.replace(/\//g, "\\") : resolvedPath;
    $: hasTabs = !$hidden && !!activeTab;
    $: showBar = hasTabs && resolvedPath !== "";
    $: tooltipText = showBar ? displayedPath : "";
    $: toolbarToggleLabel = $showMarkdownToolbar ? "隐藏 Markdown 工具栏" : "显示 Markdown 工具栏";
    $: statusResolved = resolveActivePathStatus($activePathStatus);
    $: statusText = statusResolved.message;
    $: statusLevel = statusResolved.level;
    $: isRichEditorTab = isDrawioTab || isWhiteboardTab;
    $: showStatusBadge = isRichEditorTab && !!statusText;
    $: shouldAutoRevealPath = isRichEditorTab && !!resolvedPath && resolvedPath !== lastAutoRevealedPath;
    $: if (shouldAutoRevealPath && resolvedPath) {
        void revealResolvedPathInTree(resolvedPath);
    }
    $: if (!isRichEditorTab) {
        lastAutoRevealedPath = null;
    }
    $: showActiveTools =
        !isDrawioTab &&
        !isWhiteboardTab &&
        (isExcalidrawFile || isDrawioFile || $isMarkdownActive);
    $: if (!showBar) {
        clearActivePathStatus();
        lastAutoRevealedPath = null;
    }
    $: isExcalidrawFile = isExcalidrawPath(resolvedPath);
    $: animationTabMatchesFile = Boolean(
        isExcalidrawFile &&
            $animationTarget.kind === "file" &&
            $animationTarget.path === resolvedPath,
    );
    $: whiteboardMatchesTab =
        isExcalidrawFile &&
        $whiteboardTarget.kind === "file" &&
        $whiteboardTarget.path === resolvedPath;
    $: isDrawioFile = isDrawioPath(resolvedPath);
    $: drawioMatchesTab =
        isDrawioFile &&
        $drawioTarget.kind === "file" &&
        $drawioTarget.path === resolvedPath;
    $: if (!isRichEditorTab && statusText) {
        clearActivePathStatus();
    }

    const copyLabel = "复制";
    const copyShortcut = (() => {
        if (typeof navigator !== "undefined") {
            const platform = navigator.platform?.toLowerCase?.() ?? "";
            if (platform.includes("mac")) {
                return "⌘ + C";
            }
        }
        return "Ctrl + C";
    })();
    let copyResetTimer: ReturnType<typeof setTimeout> | null = null;
    let copyFlash = false;
    let pathTextEl: HTMLSpanElement;
    const openWhiteboardLabel = "在白板中打开";
    const openDrawioLabel = "在 draw.io 中打开";
    const openAnimationLabel = "播放动画";

    function getSelectedPathText() {
        if (typeof window === "undefined") return "";
        const selection = window.getSelection?.();
        if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return "";
        const text = selection.toString();
        if (!text) return "";
        if (!pathTextEl) return "";
        const anchor = selection.anchorNode;
        const focus = selection.focusNode;
        const anchorInside = anchor ? pathTextEl.contains(anchor) || anchor === pathTextEl : false;
        const focusInside = focus ? pathTextEl.contains(focus) || focus === pathTextEl : false;
        if (anchorInside && focusInside) {
            return text;
        }
        return "";
    }

    let lastAutoRevealedPath: string | null = null;

    function normalizePathForReveal(path: string): string {
        if (!path) return "";
        const root = getRootPath();
        const prefersBackslash = root.includes("\\") || /^[a-zA-Z]:\\/.test(root);
        if (prefersBackslash && path.includes("/")) {
            return path.replace(/\//g, "\\");
        }
        return path;
    }

    async function revealResolvedPathInTree(path: string) {
        if (!path) return;
        lastAutoRevealedPath = path;
        const adjustedPath = normalizePathForReveal(path);
        try {
            await commands.revealInExplorerView?.command?.(adjustedPath);
        } catch (err) {
            console.warn("Failed to auto reveal path in tree:", err);
        }
    }

    function flashCopiedIndicator() {
        copyFlash = true;
        if (copyResetTimer) {
            clearTimeout(copyResetTimer);
        }
        copyResetTimer = setTimeout(() => {
            copyFlash = false;
            copyResetTimer = null;
        }, 800);
    }

    async function copyTextPayload(text: string) {
        if (!text) return false;
        try {
            await writeText(text);
            return true;
        } catch (_) {
            try {
                if (navigator?.clipboard?.writeText) {
                    await navigator.clipboard.writeText(text);
                    return true;
                }
            } catch (_) {
                return false;
            }
        }
        return false;
    }

    async function copyResolvedPath(forceFull = false) {
        const selected = forceFull ? "" : getSelectedPathText();
        const fallback = resolvedPath?.trim?.() ?? "";
        const text = selected || fallback;
        if (!text) return;
        const success = await copyTextPayload(text);
        if (!success) return;
        if (!selected) {
            flashCopiedIndicator();
        }
    }

    function handleContextMenu(event: MouseEvent) {
        event.preventDefault();
        const items = [
            { name: copyLabel, shortcut: copyShortcut, action: () => { void copyResolvedPath(false); } }
        ];
        openContextMenu(items, event.clientX, event.clientY);
    }

    function handleKeydown(event: KeyboardEvent) {
        const isCopyKey = (event.ctrlKey || event.metaKey) && (event.key === "c" || event.key === "C");
        if (!isCopyKey) {
            return;
        }
        const selected = getSelectedPathText();
        event.preventDefault();
        if (selected) {
            void copyResolvedPath(false);
        } else {
            void copyResolvedPath(true);
        }
    }

    onDestroy(() => {
        if (copyResetTimer) {
            clearTimeout(copyResetTimer);
        }
    });

    function openWhiteboardForTab() {
        if (!isExcalidrawFile || !resolvedPath) return;
        const label = tabLabel || (resolvedPath.split(/[/\\]/).pop() ?? resolvedPath);
        setWhiteboardFile(resolvedPath, { label });
        ensureWhiteboardTab();
    }

    function openAnimationPlayerForTab() {
        if (!isExcalidrawFile || !resolvedPath) return;
        const label = tabLabel || (resolvedPath.split(/[/\\]/).pop() ?? resolvedPath);
        setAnimationFile(resolvedPath, { label });
        ensureAnimationTab();
    }

    function openDrawioEditorForTab() {
        if (!isDrawioFile || !resolvedPath) return;
        const label = tabLabel || (resolvedPath.split(/[/\\]/).pop() ?? resolvedPath);
        setDrawioFile(resolvedPath, { label });
        ensureDrawioTab();
    }

</script>

{#if showBar}
<div
    class="active-path-bar"
    title={tooltipText}
    tabindex="0"
    on:contextmenu={handleContextMenu}
    on:keydown={handleKeydown}
>
    <span class="active-path-text" class:flash={copyFlash} bind:this={pathTextEl}>{displayedPath}</span>
    {#if showStatusBadge}
        <div
            class="active-status"
            class:status-neutral={statusLevel === "neutral"}
            class:status-info={statusLevel === "info"}
            class:status-success={statusLevel === "success"}
            class:status-warning={statusLevel === "warning"}
            class:status-error={statusLevel === "error"}
            title={statusText}
            data-status-level={statusLevel}
        >
            {statusText}
        </div>
    {/if}
    {#if showActiveTools}
        <div class="active-tools">
            {#if isExcalidrawFile}
                <button
                    type="button"
                    class="animation-toggle"
                    class:active={animationTabMatchesFile && animationTabIsActive}
                    title={openAnimationLabel}
                    aria-label={openAnimationLabel}
                    aria-pressed={animationTabMatchesFile && animationTabIsActive}
                    on:click={openAnimationPlayerForTab}
                >
                    <PlayCircle size={18} strokeWidth={1.5} />
                </button>
                <button
                    type="button"
                    class="whiteboard-toggle"
                    class:active={whiteboardMatchesTab}
                    title={openWhiteboardLabel}
                    aria-label={openWhiteboardLabel}
                    aria-pressed={whiteboardMatchesTab}
                    on:click={openWhiteboardForTab}
                >
                    <PenTool size={18} strokeWidth={1.5} />
                </button>
            {/if}
            {#if isDrawioFile}
                <button
                    type="button"
                    class="drawio-toggle"
                    class:active={drawioMatchesTab}
                    title={openDrawioLabel}
                    aria-label={openDrawioLabel}
                    aria-pressed={drawioMatchesTab}
                    on:click={openDrawioEditorForTab}
                >
                    <Shapes size={18} strokeWidth={1.5} />
                </button>
            {/if}
            {#if $isMarkdownActive}
                <button
                    type="button"
                    class="toolbar-toggle"
                    class:active={$showMarkdownToolbar}
                    title={toolbarToggleLabel}
                    aria-label={toolbarToggleLabel}
                    aria-pressed={$showMarkdownToolbar}
                    on:click={toggleToolbarVisibility}
                >
                    {#if $showMarkdownToolbar}
                        <Webhook size={18} strokeWidth={1.5} />
                    {:else}
                        <WebhookOff size={18} strokeWidth={1.5} />
                    {/if}
                </button>
                <div class="active-toolbar">
                    <span
                        class="mode"
                        class:active={$previewMode === "edit"}
                        title="仅编辑"
                        aria-label="切换到仅编辑"
                        on:click={() => previewMode.set("edit")}
                    >
                        <PencilLine size={18} strokeWidth={1.5} />
                    </span>
                    <span
                        class="mode"
                        class:active={$previewMode === "split"}
                        title="左右并排"
                        aria-label="切换到左右并排"
                        on:click={() => previewMode.set("split")}
                    >
                        <Columns size={18} strokeWidth={1.5} />
                    </span>
                    <span
                        class="mode"
                        class:active={$previewMode === "preview"}
                        title="仅预览"
                        aria-label="切换到仅预览"
                        on:click={() => previewMode.set("preview")}
                    >
                        <Eye size={18} strokeWidth={1.5} />
                    </span>
                </div>
            {/if}
        </div>
    {/if}
</div>
{/if}

<style lang="scss">
    .active-path-bar {
        display: flex;
        align-items: center;
        min-height: 32px;
        padding: 0 16px;
        background: var(--editor-tabActiveBackground, var(--editor-tabBackground));
        color: var(--editor-tabActiveForeground, var(--tab-toolbar-foreground, inherit));
        font-size: 13px;
        line-height: 1.4;
        user-select: text;
        flex: 0 0 auto;
        width: 100%;
        box-sizing: border-box;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        position: relative;
        box-shadow: inset 0 -1px 0 0 var(--window-borderColor);
    }

    .active-path-bar::after {
        content: "";
        position: absolute;
        left: 0;
        right: 0;
        bottom: 0;
        height: 2px;
        background-color: var(--editor-tabs-accent, #5a637538);
        opacity: 0.95;
        pointer-events: none;
    }

    .active-path-text {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        flex: 1 1 auto;
        min-width: 0;
        padding-right: 16px;
        outline: none;
        transition: color 0.12s ease;
    }

    .active-path-text.flash {
        color: hsl(var(--primary, 210 90% 60%));
    }

    .active-status {
        flex: 0 0 auto;
        max-width: 40%;
        margin-left: 16px;
        font-size: 12px;
        font-weight: 600;
        letter-spacing: 0.01em;
        color: #0f172a;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        padding: 3px 14px;
        border-radius: 20px;
        border: 1px solid transparent;
        background: #e2e8f0;
        transition:
            background 0.2s ease,
            color 0.2s ease,
            border-color 0.2s ease,
            box-shadow 0.2s ease;
    }

    .active-status.status-neutral {
        color: #0f172a;
        background: #e2e8f0;
        border-color: #cbd5f5;
    }

    .active-status.status-info {
        background: #2563eb;
        color: #ffffff;
        border-color: #1d4ed8;
        box-shadow: 0 2px 8px rgba(37, 99, 235, 0.35);
    }

    .active-status.status-success {
        background: #16a34a;
        color: #ffffff;
        border-color: #15803d;
        box-shadow: 0 2px 8px rgba(22, 163, 74, 0.35);
    }

    .active-status.status-warning {
        background: #f97316;
        color: #fff7ed;
        border-color: #ea580c;
        box-shadow: 0 2px 8px rgba(249, 115, 22, 0.35);
    }

    .active-status.status-error {
        background: #dc2626;
        color: #fff5f5;
        border-color: #b91c1c;
        box-shadow: 0 2px 10px rgba(220, 38, 38, 0.4);
    }

    .active-tools {
        margin-left: auto;
        display: flex;
        align-items: center;
        gap: 12px;
        height: 100%;
    }

    .toolbar-toggle,
    .whiteboard-toggle,
    .drawio-toggle,
    .animation-toggle {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 24px;
        height: 24px;
        border: none;
        border-radius: 6px;
        background: transparent;
        color: inherit;
        cursor: pointer;
        position: relative;
        overflow: hidden;
        transition: all 0.2s ease-out;
    }

    .toolbar-toggle:hover,
    .whiteboard-toggle:hover,
    .drawio-toggle:hover,
    .animation-toggle:hover {
        background: color-mix(in srgb, #e0e7ff 60%, transparent 40%) !important;
        transform: translateY(-0.5px);
        box-shadow: 0 2px 8px color-mix(in srgb, #e0e7ff 40%, transparent 60%);
    }

    .toolbar-toggle.active,
    .whiteboard-toggle.active,
    .drawio-toggle.active,
    .animation-toggle.active {
        background: color-mix(in srgb, #e0e7ff 80%, transparent 20%) !important;
        color: #4f46e5 !important;
        box-shadow: 0 2px 12px color-mix(in srgb, #e0e7ff 50%, transparent 50%);
        transform: none;
    }

    .toolbar-toggle.active::before,
    .whiteboard-toggle.active::before,
    .drawio-toggle.active::before,
    .animation-toggle.active::before {
        content: "";
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: linear-gradient(
            45deg,
            rgba(255, 255, 255, 0.3),
            transparent 50%,
            rgba(255, 255, 255, 0.3)
        );
        animation: shimmer 3s infinite;
    }

    .active-toolbar {
        display: flex;
        align-items: center;
        gap: 6px;
        height: 100%;
        padding-left: 10px;
        border-left: 1px solid var(--toolbar-divider-color, rgba(90, 99, 117, 0.18));
    }
    
    .active-toolbar .mode {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 24px;
        height: 24px;
        border-radius: 6px;
        cursor: pointer;
        position: relative;
        transition: all 0.2s ease-out;
    }

    .active-toolbar .mode:hover {
        transform: translateY(-0.5px);
    }

    /* Edit mode - Soft mint green theme */
    .active-toolbar .mode:nth-child(1):hover {
        background: color-mix(in srgb, #d1fae5 70%, transparent 30%) !important;
        color: #059669;
        box-shadow: 0 2px 8px color-mix(in srgb, #d1fae5 40%, transparent 60%);
    }

    .active-toolbar .mode:nth-child(1).active {
        background: color-mix(in srgb, #d1fae5 85%, transparent 15%) !important;
        color: #047857 !important;
        box-shadow: 0 2px 12px color-mix(in srgb, #d1fae5 50%, transparent 50%);
        transform: none;
    }

    /* Split mode - Soft peach theme */
    .active-toolbar .mode:nth-child(2):hover {
        background: color-mix(in srgb, #fed7aa 70%, transparent 30%) !important;
        color: #ea580c;
        box-shadow: 0 2px 8px color-mix(in srgb, #fed7aa 40%, transparent 60%);
    }

    .active-toolbar .mode:nth-child(2).active {
        background: color-mix(in srgb, #fed7aa 85%, transparent 15%) !important;
        color: #c2410c !important;
        box-shadow: 0 2px 12px color-mix(in srgb, #fed7aa 50%, transparent 50%);
        transform: none;
    }

    /* Preview mode - Soft sky blue theme */
    .active-toolbar .mode:nth-child(3):hover {
        background: color-mix(in srgb, #dbeafe 70%, transparent 30%) !important;
        color: #2563eb;
        box-shadow: 0 2px 8px color-mix(in srgb, #dbeafe 40%, transparent 60%);
    }

    .active-toolbar .mode:nth-child(3).active {
        background: color-mix(in srgb, #dbeafe 85%, transparent 15%) !important;
        color: #1d4ed8 !important;
        box-shadow: 0 2px 12px color-mix(in srgb, #dbeafe 50%, transparent 50%);
        transform: none;
    }

    /* Subtle animations for minimalist design */
    @keyframes shimmer {
        0% {
            transform: translateX(-100%);
            opacity: 0;
        }
        50% {
            opacity: 0.5;
        }
        100% {
            transform: translateX(100%);
            opacity: 0;
        }
    }

    /* Dark mode adjustments - More subtle and harmonious */
    @media (prefers-color-scheme: dark) {
        .toolbar-toggle:hover,
        .whiteboard-toggle:hover,
        .drawio-toggle:hover {
            background: color-mix(in srgb, #374151 30%, transparent 70%) !important;
            box-shadow: 0 1px 4px color-mix(in srgb, #374151 20%, transparent 80%);
        }

        .toolbar-toggle.active,
        .whiteboard-toggle.active,
        .drawio-toggle.active {
            background: color-mix(in srgb, #374151 50%, transparent 50%) !important;
            color: #d1d5db !important;
            box-shadow: 0 1px 6px color-mix(in srgb, #374151 25%, transparent 75%);
        }

        .active-status {
            color: #e2e8f0;
            background: #1f2937;
            border-color: #334155;
            box-shadow: inset 0 0 0 1px rgba(15, 23, 42, 0.4);
        }

        .active-status.status-neutral {
            color: #e2e8f0;
            background: #1f2937;
            border-color: #475569;
        }

        .active-status.status-info {
            color: #dbeafe;
            background: #1d4ed8;
            border-color: #2563eb;
            box-shadow: 0 2px 10px rgba(37, 99, 235, 0.45);
        }

        .active-status.status-success {
            color: #d1fae5;
            background: #15803d;
            border-color: #16a34a;
            box-shadow: 0 2px 10px rgba(22, 163, 74, 0.45);
        }

        .active-status.status-warning {
            color: #fff4db;
            background: #c2410c;
            border-color: #f97316;
            box-shadow: 0 2px 10px rgba(217, 119, 6, 0.45);
        }

        .active-status.status-error {
            color: #fee2e2;
            background: #b91c1c;
            border-color: #dc2626;
            box-shadow: 0 2px 12px rgba(239, 68, 68, 0.55);
        }

        .active-toolbar .mode:nth-child(1):hover {
            background: color-mix(in srgb, #374151 25%, transparent 75%) !important;
            color: #9ca3af;
            box-shadow: 0 1px 4px color-mix(in srgb, #374151 15%, transparent 85%);
        }

        .active-toolbar .mode:nth-child(1).active {
            background: color-mix(in srgb, #374151 40%, transparent 60%) !important;
            color: #d1d5db !important;
            box-shadow: 0 1px 6px color-mix(in srgb, #374151 20%, transparent 80%);
        }

        .active-toolbar .mode:nth-child(2):hover {
            background: color-mix(in srgb, #374151 25%, transparent 75%) !important;
            color: #9ca3af;
            box-shadow: 0 1px 4px color-mix(in srgb, #374151 15%, transparent 85%);
        }

        .active-toolbar .mode:nth-child(2).active {
            background: color-mix(in srgb, #374151 40%, transparent 60%) !important;
            color: #d1d5db !important;
            box-shadow: 0 1px 6px color-mix(in srgb, #374151 20%, transparent 80%);
        }

        .active-toolbar .mode:nth-child(3):hover {
            background: color-mix(in srgb, #374151 25%, transparent 75%) !important;
            color: #9ca3af;
            box-shadow: 0 1px 4px color-mix(in srgb, #374151 15%, transparent 85%);
        }

        .active-toolbar .mode:nth-child(3).active {
            background: color-mix(in srgb, #374151 40%, transparent 60%) !important;
            color: #d1d5db !important;
            box-shadow: 0 1px 6px color-mix(in srgb, #374151 20%, transparent 80%);
        }
    }
</style>
