<script lang="ts">
  import { onDestroy, onMount, tick } from "svelte";
  import { get } from "svelte/store";
  import renderedMarkdown from "./markdown/previewStore";
  import { resetMathJaxQueue, typesetMathInElement } from "./markdown/mathjax";
  import { emitScroll, setSyncScrollActive, subscribeScroll } from "./markdown/syncScroll";
  import { themeStylesheet } from "./markdown/themeStore";
  import {
    defaultStyleConfig,
    markdownWidthOptions,
    styleConfig,
  } from "./markdown/styleStore";
  import { openDrawioDialog } from "./markdown/drawioDialogStore";
  import {
    buildDrawioHtml,
    findDrawioBlockByXmlPath,
    loadDrawioXml,
    persistDrawioDiagram,
  } from "./markdown/drawioHelpers";
  import { editorViewStore } from "./editorViewStore";
  import { monaco } from "./monaco/instance";
  import { addNotification, NotifType } from "./Notifications/notifications";
  import { addEditorTab } from "./EditorTabList.svelte";

  let html = "";
  let previewElement: HTMLDivElement | null = null;
  let previewScrollRaf = 0;
  let suppressPreviewScroll = false;
  let lastKnownRatio = 0;
  let themeStyleElement: HTMLStyleElement | null = null;
  let unsubscribeTheme: (() => void) | null = null;
  let unsubscribeStyleConfig: (() => void) | null = null;
  const mobileWidthValue = markdownWidthOptions[0]?.value ?? "w-[578px]";
  const desktopWidthValue = markdownWidthOptions[1]?.value ?? "w-full";
  let widthValue = defaultStyleConfig.width ?? desktopWidthValue;
  let convertFileSrcFn: ((path: string) => string) | null = null;
  const isTauri = typeof window !== "undefined" && !!(window as any).__TAURI_INTERNALS__;

  $: isMobilePreview = widthValue === mobileWidthValue;
  $: previewContainerStyle = buildPreviewWidthStyle(widthValue);

  const unsubscribeMarkdown = renderedMarkdown.subscribe(async (value) => {
    html = value ?? "";
    await tick();

    const container = previewElement?.querySelector<HTMLElement>(".preview-wrapper");
    if (container) {
      await typesetMathInElement(container);
    }

    syncFrameBackground();
    applyPreviewScroll(lastKnownRatio);
  });

  function syncFrameBackground() {
    requestAnimationFrame(() => {
      const frame = previewElement?.querySelector<HTMLElement>(".preview-frame");
      if (!frame) return;

      if (isMobilePreview) {
        frame.style.backgroundColor = "var(--preview-mobile-backdrop, var(--preview-mobile-bg, #f5f7fb))";
        return;
      }

      frame.style.backgroundColor = "";

      // 尝试多个可能的选择器
      const selectors = ["#nice .container", "#nice > *", "#nice"];
      let bgColor = "transparent";

      for (const selector of selectors) {
        const element = previewElement?.querySelector<HTMLElement>(selector);
        if (element) {
          const color = window.getComputedStyle(element).backgroundColor;
          if (color && color !== "rgba(0, 0, 0, 0)" && color !== "transparent") {
            bgColor = color;
            break;
          }
        }
      }

      // 如果找到了背景色就设置，否则清除内联样式让 CSS 接管
      if (bgColor !== "transparent") {
        frame.style.backgroundColor = bgColor;
      } else {
        frame.style.backgroundColor = "";
      }
    });
  }

  const unsubscribeScroll = subscribeScroll("preview", (ratio) => {
    applyPreviewScroll(ratio);
  });

  function applyPreviewScroll(ratio: number) {
    lastKnownRatio = ratio;
    if (!previewElement) {
      return;
    }
    const max = previewElement.scrollHeight - previewElement.clientHeight;
    const target = max <= 0 ? 0 : ratio * max;
    suppressPreviewScroll = true;
    previewElement.scrollTo({ top: target });
    requestAnimationFrame(() => {
      suppressPreviewScroll = false;
    });
  }

  function handlePreviewScroll() {
    if (!previewElement || suppressPreviewScroll) {
      return;
    }
    if (previewScrollRaf) {
      return;
    }
    previewScrollRaf = requestAnimationFrame(() => {
      previewScrollRaf = 0;
      const ratio = getPreviewRatio();
      lastKnownRatio = ratio;
      emitScroll("preview", ratio);
    });
  }

  function getPreviewRatio(): number {
    if (!previewElement) return 0;
    const max = previewElement.scrollHeight - previewElement.clientHeight;
    if (max <= 0) return 0;
    return previewElement.scrollTop / max;
  }

  function buildPreviewWidthStyle(width: string | undefined | null): string {
    const value = width ?? desktopWidthValue;
    if (value === "w-full") {
      return "";
    }
    const match = /^w-\[(\d+)px\]$/.exec(value);
    if (match) {
      const px = match[1];
      return `max-width:${px}px;width:100%;`;
    }
    return "";
  }

  async function ensureConvertFileSrc() {
    if (convertFileSrcFn || !isTauri) return;
    const { convertFileSrc } = await import("@tauri-apps/api/core");
    convertFileSrcFn = convertFileSrc;
  }

  async function openExternalUrl(url: string) {
    if (!isTauri) return;
    try {
      const { openPath } = await import("@tauri-apps/plugin-opener");
      await openPath(url);
    } catch {}
  }

  function isExternalUrl(value: string): boolean {
    return /^(https?:)\/\//i.test(value);
  }

  function extractFilePathFromAssetUrl(rawUrl: string): string | null {
    if (!rawUrl) return null;
    try {
      const url = new URL(rawUrl);
      const host = url.hostname.toLowerCase();
      const protocol = url.protocol.toLowerCase();

      const isAsset =
        protocol === "asset:" ||
        host === "asset.localhost" ||
        host.endsWith(".asset.localhost");

      if (!isAsset) {
        if (protocol === "file:") {
          let decoded = decodeURIComponent(url.pathname || "");
          if (/^\/[a-zA-Z]:/.test(decoded)) {
            decoded = decoded.slice(1);
          }
          return decoded;
        }
        return null;
      }

      const originalPathname = url.pathname || "";
      let decoded = decodeURIComponent(originalPathname);

      if (/^\/[a-zA-Z]:\//.test(decoded)) {
        return decoded.slice(1).replace(/\//g, "\\");
      }
      if (/^[a-zA-Z]:\//.test(decoded)) {
        return decoded.replace(/\//g, "\\");
      }
      if (decoded.startsWith("/") && decoded.length > 1 && decoded[1] !== "/") {
        return decoded;
      }
      if (decoded.startsWith("/") && decoded.includes("\\") && decoded.length > 2) {
        return decoded.slice(1);
      }

      const strippedLeading = decoded.startsWith("/") ? decoded.slice(1) : decoded;
      if (/^[a-zA-Z]:\\/.test(strippedLeading) || strippedLeading.startsWith("\\\\")) {
        return strippedLeading;
      }

      if (originalPathname.startsWith("/") && !decoded.startsWith("/")) {
        return `/${decoded}`;
      }

      return decoded || null;
    } catch {
      return null;
    }
  }

  function filenameFromPath(path: string): string {
    return path.split(/[/\\]/).pop() || path;
  }

  async function handlePreviewClick(event: MouseEvent) {
    const target = event.target;
    if (!(target instanceof HTMLImageElement)) {
      return;
    }
    const xmlRelativePath = target.getAttribute("data-drawio") ?? target.dataset.drawio ?? "";
    if (!xmlRelativePath) {
      // Prevent embedded HTML like <a><img/></a> from triggering a WebView navigation.
      event.preventDefault();
      event.stopPropagation();

      const rawSrc = target.getAttribute("src") ?? target.currentSrc ?? target.src ?? "";
      const rawHref = target.closest("a")?.getAttribute("href") ?? "";
      const candidate = rawHref || rawSrc;

      const filePath = extractFilePathFromAssetUrl(candidate) ?? extractFilePathFromAssetUrl(rawSrc);
      if (filePath) {
        try {
          await addEditorTab(filePath, filenameFromPath(filePath));
        } catch {}
        return;
      }

      const external = isExternalUrl(candidate) ? candidate : isExternalUrl(rawSrc) ? rawSrc : "";
      if (external) {
        await openExternalUrl(external);
      }
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    try {
      const initialXml = await loadDrawioXml(xmlRelativePath);
      const result = await openDrawioDialog("edit", { initialXml });
      if (!result) return;
      if (!result.base64 || !result.xmlData) {
        console.warn("draw 返回数据不完整", result);
        return;
      }
      const persisted = await persistDrawioDiagram(result, { existingXmlRelativePath: xmlRelativePath });
      const editor = get(editorViewStore);
      const model = editor?.getModel();
      if (!editor || !model) return;
      const docText = model.getValue();
      const range = findDrawioBlockByXmlPath(docText, xmlRelativePath);
      if (!range) {
        console.warn("未找到对应的 draw 标记，无法更新", xmlRelativePath);
        return;
      }
      const newMarkup = buildDrawioHtml({
        imageRelativePath: persisted.imageRelativePath,
        xmlRelativePath: persisted.xmlRelativePath,
      });
      const startPos = model.getPositionAt(range.from);
      const endPos = model.getPositionAt(range.to);
      const editRange = new monaco.Range(startPos.lineNumber, startPos.column, endPos.lineNumber, endPos.column);
      editor.executeEdits("markdown-preview-drawio", [
        { range: editRange, text: newMarkup, forceMoveMarkers: true }
      ]);
      const cursorPos = model.getPositionAt(range.from + newMarkup.length);
      editor.setSelection(new monaco.Selection(cursorPos.lineNumber, cursorPos.column, cursorPos.lineNumber, cursorPos.column));

      target.setAttribute("data-drawio", persisted.xmlRelativePath);
      await ensureConvertFileSrc();
      const updatedSrc =
        convertFileSrcFn?.(persisted.imageAbsolutePath) ?? target.src;
      target.src = withCacheBuster(updatedSrc);
    } catch (error) {
      console.error("编辑 draw 图形失败", error);
      const message = error instanceof Error ? error.message : `${error}`;
      addNotification(NotifType.Error, "draw 编辑失败", [], message);
    }
  }

  function withCacheBuster(url: string): string {
    if (!url) return url;
    const cleaned = url.replace(/([?&])t=\d+(&?)/, (_, prefix, suffix) => (suffix ? prefix : ""));
    const trimmed = cleaned.replace(/[?&]$/, "");
    const separator = trimmed.includes("?") ? "&" : "?";
    return `${trimmed}${separator}t=${Date.now()}`;
  }

  onMount(() => {
    setSyncScrollActive(true);
    themeStyleElement = document.head.querySelector("style[data-markdown-theme]");
    if (!themeStyleElement) {
      themeStyleElement = document.createElement("style");
      themeStyleElement.setAttribute("data-markdown-theme", "true");
      document.head.appendChild(themeStyleElement);
    }

    unsubscribeTheme = themeStylesheet.subscribe(async (css) => {
      if (!themeStyleElement) return;
      themeStyleElement.textContent = css;
      await tick();
      syncFrameBackground();
    });

    unsubscribeStyleConfig = styleConfig.subscribe((value) => {
      widthValue = value.width ?? desktopWidthValue;
    });
    applyPreviewScroll(lastKnownRatio);
  });

  onDestroy(() => {
    setSyncScrollActive(false);
    unsubscribeMarkdown();
    unsubscribeScroll();
    if (unsubscribeTheme) {
      unsubscribeTheme();
      unsubscribeTheme = null;
    }
    if (unsubscribeStyleConfig) {
      unsubscribeStyleConfig();
      unsubscribeStyleConfig = null;
    }
    if (previewScrollRaf) {
      cancelAnimationFrame(previewScrollRaf);
      previewScrollRaf = 0;
    }
    if (themeStyleElement && themeStyleElement.parentNode) {
      themeStyleElement.parentNode.removeChild(themeStyleElement);
      themeStyleElement = null;
    }
    resetMathJaxQueue();
  });
</script>

<div
  class="markdown-preview"
  aria-label="Markdown preview"
  tabindex="0"
  bind:this={previewElement}
  on:click={handlePreviewClick}
  on:scroll={handlePreviewScroll}
>
  <div class={`markdown-theme preview-frame${isMobilePreview ? " preview-frame--mobile" : ""}`}>
    <div
      id="nice"
      class={`preview-wrapper${isMobilePreview ? " preview-wrapper--mobile" : ""}`}
      style={previewContainerStyle}
    >
      {@html html}
    </div>
  </div>
</div>

<style lang="scss">
.markdown-preview {
  position: relative;
  height: 100%;
  width: 100%;
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  padding: 0;
  box-sizing: border-box;
  background: transparent;
  color: inherit;
  user-select: text;

  :global(.table-container) {
    overflow-x: auto;
  }

  :global(pre.custom) {
    background: rgba(0, 0, 0, 0.05);
    padding: 16px;
    border-radius: 8px;
    overflow-x: auto;
  }

  :global(pre.custom code) {
    font-family: var(--monospace-font, ui-monospace, "SFMono-Regular", "Menlo", "Monaco", "Consolas", "Liberation Mono", "Roboto Mono", "JetBrains Mono", monospace);
    line-height: 1.5;
  }

  :global(img) {
    max-width: 100%;
    height: auto;
  }

}

.preview-frame {
  width: 100%;
  min-height: 100%;
  box-sizing: border-box;
  padding: 24px;
}

.preview-frame--mobile {
  display: flex;
  justify-content: center;
  padding: 40px 0;
  position: relative;
  background: var(--preview-mobile-backdrop, transparent);
}

.preview-wrapper {
  position: relative;
  max-width: 800px;
  margin: 0 auto;
}

:global(.markdown-preview .markdown-theme > *:first-child) {
  margin-top: 0 !important;
}

.preview-wrapper--mobile {
  width: 100%;
  background: var(--preview-mobile-surface, #ffffff);
  border-radius: 22px;
  box-shadow: 0 24px 48px rgba(15, 23, 42, 0.12);
  padding: 28px 20px;
  box-sizing: border-box;
  border: 12px solid var(--preview-mobile-frame, rgba(15, 23, 42, 0.08));
  background-clip: padding-box;
  position: relative;
  transition: border-color 0.2s ease, box-shadow 0.2s ease, background-color 0.2s ease;
}

.preview-wrapper--mobile::before,
.preview-wrapper--mobile::after {
  content: "";
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  pointer-events: none;
  background: var(--preview-mobile-detail, rgba(148, 163, 184, 0.35));
  transition: background-color 0.2s ease;
}

.preview-wrapper--mobile::before {
  top: 18px;
  width: 64px;
  height: 6px;
  border-radius: 999px;
}

.preview-wrapper--mobile::after {
  bottom: 14px;
  width: 120px;
  height: 5px;
  border-radius: 999px;
}

:global(.dark) .markdown-preview {
  background: var(--preview-surface, transparent);
  color: var(--preview-text, inherit);
  transition: background 0.2s ease, color 0.2s ease;

  :global(pre.custom) {
    background: var(--preview-code-background, rgba(0, 0, 0, 0.08));
  }

  :global(.markdown-theme) {
    color: var(--preview-text, inherit);
  }

  :global(.markdown-theme a) {
    color: var(--preview-link, currentColor);
    transition: color 0.2s ease;
  }

  :global(.markdown-theme a:hover) {
    color: var(--preview-link-hover, var(--preview-link, currentColor));
  }

  :global(.markdown-theme blockquote) {
    background: var(--blockquote-background, rgba(0, 0, 0, 0.2));
    color: var(--preview-muted, inherit);
  }

  :global(.markdown-theme code) {
    background: var(--preview-code-background, rgba(0, 0, 0, 0.25));
    color: var(--preview-inline-code, currentColor);
    padding: 0.2em 0.5em;
    border-radius: 6px;
  }

  :global(.markdown-theme pre) {
    background: var(--preview-code-background, rgba(0, 0, 0, 0.3));
    border: 1px solid var(--preview-border, rgba(148, 163, 184, 0.16));
    border-radius: 12px;
  }

  :global(.markdown-theme pre code) {
    background: transparent;
    padding: 0;
  }

  :global(.markdown-theme hr) {
    border: 0;
    border-top: 1px solid var(--preview-border, rgba(148, 163, 184, 0.24));
  }

  :global(.markdown-theme table) {
    border: 1px solid var(--preview-border, rgba(148, 163, 184, 0.16));
  }

  :global(.markdown-theme th),
  :global(.markdown-theme td) {
    border-color: var(--preview-border, rgba(148, 163, 184, 0.16));
  }
}



:global(.dark) .preview-wrapper {
  background: var(--preview-surface, #111827);
  color: var(--preview-text, inherit);
  border-radius: 18px;
  border: 1px solid var(--preview-border, rgba(148, 163, 184, 0.16));
  box-shadow: var(--preview-shadow, none);
  padding: 24px 28px;
  box-sizing: border-box;
}

:global(.dark) .preview-wrapper.preview-wrapper--mobile {
  background: var(--preview-mobile-surface, #111827);
  border-radius: 24px;
  border: 12px solid var(--preview-mobile-frame, rgba(148, 163, 184, 0.2));
  box-shadow: var(--preview-mobile-shadow-dark, 0 28px 64px rgba(15, 23, 42, 0.48));
  padding: 28px 20px;
}

:global(.dark) .preview-wrapper--mobile::before,
:global(.dark) .preview-wrapper--mobile::after {
  background: var(--preview-mobile-detail, rgba(148, 163, 184, 0.45));
}
</style>
