<script lang="ts">
    import { onMount } from "svelte";
    import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';

    export let items = [];
    export let target: HTMLElement = null;

    export let menuOpen = false;

    let cursorPos = { x: 0, y: 0 }
    let menuPos = { h: 0, w: 0 }
    let windowSize = { h: 0, w: 0 } // keep track of window borders

    onMount(() => {
        return () => {
            if (lastTarget !== null) {
                try { lastTarget.removeEventListener("contextmenu", openContextMenu); } catch {}
            }
        }
    })

    async function openContextMenu(e) {
        const appWindowSize = await getCurrentWebviewWindow().innerSize();
        let windowWidth = appWindowSize.width;
        let windowHeight = appWindowSize.height;

        menuOpen = true;
        windowSize = {w: windowWidth, h: windowHeight};
        cursorPos = {x: e.clientX, y: e.clientY};

        // Adjust context menu position based on where it is on the window
        // If it overlaps with the window border then move it to the right/left/top/bottom accordingly
        if (windowSize.h -  cursorPos.y < menuPos.h) {
            cursorPos.y = cursorPos.y - menuPos.h
        }
        if (windowSize.w -  cursorPos.x < menuPos.w) {
            cursorPos.x = cursorPos.x - menuPos.w
        }
    }

    // Portal action: move the menu node to document.body to escape local stacking contexts
    function portal(node: HTMLElement) {
        const host = document.body;
        host.appendChild(node);
        return {
            destroy() {
                try {
                    if (node.parentNode) node.parentNode.removeChild(node);
                } catch {}
            }
        }
    }

    function getContextMenuDimension(node){
        // This function will get context menu dimension
        // when navigation is shown
        let height = node.offsetHeight;
        let width = node.offsetWidth;
        menuPos = {
            w: width,
            h: height
        }
    }

    let lastTarget: HTMLElement | null = null;
    $: {
        if (target !== lastTarget) {
            if (lastTarget) {
                try { lastTarget.removeEventListener("contextmenu", openContextMenu); } catch {}
            }
            if (target) {
                target.addEventListener("contextmenu", openContextMenu);
            }
            lastTarget = target;
        }
    }
</script>

<svelte:window on:contextmenu|preventDefault on:click={(e) => {
    menuOpen = false;
}} on:mouseup={(e) => {
    if (e.button === 2) {
        menuOpen = false;
    }
}} on:keydown={(e) => { if (e.key === 'Escape') menuOpen = false; }}></svelte:window>

{#if menuOpen}
    <div use:portal use:getContextMenuDimension class="context-menu" style="top:{cursorPos.y}px; left:{cursorPos.x}px">
        {#each items as item}
            <!-- svelte-ignore a11y-click-events-have-key-events -->
            <div class="context-menu-option" title="" class:disabled={item.disabled} on:click={() => {
                if (!item.disabled) {
                    // 先关闭菜单，再执行动作，避免菜单遗留
                    menuOpen = false;
                    try { item.action(); } catch {}
                }
            }}>
                <span class="option-name">{item.name}</span>
                {#if item.shortcut}
                    <span class="option-shortcut">{item.shortcut}</span>
                {/if}
            </div>
        {/each}
    </div>
{/if}

<style lang="scss">
    .context-menu {
        min-width: 10rem;
        max-width: 18rem;
        padding: 0.25rem;
        z-index: 100000; /* above editor overlays */
        position: fixed; /* relative to viewport */
        border-radius: 3px;
    }
    .context-menu-option {
        display: flex;
        align-items: center;
        justify-content: space-between;
        height: 17px;
        padding: 6px 0;
        width: 100%;
        font-size: 0.875rem;
        cursor: pointer;
    }
    .option-name, .option-shortcut {
        padding: 0 10px;
    }
    .option-shortcut {
        margin-left: 10px;
    }
    .disabled {
        cursor: not-allowed;
    }
</style>
