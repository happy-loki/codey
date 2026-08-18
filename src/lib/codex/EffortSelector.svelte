<script lang="ts">
    import { onDestroy } from "svelte";
    import { Zap } from "lucide-svelte";

    export type EffortOption = {
        value: string;
        label: string;
    };

    export let options: EffortOption[] = [];
    export let selectedEffort: string = "";
    export let disabled = false;

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

    $: currentOption = options.find((opt) => opt.value === selectedEffort) || null;

    function toggleDropdown() {
        if (disabled || !options.length) return;
        isOpen = !isOpen;
    }

    function selectEffort(value: string) {
        selectedEffort = value;
        isOpen = false;
    }
</script>

<div class="effort-selector" bind:this={rootEl}>
    <button
        class="effort-button"
        on:click={toggleDropdown}
        disabled={disabled || !options.length}
        title={currentOption ? currentOption.label : "Effort"}
    >
        <Zap class="effort-icon" size="1em" stroke-width="1.5" />
        <span class="effort-label">
            {#if currentOption}
                {currentOption.label}
            {:else}
                Effort
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
        <div class="effort-dropdown">
            {#each options as opt (opt.value)}
                <button
                    class="effort-option"
                    class:selected={selectedEffort === opt.value}
                    on:click={() => selectEffort(opt.value)}
                >
                    <span class="option-label">{opt.label}</span>
                    {#if selectedEffort === opt.value}
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
    .effort-selector {
        position: relative;
    }

    .effort-button {
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
        max-width: 140px;
    }

    .effort-button:hover:not(:disabled),
    .effort-button:focus-visible {
        background: var(--bg-hover, #2a2a2a);
        border-color: var(--accent-color, #007acc);
    }

    .effort-button:disabled {
        opacity: 0.5;
        cursor: not-allowed;
    }

    .effort-icon {
        flex-shrink: 0;
    }

    .effort-label {
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

    .effort-dropdown {
        position: absolute;
        bottom: calc(100% + 4px);
        left: 0;
        min-width: 160px;
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

    .effort-option {
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

    .effort-option:hover {
        background: var(--bg-hover, #2a2a2a);
    }

    .effort-option.selected {
        background: rgba(0, 122, 204, 0.1);
    }

    .option-label {
        font-size: 1em;
        font-weight: 500;
        color: var(--text-primary, #fff);
    }

</style>
