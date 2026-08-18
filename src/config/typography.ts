import defaultSettings from "./defaultSettings.json";
import { SYSTEM_UI_FONT_STACK } from "./fontStacks";

const rootStyle = document?.documentElement?.style;

const settingsDefaults: any = defaultSettings;

const FALLBACK_UI_FONT_FAMILY = SYSTEM_UI_FONT_STACK;
const FALLBACK_UI_FONT_SIZE = "14px";
const FALLBACK_AI_FONT_FAMILY = SYSTEM_UI_FONT_STACK;
const FALLBACK_AI_FONT_SIZE = "16px";
export const MIN_UI_FONT_PX = 12;
export const MAX_UI_FONT_PX = 24;

const DEFAULT_UI_FONT_FAMILY = normalizeFontFamily(settingsDefaults?.ui?.fontFamily, FALLBACK_UI_FONT_FAMILY);
const DEFAULT_UI_FONT_SIZE = normalizeFontSize(settingsDefaults?.ui?.fontSize, FALLBACK_UI_FONT_SIZE, MIN_UI_FONT_PX, MAX_UI_FONT_PX);
const DEFAULT_AI_FONT_FAMILY = normalizeFontFamily(settingsDefaults?.ai?.fontFamily, FALLBACK_AI_FONT_FAMILY);
const DEFAULT_AI_FONT_SIZE = normalizeFontSize(settingsDefaults?.ai?.fontSize, FALLBACK_AI_FONT_SIZE);

let currentUiFontFamily = DEFAULT_UI_FONT_FAMILY;
let currentUiFontSize = DEFAULT_UI_FONT_SIZE;
let currentAiFontFamily = DEFAULT_AI_FONT_FAMILY;
let currentAiFontSize = DEFAULT_AI_FONT_SIZE;

function normalizeFontFamily(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : fallback;
}

function clampPx(value: number, minPx: number, maxPx: number): number {
  if (!Number.isFinite(value)) return minPx;
  if (value < minPx) return minPx;
  if (value > maxPx) return maxPx;
  return value;
}

function normalizeFontSize(value: unknown, fallback: string, minPx = 0, maxPx = Number.POSITIVE_INFINITY): string {
  if (value == null) return fallback;
  if (typeof value === "number" && Number.isFinite(value)) {
    const clamped = clampPx(value, minPx, maxPx);
    return clamped > 0 ? `${clamped}px` : fallback;
  }
  const str = String(value).trim();
  if (!str) return fallback;
  const numeric = Number(str);
  if (!Number.isNaN(numeric)) {
    const clamped = clampPx(numeric, minPx, maxPx);
    return clamped > 0 ? `${clamped}px` : fallback;
  }
  if (/^\d+(?:\.\d+)?px$/i.test(str)) {
    const withoutUnit = parseFloat(str);
    if (!Number.isNaN(withoutUnit)) {
      const clamped = clampPx(withoutUnit, minPx, maxPx);
      return `${clamped}px`;
    }
    return str;
  }
  return fallback;
}

function setRootVar(name: string, value: string) {
  try {
    rootStyle?.setProperty(name, value);
  } catch {}
}

export function setUiFontFamily(value: unknown) {
  currentUiFontFamily = normalizeFontFamily(value, DEFAULT_UI_FONT_FAMILY);
  setRootVar("--ui-font-family", currentUiFontFamily);
}

export function setUiFontSize(value: unknown) {
  currentUiFontSize = normalizeFontSize(value, DEFAULT_UI_FONT_SIZE, MIN_UI_FONT_PX, MAX_UI_FONT_PX);
  setRootVar("--ui-font-size", currentUiFontSize);
}

export function setAiFontFamily(value: unknown) {
  currentAiFontFamily = normalizeFontFamily(value, DEFAULT_AI_FONT_FAMILY);
  setRootVar("--ai-font-family", currentAiFontFamily);
}

export function setAiFontSize(value: unknown) {
  currentAiFontSize = normalizeFontSize(value, DEFAULT_AI_FONT_SIZE);
  setRootVar("--ai-font-size", currentAiFontSize);
}

export function getAiFontFamily(): string {
  return currentAiFontFamily || DEFAULT_AI_FONT_FAMILY;
}

export function getAiFontSize(): string {
  return currentAiFontSize || DEFAULT_AI_FONT_SIZE;
}

export function ensureTypographyDefaults() {
  setUiFontFamily(currentUiFontFamily);
  setUiFontSize(currentUiFontSize);
  setAiFontFamily(currentAiFontFamily);
  setAiFontSize(currentAiFontSize);
}
