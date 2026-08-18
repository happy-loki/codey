<script lang="ts">
    import { ChevronDown, ChevronRight, ExternalLink } from "lucide-svelte";
    import type { FileUpdateChange, PatchChangeKind } from "./types";
    import {
        buildDiffPayload,
        firstChangeLineIndex,
        isBinaryDiff,
    } from "./diffUtils";
    import type { DiffLine } from "./diffUtils";
    import { getRootPath } from "../tree/normalizedStore";
    import { openFileAtLine } from "../EditorTabList.svelte";

    type DiffRendererMode = "lightweight" | "pierre";

    export let change: FileUpdateChange;
    export let defaultExpanded = true;
    export let tone: "default" | "overlay" = "default";
    export let topGap = 12;
    export let showHeader = true;
    export let showStatusLabel = true;
    export let diffStyle: "unified" | "split" = "unified";
    export let maxDiffHeight: string | null = "150px";
    export let renderer: DiffRendererMode = "lightweight";

    let isExpanded = defaultExpanded;
    let PierreDiffRendererComponent: any = null;
    let pierreLoadPromise: Promise<void> | null = null;

    const ABSOLUTE_PATH_PATTERN = /^(?:[a-zA-Z]:[\\/]|\\\\|\/)/;
    const EMPTY_PARSED = {
        originalText: "",
        modifiedText: "",
        additions: 0,
        deletions: 0,
        isBinary: false,
        hasHunks: false,
        lines: [] as DiffLine[],
    };

    function getChangeKindLabel(kind: PatchChangeKind | undefined): string {
        if (!kind) return "UPDATED";
        if (kind.type === "add") return "ADDED";
        if (kind.type === "delete") return "DELETED";
        if (kind.type === "update" && kind.move_path) return "RENAMED";
        return "UPDATED";
    }

    function getChangeKindClass(kind: PatchChangeKind | undefined): string {
        if (!kind) return "pill-update";
        if (kind.type === "add") return "pill-add";
        if (kind.type === "delete") return "pill-delete";
        if (kind.type === "update" && kind.move_path) return "pill-rename";
        return "pill-update";
    }

    function relativizeToWorkspace(rawPath: string | null | undefined): { display: string; tooltip: string } {
        const trimmed = (rawPath ?? "").trim();
        if (!trimmed) return { display: "", tooltip: "" };
        const root = getRootPath() || "";
        const normalize = (p: string) => p.replace(/\\/g, "/");
        const pathNorm = normalize(trimmed);
        const rootNorm = root ? normalize(root) : "";
        if (!rootNorm) {
            return { display: pathNorm, tooltip: trimmed };
        }

        const pathLower = pathNorm.toLowerCase();
        const rootLower = rootNorm.toLowerCase();
        const prefix = rootLower.endsWith("/") ? rootLower : `${rootLower}/`;

        if (pathLower === rootLower) {
            return { display: "/", tooltip: trimmed };
        }
        if (pathLower.startsWith(prefix)) {
            let rel = pathNorm.slice(rootNorm.length);
            if (rel.startsWith("/")) rel = rel.slice(1);
            return { display: rel, tooltip: trimmed };
        }

        return { display: pathNorm, tooltip: trimmed };
    }

    function resolveAbsoluteWorkspacePath(rawPath: string | null | undefined): string | null {
        const trimmed = (rawPath ?? "").trim();
        if (!trimmed) return null;
        if (ABSOLUTE_PATH_PATTERN.test(trimmed)) {
            return trimmed;
        }

        const root = getRootPath() || "";
        if (!root) {
            return trimmed;
        }

        const separator = root.includes("\\") ? "\\" : "/";
        const normalizedRelative = trimmed
            .replace(/^[\\/]+/, "")
            .replace(/[\\/]+/g, separator);
        const needsSeparator = !root.endsWith(separator);
        return `${root}${needsSeparator ? separator : ""}${normalizedRelative}`;
    }

    function toggle() {
        isExpanded = !isExpanded;
    }

    async function ensurePierreRenderer() {
        if (PierreDiffRendererComponent || pierreLoadPromise) return;
        pierreLoadPromise = import("./PierreDiffRenderer.svelte").then((module) => {
            PierreDiffRendererComponent = module.default;
        }).finally(() => {
            pierreLoadPromise = null;
        });
        await pierreLoadPromise;
    }

    $: parsed = change ? buildDiffPayload(change) : EMPTY_PARSED;
    $: stats = { additions: parsed.additions, deletions: parsed.deletions };
    $: isBinary = parsed.isBinary || isBinaryDiff(change?.diff);
    $: hasRenderableDiff = parsed.lines.length > 0 && !isBinary;
    $: showRaw = !hasRenderableDiff && !isBinary && (change?.diff?.trim().length ?? 0) > 0;
    $: hasDiffContent = Boolean(change?.diff?.trim());
    $: maxLineNumber = parsed.lines.reduce((max, line) => {
        if (typeof line.lineNumber === "number" && line.lineNumber > max) {
            return line.lineNumber;
        }
        return max;
    }, 0);
    $: gutterCh = Math.max(String(maxLineNumber || 0).length, 2) + 1;
    $: firstChangeLine = firstChangeLineIndex(parsed.lines);
    $: mainPathInfo = relativizeToWorkspace(change?.path);
    $: displayPath = mainPathInfo.display || (change?.path ?? "");
    $: pathTooltip = mainPathInfo.tooltip || (change?.path ?? "");
    $: renamePathDisplay =
        change?.kind?.type === "update" && change.kind.move_path
            ? relativizeToWorkspace(change.kind.move_path).display
            : null;
    $: if (renderer === "pierre" && isExpanded && hasDiffContent && !isBinary) {
        void ensurePierreRenderer();
    }

    async function openFileTabForFile(event: MouseEvent | KeyboardEvent) {
        event.stopPropagation();
        event.preventDefault();
        const preferredPath =
            change?.kind?.type === "update" && change.kind.move_path
                ? change.kind.move_path
                : change?.path;
        const resolvedPath = resolveAbsoluteWorkspacePath(preferredPath ?? change?.path);
        if (!resolvedPath) return;

        try {
            const scrollToLine = typeof firstChangeLine === "number" ? firstChangeLine + 1 : 1;
            await openFileAtLine(resolvedPath, scrollToLine, 1);
        } catch (error) {
            console.warn("[FileDiffViewer] Failed to open file tab", {
                error,
                path: resolvedPath,
            });
        }
    }

    function handleOpenIconKeydown(event: KeyboardEvent) {
        if (event.key !== "Enter" && event.key !== " ") return;
        void openFileTabForFile(event);
    }
</script>

<div class="file-diff" data-expanded={isExpanded} data-tone={tone}>
    {#if showHeader}
        <button
            class="file-diff-header"
            class:expanded={isExpanded}
            data-tone={tone}
            type="button"
            on:click={toggle}
            aria-expanded={isExpanded}
            style={`margin-top: ${Math.max(topGap, 0)}px`}
        >
            <div class="file-meta">
                {#if showStatusLabel}
                    <span class={`change-label ${getChangeKindClass(change?.kind)}`}>
                        {getChangeKindLabel(change?.kind)}
                    </span>
                {/if}
                <span class="file-path" title={pathTooltip}>{displayPath}</span>
                {#if change?.kind?.type === "update" && change?.kind?.move_path}
                    <span class="file-rename">-> {renamePathDisplay}</span>
                {/if}
                <div class="file-stats">
                    <span class="additions">+{stats.additions}</span>
                    <span class="deletions">-{stats.deletions}</span>
                </div>
            </div>
            <div class="file-chevron">
                <span
                    class="open-diff-tab-icon"
                    role="button"
                    tabindex="0"
                    title="在 tab 中打开文件"
                    on:click|stopPropagation|preventDefault={openFileTabForFile}
                    on:keydown|stopPropagation={handleOpenIconKeydown}
                >
                    <ExternalLink size="1em" class="open-diff-icon" />
                </span>
                <svelte:component
                    this={isExpanded ? ChevronDown : ChevronRight}
                    size="1em"
                    class="file-chevron-icon"
                />
            </div>
        </button>
    {:else}
        <div style={`margin-top: ${Math.max(topGap, 0)}px`}></div>
    {/if}
    {#if isExpanded}
        {#if isBinary}
            <div class="diff-message" data-tone={tone} data-headless={!showHeader}>
                Binary changes are not supported for inline preview.
            </div>
        {:else if renderer === "pierre" && hasDiffContent}
            {#if PierreDiffRendererComponent}
                <svelte:component
                    this={PierreDiffRendererComponent}
                    {change}
                    {displayPath}
                    {diffStyle}
                    maxHeight={maxDiffHeight}
                    headless={!showHeader}
                    {tone}
                />
            {:else}
                <div class="diff-message" data-tone={tone} data-headless={!showHeader}>
                    Loading diff preview...
                </div>
            {/if}
        {:else if hasRenderableDiff}
            <div
                class="diff-panel"
                data-tone={tone}
                data-headless={!showHeader}
                style:max-height={maxDiffHeight ?? undefined}
            >
                <div class="inline-diff">
                    {#each parsed.lines as line, index (index)}
                        <div class="diff-row" data-kind={line.kind}>
                            <div class="diff-gutter" style={`width: ${gutterCh}ch`}>
                                <span class="line-number">
                                    {line.lineNumber ?? ""}
                                </span>
                            </div>
                            {#if line.kind === "hunk-separator"}
                                <div class="diff-content hunk">
                                    <span class="hunk-marker">...</span>
                                </div>
                            {:else}
                                <div class="diff-content">
                                    <span class="diff-sign">
                                        {line.kind === "insert" ? "+" : line.kind === "delete" ? "-" : " "}
                                    </span>
                                    <span class="diff-code">
                                        {line.text}
                                    </span>
                                </div>
                            {/if}
                        </div>
                    {/each}
                </div>
            </div>
        {:else if showRaw}
            <pre class="diff-raw" data-tone={tone} data-headless={!showHeader}>{change.diff}</pre>
        {:else}
            <div class="diff-message" data-tone={tone} data-headless={!showHeader}>
                No diff content available.
            </div>
        {/if}
    {/if}
</div>

<style>
    .file-diff {
        display: contents;
    }

    .file-diff-header {
        width: 100%;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding: 0 8px;
        min-height: 32px;
        background: transparent;
        border: none;
        border-radius: 4px;
        color: inherit;
        cursor: pointer;
        transition: background 0.15s ease;
    }

    .file-diff-header.expanded {
        border-bottom-left-radius: 0;
        border-bottom-right-radius: 0;
    }

    .file-diff-header:hover {
        background: rgba(255, 255, 255, 0.02);
    }

    :global(html[data-theme="light"]) .file-diff-header:hover {
        background: rgba(15, 23, 42, 0.04);
        box-shadow:
            inset 0 0 0 1px rgba(15, 23, 42, 0.08),
            0 2px 6px rgba(15, 23, 42, 0.08);
    }

    .file-diff-header[data-tone="overlay"] {
        background: rgba(9, 10, 12, 0.7);
        border-color: rgba(255, 255, 255, 0.1);
    }

    :global(html[data-theme="light"]) .file-diff-header {
        background: transparent;
    }

    .file-meta {
        display: flex;
        align-items: center;
        gap: 10px;
        flex: 1;
        min-width: 0;
    }

    .file-path {
        font-family: var(--font-mono, "IBM Plex Mono", Consolas, monospace);
        font-size: 12px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        color: var(--text-primary, #f3f4f6);
    }

    :global(html[data-theme="light"]) .file-path {
        color: #0f172a;
    }

    .file-rename {
        font-size: 12px;
        color: var(--text-secondary, #a1a1aa);
    }

    .file-stats {
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: 12px;
        font-weight: 600;
        text-transform: uppercase;
        margin-left: 8px;
        flex-shrink: 0;
    }

    .file-stats .additions {
        color: #16a34a;
    }

    .file-stats .deletions {
        color: #dc2626;
    }

    .file-chevron {
        display: flex;
        align-items: center;
        flex-shrink: 0;
        color: var(--text-secondary, #a1a1aa);
        gap: 6px;
        font-size: calc(var(--ai-font-size, 14px) - 2px);
    }

    .open-diff-tab-icon {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: 4px;
        border-radius: 4px;
        border: none;
        background: transparent;
        cursor: pointer;
        color: var(--text-secondary, #aaa);
    }

    .open-diff-icon,
    .file-chevron-icon {
        width: 1em;
        height: 1em;
        flex-shrink: 0;
    }

    .open-diff-tab-icon:hover {
        background: rgba(148, 163, 184, 0.12);
        color: var(--text-primary, #fff);
    }

    .change-label {
        font-size: 10px;
        font-weight: 700;
        padding: 2px 6px;
        border-radius: 6px;
        border: 1px solid transparent;
        letter-spacing: 0.05em;
    }

    .pill-add {
        color: #047857;
        border-color: rgba(16, 185, 129, 0.4);
        background: rgba(16, 185, 129, 0.16);
    }

    .pill-delete {
        color: #b91c1c;
        border-color: rgba(248, 113, 113, 0.3);
        background: rgba(248, 113, 113, 0.15);
    }

    .pill-update {
        color: #2563eb;
        border-color: rgba(59, 130, 246, 0.4);
        background: rgba(59, 130, 246, 0.16);
    }

    .pill-rename {
        color: #b45309;
        border-color: rgba(251, 191, 36, 0.45);
        background: rgba(251, 191, 36, 0.2);
    }

    .diff-panel {
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 12px;
        background: rgba(13, 14, 19, 0.9);
        overflow: auto;
        display: flex;
        flex-direction: column;
        min-width: 0;
    }

    :global(.view-all-tab) .diff-panel {
        max-height: none;
        overflow-y: visible;
        overflow-x: auto;
    }

    .diff-panel[data-headless="false"] {
        border-top: none;
        border-top-left-radius: 0;
        border-top-right-radius: 0;
    }

    .diff-panel[data-tone="overlay"] {
        background: rgba(0, 0, 0, 0.8);
    }

    :global(html[data-theme="light"]) .diff-panel {
        border-color: rgba(15, 23, 42, 0.08);
        background: #ffffff;
    }

    .inline-diff {
        font-family: var(--monospace-font, "Consolas", "Monaco", monospace);
        font-size: 12px;
        line-height: 1.5;
        max-height: 100%;
        min-width: 100%;
    }

    .diff-row {
        display: flex;
        align-items: stretch;
        white-space: pre;
        min-width: max-content;
    }

    .diff-gutter {
        flex: 0 0 auto;
        padding: 0 6px;
        text-align: right;
        color: rgba(148, 163, 184, 0.8);
        border-right: 1px solid rgba(148, 163, 184, 0.16);
        background: rgba(15, 23, 42, 0.9);
        flex-shrink: 0;
    }

    .line-number {
        display: inline-block;
        min-width: 0;
    }

    .diff-content {
        flex: 0 0 auto;
        padding: 0 12px;
        display: flex;
        align-items: stretch;
    }

    .diff-row[data-kind="insert"] .diff-content {
        background: rgba(22, 163, 74, 0.12);
    }

    .diff-row[data-kind="delete"] .diff-content {
        background: rgba(220, 38, 38, 0.12);
    }

    .diff-row[data-kind="context"] .diff-content,
    .diff-row[data-kind="hunk-separator"] .diff-content {
        background: transparent;
    }

    :global(html[data-theme="light"]) .diff-gutter {
        background: #f8fafc;
        border-right-color: rgba(148, 163, 184, 0.25);
        color: #64748b;
    }

    :global(html[data-theme="light"]) .diff-row[data-kind="insert"] .diff-content {
        background: #e6ffed;
    }

    :global(html[data-theme="light"]) .diff-row[data-kind="delete"] .diff-content {
        background: #ffeef0;
    }

    .diff-sign {
        flex: 0 0 16px;
        color: rgba(148, 163, 184, 0.9);
    }

    .diff-row[data-kind="insert"] .diff-sign,
    .diff-row[data-kind="insert"] .line-number {
        color: #16a34a;
    }

    .diff-row[data-kind="delete"] .diff-sign,
    .diff-row[data-kind="delete"] .line-number {
        color: #dc2626;
    }

    .diff-code {
        flex: 1;
    }

    .hunk-marker {
        opacity: 0.7;
        color: rgba(148, 163, 184, 0.9);
    }

    .diff-raw {
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 12px;
        margin: 0;
        padding: 12px;
        font-size: 12px;
        background: rgba(13, 14, 19, 0.9);
        color: var(--text-primary, #f3f4f6);
        overflow: auto;
    }

    .diff-raw[data-headless="false"] {
        border-top: none;
        border-top-left-radius: 0;
        border-top-right-radius: 0;
    }

    .diff-raw[data-tone="overlay"] {
        background: rgba(0, 0, 0, 0.82);
    }

    :global(html[data-theme="light"]) .diff-raw {
        background: #ffffff;
        border-color: rgba(15, 23, 42, 0.08);
        color: #0f172a;
    }

    .diff-message {
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 12px;
        padding: 14px;
        font-size: 12px;
        background: rgba(13, 14, 19, 0.9);
        color: var(--text-secondary, #9ca3af);
    }

    .diff-message[data-headless="false"] {
        border-top: none;
        border-top-left-radius: 0;
        border-top-right-radius: 0;
    }

    .diff-message[data-tone="overlay"] {
        background: rgba(0, 0, 0, 0.82);
    }

    :global(html[data-theme="light"]) .diff-message {
        border-color: rgba(15, 23, 42, 0.08);
        background: #ffffff;
        color: #475569;
    }
</style>
