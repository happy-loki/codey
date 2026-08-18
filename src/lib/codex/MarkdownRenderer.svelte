<script lang="ts">
    import { Marked } from "marked";
    import DOMPurify from "isomorphic-dompurify";
    import hljs from "highlight.js";
    import githubDarkCss from "highlight.js/styles/github-dark.css?raw";
    import githubLightCss from "highlight.js/styles/github.css?raw";
    import { onMount, afterUpdate, onDestroy } from "svelte";
    import { copyPlainTextToClipboard } from "../utility/textClipboard";
    import { typesetMathInElement } from "../markdown/mathjax";

    export let content: string;
    export let plain = false;
    // When false, still render Markdown, but skip expensive post-processing like syntax highlighting
    // and MathJax. Also coalesces frequent updates to at most once per animation frame (streaming).
    export let enhance = true;

    let renderedHtml = "";
    let container: HTMLDivElement;
    let hljsStyleElement: HTMLStyleElement | null = null;
    let themeObserver: MutationObserver | null = null;
    let renderRaf: number | null = null;
    let scheduledContent: string | null = null;
    let lastEnhanced = enhance;

    const COPY_ICON_SVG = `
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect width="14" height="14" x="8" y="8" rx="2" ry="2"></rect>
            <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"></path>
        </svg>
    `;
    const CHECK_ICON_SVG = `
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
            <path d="M20 6 9 17l-5-5"></path>
        </svg>
    `;
    const COPY_FEEDBACK_MS = 1400;

    // 独立的 Marked 实例：轻量渲染（代码高亮交给 highlight.js 在 DOM 阶段处理）
    const markdown = new Marked({
        breaks: true,
        gfm: true,
    });

    const SAFE_MARKDOWN_URI_PATTERN =
        /^(?:(?:https?|mailto|tel|file|vscode|vscode-insiders):|[A-Za-z]:[\\/]|\\\\|\/(?!\/)|#|\.{1,2}\/|[^A-Za-z:/?#][^:]*$|[A-Za-z][^:]*$)/i;

    // Cache rendered HTML for non-streaming content.
    // Virtualized rows are frequently unmounted/remounted during scroll; caching avoids
    // re-running marked + DOMPurify for the same text over and over.
    const MAX_RENDER_CACHE = 250;
    const renderCache = new Map<string, string>();
    const renderCacheOrder: string[] = [];

    function cacheGet(key: string): string | null {
        return renderCache.get(key) ?? null;
    }

    function cachePut(key: string, value: string) {
        if (renderCache.has(key)) {
            renderCache.set(key, value);
            return;
        }
        renderCache.set(key, value);
        renderCacheOrder.push(key);
        while (renderCacheOrder.length > MAX_RENDER_CACHE) {
            const oldest = renderCacheOrder.shift();
            if (oldest) renderCache.delete(oldest);
        }
    }

    function escapeHtml(text: string): string {
        return (text ?? "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/\"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    function renderFastPlain(text: string): string {
        // Streaming-friendly: avoid markdown parse + sanitize on every tiny delta.
        return `<pre class="streaming-plain">${escapeHtml(text ?? "")}</pre>`;
    }

    function normalizeMathDelimiters(text: string): string {
        if (!text) return "";
        // 将 \[ ... \] / \( ... \) 预处理成 $$...$$ / $...$，
        // 避免在 markdown 解析阶段被转义掉，从而方便后续 KaTeX 识别。
        let result = text;
        // 先处理块级，支持跨行
        result = result.replace(/\\\[((?:[\s\S]*?))\\\]/g, (_match, expr) => `$$${expr}$$`);
        // 再处理行内
        result = result.replace(/\\\((.+?)\\\)/g, (_match, expr) => `$${expr}$`);
        return result;
    }

    function renderContent(text: string): string {
        try {
            const normalized = normalizeMathDelimiters(text ?? "");
            if (enhance) {
                const cached = cacheGet(normalized);
                if (cached) return cached;
            }
            const html = preserveGfmTaskListCheckboxes(markdown.parse(normalized) as string);
            const sanitized = DOMPurify.sanitize(html, {
                ALLOWED_TAGS: [
                    "p",
                    "br",
                    "strong",
                    "em",
                    "u",
                    "s",
                    "del",
                    "code",
                    "pre",
                    "a",
                    "button",
                    "ul",
                    "ol",
                    "li",
                    "blockquote",
                    "h1",
                    "h2",
                    "h3",
                    "h4",
                    "h5",
                    "h6",
                    "table",
                    "thead",
                    "tbody",
                    "tr",
                    "th",
                    "td",
                    "img",
                    "hr",
                    "div",
                    "span",
                    "svg",
                    "path",
                ],
                ALLOWED_ATTR: [
                    "href",
                    "type",
                    "src",
                    "alt",
                    "title",
                    "class",
                    "width",
                    "height",
                    "viewBox",
                    "fill",
                    "stroke",
                    "stroke-width",
                    "stroke-linecap",
                    "stroke-linejoin",
                    "xmlns",
                    "d",
                    "data-file-path",
                    "data-line-start",
                    "data-line-end",
                    "start",
                    "align",
                ],
                ALLOWED_URI_REGEXP: SAFE_MARKDOWN_URI_PATTERN,
            });
            if (enhance) {
                cachePut(normalized, sanitized);
            }
            return sanitized;
        } catch (error) {
            console.error("Markdown rendering error:", error);
            return renderFastPlain(text ?? "");
        }
    }

    function preserveGfmTaskListCheckboxes(html: string): string {
        return html.replace(/<input\b[^>]*\btype="checkbox"[^>]*>/gi, (match) => {
            const isChecked = /\bchecked(?:=(?:""|''|"checked"|'checked'|checked))?/i.test(match);
            return `<span class="task-list-checkbox${isChecked ? " checked" : ""}"></span>`;
        });
    }

    async function renderMath() {
        if (!container || plain || !enhance) return;
        try {
            if (!container.isConnected) return;
            await typesetMathInElement(container);
        } catch (error) {
            console.error("MathJax typeset error:", error);
        }
    }

    function ensureHighlightTheme() {
        if (typeof document === "undefined") return;
        if (!hljsStyleElement) {
            hljsStyleElement = document.createElement("style");
            hljsStyleElement.setAttribute("data-hljs-theme", "chat");
            document.head.appendChild(hljsStyleElement);
        }
        const isDark = document.documentElement.getAttribute("data-theme") === "dark";
        hljsStyleElement.textContent = isDark ? githubDarkCss : githubLightCss;
    }

    function extractLanguageFromClassName(className: string): string | null {
        if (!className) return null;
        const parts = className.split(/\s+/);
        for (const part of parts) {
            if (part.startsWith("language-")) {
                return part.slice("language-".length).toLowerCase();
            }
        }
        return null;
    }

    function highlightCodeBlocks() {
        if (!enhance) return;
        if (!container || !container.isConnected) return;
        const blocks = container.querySelectorAll<HTMLElement>("pre code");
        blocks.forEach((block) => {
            // 避免重复高亮
            if (block.dataset.__arthasHighlighted === "true") return;
            try {
                if (block.className && !block.className.includes("language-")) {
                    // 尝试从文本内容自动检测
                    const result = hljs.highlightAuto(block.innerText);
                    block.innerHTML = result.value;
                    block.classList.add("hljs");
                } else {
                    hljs.highlightElement(block);
                }
                block.dataset.__arthasHighlighted = "true";
            } catch (error) {
                console.warn("Code highlight failed", error);
            }
        });

        // 为每个代码块创建语言标签 + 复制按钮
        const pres = container.querySelectorAll<HTMLPreElement>("pre");
        pres.forEach((pre) => {
            if (pre.dataset.__arthasDecorated === "true") return;
            const code = pre.querySelector("code");
            if (!code) return;

            try {
                // 有些渲染器/高亮器可能会改变 pre 的直接子节点结构，
                // 这里避免对非直系子节点做 insertBefore，防止抛出 NotFoundError。
                if (pre.querySelector(".code-header")) {
                    pre.dataset.__arthasDecorated = "true";
                    return;
                }

                const language = extractLanguageFromClassName(code.className) ?? "text";
                const rawText = code.textContent ?? "";

                const header = document.createElement("div");
                header.className = "code-header";

                const langLabel = document.createElement("span");
                langLabel.className = "code-lang";
                langLabel.textContent = language;

                const copyButton = document.createElement("button");
                copyButton.type = "button";
                copyButton.className = "code-copy";
                copyButton.title = "Copy code";
                copyButton.setAttribute("aria-label", "Copy code");
                copyButton.innerHTML = COPY_ICON_SVG;
                copyButton.addEventListener("click", async () => {
                    const copied = await copyPlainTextToClipboard(rawText);
                    if (!copied) return;

                    const existingTimer = Number(copyButton.dataset.copyResetTimer || 0);
                    if (existingTimer) {
                        window.clearTimeout(existingTimer);
                    }

                    copyButton.classList.add("copied");
                    copyButton.title = "Copied";
                    copyButton.setAttribute("aria-label", "Copied");
                    copyButton.innerHTML = CHECK_ICON_SVG;

                    const resetTimer = window.setTimeout(() => {
                        copyButton.classList.remove("copied");
                        copyButton.title = "Copy code";
                        copyButton.setAttribute("aria-label", "Copy code");
                        copyButton.innerHTML = COPY_ICON_SVG;
                        delete copyButton.dataset.copyResetTimer;
                    }, COPY_FEEDBACK_MS);
                    copyButton.dataset.copyResetTimer = String(resetTimer);
                });

                header.appendChild(langLabel);
                header.appendChild(copyButton);

                const referenceNode: ChildNode | null =
                    code.parentNode === pre ? code : (pre.firstChild ?? null);

                pre.insertBefore(header, referenceNode);
                pre.dataset.__arthasDecorated = "true";
            } catch (error) {
                console.warn("Code decoration failed", error);
            }
        });
    }

    function scheduleRender() {
        scheduledContent = content ?? "";
        if (renderRaf !== null) return;
        renderRaf = requestAnimationFrame(() => {
            renderRaf = null;
            const next = scheduledContent ?? "";
            scheduledContent = null;
            renderedHtml = renderContent(next);
        });
    }

    $: {
        if (enhance) {
            if (renderRaf !== null) {
                cancelAnimationFrame(renderRaf);
                renderRaf = null;
                scheduledContent = null;
            }
            renderedHtml = renderContent(content);
        } else {
            scheduleRender();
        }
    }

    $: {
        // If we mounted in streaming mode and later switch to enhanced rendering,
        // ensure highlight theme is injected before highlightCodeBlocks runs.
        if (enhance && !lastEnhanced) {
            ensureHighlightTheme();
        }
        lastEnhanced = enhance;
    }

    onMount(() => {
        if (enhance) {
            ensureHighlightTheme();
        }

        if (typeof document !== "undefined") {
            themeObserver = new MutationObserver((mutations) => {
                for (const mutation of mutations) {
                    if (mutation.type === "attributes" && mutation.attributeName === "data-theme") {
                        if (enhance) {
                            ensureHighlightTheme();
                        }
                        break;
                    }
                }
            });
            themeObserver.observe(document.documentElement, {
                attributes: true,
                attributeFilter: ["data-theme"],
            });
        }

        highlightCodeBlocks();
        void renderMath();
    });

    afterUpdate(() => {
        highlightCodeBlocks();
        void renderMath();
    });

    onDestroy(() => {
        if (renderRaf !== null) {
            cancelAnimationFrame(renderRaf);
            renderRaf = null;
        }
        scheduledContent = null;
        themeObserver?.disconnect();
        themeObserver = null;
    });
</script>

<div bind:this={container} class="markdown-content" class:plain>
    {@html renderedHtml}
</div>

<style>
    .markdown-content {
        line-height: 1.618; /* 黄金比例 */
        color: var(--text-primary, #fff);
        font-family: var(--ai-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
        font-size: var(--ai-font-size, 14px);
    }

    .markdown-content :global(p) {
        margin: 0 0 16px 0;
        line-height: 1.618;
    }

    .markdown-content :global(p:last-child) {
        margin-bottom: 0;
    }

    .markdown-content :global(h1),
    .markdown-content :global(h2),
    .markdown-content :global(h3),
    .markdown-content :global(h4),
    .markdown-content :global(h5),
    .markdown-content :global(h6) {
        margin: 16px 0 8px 0;
        font-weight: 600;
        line-height: 1.3;
    }

    .markdown-content :global(h1) {
        font-size: 1.5em;
    }
    .markdown-content :global(h2) {
        font-size: 1.3em;
    }
    .markdown-content :global(h3) {
        font-size: 1.1em;
    }

    .markdown-content :global(code) {
        padding: 2px 6px;
        background: var(--bg-input, #1e1e1e);
        border-radius: 3px;
        font-family: var(--editor-font-family, "Consolas", "Monaco", monospace);
        font-size: 0.9em;
        color: var(--accent-color, #007acc);
    }

    .markdown-content :global(pre) {
        padding: 0;
        background: var(--preview-code-background, #f4f4f5);
        border-radius: 6px;
        border: 1px solid var(--preview-border, rgba(148, 163, 184, 0.35));
        overflow-x: auto;
        margin: 12px 0;
    }

    .markdown-content :global(pre.streaming-plain) {
        padding: 10px 12px;
        white-space: pre-wrap;
        word-break: break-word;
        background: var(--bg-input, #1e1e1e);
        color: var(--text-primary, #fff);
        border: 1px solid rgba(148, 163, 184, 0.25);
        margin: 0;
    }

    .markdown-content :global(pre code) {
        display: block;
        padding: 8px 12px 12px;
        background: transparent;
        color: var(--text-primary, #111827);
        font-family: var(--editor-font-family, "Consolas", "Monaco", monospace);
        /* 使用继承的 0.9em，不再强行指定绝对字号 */
    }

    /* 统一使用容器背景，而不是主题文件里的 code 背景 */
    .markdown-content :global(code.hljs) {
        background: transparent !important;
    }

    .markdown-content :global(.code-header) {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 6px 10px;
        border-bottom: 1px solid var(--preview-border, rgba(148, 163, 184, 0.35));
        background: rgba(249, 250, 251, 0.95);
        border-radius: 6px 6px 0 0;
        /* Header 字号略小于代码正文 */
        font-size: 0.85em;
        color: #4b5563;
    }

    .markdown-content :global(.code-lang) {
        text-transform: lowercase;
        opacity: 0.9;
    }

    .markdown-content :global(.code-copy) {
        border: none;
        background: transparent;
        cursor: pointer;
        padding: 2px 4px;
        color: #6b7280;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        font-size: 1em;
    }

    .markdown-content :global(.code-copy:hover) {
        color: #374151;
    }

    .markdown-content :global(.code-copy.copied) {
        color: #16a34a;
    }

    .markdown-content :global(.code-copy.copied:hover) {
        color: #15803d;
    }

    :global(html[data-theme="dark"]) .markdown-content :global(pre) {
        background: var(--preview-code-background, #1f2430);
        border-color: var(--preview-border, rgba(148, 163, 184, 0.35));
    }

    :global(html[data-theme="dark"]) .markdown-content :global(pre code) {
        color: var(--text-primary, #e5e7eb);
    }

    :global(html[data-theme="dark"]) .markdown-content :global(.code-header) {
        background: rgba(15, 23, 42, 0.9);
        color: rgba(229, 231, 235, 0.92);
        border-bottom-color: var(--preview-border, rgba(148, 163, 184, 0.35));
    }

    :global(html[data-theme="dark"]) .markdown-content :global(.code-copy) {
        color: rgba(209, 213, 219, 0.8);
    }

    :global(html[data-theme="dark"]) .markdown-content :global(.code-copy:hover) {
        color: #e5e7eb;
    }

    :global(html[data-theme="dark"]) .markdown-content :global(.code-copy.copied) {
        color: #22c55e;
    }

    :global(html[data-theme="dark"]) .markdown-content :global(.code-copy.copied:hover) {
        color: #4ade80;
    }

    /* 复制图标大小随字号缩放 */
    .markdown-content :global(.code-copy svg) {
        width: 1em;
        height: 1em;
    }

    .markdown-content :global(a) {
        color: var(--accent-color, #007acc);
        text-decoration: none;
    }

    .markdown-content :global(a:hover) {
        text-decoration: underline;
    }

    .markdown-content :global(ul),
    .markdown-content :global(ol) {
        margin: 8px 0;
        padding-left: 24px;
    }

    .markdown-content :global(li) {
        margin: 6px 0;
        line-height: 1.618;
    }

    .markdown-content :global(blockquote) {
        margin: 12px 0;
        padding: 8px 16px;
        border-left: 4px solid var(--accent-color, #007acc);
        background: var(--bg-input, #1e1e1e);
        color: var(--text-secondary, #aaa);
    }

    .markdown-content :global(table) {
        border-collapse: collapse;
        width: 100%;
        margin: 12px 0;
    }

    .markdown-content :global(th),
    .markdown-content :global(td) {
        border: 1px solid var(--border-color, #333);
        padding: 8px 12px;
        text-align: left;
    }

    .markdown-content :global(th[align="center"]),
    .markdown-content :global(td[align="center"]) {
        text-align: center;
    }

    .markdown-content :global(th[align="right"]),
    .markdown-content :global(td[align="right"]) {
        text-align: right;
    }

    .markdown-content :global(th) {
        background: var(--bg-input, #1e1e1e);
        font-weight: 600;
    }

    .markdown-content :global(.task-list-checkbox) {
        display: inline-block;
        width: 0.95em;
        height: 0.95em;
        margin: 0 0.45em 0 0;
        border: 1px solid var(--border-color, #333);
        border-radius: 3px;
        vertical-align: middle;
        transform: translateY(-0.08em);
    }

    .markdown-content :global(.task-list-checkbox.checked) {
        background: var(--accent-color, #007acc);
        border-color: var(--accent-color, #007acc);
        box-shadow: inset 0 0 0 2px var(--bg-primary, #fff);
    }

    .markdown-content :global(img) {
        max-width: 100%;
        border-radius: 4px;
        margin: 8px 0;
    }

    .markdown-content :global(hr) {
        border: none;
        border-top: 1px solid var(--border-color, #333);
        margin: 16px 0;
    }

    .markdown-content :global(strong) {
        font-weight: 600;
    }

    .markdown-content.plain :global(strong),
    .markdown-content.plain :global(b) {
        font-weight: 400 !important;
    }

    .markdown-content :global(em) {
        font-style: italic;
    }
</style>
