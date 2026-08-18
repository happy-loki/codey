export const SYSTEM_UI_FONT_STACK =
  "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', 'San Francisco', 'SF Pro Text', 'SF Pro Display', 'Helvetica Neue', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', 'Noto Sans', 'Liberation Sans', 'PingFang SC', 'Microsoft YaHei', 'WenQuanYi Micro Hei', 'JetBrains Mono', sans-serif";

export const SYSTEM_MONO_FONT_STACK =
  "ui-monospace, 'SF Mono', 'SFMono-Regular', 'Menlo', 'Monaco', 'Consolas', 'Cascadia Mono', 'Cascadia Code', 'JetBrains Mono', 'Roboto Mono', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei UI', 'Microsoft YaHei', 'Noto Sans CJK SC', 'Source Han Sans SC', monospace";

export const LEGACY_MONO_FONT_STACK =
  "ui-monospace, 'SFMono-Regular', 'Menlo', 'Monaco', 'Consolas', 'Liberation Mono', 'Roboto Mono', 'JetBrains Mono', monospace";

function normalizeFontKey(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

export function normalizeMonoFontFamily(value: unknown, fallback = SYSTEM_MONO_FONT_STACK): string {
  if (typeof value !== "string" || !value.trim()) return fallback;
  const normalized = normalizeFontKey(value);
  if (normalized === "monospace") {
    return SYSTEM_MONO_FONT_STACK;
  }
  if (normalized === normalizeFontKey(LEGACY_MONO_FONT_STACK)) {
    return SYSTEM_MONO_FONT_STACK;
  }
  if (
    normalized.includes("'sfmono-regular'") &&
    normalized.includes("'menlo'") &&
    normalized.includes("'monaco'") &&
    normalized.includes("'consolas'")
  ) {
    return SYSTEM_MONO_FONT_STACK;
  }
  return value;
}
