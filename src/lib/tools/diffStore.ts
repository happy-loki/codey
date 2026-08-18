import { writable, get, derived } from "svelte/store";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { addTab, tabs, closeTab, closeTabsByPrefix } from "../EditorTabList.svelte";
import DiffTab from "./DiffTab.svelte";
import { waitForElement } from "../utils/dom";

export type DiffEvent =
  | { type: "open"; diffId: string; path: string; original: string }
  | { type: "replace"; diffId: string; startLine: number; endLine: number; content: string }
  | { type: "truncate"; diffId: string; endLine: number }
  | { type: "save"; diffId: string; path: string }
  | { type: "closeAll"; closed: number; remaining: number }
  | { type: "scroll"; diffId: string; line: number }
  | { type: "close"; diffId: string };

export type Session = {
  id: string;
  path: string;
  original: string;
  content: string;
  dirty: boolean;
  lastChangeLine?: number;
  scrollRequestId?: number;
};

export const sessions = writable<Record<string, Session>>({});
export const activeId = writable<string | null>(null);
export const justOpenedId = writable<string | null>(null);

export const entries = derived(sessions, ($s) => Object.values($s));
export const active = derived([sessions, activeId], ([$s, $id]) => ($id ? $s[$id] ?? null : null));

async function pruneClosedDiffTabs() {
    const snapshot = { ...get(sessions) };
    const openDiffIds = new Set(Object.keys(snapshot));
    const currentTabs = [...(get(tabs) as any[])];
    for (const tab of currentTabs) {
        const path: string | undefined = tab?.path;
        if (!path || typeof path !== "string" || !path.startsWith("diff://")) continue;
        const diffId = path.slice("diff://".length);
        if (!openDiffIds.has(diffId)) {
            try {
                await closeTab(tab.id);
            } catch (err) {
                console.warn("[diffStore] failed to close diff tab", { diffId, err });
            }
        }
    }
}

function computeLineStarts(s: string): number[] {
  const out = [0];
  for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) === 10 /*\n*/) out.push(i + 1);
  return out;
}

function replaceByLines(text: string, startLine: number, endLine: number, insert: string): string {
  const starts = computeLineStarts(text);
  const start = starts[startLine] ?? text.length;
  const end = starts[endLine] ?? text.length;
  return text.slice(0, start) + insert + text.slice(end);
}

let unlistenRef: UnlistenFn | null = null;
let inited = false;

export async function initDiffEvents() {
  if (inited) return unlistenRef;
  inited = true;
  console.log("[diffStore] initDiffEvents registering listener...");
  try { (window as any).__diffSessions = sessions; } catch {}
  unlistenRef = await listen<DiffEvent>("hostbridge://diff", async (evt) => {
    const e = evt.payload;
    if (e.type === "open") {
      console.log("[diffStore] received open diff event", e);
      const sess: Session = {
        id: e.diffId,
        path: e.path,
        original: e.original ?? "",
        content: e.original ?? "",
        dirty: false,
        scrollRequestId: 0,
      };
      sessions.update((s) => ({ ...s, [e.diffId]: sess }));
      activeId.set(e.diffId);
      justOpenedId.set(e.diffId);
      // 打开单文件 diff 之前，确保 tab 中不会残留其它 diff/multi-diff
      try {
        // 始终保证「diff:// 或 multi-diff://」只存在一个
        await closeTabsByPrefix("diff://", { force: true });
        await closeTabsByPrefix("multi-diff://", { force: true });

        // Open/update a main editor tab for this diff
        const diffPath = `diff://${e.diffId}`;
        const label = e.path ? `Diff: ${e.path.split(/[\/\\]/).pop()}` : `Diff ${e.diffId}`;
        const target = document.getElementById("tabview") || await waitForElement('#tabview').catch(() => null);
        if (!target) {
          console.warn("[diffStore] #tabview not ready; skipping tab add for", diffPath);
        } else {
          const snapshot = sess; // guaranteed snapshot of what we just stored
          const view = new DiffTab({
            target,
            props: {
              sessionId: e.diffId,
              sessionsStore: sessions,
              activeIdStore: activeId,
              justOpenedIdStore: justOpenedId,
              initialSession: snapshot,
            },
          });
          addTab(diffPath, label, view);
          console.log("[diffStore] DiffTab added", { diffPath, label, activeId: e.diffId });
        }
      } catch (err) {
        console.error("[diffStore] failed to create diff tab:", err);
      }
      setTimeout(() => {
        if (get(justOpenedId) === e.diffId) justOpenedId.set(null);
      }, 1400);
      return;
    }
    if (e.type === "replace") {
      let target: { path: string; content: string } | null = null;
      sessions.update((s) => {
        const cur = s[e.diffId];
        if (!cur) return s;
        const content = replaceByLines(cur.content, e.startLine ?? 0, e.endLine ?? 0, e.content ?? "");
        target = { path: cur.path, content };
        const startLine = typeof e.startLine === "number" ? Math.max(0, e.startLine - 1) : undefined;
        let nextLine = typeof cur.lastChangeLine === "number" ? cur.lastChangeLine : undefined;
        if (typeof startLine === "number") {
          nextLine = typeof nextLine === "number" ? Math.min(nextLine, startLine) : startLine;
        }
        const hasScrollRequest = typeof cur.scrollRequestId === "number" && cur.scrollRequestId > 0;
        const shouldRequestScroll = !hasScrollRequest && typeof nextLine === "number";
        const nextScrollId = shouldRequestScroll ? (cur.scrollRequestId ?? 0) + 1 : cur.scrollRequestId ?? 0;
        return {
          ...s,
          [e.diffId]: {
            ...cur,
            content,
            dirty: true,
            lastChangeLine: typeof nextLine === "number" ? nextLine : cur.lastChangeLine,
            scrollRequestId: nextScrollId,
          },
        };
      });
      if (target) syncToOpenEditor(target.path, target.content);
      return;
    }
    if (e.type === "truncate") {
      let target: { path: string; content: string } | null = null;
      sessions.update((s) => {
        const cur = s[e.diffId];
        if (!cur) return s;
        const starts = computeLineStarts(cur.content);
        const cut = starts[e.endLine] ?? cur.content.length;
        target = { path: cur.path, content: cur.content.slice(0, cut) };
        const startLine = typeof e.endLine === "number" ? Math.max(0, e.endLine - 1) : undefined;
        let nextLine = typeof cur.lastChangeLine === "number" ? cur.lastChangeLine : undefined;
        if (typeof startLine === "number") {
          nextLine = typeof nextLine === "number" ? Math.min(nextLine, startLine) : startLine;
        }
        const hasScrollRequest = typeof cur.scrollRequestId === "number" && cur.scrollRequestId > 0;
        const shouldRequestScroll = !hasScrollRequest && typeof nextLine === "number";
        const nextScrollId = shouldRequestScroll ? (cur.scrollRequestId ?? 0) + 1 : cur.scrollRequestId ?? 0;
        return {
          ...s,
          [e.diffId]: {
            ...cur,
            content: cur.content.slice(0, cut),
            dirty: true,
            lastChangeLine: typeof nextLine === "number" ? nextLine : cur.lastChangeLine,
            scrollRequestId: nextScrollId,
          },
        };
      });
      if (target) syncToOpenEditor(target.path, target.content);
      return;
    }
    if (e.type === "save") {
      sessions.update((s) => {
        const cur = s[e.diffId];
        if (!cur) return s;
        return { ...s, [e.diffId]: { ...cur, dirty: false } };
      });
      return;
    }
    if (e.type === "closeAll") {
      sessions.update((s) => {
        const next: Record<string, Session> = {};
        for (const [id, v] of Object.entries(s)) if (v.dirty) next[id] = v;
        return next;
      });
      const id = get(activeId);
      if (id && !get(sessions)[id]) activeId.set(Object.keys(get(sessions))[0] ?? null);
      await pruneClosedDiffTabs();
      return;
    }
    if (e.type === "scroll") {
      sessions.update((s) => {
        const cur = s[e.diffId];
        if (!cur) return s;
        const line = Math.max(0, e.line ?? 0);
        const nextScrollId = (cur.scrollRequestId ?? 0) + 1;
        return {
          ...s,
          [e.diffId]: { ...cur, lastChangeLine: line, scrollRequestId: nextScrollId },
        };
      });
      return;
    }
    if (e.type === "close") {
      sessions.update((s) => {
        const next = { ...s };
        delete next[e.diffId];
        return next;
      });
      const diffPath = `diff://${e.diffId}`;
      const currentTabs = [...(get(tabs) as any[])];
      const tab = currentTabs.find((t) => t.path === diffPath);
      if (tab) {
        try {
          await closeTab(tab.id);
        } catch (err) {
          console.warn("[diffStore] failed to close diff tab", err);
        }
      }
      if (get(activeId) === e.diffId) {
        activeId.set(null);
      }
      return;
    }
  });
  return unlistenRef;
}

export type OpenInlineDiffOptions = {
  path?: string | null;
  original: string;
  modified: string;
  title?: string | null;
  scrollToLine?: number | null;
};

export async function openInlineDiffTab(options: OpenInlineDiffOptions) {
  if (typeof document === "undefined") {
    console.warn("[diffStore] cannot open inline diff: document is undefined");
    return;
  }

  // Always keep at most one diff-like tab (single or multi)
  try {
    await closeTabsByPrefix("diff://", { force: true });
    await closeTabsByPrefix("multi-diff://", { force: true });
  } catch (err) {
    console.warn("[diffStore] failed to close existing diff tabs", err);
  }

  const diffId = `inline-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const path = options.path ?? options.title ?? "";
  const original = options.original ?? "";
  const content = options.modified ?? "";
  const initialScrollLine =
    typeof options.scrollToLine === "number" && Number.isFinite(options.scrollToLine)
      ? Math.max(0, Math.floor(options.scrollToLine))
      : undefined;

  const session: Session = {
    id: diffId,
    path,
    original,
    content,
    dirty: false,
    lastChangeLine: initialScrollLine,
    scrollRequestId: typeof initialScrollLine === "number" ? 1 : 0,
  };

  // Use per-tab local stores so each inline diff is fully isolated
  const localSessions = writable<Record<string, Session>>({ [diffId]: session });
  const localActiveId = writable<string | null>(diffId);
  const localJustOpenedId = writable<string | null>(null);

  const diffPath = `diff://${diffId}`;
  const label = path ? `Diff: ${path.split(/[\/\\]/).pop()}` : "Diff";
  const target =
    document.getElementById("tabview") ||
    (await waitForElement("#tabview").catch(() => null));
  if (!target) {
    console.warn("[diffStore] tab container missing; ignoring inline diff open", {
      diffPath,
      path,
    });
    return;
  }

  const view = new DiffTab({
    target,
    props: {
      sessionId: diffId,
      sessionsStore: localSessions,
      activeIdStore: localActiveId,
      justOpenedIdStore: localJustOpenedId,
      initialSession: session,
    },
  });

  addTab(diffPath, label, view);
}

export function setActive(id: string) {
  activeId.set(id);
}

function syncToOpenEditor(path: string, text: string) {
  try {
    const openTabs = get(tabs) as any[];
    const tab = openTabs.find((t) => t.isfile && t.path === path);
    if (tab && tab.saved && tab.content?.setExternalContent) {
      tab.content.setExternalContent(text);
      // keep metadata; ping view for theme refresh, etc.
      tab.refreshView(tab);
    }
  } catch {}
}
