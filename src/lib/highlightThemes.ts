const highlightThemeModules = import.meta.glob(
  "./../../node_modules/highlight.js/styles/*.min.css",
  {
    as: "raw",
    eager: true,
  },
) as Record<string, string>;

const THEME_PATH_REGEXP = /([A-Za-z0-9_-]+)\.min\.css(?:\?.*)?$/;
const LEGACY_THEME_URL_REGEXP = /\/highlight-themes\/([A-Za-z0-9_-]+)\.min\.css(?:\?.*)?$/;

const highlightThemeCssMap: Record<string, string> = Object.entries(
  highlightThemeModules,
).reduce((acc, [path, css]) => {
  const match = path.match(THEME_PATH_REGEXP);
  if (match?.[1]) {
    acc[match[1]] = css;
  }
  return acc;
}, {});

export const getHighlightThemeCss = (themeName: string): string | undefined => {
  return highlightThemeCssMap[themeName];
};

export const normalizeHighlightThemeId = (
  value?: string | null,
): string | undefined => {
  if (!value) {
    return undefined;
  }

  if (highlightThemeCssMap[value]) {
    return value;
  }

  const legacyMatch = value.match(LEGACY_THEME_URL_REGEXP);
  if (legacyMatch?.[1] && highlightThemeCssMap[legacyMatch[1]]) {
    return legacyMatch[1];
  }

  const fileMatch = value.match(THEME_PATH_REGEXP);
  if (fileMatch?.[1] && highlightThemeCssMap[fileMatch[1]]) {
    return fileMatch[1];
  }

  return undefined;
};
