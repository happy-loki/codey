import { writable } from "svelte/store";

export type PreviewMode = "edit" | "split" | "preview";

export const previewMode = writable<PreviewMode>("edit");

const TOOLBAR_STORAGE_KEY = "codey.showMarkdownToolbar";

function createShowMarkdownToolbarStore() {
    let initialValue = true;

    if (typeof window !== "undefined") {
        const stored = window.localStorage.getItem(TOOLBAR_STORAGE_KEY);
        if (stored === "true" || stored === "false") {
            initialValue = stored === "true";
        }
    }

    const { subscribe, set, update } = writable(initialValue);

    if (typeof window !== "undefined") {
        subscribe((value) => {
            window.localStorage.setItem(TOOLBAR_STORAGE_KEY, value ? "true" : "false");
        });
    }

    return {
        subscribe,
        set,
        update
    };
}

export const showMarkdownToolbar = createShowMarkdownToolbarStore();

// Whether the currently active tab is a Markdown file
export const isMarkdownActive = writable(false);
