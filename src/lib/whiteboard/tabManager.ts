import { get } from "svelte/store";
import ExcalidrawTab from "../ExcalidrawTab.svelte";
import { addTab, focusTabByPath, tabs as editorTabs } from "../EditorTabList.svelte";
import { t } from "../i18n";
import { WHITEBOARD_TAB_PATH } from "./state";

export function ensureWhiteboardTab(): void {
    if (typeof document === "undefined") return;
    const translate = get(t);
    const tabview = document.getElementById("tabview");
    if (!tabview) return;

    const existing = get(editorTabs).find((tab) => tab?.path === WHITEBOARD_TAB_PATH);
    if (existing) {
        focusTabByPath(WHITEBOARD_TAB_PATH);
        return;
    }

    addTab(
        WHITEBOARD_TAB_PATH,
        translate("sidebar.whiteboard"),
        new ExcalidrawTab({ target: tabview }),
        { labelKey: "sidebar.whiteboard" },
    );
}
