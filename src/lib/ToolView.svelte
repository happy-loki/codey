<script lang="ts">
    import { hideBottomPanel } from "./Statusbar.svelte";
    import { Ellipsis, X } from "lucide-svelte";
    import Menu from "./utility/Menu.svelte";

    export let name = "Tool";
    export let options = [];
    export let buttons = [];
    export let headerContent: any = null;
</script>
<div id="toolview">
    <div class="header">
        <div class="header-left">
            <span class="title">{name}</span>
            {#if headerContent}
                <div class="header-extra">
                    <svelte:component this={headerContent}></svelte:component>
                </div>
            {/if}
        </div>
        <div class="header-tools">
            {#if buttons && buttons.length > 0}
            <div class="tool-buttons">
                {#each buttons as button}
                    <button
                        class="tool-button"
                        type="button"
                        title={button.title}
                        disabled={button.disabled}
                        on:click={() => button.action?.()}
                    >
                        {#if button.icon}
                            <svelte:component this={button.icon}></svelte:component>
                        {/if}
                        {#if button.label}
                            <span class="label">{button.label}</span>
                        {/if}
                    </button>
                {/each}
            </div>
            {/if}
            {#if options && options.length > 0}
                <Menu right menu={{icon: Ellipsis, children: options}}></Menu>
            {/if}
            <!-- svelte-ignore a11y-click-events-have-key-events -->
            <button class="tool-button close-button" title="Hide Panel" on:click={hideBottomPanel}>
                <X />
            </button>
        </div>
    </div>
    <div id="toolview-container"></div>
</div>

<style lang="scss">
#toolview {
    height: 100%;
    width: 100%;
    display: flex;
    flex-direction: column;
}
#toolview-container {
    padding: 8px;
    height: 100%;
    flex: 1;
    overflow: hidden;
}
.header {
    min-height: 35px;
    display: flex;
    flex-direction: row;
    align-items: center;
    justify-content: space-between;
    padding: 0 8px;

    .header-left {
        display: flex;
        align-items: center;
        gap: 12px;
        flex: 1;
        min-width: 0;

        .title {
            font-weight: 500;
            color: hsl(var(--foreground));
            white-space: nowrap;
        }

        .header-extra {
            flex: 1;
            min-width: 0;
            display: flex;
            align-items: center;
        }
    }

    .header-tools {
        display: flex;
        justify-content: center;
        align-items: center;
        gap: 2px;
        flex-direction: row;
        
        .tool-buttons {
            display: flex;
            flex-direction: row;
            align-items: center;
            justify-content: center;
            gap: 2px;
        }
        
        .tool-button,
        :global(.menu-button),
        .close-button {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 4px;
            padding: 0 8px;
            min-width: 28px;
            height: 28px;
            border: none;
            background: transparent;
            cursor: pointer;
            color: hsl(var(--muted-foreground));
            transition: all 0.15s ease;
            border-radius: 4px;

            &:disabled {
                cursor: default;
                opacity: 0.5;
            }
        }

        .tool-button,
        :global(.menu-button) {
            &:hover:not(:disabled) {
                background: rgba(59, 130, 246, 0.08);
                color: #3b82f6;
            }

            &:active:not(:disabled) {
                background: rgba(59, 130, 246, 0.12);
                transform: scale(0.95);
            }
        }

        .tool-button .label {
            font-size: 12px;
        }

        :global(.tool-button svg),
        :global(.menu-button svg),
        .close-button svg {
            width: 16px;
            height: 16px;
        }
    }
    
    .close-button {
        border-left: 1px solid hsl(var(--border));
        border-radius: 4px;
        margin-left: 4px;

        &:hover:not(:disabled) {
            background: rgba(239, 68, 68, 0.08);
            color: #ef4444;
        }

        &:active:not(:disabled) {
            background: rgba(239, 68, 68, 0.12);
            transform: scale(0.95);
        }
    }
}
</style>
