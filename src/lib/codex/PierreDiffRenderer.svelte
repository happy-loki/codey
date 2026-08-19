<script lang="ts">
    import { onDestroy, onMount, tick } from "svelte";
    import {
        FileDiff,
        parsePatchFiles,
        type FileContents,
        type FileDiffMetadata,
        type FileDiffOptions,
        type ThemeTypes,
    } from "@pierre/diffs";
    import { getOrCreateWorkerPoolSingleton } from "@pierre/diffs/worker";
    import type { FileUpdateChange } from "./types";
    import { normalizeDiffNewlines } from "./diffUtils";
    import { workerFactory } from "./pierreDiffWorker";

    export let change: FileUpdateChange;
    export let displayPath = "";
    export let diffStyle: "unified" | "split" = "unified";
    export let maxHeight: string | null = "150px";
    export let headless = false;
    export let tone: "default" | "overlay" = "default";

    let host: HTMLDivElement;
    let fileContainer: HTMLElement | null = null;
    let diffInstance: FileDiff | null = null;
    let observer: MutationObserver | null = null;
    let mounted = false;

    const MOVE_TRAILER_PATTERN = /\n{2,}Moved to: .+$/s;
    const PATCH_FILE_HEADER_PATTERN = /^(?:diff --git |--- |\+\+\+ )/m;
    const HUNK_HEADER_PATTERN = /^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@/m;

    const DIFF_VIEWER_SCROLL_CSS = `
[data-gutter-buffer='buffer'],
[data-content-buffer] {
  background-image: none !important;
}
`;

    const pool = getOrCreateWorkerPoolSingleton({
        poolOptions: {
            workerFactory,
            poolSize: 2,
        },
        highlighterOptions: {
            theme: { dark: "github-dark", light: "github-light" },
        },
    });

    function normalizePatchName(name: string | null | undefined): string {
        return (name ?? "").replace(/^(?:a|b)\//, "");
    }

    function splitContentLines(content: string): string[] {
        if (!content) return [];
        const lines = normalizeDiffNewlines(content).split("\n");
        if (lines[lines.length - 1] === "") {
            lines.pop();
        }
        return lines;
    }

    function createWholeFileDiffMetadata(
        path: string,
        kind: "add" | "delete",
        content: string
    ): FileDiffMetadata {
        const lines = splitContentLines(content);
        const lineCount = lines.length;
        const hunkContent =
            lineCount > 0
                ? [
                      kind === "add"
                          ? {
                                type: "change" as const,
                                deletions: 0,
                                deletionLineIndex: 0,
                                additions: lineCount,
                                additionLineIndex: 0,
                            }
                          : {
                                type: "change" as const,
                                deletions: lineCount,
                                deletionLineIndex: 0,
                                additions: 0,
                                additionLineIndex: 0,
                            },
                  ]
                : [];

        return {
            name: path,
            type: kind === "add" ? "new" : "deleted",
            hunks:
                lineCount > 0
                    ? [
                          {
                              collapsedBefore: 0,
                              additionStart: 1,
                              additionCount: kind === "add" ? lineCount : 0,
                              additionLines: kind === "add" ? lineCount : 0,
                              additionLineIndex: 0,
                              deletionStart: 1,
                              deletionCount: kind === "delete" ? lineCount : 0,
                              deletionLines: kind === "delete" ? lineCount : 0,
                              deletionLineIndex: 0,
                              hunkContent,
                              hunkSpecs:
                                  kind === "add"
                                      ? `@@ -0,0 +1,${lineCount} @@`
                                      : `@@ -1,${lineCount} +0,0 @@`,
                              splitLineStart: 0,
                              splitLineCount: lineCount,
                              unifiedLineStart: 0,
                              unifiedLineCount: lineCount,
                              noEOFCRDeletions: false,
                              noEOFCRAdditions: false,
                          },
                      ]
                    : [],
            splitLineCount: lineCount,
            unifiedLineCount: lineCount,
            isPartial: true,
            deletionLines: kind === "delete" ? lines : [],
            additionLines: kind === "add" ? lines : [],
            cacheKey: `${kind}:${path}:${content.length}:${content}`,
        };
    }

    function buildFileContents(name: string, contents: string): FileContents {
        return {
            name,
            contents: normalizeDiffNewlines(contents),
            cacheKey: `contents:${name}:${contents.length}:${contents}`,
        };
    }

    function stripCodexMoveTrailer(diff: string): string {
        return diff.replace(MOVE_TRAILER_PATTERN, "");
    }

    function patchTextCandidates(diff: string, path: string): string[] {
        const patchText = stripCodexMoveTrailer(diff);
        if (!patchText.trim()) return [];

        const candidates = [patchText];
        if (!PATCH_FILE_HEADER_PATTERN.test(patchText) && HUNK_HEADER_PATTERN.test(patchText)) {
            candidates.push(`--- ${path}\n+++ ${path}\n${patchText}`);
        }

        return candidates;
    }

    function normalizeFileDiffMetadata(parsed: FileDiffMetadata, path: string): FileDiffMetadata {
        const name = normalizePatchName(parsed.name || path) || path;
        const prevName = parsed.prevName ? normalizePatchName(parsed.prevName) : undefined;
        const sameNameAfterNormalization = prevName !== undefined && prevName === name;

        return {
            ...parsed,
            name,
            prevName: sameNameAfterNormalization ? undefined : prevName,
            type: sameNameAfterNormalization ? "change" : parsed.type,
        };
    }

    function parsedPatchFile(diff: string, path: string): FileDiffMetadata | null {
        for (const patchText of patchTextCandidates(diff, path)) {
            const patch = parsePatchFiles(patchText);
            const parsed = patch[0]?.files[0];
            if (parsed) return normalizeFileDiffMetadata(parsed, path);
        }

        return null;
    }

    function renderRawFallback(rawDiff: string) {
        diffInstance?.cleanUp();
        diffInstance = null;
        fileContainer = null;

        const raw = document.createElement("pre");
        raw.className = "pierre-diff-raw";
        raw.textContent = rawDiff;
        host.replaceChildren(raw);
    }

    function resolveThemeType(): ThemeTypes {
        if (typeof document === "undefined") return "system";
        return document.documentElement.dataset.theme === "light" ? "light" : "dark";
    }

    function buildOptions(): FileDiffOptions<undefined> {
        return {
            diffStyle,
            hunkSeparators: "line-info",
            overflow: "scroll",
            unsafeCSS: DIFF_VIEWER_SCROLL_CSS,
            disableFileHeader: true,
            theme: { dark: "github-dark", light: "github-light" },
            themeType: resolveThemeType(),
            lineDiffType: "word-alt",
        };
    }

    function renderDiff() {
        if (!mounted || !host || !change) return;

        const path = displayPath || change.path || "diff";
        const diff = normalizeDiffNewlines(change.diff);

        if (!fileContainer) {
            fileContainer = document.createElement("diffs-container");
            fileContainer.classList.add("pierre-diff-container");
            host.replaceChildren(fileContainer);
        }

        if (!diffInstance) {
            diffInstance = new FileDiff(buildOptions(), pool, true);
        } else {
            diffInstance.setOptions(buildOptions());
        }

        if (change.kind?.type === "add") {
            diffInstance.render({
                oldFile: buildFileContents(path, ""),
                newFile: buildFileContents(path, diff),
                forceRender: true,
                fileContainer,
            });
            return;
        }

        if (change.kind?.type === "delete") {
            diffInstance.render({
                oldFile: buildFileContents(path, diff),
                newFile: buildFileContents(path, ""),
                forceRender: true,
                fileContainer,
            });
            return;
        }

        const fileDiff = parsedPatchFile(diff, path);
        if (fileDiff) {
            diffInstance.render({
                fileDiff,
                forceRender: true,
                fileContainer,
            });
            return;
        }

        renderRawFallback(stripCodexMoveTrailer(diff));
    }

    onMount(() => {
        mounted = true;
        observer = new MutationObserver(() => {
            diffInstance?.setThemeType(resolveThemeType());
        });
        observer.observe(document.documentElement, {
            attributes: true,
            attributeFilter: ["data-theme"],
        });
        void tick().then(renderDiff);
    });

    onDestroy(() => {
        observer?.disconnect();
        diffInstance?.cleanUp();
        diffInstance = null;
        fileContainer = null;
        mounted = false;
    });

    $: if (mounted && change) {
        change;
        displayPath;
        diffStyle;
        void tick().then(renderDiff);
    }
</script>

<div
    class="pierre-diff-host"
    class:headless
    data-tone={tone}
    style:max-height={maxHeight ?? undefined}
    bind:this={host}
/>

<style>
    .pierre-diff-host {
        --codey-diff-bg-dark: rgba(13, 14, 19, 0.94);
        --codey-diff-bg-light: #ffffff;
        width: 100%;
        min-width: 0;
        overflow: auto;
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 12px;
        background: var(--codey-diff-bg-dark);
    }

    .pierre-diff-host.headless {
        border-top: none;
        border-top-left-radius: 0;
        border-top-right-radius: 0;
    }

    .pierre-diff-host[data-tone="overlay"] {
        --codey-diff-bg-dark: rgba(0, 0, 0, 0.84);
        background: var(--codey-diff-bg-dark);
    }

    :global(html[data-theme="light"]) .pierre-diff-host {
        --codey-diff-bg-light: #ffffff;
        background: var(--codey-diff-bg-light);
        border-color: rgba(15, 23, 42, 0.08);
    }

    :global(.view-all-tab) .pierre-diff-host {
        max-height: none !important;
        overflow-y: visible;
        overflow-x: auto;
    }

    :global(.pierre-diff-container) {
        display: block;
        width: 100%;
        min-width: 0;
        font-size: 12px;
        line-height: 18px;
        --diffs-light-bg: var(--codey-diff-bg-light);
        --diffs-dark-bg: var(--codey-diff-bg-dark);
        --diffs-font-size: 12px;
        --diffs-line-height: 18px;
        --diffs-font-family: var(--monospace-font, "Consolas", "Monaco", monospace);
        --diffs-header-font-family: var(--font-sans, system-ui, sans-serif);
        --diffs-gap-block: 4px;
        --diffs-gap-inline: 6px;
        --diffs-tab-size: 4;
    }

    :global(.pierre-diff-raw) {
        margin: 0;
        padding: 10px 12px;
        min-width: max-content;
        font-family: var(--monospace-font, "Consolas", "Monaco", monospace);
        font-size: 12px;
        line-height: 18px;
        color: var(--text-primary, #f3f4f6);
        white-space: pre;
        background: transparent;
    }

    :global(html[data-theme="light"]) :global(.pierre-diff-raw) {
        color: #0f172a;
    }
</style>
