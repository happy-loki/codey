<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { monaco } from "../monaco/instance";
  import { detectLanguage, applyLanguageToModel, type MonacoLanguageDescriptor } from "../monaco/language-service";

  export let original: string = "";
  export let content: string = "";
  export let scrollToLine: number | undefined;
  export let scrollRequestId: number | undefined;
  export let path: string | null | undefined;
  export let languageHint: string | null | undefined;
  // auto: side‑by‑side only when both sides have content
  export let renderSideBySide: boolean | "auto" = "auto";

  let host: HTMLDivElement | null = null;
  let diffEditor: monaco.editor.IStandaloneDiffEditor | null = null;
  let originalModel: monaco.editor.ITextModel | null = null;
  let modifiedModel: monaco.editor.ITextModel | null = null;
  let currentLanguage: MonacoLanguageDescriptor | null = null;

  function normalizeExt(raw: string | null | undefined): string | null {
    if (!raw) return null;
    const trimmed = raw.trim().toLowerCase();
    if (!trimmed) return null;
    return trimmed.startsWith(".") ? trimmed.slice(1) : trimmed;
  }

  function extFromPath(rawPath: string | null | undefined): string | null {
    if (!rawPath) return null;
    const normalized = rawPath.replace(/\\/g, "/");
    const filename = normalized.split("/").pop() || normalized;
    const idx = filename.lastIndexOf(".");
    if (idx <= 0 || idx === filename.length - 1) return null;
    return filename.slice(idx + 1).toLowerCase();
  }

  function disposeEditor() {
    if (diffEditor) {
      diffEditor.dispose();
      diffEditor = null;
    }
    if (originalModel) {
      originalModel.dispose();
      originalModel = null;
    }
    if (modifiedModel) {
      modifiedModel.dispose();
      modifiedModel = null;
    }
  }

  function applyLanguage(descriptor: MonacoLanguageDescriptor | null) {
    if (!descriptor) return;
    if (descriptor.id === currentLanguage?.id) return;
    applyLanguageToModel(originalModel, descriptor);
    applyLanguageToModel(modifiedModel, descriptor);
    currentLanguage = descriptor;
  }

  $: requestedLanguage = detectLanguage({
    extension: normalizeExt(languageHint) || extFromPath(path),
    hint: languageHint,
    path,
  });

  $: if (diffEditor && originalModel && originalModel.getValue() !== (original ?? "")) {
    originalModel.setValue(original ?? "");
  }
  $: if (diffEditor && modifiedModel && modifiedModel.getValue() !== (content ?? "")) {
    modifiedModel.setValue(content ?? "");
  }
  $: if (diffEditor) {
    applyLanguage(requestedLanguage);
  }

  function revealModifiedLine(targetLine: number, targetColumn = 1) {
    if (!diffEditor) return;
    const modified = diffEditor.getModifiedEditor();
    const model = modified?.getModel();
    if (!modified || !model) return;
    const lineCount = model.getLineCount();
    const ln = Math.max(1, Math.min(lineCount, Math.floor(targetLine)));
    const col = Math.max(1, Math.floor(targetColumn));
    modified.setSelection({
      startLineNumber: ln,
      startColumn: col,
      endLineNumber: ln,
      endColumn: col,
    });
    modified.revealPositionInCenter({ lineNumber: ln, column: col });
  }

  let pendingScrollRaf = 0;
  let lastAppliedScrollToken: number | null = null;
  let lastAppliedScrollLine: number | null = null;
  $: if (diffEditor && typeof scrollToLine === "number") {
    const targetLine = Math.max(1, Math.floor(scrollToLine) + 1);
    const token = typeof scrollRequestId === "number" ? scrollRequestId : null;
    const isDuplicate =
      token !== null
        ? token === lastAppliedScrollToken
        : lastAppliedScrollToken === null && lastAppliedScrollLine === targetLine;
    if (isDuplicate) {
      // Ignore redundant scroll requests to avoid fighting with user input.
    } else {
      if (token !== null) {
        lastAppliedScrollToken = token;
        lastAppliedScrollLine = targetLine;
      } else {
        lastAppliedScrollToken = null;
        lastAppliedScrollLine = targetLine;
      }
      if (pendingScrollRaf) cancelAnimationFrame(pendingScrollRaf);
      pendingScrollRaf = requestAnimationFrame(() => {
        pendingScrollRaf = 0;
        revealModifiedLine(targetLine);
      });
    }
  }

  function computeSideBySide(): boolean {
    if (renderSideBySide === "auto") {
      const hasOriginal = !!(original && original.trim().length);
      const hasModified = !!(content && content.trim().length);
      // For pure adds / deletes, prefer a single-column diff to avoid wasted space.
      return hasOriginal && hasModified;
    }
    return !!renderSideBySide;
  }

  $: if (diffEditor) {
    diffEditor.updateOptions({ renderSideBySide: computeSideBySide() });
  }

  onMount(() => {
    originalModel = monaco.editor.createModel(original ?? "", requestedLanguage?.id);
    modifiedModel = monaco.editor.createModel(content ?? "", requestedLanguage?.id);
    diffEditor = monaco.editor.createDiffEditor(host!, {
      readOnly: true,
      automaticLayout: true,
      renderSideBySide: computeSideBySide(),
      scrollBeyondLastLine: false,
      renderIndicators: true,
      originalEditable: false,
      minimap: { enabled: false },
      folding: true,
      showFoldingControls: "mouseover",
    });
    diffEditor.setModel({ original: originalModel, modified: modifiedModel });
    applyLanguage(requestedLanguage);
  });

  onDestroy(() => {
    disposeEditor();
    if (pendingScrollRaf) {
      cancelAnimationFrame(pendingScrollRaf);
      pendingScrollRaf = 0;
    }
  });
</script>

<div class="diff-editor" bind:this={host}></div>

<style>
  .diff-editor {
    height: 100%;
    width: 100%;
  }

  :global(.monaco-editor),
  :global(.monaco-diff-editor) {
    outline: none;
  }

  :global(.monaco-diff-editor .monaco-scrollable-element .scrollbar) {
    right: 2px;
  }

  :global(.monaco-diff-editor .editor.original .margin),
  :global(.monaco-diff-editor .editor.modified .margin) {
    min-width: calc(4ch + 12px);
  }

  :global(.monaco-diff-editor .editor.original .margin .line-numbers),
  :global(.monaco-diff-editor .editor.modified .margin .line-numbers) {
    min-width: calc(4ch + 12px);
    padding: 0 6px;
    text-align: right;
  }
</style>
