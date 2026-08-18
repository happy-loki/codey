<script lang="ts">
    import SidebarTab from "./SidebarTab.svelte";
    import { onMount } from "svelte";
    import { t } from "./i18n";
    export let tabs: { id: number; tabname: string; icon: any; content: any; labelKey?: string }[] = [];
    onMount(() => { registerRightTabs(tabs); });
</script>

<script lang="ts" context="module">
    import { writable, get } from "svelte/store";
    import { fitTerminal } from "./Terminal.svelte";

    class Tool {
        tabname: string;
        content: any;
        constructor(tabname: string, content: any) {
            this.tabname = tabname;
            this.content = content;
        }
    }

    export let right_activeid = writable(-1);
    let active = -1;
    export let showrightsidebarview = writable(false);
    export let righttool = writable(null);

    // Keep a reference to the most-recent tabs array so other modules can open by id
    let currentTabs: { id: number; tabname: string; icon: any; content: any; labelKey?: string }[] = [];
    export function registerRightTabs(tabs: { id: number; tabname: string; icon: any; content: any; labelKey?: string }[]) {
        currentTabs = tabs || [];
    }

    export const toggleActiveRight = (tab: { id: any; tabname: any; icon: any; content: any }) => {
        if (active === tab.id) {
            active = -1;
            right_activeid.set(-1);
            showrightsidebarview.set(false);
        } else {
            right_activeid.set(tab.id);
            active = tab.id;
            showrightsidebarview.set(true);
            // Only swap the tool when it actually changes. This avoids re-mounting or
            // resetting tool state when the user just toggles the panel visibility.
            const existing = get(righttool) as Tool | null;
            if (!existing || existing.tabname !== tab.tabname) {
                righttool.set(new Tool(tab.tabname, tab.content));
            }
        }
        fitTerminal();
    };

    export function openRightTabById(tabs: { id: number; tabname: string; icon: any; content: any; labelKey?: string }[], tabId: number) {
        const tab = tabs.find((t) => t.id === tabId);
        if (!tab) return;
        if (active === tab.id) return;
        right_activeid.set(tab.id);
        active = tab.id;
        showrightsidebarview.set(true);
        const existing = get(righttool) as Tool | null;
        if (!existing || existing.tabname !== tab.tabname) {
            righttool.set(new Tool(tab.tabname, tab.content));
        }
    }

    // Convenience opener using last-registered tabs
    export function openRightTab(tabId: number) {
        if (!currentTabs || currentTabs.length === 0) return;
        openRightTabById(currentTabs, tabId);
    }
</script>

<div id="right-sidebar" style="display: none;">
    <!-- 右侧边栏的AI按钮已移动到顶部，这里隐藏整个右侧边栏 -->
    <div class="tabs">
        {#each tabs as tab}
            <SidebarTab
                id={`right-tool-${tab.id}`}
                active={$showrightsidebarview ? false : ($right_activeid === tab.id)}
                label={$t(tab.labelKey ?? tab.tabname)}
                on:click={() => {toggleActiveRight(tab)}}
            >
                <svelte:component this={tab.icon}/>
            </SidebarTab>
        {/each}
    </div>
    <div class="divider" />
</div>

<style lang="scss">
    #right-sidebar {
        --sidebar-width: 4.5rem;
        height: 100%;
        width: var(--sidebar-width);
        min-width: var(--sidebar-width);
        flex: 0 0 var(--sidebar-width);
        display: flex;
        flex-direction: column;
        align-items: center;
        padding: 0.5rem 0.4rem;
        box-sizing: border-box;
        gap: 0.25rem;
    }
    .tabs {
        display: flex;
        flex-direction: column;
        width: 100%;
        align-items: center;
    }
    .divider { width: 70%; height: .0625rem; margin: 0.25rem auto; }
</style>
