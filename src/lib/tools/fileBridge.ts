import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { addEditorTab, tabs } from "../EditorTabList.svelte";
import { get } from "svelte/store";
import { waitForElement } from "../utils/dom";

export type FileEvent =
  | { type: "open"; path: string }
  | { type: "saved"; path: string };

let unlistenRef: UnlistenFn | null = null;
let inited = false;

export async function initFileBridgeEvents() {
  if (inited) return unlistenRef;
  inited = true;
  unlistenRef = await listen<FileEvent>("hostbridge://file", async (evt) => {
    const e = evt.payload;
    if (!e || typeof e !== "object") return;
    if (e.type === "open" && e.path) {
      // Ensure tab container exists before creating Svelte components
      const ok = document.getElementById("tabview") || await waitForElement('#tabview').catch(() => null);
      if (!ok) {
        console.warn("[fileBridge] #tabview not ready; skipping open for", e.path);
        return;
      }
      const name = e.path.split(/[\/\\]/).pop();
      // Always request/open the tab
      await addEditorTab(e.path, name);
      // Explicitly activate the tab matching the path (covers both newly
      // created and already-open cases, avoiding focus being hijacked by
      // other views like an existing diff tab).
      try {
        const openTabs = get(tabs) as any[];
        const match = openTabs.find((t) => t.path === e.path);
        if (match && typeof match.setActive === 'function') {
          match.setActive(match.id);
        }
      } catch {}
      return;
    }
    // For now we do not auto-reload on save; editor content is user-owned.
    // Future: if needed, react to e.type === 'saved' by refreshing metadata.
  });
  return unlistenRef;
}
