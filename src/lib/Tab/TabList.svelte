<script lang="ts">
    import { onMount } from "svelte";
    import Tab from "./Tab.svelte";
    import Sortable from 'sortablejs';
    import { type Writable } from "svelte/store";

    export let tabs: Writable<any[]>;
    export let width = "unset"; // no-op; layout now uses CSS grid 1fr/auto

    let tabcontainer = null;
    import { tick } from "svelte";
    let lastLen = 0;
    let lastActiveId: number | null = null;

    onMount(() => {
        Sortable.create(tabcontainer, {
            draggable: ".tab",
            animation: 150,
            forceFallback: true,
            filter: ".close-tab",
            easing: "cubic-bezier(1, 0, 0, 1)",
            sort: true
        })
    })

    // Scroll helpers
    function scrollToEnd() {
        const el: HTMLElement | null = tabcontainer;
        if (!el) return;
        el.scrollTo({ left: el.scrollWidth, behavior: 'smooth' });
    }
    function ensureActiveVisible(list: any[]) {
        try {
            const active = list?.find?.((t) => t?.active);
            if (!active) return;
            const container: HTMLElement | null = tabcontainer;
            const el = document.getElementById(`editorTab-${active.id}`) as HTMLElement | null;
            if (!container || !el) return;
            const containerRect = container.getBoundingClientRect();
            const tabRect = el.getBoundingClientRect();
            if (tabRect.left < containerRect.left) {
                const delta = containerRect.left - tabRect.left;
                container.scrollTo({
                    left: Math.max(0, container.scrollLeft - delta),
                    behavior: "smooth"
                });
            } else if (tabRect.right > containerRect.right) {
                const delta = tabRect.right - containerRect.right;
                container.scrollTo({
                    left: container.scrollLeft + delta,
                    behavior: "smooth"
                });
            }
        } catch {}
    }

    // When the store value changes, ensure visibility.
    // Use an async reactive block to wait for DOM updates.
    $: (async () => {
        const list = $tabs ?? [];
        const len = list.length ?? 0;
        const activeId = (list.find((t) => t?.active)?.id) ?? null;
        const grew = len > lastLen;
        const activeChanged = activeId !== lastActiveId;
        if (grew || activeChanged) {
            await tick();
            if (grew) scrollToEnd();
            ensureActiveVisible(list);
            lastActiveId = activeId;
        }
        lastLen = len;
    })();
</script>
<div bind:this={tabcontainer} id="tablist">
    {#each $tabs as tab}
        <Tab
            on:closetab
            on:select
            id={tab.id}
            label={tab.label}
            path={tab.path}
            active={tab.active}
            saved={tab.saved}
            isfile={Boolean(tab.isfile || tab.isimage)}
        />
    {/each}
</div>

<style lang="scss">
    #tablist {
        display: flex;
        /* Keep a single row; prevent wrap/squish */
        flex-wrap: nowrap;
        /* Allow container to shrink but not collapse */
        flex: 1 1 auto;
        min-width: 0;
        height: 100%;
        align-items: stretch;
        /* Enable horizontal scroll so long labels don't push layout */
        overflow-x: auto;
        overflow-y: hidden;
        scrollbar-width: none;
        -ms-overflow-style: none;
    }
    #tablist::-webkit-scrollbar {
        display: none;
    }
</style>
