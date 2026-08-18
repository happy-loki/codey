<script context="module">
    const _expansionState = {
        /* treeNodeId: expanded <boolean> */
    };
</script>

<script lang="ts">
    import { createEventDispatcher, onMount } from "svelte";
    // 替换为扁平虚拟列表视图
    import FileTreeFlat from "./FileTreeFlat.svelte";
    
    // 兼容旧接口：tree 不再使用，但提供默认值避免 dev 警告
    export let tree: any = null;
    export let contextMenuEnabled = false;
    export let isExpanded = false;
    export let iconsEnabled = true;
    export let canDrag = false;

    let ref;
    let dispatch = createEventDispatcher();

    function handleContextMenu(e: MouseEvent) {
        if (!contextMenuEnabled) return;
        const tgt = e.target as HTMLElement;
        const inRow = tgt && tgt.closest ? tgt.closest('.ft-row') : null;
        if (!inRow) {
            // 空白区域：转发给父组件，并携带坐标
            dispatch("rightclick", { target: ref, contextmenu: true, clientX: e.clientX, clientY: e.clientY });
        }
        // 行内菜单由 FileTreeFlat 处理，这里不干预
    }
</script>

<div bind:this={ref} class="tree" role="tree" on:contextmenu|preventDefault={handleContextMenu}>
    <!-- 扁平视图：仅使用单击操作；不再支持 dblclick/dblnodeselect -->
    <FileTreeFlat canDrag={canDrag} on:nodeselect={(e) => dispatch('nodeselect', e.detail)} />
  </div>

<style>
    ul {
        margin: 0;
        list-style: none;
        user-select: none;
    }
    .tree {
        width: 100%;
        padding: 2px 0 4px;
        height: 100%;
        box-sizing: border-box;
    }
</style>
