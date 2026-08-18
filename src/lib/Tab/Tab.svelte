<script lang="ts">
    import { createEventDispatcher } from "svelte";
    import { openContextMenu } from "../utility/contextMenuService";
    import { commands } from "../../config/commands";
    import { t } from "../i18n";
    import { X } from "lucide-svelte";
    import FileTypeIcon from "../Icons/FileTypeIcon.svelte";
    const dispatch = createEventDispatcher();

    export let id = 0;
    export let label = "Untitled-1";
    export let path = "";
    export let active = false;
    export let saved = true;
    export let isfile = false;

    let tab = null;
    let iconFilename = "";
    let showFileIcon = false;

    function handleSelect(tabid) {
        dispatch("select", {tabid: tabid})
    }
    function handleClose(tabid) {
        dispatch("closetab", {tabid: tabid});
    }

    type ContextMenuItem = {
        name: string;
        shortcut?: string;
        disabled?: boolean;
        action: () => void;
    };

    let contextmenuitems: ContextMenuItem[] = [];

    function deriveIconFilename(tabPath: string, tabLabel: string): string {
        if (typeof tabPath === "string" && tabPath.trim().length > 0) {
            const trimmed = tabPath.trim();
            const segments = trimmed.split(/[/\\]/);
            const candidate = segments.pop() ?? trimmed;
            if (candidate.length > 0) {
                return candidate;
            }
            return trimmed;
        }
        if (typeof tabLabel === "string" && tabLabel.trim().length > 0) {
            return tabLabel.trim();
        }
        return "";
    }

    $: contextmenuitems = [
        {name: $t("tabContext.closeTab"), shortcut: commands.closeTab.keybind, action: () => {handleClose(id)}},
        {name: $t("tabContext.closeOthers"), shortcut: "", action: () => {commands.closeOtherTabs.command(id)}},
        {name: $t("tabContext.closeLeft"), shortcut: "", action: () => {commands.closeTabsToLeft.command(id)}},
        {name: $t("tabContext.closeRight"), shortcut: "", action: () => {commands.closeTabsToRight.command(id)}},
        {name: $t("tabContext.closeAll"), shortcut: "", action: commands.closeAllTabs.command},
        {name: $t("tabContext.openInExplorer"), disabled: path === label, shortcut: commands.openInExplorer.keybind, action: () => {commands.openInExplorer.command(path)}},
        {name: $t("tabContext.revealInExplorerView"), disabled: path === label, shortcut: "", action: () => {commands.revealInExplorerView.command(path)}},
        {name: $t("tabContext.renameFile"), disabled: path === label, shortcut: commands.renameFile.keybind, action: () => {commands.renameFile.command(label, path)}},
    ];

    $: iconFilename = deriveIconFilename(path, label);
    $: showFileIcon = Boolean(isfile && iconFilename);
</script>
<div bind:this={tab} title={path} id={`editorTab-${id}`} class="tab" class:active={active}>
    <!-- svelte-ignore a11y-click-events-have-key-events -->
    <div class="tab-content"
         on:mousedown={(e) => { if (e.button === 0) handleSelect(id); }}
         on:contextmenu|preventDefault={(e) => { openContextMenu(contextmenuitems, e.clientX, e.clientY); }}>
        {#if showFileIcon}
            <span class="tab-icon" aria-hidden="true">
                <FileTypeIcon filename={iconFilename} />
            </span>
        {/if}
        <span class="tab-label">{label}</span>
        <span class="save-state" class:saved></span>
    </div>
    <!-- svelte-ignore a11y-click-events-have-key-events -->
    <div class="close-tab">
        <span title={$t("tabContext.closeTab")} on:click={() => {handleClose(id)}}>
            <X size={14} />
        </span>
    </div>
</div>

<style lang="scss">
    .tab {
        height: 100%;
        /* Allow horizontal scrolling container to hide left-most tabs */
        /* Do not grow or wrap; size to content and allow ellipsis */
        flex: 0 0 auto;
        min-width: 0;
        display: flex;
        overflow: hidden;
        justify-content: space-between;
        align-items: center;
        font-size: var(--header-compact-font-size, 12px);
        line-height: 1;
        cursor: pointer;
        padding: 0 12px 0 10px;
        color: hsl(var(--muted-foreground));
        transition: color 0.15s ease;
    }
    .tab.active {
        color: hsl(var(--foreground));
    }
    .tab-content {
        display: flex;
        justify-content: center;
        align-items: center;
        gap: 6px;
        overflow-x: hidden;
        overflow-y: hidden;
        height: 100%;
        padding-left: 2px;
        .save-state {
            &.saved {
                display: none !important;   
            }
            display: block;
            width: 6px;
            height: 6px;
            border-radius: 50%;
            left: -11px;
            top: 0.5px;
            position: relative;
        }
    }
    .tab-icon {
        display: flex;
        align-items: center;
        flex: 0 0 auto;
        color: inherit;
    }
    .tab-icon :global(.file-icon) {
        margin-right: 0;
    }
    .tab-label {
        text-overflow: ellipsis;
        white-space: nowrap;
        padding-right: 12px;
        flex: 1 1 auto;
        min-width: 0;
        color: inherit;
        transition: color 0.15s ease;
    }
    .tab:not(.active) .tab-label {
        color: hsl(var(--muted-foreground));
    }
    .close-tab span {
        display: flex;
        justify-content: center;
        width: 100%;
        height: 100%;
        align-items: center;
        cursor: pointer;
        color: hsl(var(--muted-foreground));
        transition: color 0.15s ease;
    }
    .close-tab span:hover {
        color: hsl(var(--destructive));
        background: hsl(var(--destructive) / 0.1);
        border-radius: 3px;
    }
    .close-tab {
        width: 18px;
        height: 18px;
        display: flex;
        justify-content: center;
        align-items: center;
        margin-left: -0.25rem;
        opacity: 0;
        pointer-events: none;
        transition: opacity 0.12s ease, transform 0.12s ease;
        transform: translateX(4px);
    }
    .tab:hover .close-tab,
    .tab:focus-within .close-tab {
        opacity: 1;
        pointer-events: auto;
        transform: translateX(0);
    }
</style>
