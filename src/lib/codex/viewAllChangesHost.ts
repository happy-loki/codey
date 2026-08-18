import { addTab, closeTabsByPrefix } from "../EditorTabList.svelte";
import { waitForElement } from "../utils/dom";
import type { FileUpdateChange } from "./types";
import ViewAllChangesTab from "./ViewAllChangesTab.svelte";

export type OpenViewAllChangesOptions = {
    turnId?: string | null;
    title?: string | null;
    changes: FileUpdateChange[];
};

export async function openViewAllChangesTab(options: OpenViewAllChangesOptions) {
    if (typeof document === "undefined") {
        console.warn(
            "[viewAllChangesHost] cannot open view-all-changes tab: document is undefined"
        );
        return;
    }

    const sessionId =
        (options.turnId && String(options.turnId)) || `view-all-${Date.now()}`;
    const baseTitle =
        typeof options.title === "string" && options.title.trim().length > 0
            ? options.title.trim()
            : "View all changes";
    const changes = Array.isArray(options.changes) ? options.changes : [];
    const fileCount = changes.length;
    const tabLabel =
        fileCount > 0 ? `${baseTitle} · ${fileCount} files` : baseTitle;

    const target =
        document.getElementById("tabview") ||
        (await waitForElement("#tabview").catch(() => null));
    if (!target) {
        console.warn(
            "[viewAllChangesHost] tab container missing; ignoring open request",
            {
                options,
            }
        );
        return;
    }

    try {
        await closeTabsByPrefix("view-all://", { force: true });
    } catch (err) {
        console.warn(
            "[viewAllChangesHost] failed to close existing view-all tabs",
            err
        );
    }

    const view = new ViewAllChangesTab({
        target,
        props: {
            sessionId,
            title: baseTitle,
            changes,
        },
    });

    const tabPath = `view-all://${sessionId}`;
    addTab(tabPath, tabLabel, view);
}

