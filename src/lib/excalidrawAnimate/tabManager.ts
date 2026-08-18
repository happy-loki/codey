import { get } from "svelte/store";
import AnimationTab from "./AnimationTab.svelte";
import { addTab, focusTabByPath, tabs as editorTabs } from "../EditorTabList.svelte";
import { ANIMATION_TAB_PATH } from "./state";
import { t } from "../i18n";

export function ensureAnimationTab(): void {
    if (typeof document === "undefined") return;
    const translate = get(t);
    const tabview = document.getElementById("tabview");
    if (!tabview) return;

    const existing = get(editorTabs).find((tab) => tab?.path === ANIMATION_TAB_PATH);
    if (existing) {
        focusTabByPath(ANIMATION_TAB_PATH);
        return;
    }

    addTab(
        ANIMATION_TAB_PATH,
        translate("sidebar.excalidrawAnimation"),
        new AnimationTab({ target: tabview }),
        { labelKey: "sidebar.excalidrawAnimation" },
    );
}
