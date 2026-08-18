<script lang="ts">
  import VirtualList from "../VirtualList.svelte";
  import type { VisibleRow } from "../tree/normalizedStore";
  import { visibleRows, toggleExpandedById, selectedPath, setSelectedPath, revealTargetPath, rootPath } from "../tree/normalizedStore";
  import { expandNode, syncWatchScope } from "../File";
  import DirectoryIcon from "../Icons/DirectoryIcon.svelte";
  import FileTypeIcon from "../Icons/FileTypeIcon.svelte";
  import { is_dark_theme } from "../../config/themehandler";
  import { openContextMenu } from "../utility/contextMenuService";
  import { commands } from "../../config/commands";
  import { writeText } from '@tauri-apps/plugin-clipboard-manager';
  import { addEditorTab } from "../EditorTabList.svelte";
  import { moveToTrash, pasteFile, cutPath } from "../File";
  import { tick } from "svelte";
  import { get } from "svelte/store";
  import { t } from "../i18n";
  import { formatShortcutLabel } from "../utility/textClipboard";

  // Keep this as an integer pixel value to avoid subpixel seams in tree guide lines.
  export let rowHeight = 24;
  export let canDrag = false;

  let contextItems: Array<{ name: string; disabled?: boolean; shortcut?: string; action: () => void }>=[];
  let contextRow: VisibleRow | null = null;

  const copyShortcut = formatShortcutLabel("C");
  const cutShortcut = formatShortcutLabel("X");
  const pasteShortcut = formatShortcutLabel("V");

  async function openFileFromTree(path: string, name: string) {
    await addEditorTab(path, name);
  }

  function buildItems(row: VisibleRow) {
    const translate = get(t);
    const renameShortcut = commands.renameFile.keybind ?? "F2";
    const isRoot = row.depth === 0;
    if (row.isDirectory) {
      contextItems = [
        { name: translate("fileTree.contextMenu.openInExplorer"), action: () => commands.openInExplorer.command(row.path) },
        { name: translate("fileTree.contextMenu.newFolder"), action: () => commands.createFolder.command(row.path) },
        { name: translate("fileTree.contextMenu.newFile"), action: () => { commands.createFile.command(row.path); } },
        { name: translate("fileTree.contextMenu.copyPath"), shortcut: copyShortcut, action: () => { void writeText(row.path); } },
        { name: translate("fileTree.contextMenu.cut"), shortcut: cutShortcut, disabled: isRoot, action: () => { if (!isRoot) cutPath(row.path); } },
        { name: translate("fileTree.contextMenu.paste"), shortcut: pasteShortcut, action: () => { void pasteFile(row.path); } },
        { name: translate("fileTree.contextMenu.copyFolderName"), action: () => { void writeText(row.name); } },
        { name: translate("fileTree.contextMenu.rename"), shortcut: renameShortcut, disabled: isRoot, action: () => { if (!isRoot) commands.renameFile.command(row.name, row.path); } },
        { name: translate("fileTree.contextMenu.delete"), shortcut: "Delete", disabled: isRoot, action: () => { if (!isRoot) void moveToTrash(row.path); } },
      ];
    } else {
      contextItems = [
        { name: translate("fileTree.contextMenu.openInExplorer"), action: () => commands.openInExplorer.command(row.path) },
        { name: translate("fileTree.contextMenu.copyPath"), shortcut: copyShortcut, action: () => { void writeText(row.path); } },
        { name: translate("fileTree.contextMenu.cut"), shortcut: cutShortcut, action: () => { cutPath(row.path); } },
        { name: translate("fileTree.contextMenu.copyFileName"), action: () => { void writeText(row.name); } },
        { name: translate("fileTree.contextMenu.edit"), action: () => { void openFileFromTree(row.path, row.name); } },
        { name: translate("fileTree.contextMenu.rename"), shortcut: renameShortcut, action: () => { commands.renameFile.command(row.name, row.path); } },
        { name: translate("fileTree.contextMenu.delete"), shortcut: "Delete", action: () => { void moveToTrash(row.path); } },
      ];
    }
  }

  function onRowClick(row: VisibleRow) {
    if (row.isDirectory) {
      const willExpand = !(row.expanded ?? false);
      toggleExpandedById(row.id);
      syncWatchScope(row.path, willExpand);
      // 懒加载：若目录标记未加载，由 expandNode 触发按路径加载
      if (willExpand && !row.isLoaded && row.hasChildren) {
        // 传入一个最小 NodeMeta 结构，仅含 path/name
        void expandNode({ id: row.id, name: row.name, path: row.path, isDirectory: true, isLoaded: false, hasChildren: true });
      }
      // 目录也需要选中高亮（文件的选中由 EditorTabList 同步）
      try { setSelectedPath(row.path); } catch {}
    } else {
      // 单击文件即打开，由 EditorTabList 同步 selectedPath（单一事实来源）
      void openFileFromTree(row.path, row.name);
    }
  }

  function onContextMenu(row: VisibleRow, el: HTMLElement, e: MouseEvent) {
    contextRow = row;
    buildItems(row);
    openContextMenu(contextItems, e.clientX, e.clientY);
  }

  function handleRowContextMenu(row: VisibleRow, e: MouseEvent) {
    e.stopPropagation();
    const el = e.currentTarget as HTMLElement;
    onContextMenu(row, el, e);
  }

  function onRowKeydown(row: VisibleRow, e: KeyboardEvent) {
    const k = e.key;
    if (k === 'Enter' || k === ' ') {
      e.preventDefault();
      onRowClick(row);
    }
  }

  let virtualListRef: any = null;
  let lastRevealPath: string | null = null;
  let revealAttempts = 0;

  function clearRevealRequest() {
    revealTargetPath.set(null);
    lastRevealPath = null;
    revealAttempts = 0;
  }

  async function scrollPathIntoView(path: string, rows: VisibleRow[]) {
    if (!path) return;
    if (path !== lastRevealPath) {
      lastRevealPath = path;
      revealAttempts = 0;
    }
    revealAttempts += 1;
    if (!Array.isArray(rows) || rows.length === 0) {
      if (revealAttempts > 5) clearRevealRequest();
      return;
    }
    const index = rows.findIndex((row) => row.path === path);
    if (index === -1) {
      if (revealAttempts > 5) clearRevealRequest();
      return;
    }
    try {
      virtualListRef?.scrollToIndex?.(index, "center");
    } catch {}
    await tick();
    const renderedRows = Array.from(document.querySelectorAll<HTMLElement>(".ft-row[data-path]"));
    const el = renderedRows.find((node) => node.dataset.path === path);
    if (el) {
      try {
        el.scrollIntoView({ block: "nearest", inline: "nearest" });
      } catch {}
    }
    clearRevealRequest();
  }

  $: if ($revealTargetPath) {
    void scrollPathIntoView($revealTargetPath, $visibleRows ?? []);
  }

  function normalizeSeparators(path: string): string {
    return path.replace(/\\/g, "/");
  }

  function stripTrailingSlash(path: string): string {
    return path.replace(/\/+$/, "");
  }

  function toFileUri(path: string): string | null {
    if (!path) return null;
    const normalized = normalizeSeparators(path);
    if (normalized.startsWith("//")) {
      return `file:${encodeURI(normalized)}`;
    }
    if (/^[A-Za-z]:/.test(normalized)) {
      const driveNormalized = normalized.replace(/^([A-Za-z]):/, (_, drive: string) => `${drive.toUpperCase()}:`);
      return `file:///${encodeURI(driveNormalized)}`;
    }
    const withLeading = normalized.startsWith("/") ? normalized.slice(1) : normalized;
    return `file:///${encodeURI(withLeading)}`;
  }

  function toMentionPath(path: string, isDirectory: boolean): string | null {
    const root = get(rootPath) || "";
    const normalizedRootRaw = stripTrailingSlash(normalizeSeparators(root));
    const normalizedRoot = normalizedRootRaw.toLowerCase();
    const normalizedPathRaw = normalizeSeparators(path);
    const normalizedPath = normalizedPathRaw.toLowerCase();

    if (normalizedRoot) {
      const rootMatch = normalizedPath === normalizedRoot;
      const nestedMatch = normalizedPath.startsWith(`${normalizedRoot}/`);
      if (rootMatch || nestedMatch) {
        let relative = rootMatch ? "" : normalizedPathRaw.substring(normalizedRootRaw.length);
        if (!relative.startsWith("/")) {
          relative = `/${relative}`;
        }
        if (isDirectory && !relative.endsWith("/")) {
          relative = `${relative}/`;
        }
        return relative === "" ? "/" : relative;
      }
    }

    let fallback = normalizedPathRaw.startsWith("/") ? normalizedPathRaw : `/${normalizedPathRaw}`;
    if (isDirectory && !fallback.endsWith("/")) {
      fallback = `${fallback}/`;
    }
    return fallback;
  }

  function formatMention(value: string): string {
    if (value.startsWith("/") && value.includes(" ")) {
      return `"${value}"`;
    }
    return value;
  }

  function handleDragStart(event: DragEvent, row: VisibleRow) {
    const transfer = event.dataTransfer;
    if (!transfer) return;

    const fileUri = toFileUri(row.path);
    if (!fileUri) return;

    const resourceEntry = encodeURIComponent(fileUri);
    transfer.effectAllowed = "copy";
    transfer.setData("resourceurls", JSON.stringify([resourceEntry]));
    transfer.setData("application/vnd.code.uri-list", `${fileUri}\n`);

    const mentionPath = toMentionPath(row.path, row.isDirectory);
    if (mentionPath) {
      transfer.setData("text/plain", `@${formatMention(mentionPath)} `);
    }
  }
</script>

<!-- 右键菜单由全局 ContextMenuHost 承载，无需本地开关 -->

<VirtualList rowHeight={rowHeight} items={$visibleRows} overscan={8} bind:this={virtualListRef}>
  <div slot="row" let:visible let:start>
    {#each visible as row, i (row.id)}
      {@const depth = Math.max(0, row.depth ?? 0)}
      <div
        class={`ft-row ${$selectedPath === row.path ? 'selected' : ''}`}
        class:deleting={row.status === 'deleting'}
        class:dark-theme={$is_dark_theme}
        data-path={row.path}
        style={`height:${rowHeight}px; --depth:${depth};`}
        draggable={canDrag}
        on:dragstart={(event) => handleDragStart(event, row)}
        on:click={() => onRowClick(row)}
        on:contextmenu|preventDefault={(e) => handleRowContextMenu(row, e)}
        title={row.path}
        role="button"
        tabindex="0"
        aria-disabled={row.status === 'deleting' ? 'true' : undefined}
        on:keydown={(e) => onRowKeydown(row, e)}
      >
        <span class="tree-cols" aria-hidden="true">
          <!-- Ancestor guide columns (depth), then the current node icon column. -->
          <span class="indent-guides" aria-hidden="true"></span>
          <span class="icon-col">
            {#if row.isDirectory}
              <DirectoryIcon expanded={!!row.expanded} />
            {:else}
              <FileTypeIcon filename={row.name} />
            {/if}
          </span>
        </span>
        <span class="label">{row.name}</span>
        {#if row.status === 'deleting'}
          <span class="status-pill deleting">删除中…</span>
        {/if}
      </div>
    {/each}
  </div>
</VirtualList>

<!-- 无内嵌 ContextMenu -->

<style>
  .ft-row {
    /* Theme-tuned tree guide color; callers can override via CSS vars. */
    --filetree-guide-color: rgba(0, 0, 0, 0.10);
    display: flex;
    align-items: center;
    /* Controls spacing between icon and label; keep tight like VSCode. */
    gap: 2px;
    cursor: pointer;
    /* No vertical padding, otherwise the guide line looks "broken" between rows. */
    padding: 0 10px 0 8px;
    font-size: var(--filetree-row-font-size, 14px);
    line-height: 1.45;
    width: 100%;
    box-sizing: border-box;
    border-radius: 4px;
    /* Avoid layout-affecting borders; they create 1px gaps in "continuous" tree guides. */
    border: 0;
    position: relative;
    transition: background-color 0.12s ease, border-color 0.12s ease;
  }
  .ft-row.dark-theme {
    --filetree-guide-color: rgba(255, 255, 255, 0.14);
  }
  /* Put tree guides underneath row contents. */
  .ft-row > * { position: relative; z-index: 1; }

  .tree-cols {
    /* This defines the indentation grid; align guide lines with icon centers. */
    /* Use em-based sizing so icon + indentation scale with the row font size. */
    --ft-indent-step: var(--filetree-indent-step, 1.45em);
    --ft-icon-size: var(--filetree-icon-size, 0.9em);
    /* Center guide lines within each indent column, with a small bias to match icon visual center. */
    --ft-guide-bias: var(--filetree-guide-bias, -1px);
    --ft-guide-x: calc((var(--ft-indent-step) / 2) + var(--ft-guide-bias));
    --ft-tree-guide: var(--filetree-guide-color, rgba(128, 128, 128, 0.35));
    height: 100%;
    flex: 0 0 auto;
    display: flex;
    align-items: stretch;
  }

  /*
    Performance: theme toggles force style recalculation on visible rows.
    Rendering N "columns" per row (Array.from + spans) scales with depth and can get slow.
    Keep DOM constant per row: one guides span + one icon span.
  */
  .indent-guides {
    width: calc(var(--depth) * var(--ft-indent-step));
    height: 100%;
    flex: 0 0 auto;
    background-image: repeating-linear-gradient(
      to right,
      transparent 0,
      transparent var(--ft-guide-x),
      var(--ft-tree-guide) var(--ft-guide-x),
      var(--ft-tree-guide) calc(var(--ft-guide-x) + 1px),
      transparent calc(var(--ft-guide-x) + 1px),
      transparent var(--ft-indent-step)
    );
    background-repeat: repeat;
    background-size: var(--ft-indent-step) 100%;
    background-position: 0 0;
  }

  .icon-col {
    width: var(--ft-indent-step);
    height: 100%;
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .icon-col :global(svg) {
    width: var(--ft-icon-size);
    height: var(--ft-icon-size);
    flex: 0 0 auto;
  }
  .ft-row.deleting {
    opacity: 0.55;
    cursor: wait;
    pointer-events: none;
  }
  .ft-row:hover:not(.selected) {
    background: var(--vscode-list-hoverBackground, rgba(128,128,128,0.08));
  }

  /* Don't force a minimum size; icon sizes are controlled explicitly via CSS vars. */
  .ft-row :global(svg) { min-width: 0; min-height: 0; }
  .label {
    font-size: inherit;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
    flex: 1;
    text-align: left;
  }
  .ft-row.selected {
    background: var(--vscode-list-activeSelectionBackground, rgba(0, 120, 215, 0.22));
    box-shadow: inset 0 0 0 1px var(--vscode-focusBorder, rgba(0, 120, 215, 0.9));
  }

  .ft-row.selected .label { color: inherit; }
  .status-pill {
    font-size: 11px;
    padding: 0 6px;
    border-radius: 999px;
    border: 1px solid transparent;
    line-height: 1.4;
    margin-left: 6px;
    white-space: nowrap;
  }
  .status-pill.deleting {
    background: rgba(255, 166, 0, 0.12);
    border-color: rgba(255, 166, 0, 0.3);
    color: var(--status-pill-deleting-color, #c27d00);
  }
</style>
