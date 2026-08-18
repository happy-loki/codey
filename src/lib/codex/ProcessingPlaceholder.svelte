<script lang="ts">
    import { Loader2 } from "lucide-svelte";
    import MarkdownRenderer from "./MarkdownRenderer.svelte";

    export let header: string | null = null;
    export let pinned: boolean = true;
    export let elapsedSeconds: number | null = null;

    const sanitize = (value: string | undefined | null) => value?.trim() ?? "";
    $: headerText = sanitize(header);
    $: hasHeader = headerText.length > 0;
    $: elapsedText =
        elapsedSeconds == null || elapsedSeconds < 1
            ? null
            : elapsedSeconds < 60
              ? `${elapsedSeconds}s`
              : elapsedSeconds < 3600
                ? `${Math.floor(elapsedSeconds / 60)}m ${elapsedSeconds % 60}s`
                : `${Math.floor(elapsedSeconds / 3600)}h ${Math.floor((elapsedSeconds % 3600) / 60)}m`;
</script>

<div
    class="processing-placeholder"
    class:pinned={pinned}
    class:unpinned={!pinned}
>
    <Loader2 class="spinner" />
    <div class="summary-container" aria-live="polite">
        {#if hasHeader}
            <div class="summary-line glow-text summary-header">
                <MarkdownRenderer content={`**${headerText}**`} plain />
                {#if elapsedText}
                    <span class="summary-elapsed">({elapsedText})</span>
                {/if}
            </div>
        {:else}
            <div class="summary-line glow-text summary-header">
                <MarkdownRenderer content="Processing" plain />
                {#if elapsedText}
                    <span class="summary-elapsed">({elapsedText})</span>
                {/if}
            </div>
        {/if}
    </div>
</div>

<style>
    .processing-placeholder {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px 12px;
        margin-bottom: 12px;
        color: var(--text-secondary, #9b9b9b);
        font-size: 13px;
        font-weight: 400;
        min-height: 20px;
        background: var(--sheet-surface, transparent);
        transition: background 160ms ease, box-shadow 160ms ease, opacity 160ms ease;
    }

    .processing-placeholder.pinned {
        position: sticky;
        bottom: 0;
        padding-left: 12px;
        z-index: 1;
    }

    .processing-placeholder.unpinned {
        position: static;
        margin: 16px 0;
        border-radius: 10px;
        background: rgba(20, 20, 20, 0.75);
        box-shadow: 0 6px 18px rgba(0, 0, 0, 0.35);
        opacity: 0.9;
        z-index: 0;
    }

    :global(html[data-theme="light"]) .processing-placeholder.unpinned {
        background: rgba(255, 255, 255, 0.85);
        box-shadow: 0 4px 10px rgba(15, 23, 42, 0.15);
        color: var(--text-secondary, #4f4f4f);
    }

    .summary-line :global(.markdown-wrapper) {
        margin: 0;
    }

    .summary-line :global(.markdown-content) {
        color: inherit;
        font-size: inherit;
        line-height: inherit;
    }

    .summary-line :global(p) {
        margin: 0;
        display: inline;
    }

    .processing-placeholder :global(.spinner) {
        animation: spin 1s linear infinite;
        flex-shrink: 0;
        opacity: 0.7;
        margin-top: 2px;
        width: var(--ai-font-size, 14px);
        height: var(--ai-font-size, 14px);
    }

    .summary-container {
        display: flex;
        flex-direction: column;
        gap: 2px;
        flex: 1;
        min-height: 20px;
        justify-content: center;
    }

    .summary-line {
        margin: 0;
        line-height: 18px;
        min-height: 18px;
        color: var(--text-secondary, #d1d1d1);
        position: relative;
        display: flex;
        align-items: center;
    }

    .glow-text {
        text-shadow: none;
    }

    .summary-header {
        font-weight: 600;
        gap: 6px;
    }

    .summary-elapsed {
        color: var(--text-secondary, #9ca3af);
        font-weight: 500;
        opacity: 0.86;
        white-space: nowrap;
    }

    @keyframes spin {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
    }

</style>
