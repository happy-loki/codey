import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { addTab, closeTabsByPrefix } from "../EditorTabList.svelte";
import MultiDiffTab from "./MultiDiffTab.svelte";
import { waitForElement } from "../utils/dom";

export type MultiDiffEntry = {
  path: string;
  left: string;
  right: string;
};

export type MultiDiffEvent =
  | {
      type: "multiOpen";
      sessionId?: string | null;
      title?: string | null;
      diffs?: MultiDiffEntry[];
      count?: number | null;
    };

export type OpenMultiDiffOptions = {
  sessionId?: string | null;
  title?: string | null;
  diffs?: MultiDiffEntry[] | unknown;
};

let unlistenRef: UnlistenFn | null = null;
let initialized = false;

function sanitizeEntries(entries: unknown): MultiDiffEntry[] {
  if (!Array.isArray(entries)) return [];
  return entries.map((entry) => {
    const path = typeof (entry as any)?.path === "string" ? (entry as any).path : "";
    const left =
      typeof (entry as any)?.left === "string"
        ? (entry as any).left
        : typeof (entry as any)?.left_content === "string"
          ? (entry as any).left_content
          : "";
    const right =
      typeof (entry as any)?.right === "string"
        ? (entry as any).right
        : typeof (entry as any)?.right_content === "string"
          ? (entry as any).right_content
          : "";
    return { path, left, right };
  });
}

export async function openMultiDiffSession(options: OpenMultiDiffOptions) {
  if (typeof document === "undefined") {
    console.warn("[multiDiffHost] cannot open multi-diff session: document is undefined");
    return;
  }
  // Ensure we only keep one diff-related tab at a time
  try {
    await closeTabsByPrefix("diff://", { force: true });
  } catch (err) {
    console.warn("[multiDiffHost] failed to close single-file diff tabs", err);
  }
  const sessionId =
    (options.sessionId && String(options.sessionId)) || `multi-diff-${Date.now()}`;
  const labelBase =
    typeof options.title === "string" && options.title.trim().length > 0
      ? options.title.trim()
      : "Multi-file Diff";
  const files = sanitizeEntries(options.diffs ?? []);
  const tabLabel =
    files.length > 0 ? `${labelBase} · ${files.length} files` : labelBase;
  const target =
    document.getElementById("tabview") ||
    (await waitForElement("#tabview").catch(() => null));
  if (!target) {
    console.warn("[multiDiffHost] tab container missing; ignoring open request", {
      options,
    });
    return;
  }
  await closeTabsByPrefix("multi-diff://", { force: true });

  const view = new MultiDiffTab({
    target,
    props: {
      sessionId,
      title: labelBase,
      diffs: files,
    },
  });
  const tabPath = `multi-diff://${sessionId}`;
  addTab(tabPath, tabLabel, view);
}

export async function initMultiDiffEvents() {
  if (initialized) return unlistenRef;
  initialized = true;
  unlistenRef = await listen<MultiDiffEvent>("hostbridge://multi-diff", async (evt) => {
    const payload = evt.payload;
    if (!payload || payload.type !== "multiOpen") {
      return;
    }
    await openMultiDiffSession({
      sessionId: payload.sessionId,
      title: payload.title,
      diffs: payload.diffs,
    });
  });
  return unlistenRef;
}
