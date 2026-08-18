<script lang="ts">
    import { ClipboardList, Sparkles } from "lucide-svelte";
    import { t } from "../i18n";
    import type { ModeKind } from "./protocol/generated/ModeKind";

    export let selectedMode: ModeKind = "default";

    type ModeOption = {
        value: ModeKind;
        labelKey: string;
        tipKey: string;
        icon: any;
    };

    const modes: ModeOption[] = [
        {
            value: "default",
            labelKey: "codex.collaborationMode.default",
            tipKey: "codex.collaborationMode.defaultTip",
            icon: Sparkles,
        },
        {
            value: "plan",
            labelKey: "codex.collaborationMode.plan",
            tipKey: "codex.collaborationMode.planTip",
            icon: ClipboardList,
        },
    ];

    let isOpen = false;

    function selectMode(mode: ModeKind) {
        selectedMode = mode;
        isOpen = false;
    }

    function toggleDropdown() {
        isOpen = !isOpen;
    }

    $: currentMode = modes.find((m) => m.value === selectedMode) ?? modes[0];
</script>

<div class="mode-selector">
    <button class="mode-button" on:click={toggleDropdown} title={$t("codex.collaborationMode.tooltip")}>
        {#if currentMode}
            <svelte:component
                this={currentMode.icon}
                class="mode-icon"
                size="1em"
                strokeWidth={1.5}
            />
            <span class="mode-label">{$t(currentMode.labelKey)}</span>
        {/if}
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
        <div class="mode-dropdown">
            {#each modes as mode}
                <button
                    class="mode-option"
                    class:selected={selectedMode === mode.value}
                    on:click={() => selectMode(mode.value)}
                    title={$t(mode.tipKey)}
                >
                    <div class="option-left">
                        <svelte:component
                            this={mode.icon}
                            class="mode-icon"
                            size="1em"
                            strokeWidth={1.5}
                        />
                        <span class="option-label">{$t(mode.labelKey)}</span>
                    </div>
                    {#if selectedMode === mode.value}
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M20 6L9 17l-5-5" />
                        </svg>
                    {/if}
                </button>
            {/each}
        </div>
    {/if}
</div>

{#if isOpen}
    <div class="backdrop" on:click={() => (isOpen = false)} />
{/if}

<style>
    /* Match ApprovalPolicySelector's minimal style to blend into the existing composer controls. */
    .mode-selector {
        position: relative;
    }

    .mode-button {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 4px 10px;
        background: var(--bg-secondary, #252525);
        border: 1px solid transparent;
        border-radius: 4px;
        color: var(--text-primary, #fff);
        cursor: pointer;
        font-size: var(--header-compact-font-size, 12px);
        transition: all 0.2s;
        max-width: 160px;
    }

    .mode-icon {
        flex-shrink: 0;
        stroke-width: 1.5;
        color: var(--text-secondary, #aaa);
    }

    .mode-label {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        min-width: 0;
    }

    .mode-button:hover,
    .mode-button:focus-visible {
        background: var(--bg-hover, #2a2a2a);
        border-color: var(--accent-color, #007acc);
    }

    .mode-button .chevron {
        transition: transform 0.2s;
        color: var(--text-secondary, #aaa);
        flex-shrink: 0;
    }

    .mode-button .chevron.open {
        transform: rotate(180deg);
    }

    .mode-dropdown {
        position: absolute;
        bottom: calc(100% + 4px);
        left: 0;
        min-width: 180px;
        background: var(--bg-secondary, #252525);
        border: 1px solid var(--border-color, #333);
        border-radius: 6px;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.28);
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

    .mode-option {
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

    .mode-option:hover {
        background: var(--bg-hover, #2a2a2a);
    }

    .mode-option.selected {
        background: rgba(0, 122, 204, 0.1);
    }

    .option-left {
        display: flex;
        align-items: center;
        gap: 10px;
        flex: 1;
        min-width: 0;
    }

    .option-label {
        font-size: 1em;
        font-weight: 500;
        color: var(--text-primary, #fff);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .backdrop {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        z-index: 999;
    }
</style>
