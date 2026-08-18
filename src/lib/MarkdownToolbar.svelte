<script lang="ts">
  import { onDestroy } from "svelte";
  import { get } from "svelte/store";
  import { editorViewStore, type MonacoEditor } from "./editorViewStore";
  import { monaco } from "./monaco/instance";
  import { activeInfo } from "./editorBus";
  import { workingDir } from "./File";
  import { openDrawioDialog } from "./markdown/drawioDialogStore";
  import { buildDrawioHtml, persistDrawioDiagram } from "./markdown/drawioHelpers";
  import { computeRelativePath } from "./markdown/pathUtils";
  import { addNotification, NotifType } from "./Notifications/notifications";

  // lucide-svelte icons
  import {
    Bold,
    Italic,
    Strikethrough,
    Link,
    Image as ImageIcon,
    Code,
    Code2,
    Quote,
    List,
    ListOrdered,
    Heading1,
    Heading2,
    Heading3,
    Minus,
    Table,
    Undo,
    Redo
  } from "lucide-svelte";
  const ICON_SIZE = 16;

  function withEditor(run: (editor: MonacoEditor, model: monaco.editor.ITextModel, selection: monaco.Selection) => void) {
    const editor = get(editorViewStore) as MonacoEditor | null;
    const model = editor?.getModel();
    const selection = editor?.getSelection();
    if (!editor || !model || !selection) return;
    run(editor, model, selection);
  }

  function wrapSelection(prefix: string, suffix: string) {
    withEditor((editor, model, selection) => {
      const selected = model.getValueInRange(selection);
      const insert = `${prefix}${selected || ""}${suffix}`;
      const startOffset = model.getOffsetAt(selection.getStartPosition());
      editor.executeEdits("markdown-toolbar", [
        { range: selection, text: insert, forceMoveMarkers: true }
      ]);
      const anchorOffset = startOffset + prefix.length;
      const headOffset = startOffset + insert.length - suffix.length;
      const anchorPos = model.getPositionAt(anchorOffset);
      const headPos = model.getPositionAt(headOffset);
      editor.setSelection(new monaco.Selection(anchorPos.lineNumber, anchorPos.column, headPos.lineNumber, headPos.column));
      editor.focus();
    });
  }

  function insertAtCursor(text: string) {
    withEditor((editor, model, selection) => {
      const startOffset = model.getOffsetAt(selection.getStartPosition());
      editor.executeEdits("markdown-toolbar", [
        { range: selection, text, forceMoveMarkers: true }
      ]);
      const cursorPos = model.getPositionAt(startOffset + text.length);
      editor.setSelection(new monaco.Selection(cursorPos.lineNumber, cursorPos.column, cursorPos.lineNumber, cursorPos.column));
      editor.focus();
    });
  }

  function cmdBold() { wrapSelection("**", "**"); }
  function cmdItalic() { wrapSelection("*", "*"); }
  function cmdStrike() { wrapSelection("~~", "~~"); }
  function cmdInlineCode() { wrapSelection("`", "`"); }
  function cmdBlockCode() { insertAtCursor("\n```\n\n```\n"); }
  function cmdQuote() { insertAtCursor("> "); }
  function cmdList() { insertAtCursor("- "); }
  function cmdListOrdered() { insertAtCursor("1. "); }
  function cmdTable() { insertAtCursor("\n| 表头 | 表头 |\n| --- | --- |\n| 内容 | 内容 |\n"); }
  function cmdH1() { insertAtCursor("# "); }
  function cmdH2() { insertAtCursor("## "); }
  function cmdH3() { insertAtCursor("### "); }
  function cmdHr() { insertAtCursor("\n\n---\n\n"); }
  const isTauri = typeof window !== "undefined" && !!(window as any).__TAURI_INTERNALS__;
  const DEFAULT_LINK_TEXT = "名字";
  const DEFAULT_LINK_URL = "https://xxx.com";
  const DEFAULT_IMAGE_ALT = "图片描述";
  const DEFAULT_IMAGE_URL = "https://xxx.png";
  const IMAGE_FILTER_EXTENSIONS = ["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "ico", "avif"];

  let showImageModal = false;
  let activeImageTab: "local" | "url" = "local";
  let fileInput: HTMLInputElement | undefined;
  let convertFileSrcFn: ((path: string) => string) | null = null;
  const blobUrls = new Set<string>();

  function insertLinkPlaceholder() {
    withEditor((editor, model, selection) => {
      const selected = model.getValueInRange(selection) || DEFAULT_LINK_TEXT;
      const insert = `[${selected}](${DEFAULT_LINK_URL})`;
      const startOffset = model.getOffsetAt(selection.getStartPosition());
      editor.executeEdits("markdown-toolbar", [
        { range: selection, text: insert, forceMoveMarkers: true }
      ]);
      const cursorPos = model.getPositionAt(startOffset + insert.length);
      editor.setSelection(new monaco.Selection(cursorPos.lineNumber, cursorPos.column, cursorPos.lineNumber, cursorPos.column));
      editor.focus();
    });
  }

  function insertImageMarkdown(target: string) {
    if (!target) return;
    withEditor((editor, model, selection) => {
      const insert = `![${DEFAULT_IMAGE_ALT}](${target})`;
      const startOffset = model.getOffsetAt(selection.getStartPosition());
      editor.executeEdits("markdown-toolbar", [
        { range: selection, text: insert, forceMoveMarkers: true }
      ]);
      const cursorPos = model.getPositionAt(startOffset + insert.length);
      editor.setSelection(new monaco.Selection(cursorPos.lineNumber, cursorPos.column, cursorPos.lineNumber, cursorPos.column));
      editor.focus();
    });
  }

  async function ensureConvertFileSrc() {
    if (!isTauri || convertFileSrcFn) return;
    const { convertFileSrc } = await import("@tauri-apps/api/core");
    convertFileSrcFn = convertFileSrc;
  }

  function stripFileProtocol(value: string): string {
    if (value.startsWith("file://")) {
      try {
        const url = new URL(value);
        const pathname = url.pathname || "";
        if (/^\/[a-zA-Z]:/.test(pathname)) {
          return pathname.slice(1).replace(/\//g, "\\");
        }
        return decodeURIComponent(pathname);
      } catch (error) {
        console.warn("Failed to parse file url", value, error);
        return value.replace(/^file:\/\//i, "");
      }
    }
    return value;
  }

  function preferRelativePath(target: string) {
    const info = get(activeInfo);
    const workspace = get(workingDir);
    return computeRelativePath(target, [info?.path ?? null, workspace]) ?? null;
  }

  function looksLikeDevServerPath(value: string): boolean {
    return /https?:\/\/127\.0\.0\.1(?::\d+)?\//.test(value) || /https?:\/\/localhost(?::\d+)?\//.test(value);
  }

  function buildAssetUrl(pathname: string): string {
    const normalized = pathname.replace(/\\/g, "/");
    const withPrefix = normalized.startsWith("/") ? normalized : `/${normalized}`;
    const encoded = withPrefix
      .split("/")
      .map((segment) => (segment.length === 0 ? "" : encodeURIComponent(segment)))
      .join("/");
    return `asset://localhost${encoded}`;
  }

  function ensureAssetUrl(converted: string, originalPath: string): string {
    if (!converted) {
      return buildAssetUrl(originalPath);
    }
    if (/^(asset|tauri):\/\//i.test(converted)) {
      return converted;
    }
    if (looksLikeDevServerPath(converted)) {
      return buildAssetUrl(originalPath);
    }
    if (/^https?:/i.test(converted)) {
      return converted;
    }
    if (converted.startsWith("file://")) {
      return converted;
    }
    return buildAssetUrl(originalPath);
  }

  async function resolveLocalImageTarget(rawPath: string) {
    if (!rawPath) return rawPath;
    const cleaned = stripFileProtocol(rawPath.trim());
    if (!cleaned) return cleaned;
    const relative = preferRelativePath(cleaned);
    if (relative) {
      return relative;
    }
    if (isTauri) {
      await ensureConvertFileSrc();
      if (convertFileSrcFn) {
        try {
          const converted = convertFileSrcFn(cleaned);
          return ensureAssetUrl(converted, cleaned);
        } catch (error) {
          console.warn("convertFileSrc failed", cleaned, error);
          return buildAssetUrl(cleaned);
        }
      }
      return buildAssetUrl(cleaned);
    }
    return createFileUrl(cleaned);
  }

  function createFileUrl(path: string) {
    if (!path) return path;
    if (/^(?:https?|data|blob|asset|tauri|app):/i.test(path)) {
      return path;
    }
    const normalized = path.replace(/\\/g, "/");
    if (normalized.startsWith("/")) {
      return encodeURI(`file://${normalized}`);
    }
    if (/^[a-zA-Z]:\//.test(normalized)) {
      return encodeURI(`file:///${normalized}`);
    }
    return encodeURI(normalized);
  }

  async function insertImageFromLocalPath(rawPath: string) {
    const target = await resolveLocalImageTarget(rawPath);
    insertImageMarkdown(target);
  }

  function createObjectUrl(file: File) {
    const url = URL.createObjectURL(file);
    blobUrls.add(url);
    return url;
  }

  function cmdLink() {
    insertLinkPlaceholder();
  }

  function resetImageModalState() {
    activeImageTab = "local";
  }

  function openImageModal() {
    resetImageModalState();
    showImageModal = true;
  }

  function closeImageModal() {
    showImageModal = false;
  }

  function cmdImage() {
    openImageModal();
  }

  function insertDrawioMarkup(markup: string) {
    withEditor((editor, model, selection) => {
      const startOffset = model.getOffsetAt(selection.getStartPosition());
      const doc = model.getValue();
      const beforeChar = startOffset > 0 ? doc.slice(startOffset - 1, startOffset) : "";
      const prefix = beforeChar && beforeChar !== "\n" ? "\n" : "";
      const insert = `${prefix}${markup}\n`;
      editor.executeEdits("markdown-toolbar", [
        { range: selection, text: insert, forceMoveMarkers: true }
      ]);
      const cursorPos = model.getPositionAt(startOffset + insert.length);
      editor.setSelection(new monaco.Selection(cursorPos.lineNumber, cursorPos.column, cursorPos.lineNumber, cursorPos.column));
      editor.focus();
    });
  }

  async function cmdDrawio() {
    if (!isTauri) {
      console.warn("draw 插入仅在桌面环境可用");
      return;
    }
    try {
      const result = await openDrawioDialog("insert");
      if (!result) return;
      if (!result.base64 || !result.xmlData) {
        console.warn("draw 返回数据不完整", result);
        return;
      }
      const persisted = await persistDrawioDiagram(result);
      const markup = buildDrawioHtml({
        imageRelativePath: persisted.imageRelativePath,
        xmlRelativePath: persisted.xmlRelativePath,
      });
      insertDrawioMarkup(markup);
    } catch (error) {
      console.error("插入 draw 图形失败", error);
      const message = error instanceof Error ? error.message : `${error}`;
      addNotification(NotifType.Error, "draw 插入失败", [], message);
    }
  }

  async function handleLocalImageSelection() {
    if (isTauri) {
      try {
        const { open } = await import("@tauri-apps/plugin-dialog");
        const selection = await open({
          multiple: false,
          directory: false,
          filters: [{ name: "Images", extensions: IMAGE_FILTER_EXTENSIONS }]
        });
        if (typeof selection === "string" && selection) {
          await insertImageFromLocalPath(selection);
          closeImageModal();
        }
        return;
      } catch (error) {
        console.error("选择本地图片失败", error);
      }
    }
    fileInput?.click();
  }

  async function handleLocalFileChange(event: Event) {
    const target = event.currentTarget as HTMLInputElement;
    const file = target?.files?.[0];
    if (!file) return;
    const url = isTauri && (file as any)?.path ? await resolveLocalImageTarget((file as any).path) : createObjectUrl(file);
    insertImageMarkdown(url);
    closeImageModal();
    if (target) {
      target.value = "";
    }
  }

  function selectLocalTab() {
    activeImageTab = "local";
  }

  function selectUrlTab() {
    activeImageTab = "url";
    insertImageMarkdown(DEFAULT_IMAGE_URL);
    closeImageModal();
  }

  function onBackdropClick(event: MouseEvent) {
    if (event.currentTarget === event.target) {
      closeImageModal();
    }
  }

  onDestroy(() => {
    blobUrls.forEach((url) => URL.revokeObjectURL(url));
    blobUrls.clear();
  });
  function cmdUndo() {
    const editor = get(editorViewStore);
    editor?.trigger("markdown-toolbar", "undo", null);
  }
  function cmdRedo() {
    const editor = get(editorViewStore);
    editor?.trigger("markdown-toolbar", "redo", null);
  }
</script>

<div class="md-toolbar" role="toolbar" aria-label="Markdown toolbar">
  <div class="toolbar-group toolbar-group--primary">
    <div class="toolbar-subgroup">
      <button title="加粗" on:click={cmdBold}><Bold size={ICON_SIZE} /><span>加粗</span></button>
      <button title="斜体" on:click={cmdItalic}><Italic size={ICON_SIZE} /><span>斜体</span></button>
      <button title="删除线" on:click={cmdStrike}><Strikethrough size={ICON_SIZE} /><span>删除</span></button>
    </div>
    <div class="toolbar-subgroup">
      <button title="链接" on:click={cmdLink}><Link size={ICON_SIZE} /><span>链接</span></button>
      <button title="图片" on:click={cmdImage}><ImageIcon size={ICON_SIZE} /><span>图片</span></button>
      <button title="draw" class="md-toolbar__drawio" on:click={cmdDrawio}><span>draw</span></button>
    </div>
    <div class="toolbar-subgroup">
      <button title="行内代码" on:click={cmdInlineCode}><Code2 size={ICON_SIZE} /><span>行内</span></button>
      <button title="代码块" on:click={cmdBlockCode}><Code size={ICON_SIZE} /><span>代码</span></button>
    </div>
    <div class="toolbar-subgroup">
      <button title="H1" aria-label="H1" on:click={cmdH1}><Heading1 size={ICON_SIZE} /></button>
      <button title="H2" aria-label="H2" on:click={cmdH2}><Heading2 size={ICON_SIZE} /></button>
      <button title="H3" aria-label="H3" on:click={cmdH3}><Heading3 size={ICON_SIZE} /></button>
    </div>
    <div class="toolbar-subgroup">
      <button title="分割线" on:click={cmdHr}><Minus size={ICON_SIZE} /><span>分割</span></button>
      <button title="引用" on:click={cmdQuote}><Quote size={ICON_SIZE} /><span>引用</span></button>
      <button title="表格" on:click={cmdTable}><Table size={ICON_SIZE} /><span>表格</span></button>
      <button title="无序列表" on:click={cmdList}><List size={ICON_SIZE} /><span>无序</span></button>
      <button title="有序列表" on:click={cmdListOrdered}><ListOrdered size={ICON_SIZE} /><span>有序</span></button>
    </div>
    <div class="toolbar-subgroup">
      <button title="撤销" on:click={cmdUndo}><Undo size={ICON_SIZE} /><span>撤销</span></button>
      <button title="重做" on:click={cmdRedo}><Redo size={ICON_SIZE} /><span>重做</span></button>
    </div>
  </div>
</div>

{#if showImageModal}
  <div class="md-modal-backdrop" role="presentation" on:click={onBackdropClick}>
    <div class="md-modal" role="dialog" aria-modal="true" aria-labelledby="image-modal-title">
      <header class="md-modal__header">
        <h2 id="image-modal-title">插入图片</h2>
        <button type="button" class="md-modal__close" aria-label="关闭" on:click={closeImageModal}>
          ×
        </button>
      </header>
      <div class="md-modal__tabs" role="tablist" aria-label="图片插入方式">
        <button
          type="button"
          role="tab"
          aria-selected={activeImageTab === "local"}
          class:active={activeImageTab === "local"}
          on:click={selectLocalTab}
        >本地图片</button>
        <button
          type="button"
          role="tab"
          aria-selected={activeImageTab === "url"}
          class:active={activeImageTab === "url"}
          on:click={selectUrlTab}
        >图片链接</button>
      </div>
      {#if activeImageTab === "local"}
        <div class="md-modal__body">
          <p>从本地选择一张图片，将自动插入 Markdown 链接。</p>
          <button type="button" class="md-modal__action" on:click={handleLocalImageSelection}>选择图片文件</button>
          <input
            type="file"
            accept="image/*"
            class="md-modal__file-input"
            bind:this={fileInput}
            on:change={handleLocalFileChange}
          />
        </div>
      {:else}
        <div class="md-modal__body">
          <p>已插入示例图片链接，可在编辑器中修改 URL 或说明。</p>
        </div>
      {/if}
    </div>
  </div>
{/if}

<style lang="scss">
.md-toolbar {
  --toolbar-font-size: var(--ui-font-size, 16px);
  --toolbar-control-height: clamp(28px, calc(var(--toolbar-font-size) * 2.25), 46px);
  --toolbar-button-horizontal-padding: clamp(12px, calc(var(--toolbar-font-size) * 0.85), 20px);

  position: sticky;
  top: 0;
  z-index: 2;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 12px;
  background: var(--window-panelBackground, rgba(255, 255, 255, 0.9));
  border-bottom: 1px solid var(--window-borderColor, rgba(0, 0, 0, 0.08));
  backdrop-filter: blur(12px);
  flex-wrap: wrap;
  color: var(--window-foreground, inherit);

  .toolbar-group {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }

  .toolbar-group--primary {
    flex: 1 1 auto;
  }

  .toolbar-subgroup {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    padding: 2px 4px;
    border-radius: 22px;
    background: var(--window-inputBackground, rgba(255, 255, 255, 0.82));
    border: 1px solid color-mix(in srgb, var(--window-inputBorder, rgba(0, 0, 0, 0.1)) 75%, transparent);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, transparent 88%, var(--window-inputBorder, rgba(0, 0, 0, 0.08)) 12%);
    flex-wrap: nowrap;
  }

  button {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    border: none;
    border-radius: 18px;
    padding: 0 var(--toolbar-button-horizontal-padding);
    height: var(--toolbar-control-height);
    font-size: var(--toolbar-font-size);
    line-height: 1;
    background: transparent;
    color: inherit;
    transition: background 0.2s ease, color 0.2s ease;

    &:hover {
      background: color-mix(in srgb, var(--accent-color, #3b82f6) 12%, transparent);
    }

    svg {
      width: clamp(14px, calc(var(--toolbar-font-size) * 0.9), 20px);
      height: clamp(14px, calc(var(--toolbar-font-size) * 0.9), 20px);
    }

    span {
      font-size: inherit;
    }
  }

  .toolbar-subgroup:last-child button {
    min-width: 56px;
  }

  .md-toolbar__drawio {
    font-weight: 600;
    text-transform: lowercase;
  }
}

:global(#workarea.mode-split) .md-toolbar {
  margin-right: 0;
  padding-right: 12px;
}

:global(.dark) .md-toolbar,
:global(html[data-theme="dark"]) .md-toolbar {
  background: var(--preview-toolbar-surface, rgba(28, 34, 44, 0.92));
  border-bottom-color: var(--preview-toolbar-border, rgba(148, 163, 184, 0.16));
  color: var(--preview-text, #e5e7eb);

  .toolbar-subgroup {
    background: color-mix(in srgb, var(--preview-toolbar-surface, rgba(28, 34, 44, 0.92)) 90%, transparent);
    border-color: var(--preview-toolbar-border, rgba(148, 163, 184, 0.2));
    box-shadow: inset 0 0 0 1px color-mix(in srgb, transparent 85%, var(--preview-toolbar-border, rgba(148, 163, 184, 0.2)) 15%);
  }

  button {
    color: var(--preview-text, #e5e7eb);

    &:hover {
      background: color-mix(in srgb, var(--preview-toolbar-surface, rgba(28, 34, 44, 0.92)) 82%, var(--preview-link, #8e9eb9) 18%);
    }
  }
}

.md-modal-backdrop {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: color-mix(in srgb, rgba(15, 23, 42, 0.65) 75%, transparent);
  backdrop-filter: blur(6px);
  z-index: 100;
}

.md-modal {
  width: min(420px, 100%);
  padding: 20px;
  border-radius: 18px;
  background: var(--window-panelBackground, #ffffff);
  color: var(--window-foreground, #111827);
  box-shadow: 0 18px 48px rgba(15, 23, 42, 0.28);
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.md-modal__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;

  h2 {
    font-size: 18px;
    margin: 0;
  }
}

.md-modal__close {
  border: none;
  background: transparent;
  font-size: 22px;
  line-height: 1;
  cursor: pointer;
  color: inherit;
  padding: 4px 8px;

  &:hover {
    color: var(--accent-color, #3b82f6);
  }
}

.md-modal__tabs {
  display: inline-flex;
  border-radius: 14px;
  padding: 4px;
  background: color-mix(in srgb, var(--window-inputBackground, rgba(255, 255, 255, 0.9)) 90%, transparent);
  border: 1px solid color-mix(in srgb, var(--window-inputBorder, rgba(0, 0, 0, 0.12)) 70%, transparent);
  gap: 4px;

  button {
    border: none;
    border-radius: 10px;
    padding: 8px 14px;
    font-size: 14px;
    background: transparent;
    color: inherit;
    cursor: pointer;
    transition: background 0.2s ease, color 0.2s ease;

    &.active,
    &:hover {
      background: color-mix(in srgb, var(--accent-color, #3b82f6) 18%, transparent);
      color: color-mix(in srgb, var(--window-foreground, #111827) 40%, var(--accent-color, #3b82f6) 60%);
    }
  }
}

.md-modal__body {
  display: flex;
  flex-direction: column;
  gap: 12px;
  font-size: 14px;
  line-height: 1.5;

  p {
    margin: 0;
    color: color-mix(in srgb, var(--window-foreground, #111827) 75%, transparent);
  }
}

.md-modal__action {
  align-self: flex-start;
  border: none;
  border-radius: 10px;
  padding: 10px 18px;
  font-size: 14px;
  background: var(--accent-color, #3b82f6);
  color: #ffffff;
  cursor: pointer;
  transition: filter 0.2s ease;

  &:hover {
    filter: brightness(1.05);
  }
}

.md-modal__file-input {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
  pointer-events: none;
}

:global(.dark) .md-modal {
  background: var(--preview-toolbar-surface, rgba(28, 34, 44, 0.9));
  color: var(--preview-text, #e5e7eb);
  box-shadow: 0 18px 48px rgba(6, 11, 20, 0.6);
}

:global(.dark) .md-modal__tabs {
  background: color-mix(in srgb, var(--preview-toolbar-surface, rgba(28, 34, 44, 0.9)) 86%, transparent);
  border-color: var(--preview-toolbar-border, rgba(148, 163, 184, 0.25));
}

:global(.dark) .md-modal__tabs button:hover,
:global(.dark) .md-modal__tabs button.active {
  background: color-mix(in srgb, var(--preview-toolbar-surface, rgba(28, 34, 44, 0.9)) 70%, var(--preview-link, #90caf9) 30%);
  color: var(--preview-text, #e5e7eb);
}

:global(.dark) .md-modal__action {
  background: color-mix(in srgb, var(--preview-link, #90caf9) 75%, #1f2937 25%);
}
</style>
