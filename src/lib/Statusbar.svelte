<script lang="ts">
    import { isfile } from "./EditorTabList.svelte";
    import { line_info, language, encoding, spaces } from "./Editor.svelte";
    import { getVersion } from '@tauri-apps/api/app';
    import { onMount } from "svelte";
    import type { Writable } from "svelte/store";
    import {
        SquareTerminal as TerminalIcon,
        Bell as NotificationIcon,
        Trash2 as TrashIcon,
        Search as SearchIcon,
        ListChevronsUpDown,
        ListChevronsDownUp
    } from "lucide-svelte";
    import { invoke } from "@tauri-apps/api/core"
    import TerminalManager from "./TerminalManager.svelte";
    import TerminalTabs from "./terminal/TerminalTabs.svelte";
    import { workingDir } from "./File";
    import NotificationList from "./Notifications/NotificationList.svelte";
    import SearchView from "./search/SearchView.svelte";
    import { clearNotifications, markAllRead, unreadnotifications } from "./Notifications/notifications";
    import { searchState, setAllExpanded } from "./search/searchStore";

    declare const editortool: Writable<{ name: string; options: any[]; buttons: any[]; header: any }>;

    let appVersion = "";
    onMount(async () => {
        appVersion = await getVersion();
    })
    // Search expand/collapse functionality
    $: searchHasResults = $searchState.results.length > 0;
    $: allExpanded = searchHasResults && $searchState.results.every((file) => $searchState.expanded[file.path] !== false);

    function handleToggleAllExpand() {
        if (!searchHasResults) {
            return;
        }
        setAllExpanded(!allExpanded);
    }

    // Create search buttons dynamically
    let searchButtons = [];

    function buttonsEqual(a, b) {
        if (!Array.isArray(a) || !Array.isArray(b)) {
            return false;
        }
        if (a.length !== b.length) {
            return false;
        }
        for (let i = 0; i < a.length; i += 1) {
            const left = a[i];
            const right = b[i];
            if (!left || !right) {
                return false;
            }
            if (left.icon !== right.icon || left.label !== right.label || left.disabled !== right.disabled) {
                return false;
            }
        }
        return true;
    }

    $: {
        const nextButtons = [
            {
                icon: allExpanded ? ListChevronsUpDown : ListChevronsDownUp,
                title: allExpanded ? "Collapse all" : "Expand all",
                disabled: !searchHasResults,
                action: handleToggleAllExpand,
            }
        ];

        if (!buttonsEqual(searchButtons, nextButtons)) {
            searchButtons = nextButtons;
            if ($editortool?.name === "Search") {
                editortool.set({ ...$editortool, buttons: nextButtons });
            }
        }
    }

    $: tools = [
        {name: "Terminal", content: TerminalManager, icon: TerminalIcon, action: (t) => {spawnTerminal(t)}, options: [],
            buttons: [], header: TerminalTabs
        },
        {name: "Search", content: SearchView, icon: SearchIcon, action: (t) => { toggleBottomPanel(t); }, options: [], buttons: searchButtons},
        {name: "Notifications", content: NotificationList, icon: NotificationIcon, action: (t) => {toggleBottomPanel(t)}, options: [
            {name: "Mark all as Read", action: () => {markAllRead()}}],
            buttons: [
                {icon: TrashIcon, title: "Clear Notifications", action: () => {clearNotifications()}}
        ]}
    ]

    async function spawnTerminal(t) {
        if ($externalTerminal) {
            try { await invoke("open_terminal", {path: $workingDir}); } catch (e) { /* ignore OS spurious errors */ }
        }
        else {
            try { toggleBottomPanel(t); } catch {}
            // Ensure at least one terminal exists when the panel is shown
            queueMicrotask(() => {
                try { import('./terminalBus').then(m => m.requestEnsureBaseTerminal()); } catch {}
            });
        }
    }
</script>
<script lang="ts" context="module">
    import { get, writable } from "svelte/store";
    // Module helpers to interact with the Terminal tool instance
    import TerminalManagerMod from "./TerminalManager.svelte";
    import SearchViewMod from "./search/SearchView.svelte";

    export let showBottomPanel = writable(false);
    export let externalTerminal = writable(false);
    let lastTool = writable({tool: null, element: null});
    let show = false;
    
    // Track active tool for highlighting
    export let activeTool = writable(null);

    export let editortool = writable({name: "", options: [], buttons: [], header: null});
    // No cross-script reference; we will normalize by tool name to avoid duplicates

    function getContainer() {
        return document.getElementById("toolview-container");
    }

    type ToolDescriptor = {
        name: string;
        content: any;
        options?: any[];
        buttons?: any[];
        header?: any;
    };

    type ToolInstance = {
        tool: ToolDescriptor;
        element: any;
        container: HTMLElement;
    };

    const toolInstances = new Map<string, ToolInstance>();

    function revealContainer() {
        const target = getContainer();
        if (target) {
            delete target.dataset.hidden;
        }
    }

    function hideContainerEl() {
        const target = getContainer();
        if (target) {
            target.dataset.hidden = "true";
        }
    }

    function ensureToolInstance(tool: ToolDescriptor): ToolInstance | null {
        if (!tool?.name || !tool.content) {
            return null;
        }
        const target = getContainer();
        if (!target) {
            return null;
        }

        let instance = toolInstances.get(tool.name);
        if (instance) {
            if (instance.container.parentElement !== target) {
                target.appendChild(instance.container);
            }
            instance.tool = tool;
            return instance;
        }

        const container = document.createElement("div");
        container.dataset.tool = tool.name;
        container.style.height = "100%";
        container.style.width = "100%";
        container.style.display = "none";
        target.appendChild(container);

        const element = new tool.content({ target: container });
        instance = { tool, element, container };
        toolInstances.set(tool.name, instance);
        return instance;
    }

    function setInstanceVisibility(name: string, visible: boolean) {
        const instance = toolInstances.get(name);
        if (!instance) {
            return;
        }
        instance.container.style.display = visible ? "" : "none";
        if (visible) {
            instance.container.removeAttribute("aria-hidden");
        } else {
            instance.container.setAttribute("aria-hidden", "true");
        }
        try { instance.element?.$set?.({ hidden: !visible }); } catch {}
    }

    function showToolInstance(tool: ToolDescriptor) {
        const instance = ensureToolInstance(tool);
        if (!instance) {
            return null;
        }
        toolInstances.forEach((entry, name) => {
            setInstanceVisibility(name, name === tool.name);
        });
        return instance;
    }

    function destroyInstance(name: string) {
        const instance = toolInstances.get(name);
        if (!instance) {
            return;
        }
        try { instance.element?.$destroy(); } catch {}
        if (instance.container.parentElement) {
            instance.container.parentElement.removeChild(instance.container);
        }
        toolInstances.delete(name);
    }

    function destroyAllInstances() {
        Array.from(toolInstances.keys()).forEach((key) => destroyInstance(key));
        const target = getContainer();
        if (target) {
            target.innerHTML = "";
        }
    }

    export function toggleBottomPanel(tool = null) {
        const current = get(lastTool);
        const isSameTool = tool && current.tool && tool.name === current.tool.name;
        const isOpen = get(showBottomPanel);

        if (!tool) {
            hideBottomPanel();
            return;
        }

        if (isSameTool) {
            if (isOpen) {
                hideBottomPanel();
            } else {
                show = true;
                showBottomPanel.set(true);
                activeTool.set(tool.name);
                try { current.element?.$set?.({ hidden: false }); } catch {}
                setInstanceVisibility(tool.name, true);
                revealContainer();
            }
            return;
        }

        if (current.tool?.name) {
            setInstanceVisibility(current.tool.name, false);
        }

        const instance = showToolInstance(tool);
        if (!instance) {
            return;
        }

        lastTool.set({ tool, element: instance.element });
        show = true;
        showBottomPanel.set(true);
        activeTool.set(tool.name);
        revealContainer();

        editortool.set({ name: tool.name, options: tool.options, buttons: tool.buttons, header: tool.header || null });
    }
    // Ensure bottom panel is open with Terminal tool active (reuse existing instance; do NOT mount duplicates)
    export function ensureTerminalPanelOpen() {
        // Provide a lightweight descriptor; toggleBottomPanel will normalize to mounted instance by name
        const ref = { name: "Terminal", content: TerminalManagerMod, options: [], buttons: [], header: TerminalTabs } as ToolDescriptor;
        const instance = showToolInstance(ref);
        if (!instance) {
            return;
        }

        lastTool.set({ tool: ref, element: instance.element });
        show = true;
        showBottomPanel.set(true);
        activeTool.set("Terminal");
        revealContainer();

        editortool.set({ name: ref.name, options: ref.options, buttons: ref.buttons, header: ref.header || null });
        // After mount tick, ensure at least one terminal exists (only when panel is visible)
        queueMicrotask(() => {
            try { import('./terminalBus').then(m => m.requestEnsureBaseTerminal()); } catch {}
        });
    }

    export function ensureSearchPanelOpen() {
        const ref = { name: "Search", content: SearchViewMod, options: [], buttons: [] } as ToolDescriptor;
        const instance = showToolInstance(ref);
        if (!instance) {
            return;
        }

        lastTool.set({ tool: ref, element: instance.element });
        show = true;
        showBottomPanel.set(true);
        activeTool.set("Search");
        revealContainer();
        editortool.set({ name: ref.name, options: ref.options, buttons: ref.buttons, header: ref.header || null });
    }
    export function hideBottomPanel() {
        show = false;
        showBottomPanel.set(false);
        activeTool.set(null);
        const current = get(lastTool);
        try { current.element?.$set?.({ hidden: true }); } catch {}
        if (current.tool?.name) {
            setInstanceVisibility(current.tool.name, false);
        }
        hideContainerEl();
    }
    export function closeBottomPanel() {
        show = false;
        showBottomPanel.set(false);
        activeTool.set(null);
        destroyAllInstances();
        revealContainer();
        editortool.set({name: "", options: [], buttons: [], header: null});
        lastTool.set({tool: null, element: null});
    }
    export function setTerminalState(value) {
        let v = value === true ? true : false;
        externalTerminal.set(v);
    }
</script>

<div id="statusbar">
    <div id="title">
        <span>Codey <span id="version">-v{appVersion}-alpha</span></span>
        <div class="divider"></div>
    </div>
    <div class="editor-tools">
        {#each tools as tool}
            <!-- svelte-ignore a11y-click-events-have-key-events -->
            <span 
                class="tool" 
                title={tool.name} 
                on:click={() => {tool.action(tool)}} 
                class:updated={tool.name === "Notifications" && $unreadnotifications}
                class:active={$activeTool === tool.name && $showBottomPanel}
            >
                <svelte:component this={tool.icon}></svelte:component>
                {#if tool.name === "Notifications"}
                    <span class="notification"></span>
                {/if}
            </span>
        {/each}
        
    </div>
    {#if $isfile}
        <div class="editor-info">
            <span title="Indentation">Spaces: {$spaces}</span>
            <div class="divider"></div>
            <span title="Ln: {$line_info.line}, Col: {$line_info.column}">{$line_info.line} : {$line_info.column}</span>
            <div class="divider"></div>
            <span>{$encoding.value} {$encoding.hasBom === true ? " with BOM" : ""}</span>
            <div class="divider"></div>
            <span>{$language}</span>
        </div>
    {/if}
</div>

<style lang="scss">
    #statusbar {
        z-index: 8000;
        width: -webkit-fill-available;
        display: flex;
        align-items: center;
        padding: var(--statusbar-padding-y) var(--statusbar-padding-x);
        gap: var(--statusbar-gap);
        font-size: clamp(11px, calc(var(--statusbar-font-size, var(--ui-font-size, 16px)) * 0.78), 16px);
        line-height: 1;
        box-sizing: border-box;
        min-height: var(--statusbar-height);
        :global(span svg) {
            width: var(--statusbar-icon-size);
            height: var(--statusbar-icon-size);
        }
    }
    #title {
        display: flex;
        justify-content: flex-start;
        align-items: center;
        height: 100%;
        span {
            display: flex;
            align-items: center;
            height: 100%;
            padding: 0 10px;
        }
    }
    .divider {
        width: 0.0625rem;
		height: var(--statusbar-item-height);
    }
    .editor-tools {
        height: var(--statusbar-item-height);
        display: flex;
        align-items: center;
        justify-content: flex-start;
        padding-left: calc(var(--statusbar-gap) * 0.5);
        .tool {
            height: 100%;
            margin: 0;
            padding: 0 clamp(6px, calc(var(--statusbar-font-size, var(--ui-font-size, 16px)) * 0.4), 14px);
            position: relative;
            transition: all 0.2s ease;
            border-radius: var(--statusbar-radius);
            
            &:hover {
                cursor: pointer;
                background-color: var(--tool-hover-bg);
            }
            
            &.active {
                background-color: var(--tool-active-bg);
                color: var(--tool-active-color);
                
                &:hover {
                    background-color: var(--tool-active-hover-bg);
                }
            }
            
            &.updated {
                .notification {
                    position: absolute;
                    width: 8px;
                    height: 8px;
                    display: block;
                    background-color: var(--window-accent);
                    border-radius: 50%;
                    top: clamp(3px, calc(var(--statusbar-font-size, var(--ui-font-size, 16px)) * 0.18), 6px);
                    right: clamp(3px, calc(var(--statusbar-font-size, var(--ui-font-size, 16px)) * 0.18), 6px);
                    border: none;
                }
            }
        }
        span {
            display: flex;
            align-items: center;
            justify-content: center;
        }
    }
    .editor-info {
        display: flex;
        justify-content: flex-end;
        align-items: center;
        flex-grow: 1;
        font-size: inherit;
        height: var(--statusbar-item-height);
        span {
            padding: 0 clamp(6px, calc(var(--statusbar-font-size, var(--ui-font-size, 16px)) * 0.45), 14px);
            height: 100%;
            margin: 0;
            display: flex;
            align-items: center;
            border-radius: var(--statusbar-radius);
            transition: all 0.2s ease;
            
            &:hover {
                background-color: var(--tool-hover-bg);
            }
        }
    }
    #version {
        font-size: clamp(10px, calc(var(--statusbar-font-size, var(--ui-font-size, 16px)) * 0.6), 13px);
        padding: 0 !important;
        color: var(--window-descriptionForeground);
    }
</style>
