<script lang="ts">
    import { onDestroy, onMount } from "svelte";
    import { treeLoading, dirToLoad, dirLoadFail } from "./File";
    import ProgressBar from "./utility/ProgressBar.svelte";
    import { relayoutActiveEditor } from "./EditorTabList.svelte";

    export let content = null;
    // Allow callers to decide whether to show the file-tree loading bar in this sidebar.
    // Left Explorer should pass true; right sidebar panels should pass false.
    export let showTreeLoading: boolean = true;

    onMount(() => {
        relayoutActiveEditor();
    })

    onDestroy(() => {
        relayoutActiveEditor();
    })
</script>
<div id="sidebarview">
    {#if content}
        <div class="content-host">
            <svelte:component this={content}></svelte:component>
        </div>
    {/if}
    {#if showTreeLoading && $treeLoading}
        <div class="loading-container">
            <ProgressBar label="{$dirToLoad}..." fail={$dirLoadFail}></ProgressBar>
        </div>
    {/if}
</div>

<style lang="scss">
    /* 侧栏容器：不滚动 */
    :global(#sidebarview) {
        height: 100%;
        display: flex;
        flex-direction: column;
        align-items: center;
        overflow: hidden;
    }

    /* 内容承载层：填满且不滚动（覆盖第三方/内部设置的 overflow:auto） */
    :global(#sidebarview .content-host) {
        width: 100%;
        height: 100%;
        flex: 1 1 auto;
        overflow: hidden !important;
        position: relative;
    }

    /* 内容承载层的第一层子元素（通常是中间 div），强制不滚动 */
    :global(#sidebarview .content-host > div) {
        width: 100%;
        height: 100%;
        overflow: hidden !important;
    }

    /* iframe 铺满且不滚动（宿主侧隐藏滚动条） */
    :global(#sidebarview .content-host iframe) {
        display: block;
        width: 100%;
        height: 100%;
        border: 0;
        overflow: hidden !important;
    }

    /* 允许滚动条显示，使用全局自动隐藏样式 */
    :global(#sidebarview .content-host),
    :global(#sidebarview .content-host > div),
    :global(#sidebarview .content-host iframe) {
        --scrollbar-size: 10px;
        --scrollbar-thumb-border: 2px;
    }

    /* 最小放行：仅对 FileTree 的滚动容器开放滚动能力 */
    :global(#sidebarview .content-host > div > .filetree-scroll) {
        flex: 1 1 auto !important;
        min-height: 0 !important;
        overflow: auto !important;
        height: auto !important;
        max-height: none !important;
    }

    /* 保持 loading 栏样式与高度，不受上面规则影响 */
    :global(#sidebarview .loading-container) {
        width: 100%;
        height: 15%;
        justify-self: end;
        border-top: var(--window-borderColor) 1px solid;
        border-left: var(--window-borderColor) 1px solid;
        border-bottom: var(--window-borderColor) 1px solid;
        /* 可选：让 loading 栏不挤压内容，固定高度 */
        flex: 0 0 auto;
    }
</style>
