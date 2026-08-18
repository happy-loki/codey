<script lang="ts">
    import FileTreeView from "./FileTree/FileTreeView.svelte";
    import { openContextMenu } from "./utility/contextMenuService";
    import { addEditorTab, getActiveTab } from "./EditorTabList.svelte";
    import { openFolderDialog, pasteFile, trimWatchScopesToRoot } from "./File";
    import {  writeText } from '@tauri-apps/plugin-clipboard-manager';
    import Button from "./utility/Button.svelte";
    import { commands } from "../config/commands";
    import { rootPath, collapseAllFolders } from './tree/normalizedStore';
    import { get } from 'svelte/store';
    import { FoldVertical, LocateFixed } from 'lucide-svelte';
    import { t } from "./i18n";
    import { formatShortcutLabel } from "./utility/textClipboard";

    let treeDom;
    let hovered = false;

    let path: string | null = null;
    let name: string | null = null;

    function handleClick(e) {
        treeDom = e.detail.target;
        // 根级空白区域菜单：使用规范化 store 的 rootPath
        path = $rootPath;
        name = $rootPath ? $rootPath.split($rootPath.includes('\\') ? '\\' : '/').pop() : null;
        // 空白区域右键：直接通过全局 ContextMenuHost 打开菜单
        const x = e.detail.clientX ?? 0;
        const y = e.detail.clientY ?? 0;
        openContextMenu(contextmenuitems, x, y);
    }
    function handleSelect(e) {
        addEditorTab(e.detail.node.path, e.detail.node.name);
    }
    function handleCollapseAll() {
        collapseAllFolders();
        trimWatchScopesToRoot();
    }

    // Reveal in FileTree View - 这个功能已经存在，我们只需要触发它
    function revealInFileTree() {
        // 获取当前活动的编辑器标签页
        const activeTab = getActiveTab();
        if (activeTab && activeTab.path) {
            // 使用现有的 revealInExplorerView 命令，传入当前文件路径
            commands.revealInExplorerView?.command?.(activeTab.path);
        }
    }

    const copyShortcut = formatShortcutLabel("C");
    const cutShortcut = formatShortcutLabel("X");
    const pasteShortcut = formatShortcutLabel("V");

    function buildRootContextMenu() {
        const translate = get(t);
        return [
            { name: translate("fileTree.contextMenu.openInExplorer"), action: async () => path && commands.openInExplorer.command(path) },
            { name: translate("fileTree.contextMenu.newFolder"), action: () => path && commands.createFolder.command(path) },
            { name: translate("fileTree.contextMenu.newFile"), action: () => { if (path) commands.createFile.command(path); } },
            { name: translate("fileTree.contextMenu.copyPath"), shortcut: copyShortcut, action: async () => { if (path) await writeText(path); } },
            { name: translate("fileTree.contextMenu.cut"), shortcut: cutShortcut, disabled: true, action: () => { console.warn("Cut root is disabled."); } },
            { name: translate("fileTree.contextMenu.paste"), shortcut: pasteShortcut, action: async () => { if (path) await pasteFile(path); } },
            { name: translate("fileTree.contextMenu.copyName"), action: async () => { if (name) await writeText(name); } },
            { name: translate("fileTree.contextMenu.rename"), shortcut: commands.renameFile.keybind ?? "F2", disabled: true, action: () => { console.warn("Rename root is disabled."); } },
            { name: translate("fileTree.contextMenu.delete"), shortcut: "Delete", disabled: true, action: () => { console.warn("Delete root is disabled."); } }
        ];
    }

    let contextmenuitems = [];
    $: contextmenuitems = buildRootContextMenu();
</script>

<script lang="ts" context="module">
    import { writable } from "svelte/store";

    export let filetree = writable([]);
</script>

{#if $filetree.length === 0}
    <div class="container">
        <span>{$t("fileTree.emptyState")}</span>
        <Button _class="toolbar-button" style="secondary" label={$t("fileTree.openFolder")} on:click={async () => {await openFolderDialog()}} />
    </div>
{:else}
    <div data-filetree-root>
        <!-- 根目录工具栏 -->
        <div class="filetree-toolbar">
            <button 
                class="toolbar-icon-button" 
                title="Collapse All Folders"
                on:click={handleCollapseAll}
            >
                <FoldVertical size={16} />
            </button>
            <button 
                class="toolbar-icon-button" 
                title="Reveal in FileTree View"
                on:click={revealInFileTree}
            >
                <LocateFixed size={16} />
            </button>
        </div>
        
        <div class="filetree-scroll" class:hovered={hovered} on:mouseenter={() => (hovered = true)} on:mouseleave={() => (hovered = false)}>
            <!-- 使用扁平 + 虚拟列表渲染 -->
            <svelte:component this={FileTreeView} on:nodeselect={handleSelect} on:rightclick={handleClick} contextMenuEnabled canDrag />
        </div>
    </div>
{/if}

<!-- 根级菜单改由全局 ContextMenuHost 承载 -->


<style lang="scss">
    :global(.toolbar-button) {
        font-family: inherit;
        text-align: center;
        padding: 7px 30px;
        margin-top: 10px;
        margin-bottom: 5px;
        display: inline-block;
        cursor: pointer;
        padding: 5px 25px;
        font-size: 0.875rem;
        border-radius: 2px;
        &:focus {
            outline-color: #2276b2;
        }
    }

    .container {
        display:flex; 
        flex-direction:column; 
        align-items: center;
        justify-content:center;
        min-height: 70vh;
        margin-top: 10px;
        margin-bottom: 5px;
        &>span {
            margin-top: 10px;
            margin-bottom: 5px;
            text-align: center;
            font-size: 0.875rem;
        }
    }

    [data-filetree-root] {
        display: flex;
        flex-direction: column;
        height: 100%;
        min-height: 0;
        width: 100%;
    }

    .filetree-toolbar {
        display: flex;
        align-items: center;
        justify-content: flex-end;
        gap: 4px;
        padding: 0 8px;
        height: calc(2rem + 5px);
        min-height: calc(2rem + 5px);
        background: var(--vscode-sideBar-background, var(--window-background));
        box-shadow: inset 0 -1px 0 0 var(--window-borderColor);
        flex: 0 0 auto;
    }

    .toolbar-icon-button {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 24px;
        height: 24px;
        border: none;
        background: transparent;
        border-radius: 3px;
        cursor: pointer;
        color: var(--vscode-icon-foreground);
        opacity: 0.8;
        transition: all 0.15s ease;

        &:hover {
            background: var(--vscode-toolbar-hoverBackground);
            opacity: 1;
        }

        &:active {
            background: var(--vscode-toolbar-activeBackground);
            opacity: 1;
        }

        &:focus {
            outline: 1px solid var(--vscode-focusBorder);
            outline-offset: -1px;
            opacity: 1;
        }
    }
    .filetree-scroll {
        /* 占满可用空间，并在内容溢出时出现滚动条 */
        flex: 1 1 auto;
        min-height: 0; /* 解决 flex 容器中子项不滚动的问题 */
        overflow-y: auto;
        overflow-x: hidden;
        /* Firefox 默认隐藏，悬停容器时显示为 thin */
        scrollbar-width: none;
        &.hovered { scrollbar-width: thin; }
        /* 使用全局自动隐藏滚动条样式 */
        /* WebKit/Blink 滚动条由全局样式控制 */
    }
    :global(#toolview-container) {
        /* 确保侧栏内容容器自身允许子项滚动 */
        height: 100%;
        min-height: 0;
        overflow: hidden; /* 由子项负责滚动 */
        display: flex;
        flex-direction: column;
    }
    /* 仅当显示 FileTree 时，恢复侧栏内容容器的滚动能力与滚动条可见 */
    :global(#sidebarview .content-host) {
        min-height: 0 !important;      /* 允许子项产生滚动 */
        overflow: visible !important;   /* 不强制隐藏滚动，由子项决定 */
    }
    :global(#sidebarview .content-host > div) {
        min-height: 0 !important;
        overflow: visible !important;
    }
    /* 恢复滚动条可见（覆盖 SidebarView 中的隐藏规则），仅在 FileTree 视图里生效 */
    :global(#sidebarview .content-host),
    :global(#sidebarview .content-host > div) {
        scrollbar-width: thin !important;
        --scrollbar-size: 8px;
        --scrollbar-thumb-border: 2px;
    }
</style>
