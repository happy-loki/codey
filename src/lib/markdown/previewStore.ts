import { derived } from "svelte/store";

import { activeDoc, activeInfo } from "../editorBus";
import { renderMarkdown, updateMarkdownRendererState } from "./renderMarkdown";
import { customCssConfig, styleConfig } from "./styleStore";

const empty = "";

export const renderedMarkdown = derived(
  [activeDoc, activeInfo, styleConfig, customCssConfig],
  ([doc, info, config, customCss]) => {
    const content = typeof doc === "string" ? doc : empty;
    const path = info?.path ?? null;

    try {
      updateMarkdownRendererState({
        ...config,
        customCss: customCss.mapping,
      });
      return renderMarkdown(content, { filePath: path });
    } catch (error) {
      console.warn("renderMarkdown failed", error);
      return empty;
    }
  },
  empty,
);

export default renderedMarkdown;
