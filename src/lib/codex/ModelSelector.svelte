<script lang="ts">
    import { onDestroy } from "svelte";
    import { createEventDispatcher } from "svelte";
    import { t } from "../i18n";
    import { Boxes } from "lucide-svelte";

    export let models: Array<{
        id: string;
        name: string;
        slug?: string;
        displayName?: string;
        provider: string | null;
    }> = [];
    export let selectedModel: string | null = null;
    export let disabled = false;

    const dispatch = createEventDispatcher<{ open: void }>();

    let isOpen = false;
    let rootEl: HTMLDivElement | null = null;

    function handleDocumentPointerDown(event: PointerEvent) {
        if (!isOpen || !rootEl) return;
        const target = event.target as Node | null;
        if (target && rootEl.contains(target)) return;
        isOpen = false;
    }

    if (typeof window !== "undefined") {
        window.addEventListener("pointerdown", handleDocumentPointerDown, true);
    }

    onDestroy(() => {
        if (typeof window !== "undefined") {
            window.removeEventListener("pointerdown", handleDocumentPointerDown, true);
        }
    });

    $: currentModel =
        (selectedModel && models.find((m) => m.id === selectedModel)) || models[0] || null;

    function toggleDropdown() {
        if (disabled || !models.length) return;
        const next = !isOpen;
        isOpen = next;
        if (next) {
            dispatch("open");
        }
    }

    function selectModel(id: string) {
        selectedModel = id;
        isOpen = false;
    }

    function formatDropdownLabel(model: {
        name: string;
        slug?: string;
        displayName?: string;
        provider: string | null;
    }) {
        const displayName = (model.displayName || model.name || "").trim();
        const slug = (model.slug || "").trim();
        return displayName || slug;
    }

    function formatSelectedLabel(model: {
        name: string;
        slug?: string;
        displayName?: string;
        provider: string | null;
    }) {
        const slug = (model.slug || "").trim();
        const displayName = (model.displayName || model.name || "").trim();
        return slug || displayName;
    }
</script>

<div class="model-selector" bind:this={rootEl}>
    <button
        class="model-button"
        on:click={toggleDropdown}
        disabled={disabled || !models.length}
        title={currentModel ? formatSelectedLabel(currentModel) : $t("codex.composer.modelLabel")}
    >
        <Boxes class="model-icon" size="1em" stroke-width="1.5" />
        <span class="model-label">
            {#if currentModel}
                {formatSelectedLabel(currentModel)}
            {:else}
                {$t("codex.composer.modelLabel")}
            {/if}
        </span>
        <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            class="chevron"
            class:open={isOpen}
        >
            <path d="M6 9l6 6 6-6" />
        </svg>
    </button>

    {#if isOpen}
        <div class="model-dropdown">
            {#each models as model (model.id)}
                <button
                    class="model-option"
                    class:selected={selectedModel === model.id}
                    on:click={() => selectModel(model.id)}
                >
                    <span class="option-label">
                        {formatDropdownLabel(model)}{model.provider ? ` (${model.provider})` : ""}
                    </span>
                    {#if selectedModel === model.id}
                        <svg
                            width="16"
                            height="16"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="2"
                        >
                            <path d="M20 6L9 17l-5-5" />
                        </svg>
                    {/if}
                </button>
            {/each}
        </div>
    {/if}
</div>

<style>
    .model-selector {
        position: relative;
    }

    .model-button {
        display: flex;
        align-items: center;
        gap: 4px;
        padding: 4px 8px;
        background: var(--bg-secondary, #252525);
        border: 1px solid transparent;
        border-radius: 4px;
        color: var(--text-primary, #fff);
        cursor: pointer;
        font-size: var(--header-compact-font-size, 12px);
        transition: all 0.2s;
        max-width: 210px;
    }

    .model-button:hover:not(:disabled),
    .model-button:focus-visible {
        background: var(--bg-hover, #2a2a2a);
        border-color: var(--accent-color, #007acc);
    }

    .model-button:disabled {
        opacity: 0.5;
        cursor: not-allowed;
    }

    .model-icon {
        flex-shrink: 0;
    }

    .model-label {
        flex: 1;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .chevron {
        transition: transform 0.2s;
        color: var(--text-secondary, #aaa);
        flex-shrink: 0;
    }

    .chevron.open {
        transform: rotate(180deg);
    }

    .model-dropdown {
        position: absolute;
        bottom: calc(100% + 4px);
        left: 0;
        min-width: 220px;
        background: var(--bg-secondary, #252525);
        border: 1px solid var(--border-color, #333);
        border-radius: 6px;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
        z-index: 1000;
        overflow: hidden;
        animation: slideDown 0.15s ease-out;
    }

    @keyframes slideDown {
        from {
            opacity: 0;
            transform: translateY(-8px);
        }
        to {
            opacity: 1;
            transform: translateY(0);
        }
    }

    .model-option {
        width: 100%;
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 6px 10px;
        background: transparent;
        border: none;
        color: var(--text-primary, #fff);
        cursor: pointer;
        transition: background 0.15s;
        text-align: left;
        font-size: var(--header-compact-font-size, 12px);
    }

    .model-option:hover {
        background: var(--bg-hover, #2a2a2a);
    }

    .model-option.selected {
        background: rgba(0, 122, 204, 0.1);
    }

    .option-label {
        font-size: 1em;
        font-weight: 500;
        color: var(--text-primary, #fff);
    }

</style>
