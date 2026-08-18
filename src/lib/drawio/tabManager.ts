import { get } from "svelte/store";
import DrawioTab from "./DrawioTab.svelte";
import { addTab, focusTabByPath, tabs as editorTabs } from "../EditorTabList.svelte";
import { t } from "../i18n";
import { DRAWIO_TAB_PATH } from "./state";

export function ensureDrawioTab(): void {
    if (typeof document === "undefined") return;
    const tabview = document.getElementById("tabview");
    if (!tabview) return;

    const existing = get(editorTabs).find((tab) => tab?.path === DRAWIO_TAB_PATH);
    if (existing) {
        focusTabByPath(DRAWIO_TAB_PATH);
        return;
    }

    const translate = get(t);
    addTab(
        DRAWIO_TAB_PATH,
        translate("drawioWorkspace.tabTitle"),
        new DrawioTab({ target: tabview }),
        { labelKey: "drawioWorkspace.tabTitle" },
    );
}
