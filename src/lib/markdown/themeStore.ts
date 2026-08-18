import { derived } from "svelte/store";

import {
  customCssConfig,
  markdownCodeBlockThemeOptions,
  markdownThemeOptions,
  setStyleOption,
  styleConfig,
  type StyleConfig,
} from "./styleStore";
import { codeThemeStylesheet } from "./styleStore";

const DEFAULT_THEME_KEY = markdownThemeOptions[0]?.value ?? "default";

export const themeStylesheet = derived([styleConfig, codeThemeStylesheet, customCssConfig], ([$config, highlightCss, customCss]) => {
  const cssParts: string[] = [];
  if (!$config.useCustomCss && highlightCss?.trim()) {
    cssParts.push(highlightCss);
  }
  if ($config.useCustomCss && customCss.raw?.trim()) {
    cssParts.push(customCss.raw);
  }
  return cssParts.join("\n");
});

export const markdownThemeId = derived(styleConfig, ($config) => $config.theme ?? DEFAULT_THEME_KEY);
export const codeThemeId = derived(styleConfig, ($config) => $config.codeBlockTheme ?? "");

export function setMarkdownTheme(id: string) {
  if (markdownThemeOptions.some((option) => option.value === id)) {
    setStyleOption("theme", id as StyleConfig["theme"]);
  }
}

export function setCodeTheme(id: string) {
  if (markdownCodeBlockThemeOptions.some((option) => option.value === id)) {
    setStyleOption("codeBlockTheme", id as StyleConfig["codeBlockTheme"]);
  }
}

export { markdownThemeOptions, markdownCodeBlockThemeOptions };
