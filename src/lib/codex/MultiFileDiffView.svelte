<script lang="ts">
    import FileDiffViewer from "./FileDiffViewer.svelte";
    import type { FileUpdateChange } from "./types";

    export let changes: FileUpdateChange[] = [];
    export let tone: "default" | "overlay" = "default";
    export let defaultExpanded = true;
    export let showStatusLabel = true;
    export let diffStyle: "unified" | "split" = "unified";
    export let maxDiffHeight: string | null = "150px";
    export let renderer: "lightweight" | "pierre" = "lightweight";

    $: parsedChanges = changes.map((change, index) => ({
        change,
        key: `${change.path}::${index}`,
    }));
</script>

{#if parsedChanges.length === 0}
    <div class="multi-diff empty" data-tone={tone}>
        <div class="multi-diff-inner">
            <div class="multi-diff-empty">No file changes</div>
        </div>
    </div>
{:else}
    <div class="multi-diff" data-tone={tone}>
        <div class="multi-diff-inner">
            <div class="multi-diff-list">
                {#each parsedChanges as entry (entry.key)}
                    <div class="multi-diff-item">
                        <FileDiffViewer
                            change={entry.change}
                            {tone}
                            {defaultExpanded}
                            {showStatusLabel}
                            {diffStyle}
                            {maxDiffHeight}
                            {renderer}
                            topGap={0}
                        />
                    </div>
                {/each}
            </div>
        </div>
    </div>
{/if}

<style>
    .multi-diff {
        width: 100%;
    }

    .multi-diff-inner {
        border-radius: 10px;
        border: 1px solid rgba(148, 163, 184, 0.25);
        background: radial-gradient(circle at top, rgba(15, 23, 42, 0.85), rgba(15, 23, 42, 0.94));
        padding: 2px 4px;
        display: flex;
        flex-direction: column;
        gap: 0;
    }

    .multi-diff.empty .multi-diff-inner {
        padding: 8px 10px;
    }

    .multi-diff[data-tone="overlay"] .multi-diff-inner {
        background: rgba(9, 10, 12, 0.9);
    }

    :global(html[data-theme="light"]) .multi-diff-inner {
        background: #ffffff;
        border-color: rgba(148, 163, 184, 0.35);
    }

    .multi-diff-empty {
        font-size: 12px;
        color: var(--text-secondary, #9ca3af);
    }

    .multi-diff-list {
        display: flex;
        flex-direction: column;
        gap: 0;
        margin-top: 0;
    }

    .multi-diff-item {
        border-radius: 6px;
        overflow: hidden;
        background: transparent;
    }

    .multi-diff-item :global(.file-diff-header) {
        padding-left: 4px;
        padding-right: 4px;
    }
</style>
