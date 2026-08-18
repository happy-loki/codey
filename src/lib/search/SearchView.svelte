<script lang="ts">
    import { ChevronDown, ChevronRight } from "lucide-svelte";
    import { searchState, toggleExpand, setAllExpanded } from "./searchStore";
    import type { SearchFileResult, SearchMatch, SearchSubmatch } from "./searchStore";
    import { openFileAtLine } from "../EditorTabList.svelte";
    import { workingDir } from "../File";

    export let hidden = false;

    $: state = $searchState;
    $: hasResults = state.results.length > 0;
    $: allExpanded = hasResults && state.results.every((file) => state.expanded[file.path] !== false);
    let workspaceRootPath = "";
    $: workspaceRootPath = ($workingDir ?? "").trim();

    function handleToggleAll() {
        setAllExpanded(!allExpanded);
    }

    function handleClose() {
        hidden = true;
    }

    function handleOpenMatch(file: SearchFileResult, match: SearchMatch) {
        void openFileAtLine(file.path, match.line_number, match.column);
    }

    function normalizeSeparators(value: string): string {
        return value.replace(/\\/g, "/");
    }

    function sanitizeRelativePath(value?: string | null): string {
        if (!value) {
            return "";
        }
        let normalized = value.trim();
        if (!normalized) {
            return "";
        }
        normalized = normalizeSeparators(normalized);
        normalized = normalized.replace(/^\.\/+/, "");
        normalized = normalized.replace(/^\/+/u, "");
        return normalized;
    }

    function deriveRelativeFromRoot(filePath?: string): string {
        if (!filePath) {
            return "";
        }
        const normalizedPath = normalizeSeparators(filePath);
        const root = workspaceRootPath ? normalizeSeparators(workspaceRootPath) : "";
        if (!root) {
            return normalizedPath;
        }

        const lowerPath = normalizedPath.toLowerCase();
        const lowerRoot = root.toLowerCase();

        if (lowerPath.startsWith(lowerRoot)) {
            let trimmed = normalizedPath.slice(root.length);
            trimmed = trimmed.replace(/^\/+/u, "");
            return trimmed;
        }
        return normalizedPath;
    }

    function displayPath(file: SearchFileResult): string {
        const fromResult = sanitizeRelativePath(file?.relative_path);
        if (fromResult) {
            return fromResult;
        }
        return deriveRelativeFromRoot(file?.path);
    }

    function segmentsForLine(line: string, submatches: SearchSubmatch[]) {
        if (!Array.isArray(submatches) || submatches.length === 0) {
            return [{ text: line, highlight: false }];
        }
        const segments: { text: string; highlight: boolean }[] = [];
        let cursor = 0;
        for (const sm of submatches) {
            const start = Math.max(0, sm.start ?? 0);
            const end = Math.max(start, sm.end ?? start);
            if (start > cursor) {
                segments.push({ text: line.slice(cursor, start), highlight: false });
            }
            const matchText = sm.text ?? line.slice(start, end);
            if (matchText) {
                segments.push({ text: matchText, highlight: true });
            }
            cursor = end;
        }
        if (cursor < line.length) {
            segments.push({ text: line.slice(cursor), highlight: false });
        }
        if (segments.length === 0) {
            return [{ text: line, highlight: false }];
        }
        return segments;
    }
</script>

<div class="search-panel" class:hidden>


    {#if state.error}
        <div class="status error">{state.error}</div>
    {:else if state.isSearching}
        <div class="status info">Searching workspace…</div>
    {:else if !hasResults && state.query.trim().length > 0}
        <div class="status info">No results found for “{state.query.trim()}”.</div>
    {:else if !hasResults}
        <div class="status placeholder">Open the search dialog (Ctrl+Shift+F) to run a workspace search.</div>
    {/if}

    {#if hasResults}
        <div class="results" role="list">
            {#each state.results as file}
                <section class="file" role="listitem">
                    <header class="file-header" on:click={() => toggleExpand(file.path)}>
                        <button class="chevron" on:click|stopPropagation={() => toggleExpand(file.path)}>
                            {#if state.expanded[file.path] === false}
                                <ChevronRight />
                            {:else}
                                <ChevronDown />
                            {/if}
                        </button>
                        <div class="file-path">
                            <strong>{displayPath(file)}</strong>
                        </div>
                        <span class="match-count">{file.matches.length} match{file.matches.length === 1 ? "" : "es"}</span>
                    </header>
                    {#if state.expanded[file.path] !== false}
                        <ul class="match-list">
                            {#each file.matches as match}
                                <li class="match" on:click={() => handleOpenMatch(file, match)}>
                                    <span class="line-number">{match.line_number}</span>
                                    <span class="line-text">
                                        {#each segmentsForLine(match.line, match.submatches) as segment}
                                            {#if segment.highlight}
                                                <mark>{segment.text}</mark>
                                            {:else}
                                                <span>{segment.text}</span>
                                            {/if}
                                        {/each}
                                    </span>
                                </li>
                            {/each}
                        </ul>
                    {/if}
                </section>
            {/each}
        </div>
    {/if}
</div>

<style>
    .search-panel {
        display: flex;
        flex-direction: column;
        gap: 8px;
        height: 100%;
        padding: 4px 4px 8px;
    }

    .status {
        font-size: 13px;
        padding: 6px 8px;
        border-radius: 4px;
    }
    .status.info {
        background: rgba(79, 134, 239, 0.12);
        color: #2f80ed;
    }
    .status.error {
        background: rgba(208, 2, 27, 0.12);
        color: #d0021b;
    }
    .status.placeholder {
        color: var(--text-muted, #666666);
        font-style: italic;
    }
    .results {
        overflow: auto;
        padding-right: 4px;
        padding-left: 4px;
    }
    /* Light theme styles */
    .file {
        border: 1px solid rgba(0, 0, 0, 0.08);
        border-radius: 6px;
        margin-bottom: 8px;
        background: rgba(255, 255, 255, 0.8);
        overflow: hidden;
    }
    .file-header {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 6px 10px;
        font-size: 13px;
        border-bottom: 1px solid rgba(0, 0, 0, 0.1);
        background: rgba(0, 0, 0, 0.08);
        cursor: pointer;
        user-select: none;
    }
    .file-header:hover {
        background: rgba(0, 0, 0, 0.12);
    }
    .file-path {
        flex: 1;
        display: flex;
        flex-direction: column;
    }
    .match-count {
        font-size: 11px;
        color: var(--text-muted, #6a6a6a);
    }
    .chevron {
        border: none;
        background: transparent;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        padding: 2px;
        color: var(--text-muted, #888888);
    }
    .chevron svg {
        width: 16px;
        height: 16px;
    }
    .match-list {
        list-style: none;
        margin: 0;
        padding: 4px 0;
        max-height: 220px;
        overflow-y: auto;
        background: rgba(255, 255, 255, 0.5);
    }
    .match {
        display: grid;
        grid-template-columns: 52px 1fr;
        gap: 8px;
        align-items: start;
        padding: 4px 10px;
        cursor: pointer;
        font-size: 13px;
        transition: background-color 0.15s ease;
    }
    .match:hover {
        background: rgba(47, 128, 237, 0.08);
    }
    .line-number {
        font-family: monospace;
        text-align: right;
        color: var(--text-muted, #888888);
        font-size: 12px;
    }
    .line-text {
        font-family: monospace;
        white-space: pre-wrap;
        word-break: break-all;
        line-height: 1.4;
    }
    mark {
        background: rgba(255, 193, 7, 0.4);
        color: rgba(0, 0, 0, 0.9);
        padding: 1px 2px;
        border-radius: 2px;
        font-weight: 500;
    }
    .hidden {
        display: none;
    }

    /* Dark theme styles */
    :global(html[data-theme="dark"]) .file {
        border: 1px solid rgba(255, 255, 255, 0.1);
        background: rgba(0, 0, 0, 0.2);
    }
    :global(html[data-theme="dark"]) .file-header {
        border-bottom: 1px solid rgba(255, 255, 255, 0.1);
        background: rgba(0, 0, 0, 0.3);
    }
    :global(html[data-theme="dark"]) .match-list {
        background: rgba(0, 0, 0, 0.1);
    }
    :global(html[data-theme="dark"]) .match:hover {
        background: rgba(59, 130, 246, 0.15);
    }
    :global(html[data-theme="dark"]) mark {
        background: rgba(255, 193, 7, 0.6);
        color: rgba(0, 0, 0, 0.9);
    }
</style>
