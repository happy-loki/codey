<script lang="ts">
    import MultiFileDiffView from "./MultiFileDiffView.svelte";
    import MultiFileSideBySideDiffView from "./MultiFileSideBySideDiffView.svelte";
    import type { FileUpdateChange } from "./types";
    import {
        buildFileChangeSummaryFromChanges,
        type FileChangeSummaryEntry,
    } from "./fileChangeSummaryUtils";

    export let sessionId: string;
    export let title: string = "View all changes";
    export let changes: FileUpdateChange[] = [];
    export let hidden: boolean = false;

    let diffMode: "inline" | "sideBySide" = "inline";

    $: summaryEntries = buildFileChangeSummaryFromChanges(changes) as FileChangeSummaryEntry[];
    $: totals = summaryEntries.reduce(
        (acc, entry) => ({
            added: acc.added + (entry.additions || 0),
            deleted: acc.deleted + (entry.deletions || 0),
        }),
        { added: 0, deleted: 0 }
    );
    $: fileCount =
        summaryEntries.length > 0 ? summaryEntries.length : changes.length;
</script>

<div class="view-all-tab" data-session={sessionId} data-title={title} hidden={hidden}>
    <header class="view-all-header">
        <div class="summary-title">
            {#if fileCount === 0}
                <span>No file changes</span>
            {:else}
                <span>
                    {fileCount === 1 ? "1 file changed" : `${fileCount} files changed`}
                </span>
                <span class="summary-counts">
                    <span class="summary-add">+{totals.added}</span>
                    <span class="summary-del">-{totals.deleted}</span>
                </span>
            {/if}
        </div>
        <div class="header-actions">
            <div class="mode-toggle" aria-label="Diff view mode">
                <button
                    type="button"
                    class:selected={diffMode === "inline"}
                    on:click={() => (diffMode = "inline")}
                    title="Inline diff view"
                    aria-label="Inline diff view"
                >
                    <svg
                        class="mode-icon"
                        viewBox="0 0 16 16"
                        aria-hidden="true"
                    >
                        <!-- outer frame -->
                        <rect
                            x="1.5"
                            y="2"
                            width="13"
                            height="12"
                            rx="2"
                            ry="2"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="1"
                        />
                        <!-- top diff stripe -->
                        <rect
                            x="2.5"
                            y="3"
                            width="11"
                            height="3"
                            rx="1"
                            fill="#22c55e"
                        />
                        <!-- body area -->
                        <rect
                            x="2.5"
                            y="6.5"
                            width="11"
                            height="5.5"
                            rx="1"
                            fill="#dc2626"
                            opacity="0.9"
                        />
                    </svg>
                </button>
                <button
                    type="button"
                    class:selected={diffMode === "sideBySide"}
                    on:click={() => (diffMode = "sideBySide")}
                    title="Side-by-side diff view"
                    aria-label="Side-by-side diff view"
                >
                    <svg
                        class="mode-icon"
                        viewBox="0 0 16 16"
                        aria-hidden="true"
                    >
                        <!-- outer frame -->
                        <rect
                            x="1.5"
                            y="2"
                            width="13"
                            height="12"
                            rx="2"
                            ry="2"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="1"
                        />
                        <!-- left pane (deletions) -->
                        <rect
                            x="2.5"
                            y="3"
                            width="5"
                            height="9"
                            rx="1"
                            fill="#dc2626"
                            opacity="0.95"
                        />
                        <!-- right pane (additions) -->
                        <rect
                            x="8.5"
                            y="3"
                            width="5"
                            height="9"
                            rx="1"
                            fill="#22c55e"
                        />
                    </svg>
                </button>
            </div>
        </div>
    </header>

    <section class="view-all-body">
        {#if changes.length === 0}
            <div class="empty-state">No file changes to display.</div>
        {:else}
            {#if diffMode === "inline"}
                <MultiFileDiffView
                    {changes}
                    tone="default"
                    defaultExpanded={true}
                    showStatusLabel={true}
                    renderer="pierre"
                />
            {:else}
                <MultiFileSideBySideDiffView {changes} />
            {/if}
        {/if}
    </section>
</div>

<style>
    .view-all-tab {
        display: flex;
        flex-direction: column;
        height: 100%;
        width: 100%;
        min-height: 0;
    }

    .view-all-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 6px 10px;
        border-bottom: 1px solid rgba(148, 163, 184, 0.35);
        background: radial-gradient(circle at top, rgba(15, 23, 42, 0.95), rgba(15, 23, 42, 0.98));
    }

    :global(html[data-theme="light"]) .view-all-header {
        background: #f9fafb;
        border-bottom-color: rgba(148, 163, 184, 0.35);
    }

    .summary-title {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 13px;
        font-weight: 500;
        color: var(--text-primary, #e5e7eb);
    }

    :global(html[data-theme="light"]) .summary-title {
        color: #0f172a;
    }

    .summary-counts {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        font-size: 12px;
        font-family: var(--font-mono, "IBM Plex Mono", Consolas, monospace);
    }

    .summary-add {
        color: #22c55e;
    }

    .summary-del {
        color: #f97373;
    }

    .header-actions {
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: 12px;
        color: var(--text-secondary, #9ca3af);
    }

    .mode-toggle {
        display: inline-flex;
        border-radius: 999px;
        border: 1px solid rgba(148, 163, 184, 0.45);
        overflow: hidden;
        background: rgba(15, 23, 42, 0.8);
    }

    :global(html[data-theme="light"]) .mode-toggle {
        background: #e5e7eb;
        border-color: rgba(148, 163, 184, 0.6);
    }

    .mode-toggle button {
        border: none;
        background: transparent;
        color: var(--text-secondary, #9ca3af);
        padding: 3px 6px;
        font-size: 11px;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
    }

    .mode-toggle button.selected {
        background: rgba(148, 163, 184, 0.25);
        color: var(--text-primary, #e5e7eb);
    }

    :global(html[data-theme="light"]) .mode-toggle button.selected {
        background: #ffffff;
        color: #111827;
    }

    .mode-icon {
        width: 13px;
        height: 13px;
        fill: currentColor;
    }

    .view-all-body {
        flex: 1;
        min-height: 0;
        overflow: auto;
        padding: 8px 10px;
    }

    .empty-state {
        padding: 10px;
        font-size: 13px;
        color: var(--text-secondary, #9ca3af);
    }
</style>
