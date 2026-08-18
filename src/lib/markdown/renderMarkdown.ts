import { convertFileSrc } from "@tauri-apps/api/core";
import type { IOpts, Theme } from "@md/shared/types";

import { initRenderer } from "./reference/core/renderer";
import { modifyHtmlContent } from "./reference/core/utils/markdownHelpers";
import { defaultStyleConfig } from "./reference/shared/configs/style";
import { themeMap } from "./reference/shared/configs/theme";
import { customCssWithTemplate } from "./reference/core/utils/themeHelpers";
import type { CustomCssMap } from "./styleStore";

export interface RenderContext {
  filePath?: string | null;
  baseDir?: string | null;
}

type StyleConfig = typeof defaultStyleConfig & {
  isUseIndent?: boolean;
  isUseJustify?: boolean;
  useCustomCss?: boolean;
  customCss?: CustomCssMap;
};

let rendererState: StyleConfig = {
  ...defaultStyleConfig,
  useCustomCss: false,
  customCss: undefined,
};

const renderer = initRenderer(buildRendererOptions(rendererState));

export function renderMarkdown(source: string, context: RenderContext = {}): string {
  const markdown = typeof source === "string" ? source : "";

  renderer.reset(buildRendererOptions(rendererState));

  const html = modifyHtmlContent(markdown, renderer);
  return postProcessHtml(html, context);
}

export function updateMarkdownRendererState(partial: Partial<StyleConfig>): void {
  rendererState = {
    ...rendererState,
    ...partial,
  };
}

function buildRendererOptions(style: StyleConfig): IOpts {
  const useCustomCss = Boolean(style.useCustomCss);
  const themeKey = (useCustomCss ? "default" : (style.theme ?? "default")) as keyof typeof themeMap;
  const baseTheme = themeMap[themeKey] ?? themeMap.default;
  let theme = cloneTheme(baseTheme);

  if (!useCustomCss && style.primaryColor) {
    theme.base["--md-primary-color"] = style.primaryColor;
  }

  if (useCustomCss && style.customCss && Object.keys(style.customCss).length > 0) {
    const color = theme.base["--md-primary-color"] || "#000000";
    try {
      theme = customCssWithTemplate(style.customCss, color, theme);
    }
    catch (error) {
      console.warn("Failed to apply custom CSS template", error);
    }
  }

  return {
    theme,
    fonts: useCustomCss ? defaultStyleConfig.fontFamily : style.fontFamily,
    size: useCustomCss ? defaultStyleConfig.fontSize : style.fontSize,
    isUseIndent: useCustomCss ? false : Boolean(style.isUseIndent),
    isUseJustify: useCustomCss ? false : Boolean(style.isUseJustify),
    legend: style.legend,
    citeStatus: useCustomCss ? false : style.isCiteStatus,
    countStatus: style.isCountStatus,
    isMacCodeBlock: useCustomCss ? false : Boolean(style.isMacCodeBlock),
    isShowLineNumber: useCustomCss ? false : style.isShowLineNumber,
  } satisfies IOpts;
}

function cloneTheme(theme: Theme): Theme {
  return JSON.parse(JSON.stringify(theme)) as Theme;
}

function postProcessHtml(html: string, context: RenderContext): string {
  if (typeof window === "undefined" || typeof DOMParser === "undefined") {
    return html;
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");
  const images = Array.from(doc.querySelectorAll("img"));

  if (images.length === 0) {
    return doc.body.innerHTML;
  }

  const baseDir = resolveBaseDir(context);

  for (const image of images) {
    const src = image.getAttribute("src");
    if (!src) continue;

    const resolved = resolveImageSrc(src, baseDir);
    if (resolved) {
      updateImageSources(image, resolved, baseDir);
    }
  }

  return doc.body.innerHTML;
}

function updateImageSources(image: HTMLImageElement, resolvedSrc: string, baseDir: string | null): void {
  image.setAttribute("src", resolvedSrc);

  const mirrorAttributes = ["data-src", "data-original", "data-url", "data-href", "data-lazy"];
  for (const attr of mirrorAttributes) {
    if (image.hasAttribute(attr)) {
      image.setAttribute(attr, resolvedSrc);
    }
  }

  if (image.hasAttribute("srcset")) {
    const srcset = image.getAttribute("srcset") ?? "";
    const rewritten = rewriteSrcset(srcset, baseDir);
    if (rewritten) {
      image.setAttribute("srcset", rewritten);
    }
    else {
      image.removeAttribute("srcset");
    }
  }

  if (image.hasAttribute("data-srcset")) {
    const srcset = image.getAttribute("data-srcset") ?? "";
    const rewritten = rewriteSrcset(srcset, baseDir);
    if (rewritten) {
      image.setAttribute("data-srcset", rewritten);
    }
    else {
      image.removeAttribute("data-srcset");
    }
  }
}

function rewriteSrcset(value: string, baseDir: string | null): string | null {
  if (!value) {
    return null;
  }

  const entries = value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

  if (entries.length === 0) {
    return null;
  }

  const rewritten = entries
    .map((entry) => {
      const [urlPart, descriptor] = splitSrcsetEntry(entry);
      const resolved = resolveImageSrc(urlPart, baseDir) ?? urlPart;
      return descriptor ? `${resolved} ${descriptor}` : resolved;
    })
    .filter(Boolean);

  if (rewritten.length === 0) {
    return null;
  }

  return rewritten.join(", ");
}

function splitSrcsetEntry(entry: string): [string, string | null] {
  const parts = entry.split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return ["", null];
  }
  if (parts.length === 1) {
    return [parts[0], null];
  }
  const urlPart = parts[0];
  const descriptor = parts.slice(1).join(" ");
  return [urlPart, descriptor];
}

function resolveBaseDir(context: RenderContext): string | null {
  const { baseDir, filePath } = context;

  if (baseDir) {
    const strippedBase = stripFileProtocol(baseDir);
    if (isAbsolutePath(strippedBase)) {
      return strippedBase;
    }
  }

  if (filePath) {
    const stripped = stripFileProtocol(filePath);
    if (isAbsolutePath(stripped)) {
      const isWindows = isWindowsPath(stripped);
      return fallbackDirname(stripped, isWindows);
    }
  }

  return null;
}

function resolveImageSrc(src: string, baseDir: string | null): string | null {
  const trimmed = src.trim();
  if (!trimmed) {
    return null;
  }

  if (isExternalResource(trimmed)) {
    return trimmed;
  }

  const decodedSrc = decodeUriComponentSafe(trimmed);
  const filePath = stripFileProtocol(decodedSrc);

  if (isAbsolutePath(filePath)) {
    const decodedAbsolute = decodeUriComponentSafe(filePath);
    return safeConvertFileSrc(decodedAbsolute);
  }

  if (!baseDir) {
    return decodedSrc;
  }

  const isWindows = isWindowsPath(baseDir);
  const normalizedRelative = decodeUriComponentSafe(filePath);
  const joined = fallbackJoin(baseDir, normalizedRelative, isWindows);
  if (joined) {
    const decodedJoined = decodeUriComponentSafe(joined);
    return safeConvertFileSrc(decodedJoined);
  }

  return decodedSrc;
}

function isExternalResource(src: string): boolean {
  return /^(https?:|data:|blob:|tauri:\/\/)/i.test(src);
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
    }
    catch (error) {
      console.warn("Failed to parse file url", value, error);
      return value.replace(/^file:\/\//i, "");
    }
  }
  return value;
}

function decodeUriComponentSafe(value: string): string {
  try {
    return decodeURIComponent(value);
  }
  catch (_error) {
    return value;
  }
}

function isWindowsPath(value: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(value) || /^\\\\/.test(value);
}

function isAbsolutePath(value: string): boolean {
  return isWindowsPath(value) || value.startsWith("/");
}

function safeConvertFileSrc(pathname: string): string {
  const decodedPath = decodeUriComponentSafe(pathname);
  const fallback = buildAssetUrl(decodedPath);
  try {
    const converted = convertFileSrc(decodedPath);
    if (!converted || looksLikeDevServerPath(converted) || containsEncodedBackslash(converted)) {
      return fallback;
    }
    return converted;
  }
  catch (error) {
    console.warn("convertFileSrc failed", decodedPath, error);
    return fallback;
  }
}

function containsEncodedBackslash(value: string): boolean {
  return value.includes("\\") || /%5[cC]/.test(value);
}

function looksLikeDevServerPath(value: string): boolean {
  return /https?:\/\/127\.0\.0\.1(?::\d+)?\//.test(value) || /https?:\/\/localhost(?::\d+)?\//.test(value);
}

function buildAssetUrl(pathname: string): string {
  const normalized = pathname.replace(/\\/g, "/");
  const withPrefix = normalized.startsWith("/") ? normalized : `/${normalized}`;
  return `https://asset.localhost${encodeURI(withPrefix)}`;
}

function fallbackDirname(filePath: string, isWindows: boolean): string {
  const normalized = normalizeSeparators(filePath, isWindows);
  const separator = isWindows ? "\\" : "/";
  const trimmed = trimTrailingSeparators(normalized, separator);
  const lastIndex = trimmed.lastIndexOf(separator);

  if (lastIndex === -1) {
    if (!isWindows) {
      return trimmed || "/";
    }
    if (/^[a-zA-Z]:$/.test(trimmed)) {
      return `${trimmed}\\`;
    }
    return trimmed;
  }

  let dir = trimmed.slice(0, lastIndex);
  if (!dir) {
    return isWindows ? separator : "/";
  }

  if (isWindows && /^[a-zA-Z]:$/.test(dir)) {
    dir += "\\";
  }

  return dir;
}

function fallbackJoin(baseDir: string, relative: string, isWindows: boolean): string | null {
  if (!relative) return baseDir;

  const separator = isWindows ? "\\" : "/";
  const root = getRoot(baseDir, isWindows);
  const baseParts = splitSegments(removeRoot(normalizeSeparators(baseDir, isWindows), root), separator);
  const relParts = splitSegments(normalizeSeparators(relative, isWindows), separator);

  for (const part of relParts) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (baseParts.length > 0) {
        baseParts.pop();
      }
      continue;
    }
    baseParts.push(part);
  }

  const joined = baseParts.join(separator);
  if (!joined) {
    return root || (isWindows ? baseDir : "/");
  }
  return root ? root + joined : joined;
}

function normalizeSeparators(value: string, isWindows: boolean): string {
  return isWindows ? value.replace(/\//g, "\\") : value.replace(/\\/g, "/");
}

function trimTrailingSeparators(value: string, separator: string): string {
  const pattern = separator === "\\" ? /\\+$/ : /\/+$/;
  return value.replace(pattern, "");
}

function getRoot(value: string, isWindows: boolean): string {
  const normalized = normalizeSeparators(value, isWindows);
  if (isWindows) {
    if (normalized.startsWith("\\\\")) {
      const match = normalized.match(/^(\\\\[^\\]+\\[^\\]+)/);
      return match ? `${match[1]}\\` : "\\\\";
    }
    const driveMatch = normalized.match(/^([a-zA-Z]:)(?:\\|$)/);
    return driveMatch ? `${driveMatch[1]}\\` : "";
  }
  return normalized.startsWith("/") ? "/" : "";
}

function removeRoot(value: string, root: string): string {
  if (!root) return value;
  if (value.startsWith(root)) {
    return value.slice(root.length);
  }
  return value;
}

function splitSegments(value: string, separator: string): string[] {
  const pattern = separator === "\\" ? /[\\/]+/ : /\/+/;
  return value.split(pattern).filter(Boolean);
}
