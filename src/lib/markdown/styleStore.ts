import { derived, writable } from "svelte/store";

import type { PropertiesHyphen } from "csstype";

import {
  colorOptions,
  codeBlockThemeOptions,
  defaultStyleConfig,
  fontFamilyOptions,
  fontSizeOptions,
  legendOptions,
  widthOptions,
} from "./reference/shared/configs/style";
import { themeOptions } from "./reference/shared/configs/theme";
import type { Block, Inline } from "./reference/shared/types";
import { updateMarkdownRendererState } from "./renderMarkdown";
import { getHighlightThemeCss, normalizeHighlightThemeId } from "../highlightThemes";

type BaseStyleConfig = typeof defaultStyleConfig;

type StyleConfig = BaseStyleConfig & {
  isUseIndent?: boolean;
  isUseJustify?: boolean;
  useCustomCss?: boolean;
  customCss?: CustomCssMap;
};

type CustomCssMap = Partial<Record<Block | Inline, PropertiesHyphen>>;

interface CustomCssResult {
  raw: string;
  mapping: CustomCssMap;
}

const DEFAULT_MARKDOWN_CSS_TEMPLATE = `/* Custom markdown preview overrides
 * Scope rules to #nice so they only affect the preview content.
 */

#nice {
}

#nice h1 {
}

#nice h2 {
}

#nice h3 {
}

#nice p {
}

#nice a {
}

#nice pre {
}

#nice code {
}

#nice blockquote {
}
`;

const BLOCK_SELECTORS: Block[] = [
  "container",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "code",
  "code_pre",
  "p",
  "hr",
  "blockquote",
  "blockquote_note",
  "blockquote_tip",
  "blockquote_info",
  "blockquote_important",
  "blockquote_warning",
  "blockquote_caution",
  "blockquote_p",
  "blockquote_p_note",
  "blockquote_p_tip",
  "blockquote_p_info",
  "blockquote_p_important",
  "blockquote_p_warning",
  "blockquote_p_caution",
  "blockquote_title",
  "blockquote_title_note",
  "blockquote_title_tip",
  "blockquote_title_info",
  "blockquote_title_important",
  "blockquote_title_warning",
  "blockquote_title_caution",
  "image",
  "ul",
  "ol",
  "figure",
  "footnotes",
  "block_katex",
];

const INLINE_SELECTORS: Inline[] = [
  "listitem",
  "codespan",
  "link",
  "wx_link",
  "strong",
  "table",
  "thead",
  "th",
  "td",
  "footnote",
  "figcaption",
  "em",
  "inline_katex",
  "markup_highlight",
  "markup_underline",
  "markup_wavyline",
];

const ALLOWED_CUSTOM_KEYS = new Set<Block | Inline>([...BLOCK_SELECTORS, ...INLINE_SELECTORS]);

const STORAGE_KEY = "codey.markdownStyleConfig";

function loadInitialState(): StyleConfig {
  if (typeof window === "undefined") {
    return { ...defaultStyleConfig, useCustomCss: false };
  }

  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as Partial<StyleConfig>;
      const merged: StyleConfig = {
        ...defaultStyleConfig,
        useCustomCss: false,
        ...parsed,
      };

      const normalizedThemeId = normalizeHighlightThemeId(merged.codeBlockTheme);
      if (normalizedThemeId) {
        merged.codeBlockTheme = normalizedThemeId as StyleConfig["codeBlockTheme"];
      } else if (!merged.codeBlockTheme) {
        merged.codeBlockTheme = defaultStyleConfig.codeBlockTheme;
      }

      return merged;
    }
  }
  catch (error) {
    console.warn("Failed to load markdown style config", error);
  }

  return { ...defaultStyleConfig, useCustomCss: false };
}

const styleConfigStore = writable<StyleConfig>(loadInitialState());
const customCssReloadToken = writable(0);

let latestCustomCss: CustomCssMap | undefined;

styleConfigStore.subscribe((value) => {
  updateMarkdownRendererState({
    ...value,
    customCss: latestCustomCss,
  });

  if (typeof window === "undefined") {
    return;
  }

  try {
    const { customCss, ...rest } = value;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(rest));
  }
  catch (error) {
    console.warn("Failed to persist markdown style config", error);
  }
});

function normalizeStyleValue<K extends keyof StyleConfig>(key: K, value: StyleConfig[K]): StyleConfig[K] {
  if (key === "codeBlockTheme" && typeof value === "string") {
    const normalized = normalizeHighlightThemeId(value);
    return (normalized ?? value) as StyleConfig[K];
  }
  return value;
}

export const styleConfig = {
  subscribe: styleConfigStore.subscribe,
};

export function setStyleOption<K extends keyof StyleConfig>(key: K, value: StyleConfig[K]): void {
  styleConfigStore.update((current) => {
    const normalizedValue = normalizeStyleValue(key, value);
    if (current[key] === normalizedValue) {
      return current;
    }
    return {
      ...current,
      [key]: normalizedValue,
    };
  });
}

export function updateStyleConfig(partial: Partial<StyleConfig>): void {
  styleConfigStore.update((current) => ({
    ...current,
    ...Object.entries(partial).reduce<Partial<StyleConfig>>((acc, [entryKey, entryValue]) => {
      const typedKey = entryKey as keyof StyleConfig;
      acc[typedKey] = normalizeStyleValue(typedKey, entryValue as StyleConfig[keyof StyleConfig]);
      return acc;
    }, {}),
  }));
}

export const codeThemeStylesheet = derived(styleConfigStore, ($config, set) => {
  if (typeof window === "undefined") {
    set("");
    return;
  }

  const normalizedThemeId = normalizeHighlightThemeId($config.codeBlockTheme);
  if (normalizedThemeId) {
    const css = getHighlightThemeCss(normalizedThemeId);
    set(css ?? "");
    return;
  }

  const href = $config.codeBlockTheme ?? "";

  if (!href) {
    set("");
    return;
  }

  let cancelled = false;
  const controller = new AbortController();

  void fetch(href, { signal: controller.signal })
    .then((response) => {
      if (!response.ok) {
        throw new Error(`Failed to fetch code theme CSS: ${response.status}`);
      }
      return response.text();
    })
    .then((css) => {
      if (!cancelled) {
        set(css);
      }
    })
    .catch((error) => {
      console.warn("Failed to load code theme stylesheet", href, error);
      if (!cancelled) {
        set("");
      }
    });

  return () => {
    cancelled = true;
    controller.abort();
  };
}, "");

async function loadCustomCss(): Promise<string | null> {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const [{ appLocalDataDir, join }, { readTextFile, exists }] = await Promise.all([
      import("@tauri-apps/api/path"),
      import("@tauri-apps/plugin-fs"),
    ]);

    const baseDir = await appLocalDataDir();
    let themeFile = "";
    try {
      themeFile = await join(baseDir, "markdown.css");
    }
    catch {
      themeFile = `${baseDir}markdown.css`;
    }

    const fileExists = await exists(themeFile).catch(() => false);
    if (!fileExists) {
      return null;
    }

    const css = await readTextFile(themeFile);
    return css;
  }
  catch (error) {
    console.warn("Failed to load custom markdown CSS", error);
    return null;
  }
}

let markdownCssPathPromise: Promise<string | null> | null = null;

async function resolveMarkdownCssPath(): Promise<string | null> {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const [{ appLocalDataDir, join }, { exists, writeTextFile }] = await Promise.all([
      import("@tauri-apps/api/path"),
      import("@tauri-apps/plugin-fs"),
    ]);

    const baseDir = await appLocalDataDir();
    let cssPath = "";
    try {
      cssPath = await join(baseDir, "markdown.css");
    }
    catch {
      cssPath = `${baseDir}markdown.css`;
    }

    const fileExists = await exists(cssPath).catch(() => false);
    if (!fileExists) {
      try {
        await writeTextFile(cssPath, DEFAULT_MARKDOWN_CSS_TEMPLATE);
      }
      catch (error) {
        console.warn("Failed to create markdown.css", error);
        return null;
      }
    }

    return cssPath;
  }
  catch (error) {
    console.warn("Failed to resolve markdown.css", error);
    return null;
  }
}

export async function getMarkdownCssPath(): Promise<string | null> {
  if (!markdownCssPathPromise) {
    markdownCssPathPromise = resolveMarkdownCssPath();
  }
  const resolved = await markdownCssPathPromise;
  if (!resolved) {
    markdownCssPathPromise = null;
  }
  return resolved;
}

export function refreshCustomCss(): void {
  customCssReloadToken.update((value) => value + 1);
}

function parseCustomCss(raw: string | null): CustomCssResult {
  if (!raw) {
    return { raw: "", mapping: {} };
  }

  const cleaned = raw.replace(/\/\*[\s\S]*?\*\//g, "");
  const mapping: CustomCssMap = {};
  const blockRegex = /([a-zA-Z0-9_-]+)\s*\{([\s\S]*?)\}/g;
  let match: RegExpExecArray | null;

  while ((match = blockRegex.exec(cleaned)) !== null) {
    const selector = match[1]?.trim();
    const body = match[2] ?? "";
    if (!selector) continue;

    const style: PropertiesHyphen = {};
    const declarations = body.split(/;|\n/);
    for (const decl of declarations) {
      const trimmed = decl.trim();
      if (!trimmed) continue;
      const colonIndex = trimmed.indexOf(":");
      if (colonIndex === -1) continue;
      const property = trimmed.slice(0, colonIndex).trim();
      const value = trimmed.slice(colonIndex + 1).trim();
      if (!property || !value) continue;
      (style as Record<string, string>)[property] = value;
    }

    if (Object.keys(style).length > 0) {
      const normalized = selector as Block | Inline;
      if (ALLOWED_CUSTOM_KEYS.has(normalized)) {
        mapping[normalized] = style;
      }
    }
  }

  return { raw, mapping };
}

export const customCssConfig = derived([styleConfigStore, customCssReloadToken], ([$config, _reload], set) => {
  if (!$config.useCustomCss) {
    latestCustomCss = undefined;
    updateMarkdownRendererState({ customCss: undefined });
    set({ raw: "", mapping: {} });
    return;
  }

  if (typeof window === "undefined") {
    latestCustomCss = undefined;
    updateMarkdownRendererState({ customCss: undefined });
    set({ raw: "", mapping: {} });
    return;
  }

  let cancelled = false;

  void loadCustomCss()
    .then((css) => {
      if (cancelled) return;
      const parsed = parseCustomCss(css);
      latestCustomCss = parsed.mapping;
      updateMarkdownRendererState({ customCss: parsed.mapping });
      set(parsed);
    })
    .catch((error) => {
      console.warn("Failed to resolve custom CSS", error);
      if (!cancelled) {
        latestCustomCss = undefined;
        updateMarkdownRendererState({ customCss: undefined });
        set({ raw: "", mapping: {} });
      }
    });

  return () => {
    cancelled = true;
  };
}, { raw: "", mapping: {} });

export const markdownThemeOptions = themeOptions;
export const markdownFontFamilyOptions = fontFamilyOptions;
export const markdownFontSizeOptions = fontSizeOptions;
export const markdownColorOptions = colorOptions;
export const markdownWidthOptions = widthOptions;
export const markdownCodeBlockThemeOptions = codeBlockThemeOptions;
export const markdownLegendOptions = legendOptions;

export { defaultStyleConfig };

export type { StyleConfig, CustomCssResult, CustomCssMap };
