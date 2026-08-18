import type { Lang } from "./i18n";
import rawNotes from "./release-notes.json";

type ReleaseNotesMap = Record<string, Partial<Record<Lang | "en", string[]>>>;

const notesMap: ReleaseNotesMap = rawNotes;

export function getReleaseNotesList(version: string, language: Lang): string[] | undefined {
  const entry = notesMap[version];
  if (!entry) {
    return undefined;
  }
  const localized = entry[language];
  if (localized && localized.length > 0) {
    return localized;
  }
  const fallback = entry["en"];
  return fallback && fallback.length > 0 ? fallback : undefined;
}

export function getReleaseNotesSummary(version: string, language: Lang): string | undefined {
  const list = getReleaseNotesList(version, language);
  if (!list || list.length === 0) {
    return undefined;
  }
  const sanitized = list
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter((item) => item.length > 0);
  if (sanitized.length === 0) {
    return undefined;
  }
  const separator = language === "zh-CN" ? "；" : "; ";
  return sanitized.join(separator);
}
