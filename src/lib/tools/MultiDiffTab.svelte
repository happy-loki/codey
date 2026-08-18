<script lang="ts">
  import DiffEditors from "../widgets/DiffEditors.svelte";
  import type { MultiDiffEntry } from "./multiDiffHost";
  import { FolderTree, FileText } from "lucide-svelte";
  import { getRootPath } from "../tree/normalizedStore";

  export let sessionId: string;
  export let title: string = "Multi-file Diff";
  export let diffs: MultiDiffEntry[] = [];
  export let hidden: boolean = false;

  type DiffTreeNode = {
    name: string;
    path?: string;
    displayPath?: string;
    index?: number;
    children?: DiffTreeNode[];
    isFile: boolean;
  };

  type FlatRow = {
    key: string;
    indent: number;
    label: string;
    isDirectory: boolean;
    fileIndex: number | null;
    fullPath?: string;
  };

  let activeIndex = 0;
  let sidebarWidth = 130;
  let isResizing = false;

  $: normalized = Array.isArray(diffs) ? diffs : [];
  $: total = normalized.length;
  $: if (total === 0) {
    activeIndex = 0;
  } else if (activeIndex > total - 1) {
    activeIndex = total - 1;
  }
  $: active = total ? normalized[activeIndex] : null;

  function relativizeToWorkspace(rawPath: string): string {
    if (!rawPath) return rawPath;
    const root = getRootPath() || "";
    const normalize = (p: string) => p.replace(/\\/g, "/");
    const pathNorm = normalize(rawPath);
    const rootNorm = normalize(root);
    if (!rootNorm) return pathNorm;

    const pathLower = pathNorm.toLowerCase();
    const rootLower = rootNorm.toLowerCase();

    if (pathLower === rootLower) return "";
    if (pathLower.startsWith(rootLower.endsWith("/") ? rootLower : `${rootLower}/`)) {
      let rel = pathNorm.slice(rootNorm.length);
      if (rel.startsWith("/")) rel = rel.slice(1);
      return rel;
    }

    return pathNorm;
  }

  function buildDiffTree(entries: MultiDiffEntry[]): DiffTreeNode[] {
    const root: DiffTreeNode = { name: "", isFile: false, children: [] };

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      const rawPath = entry.path || `File ${i + 1}`;
      const displayPath = relativizeToWorkspace(rawPath) || rawPath;
      const normalizedPath = displayPath.replace(/\\/g, "/");
      const segments = normalizedPath.split("/").filter(Boolean);

      let current = root;
      let currentPath = "";
      for (let s = 0; s < segments.length; s++) {
        const segment = segments[s];
        const isLast = s === segments.length - 1;
        currentPath = currentPath ? `${currentPath}/${segment}` : segment;
        if (!current.children) current.children = [];
        let child = current.children.find((c) => c.name === segment);
        if (!child) {
          child = {
            name: segment,
            isFile: isLast,
            path: currentPath,
            children: isLast ? undefined : [],
          };
          current.children.push(child);
        }
        if (isLast) {
          child.isFile = true;
          child.path = displayPath;
          child.index = i;
        } else {
          current = child;
        }
      }
    }

    return root.children ?? [];
  }

  function flattenTree(nodes: DiffTreeNode[], depth = 0, rows: FlatRow[] = []): FlatRow[] {
    for (const node of nodes) {
      const indent = depth * 14;
      if (!node.isFile) {
        rows.push({
          key: `dir:${node.path || node.name}`,
          indent,
          label: node.name,
          isDirectory: true,
          fileIndex: null,
          fullPath: node.displayPath || node.path || node.name,
        });
      }

      if (node.children && node.children.length) {
        flattenTree(node.children, depth + (node.isFile ? 0 : 1), rows);
      }

      if (node.isFile && typeof node.index === "number") {
        rows.push({
          key: `file:${node.index}`,
          indent: depth * 14,
          label: node.name,
          isDirectory: false,
          fileIndex: node.index,
          fullPath: node.displayPath || node.path,
        });
      }
    }
    return rows;
  }

  $: diffTree = buildDiffTree(normalized);
  $: flatRows = flattenTree(diffTree);

  function setActive(index: number) {
    if (index < 0 || index >= total) return;
    activeIndex = index;
  }

  function cycle(delta: number) {
    if (!total) return;
    const next = (activeIndex + delta + total) % total;
    activeIndex = next;
  }

  function goNext() {
    cycle(1);
  }

  function handleKey(event: KeyboardEvent) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      cycle(1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      cycle(-1);
    } else if (event.key === "Home") {
      event.preventDefault();
      setActive(0);
    } else if (event.key === "End") {
      event.preventDefault();
      setActive(total - 1);
    }
  }

  function fileName(path: string | undefined | null): string {
    if (!path) return "Untitled";
    const normalizedPath = path.replace(/\\/g, "/");
    const segments = normalizedPath.split("/");
    const last = segments.pop();
    return last && last.length > 0 ? last : normalizedPath;
  }

  function fileDir(path: string | undefined | null): string {
    if (!path) return "";
    const normalizedPath = path.replace(/\\/g, "/");
    const idx = normalizedPath.lastIndexOf("/");
    return idx >= 0 ? normalizedPath.slice(0, idx) : "";
  }

  function startResize(event: MouseEvent) {
    event.preventDefault();
    isResizing = true;
    const startX = event.clientX;
    const startWidth = sidebarWidth;

    const handleMove = (e: MouseEvent) => {
      if (!isResizing) return;
      const delta = e.clientX - startX;
      const next = Math.min(320, Math.max(120, startWidth + delta));
      sidebarWidth = next;
    };

    const handleUp = () => {
      isResizing = false;
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };

    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
  }
</script>

<div class="multi-diff-tab" data-session={sessionId} hidden={hidden}>
  <header class="multi-diff-header">
    <div class="actions">
      <button type="button" on:click={goNext} disabled={total <= 1}>下一条差异</button>
    </div>
  </header>
  <div class="multi-diff-body">
    <aside
      class="file-list"
      on:keydown={handleKey}
      tabindex="0"
      aria-label="Multi-file diff navigation"
      style={`width: ${sidebarWidth}px`}
    >
      {#if total === 0}
        <div class="empty-list">No files to display.</div>
      {:else}
        {#each flatRows as row (row.key)}
          {#if row.isDirectory}
            <div
              class="tree-row dir-row"
              style={`padding-left: ${8 + row.indent}px`}
              title={row.fullPath || row.label}
            >
              <FolderTree size={14} class="tree-icon" />
              <span class="label">{row.label}</span>
            </div>
          {:else}
            <button
              type="button"
              class:selected={row.fileIndex === activeIndex}
              class="tree-row file-row"
              style={`padding-left: ${8 + row.indent}px`}
              on:click={() => row.fileIndex != null && setActive(row.fileIndex)}
              title={row.fullPath || row.label}
            >
              <FileText size={14} class="tree-icon" />
              <span class="label">{row.label}</span>
            </button>
          {/if}
        {/each}
      {/if}
    </aside>
    <div
      class="sidebar-resizer"
      on:mousedown={startResize}
      aria-hidden="true"
    ></div>
    <section class="viewer">
      {#if active}
        <DiffEditors
          original={active.left ?? ""}
          content={active.right ?? ""}
          path={active.path}
          scrollToLine={undefined}
          languageHint={null}
          renderSideBySide="auto"
        />
      {:else}
        <div class="empty-viewer">Select a file on the left to see its diff.</div>
      {/if}
    </section>
  </div>
</div>

<style>
  .multi-diff-tab {
    display: flex;
    flex-direction: column;
    height: 100%;
    width: 100%;
    min-height: 0;
    background: var(--editor-background, hsl(var(--background)));
    color: var(--editor-foreground, hsl(var(--foreground)));
  }

  .multi-diff-header {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    padding: 0.4rem 0.75rem;
    border-bottom: 1px solid var(--editor-border, hsl(var(--border)));
    gap: 0.75rem;
  }

  .title-block {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    min-width: 0;
  }

  .title-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .title-block h2 {
    font-size: 0.95rem;
    margin: 0;
  }

  .subtitle {
    font-size: 0.85rem;
    color: hsl(var(--muted-foreground));
  }

  .actions {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .actions button {
    border: 1px solid var(--editor-border, hsl(var(--border)));
    background: color-mix(
      in srgb,
      var(--editor-foreground, hsl(var(--foreground))) 8%,
      var(--editor-background, hsl(var(--background)))
    );
    color: inherit;
    border-radius: 6px;
    padding: 0.35rem 0.75rem;
    cursor: pointer;
  }

  .actions button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .actions button:not(:disabled):hover {
    background: color-mix(
      in srgb,
      var(--editor-foreground, hsl(var(--foreground))) 14%,
      var(--editor-background, hsl(var(--background)))
    );
  }

  .active-path {
    flex: 0 1 auto;
    min-width: 0;
    text-align: left;
    font-size: 0.85rem;
    color: hsl(var(--muted-foreground));
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .multi-diff-body {
    flex: 1;
    display: flex;
    min-height: 0;
    width: 100%;
  }

  .sidebar-resizer {
    width: 3px;
    cursor: col-resize;
    background: transparent;
    border-right: 1px solid var(--editor-border, hsl(var(--border)));
  }

  .sidebar-resizer:hover,
  .sidebar-resizer:active {
    background: color-mix(
      in srgb,
      var(--editor-foreground, hsl(var(--foreground))) 10%,
      transparent
    );
  }

  .file-list {
    border-right: 1px solid var(--editor-border, hsl(var(--border)));
    background: var(--sidepanel-background, var(--panel-background, hsl(var(--secondary))));
    overflow-y: auto;
    padding: 0.5rem;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .tree-row {
    width: 100%;
    text-align: left;
    border-radius: 6px;
    padding: 0.35rem 0.4rem;
    display: flex;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.85rem;
    box-sizing: border-box;
  }

  .file-row {
    border: none;
    background: transparent;
    color: inherit;
    cursor: pointer;
  }

  .dir-row {
    color: hsl(var(--muted-foreground));
  }

  .file-row:hover,
  .file-row:focus-visible {
    background: color-mix(
      in srgb,
      var(--editor-foreground, hsl(var(--foreground))) 10%,
      transparent
    );
    outline: none;
  }

  .file-row.selected {
    background: color-mix(
      in srgb,
      hsl(var(--primary)) 22%,
      transparent
    );
  }

  .tree-icon {
    flex: 0 0 auto;
  }

  .label {
    flex: 1 1 auto;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .empty-list,
  .empty-viewer {
    padding: 1rem;
    color: hsl(var(--muted-foreground));
  }

  .viewer {
    flex: 1;
    min-width: 0;
    min-height: 0;
    display: flex;
  }
</style>
