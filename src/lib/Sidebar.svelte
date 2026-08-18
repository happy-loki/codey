<script lang="ts">
    import { Folder, Palette, Settings as SettingsIcon, Shapes } from "lucide-svelte";
    import SidebarTab from "./SidebarTab.svelte";
    import FileTree from "./FileTree.svelte";
    import { fitTerminal } from "./Terminal.svelte";
    import settings from "./Settings.svelte";
    import { addTab, closeTabByPath, focusTabByPath, tabs as editorTabs } from "./EditorTabList.svelte";
    import { t } from "./i18n";
    import { get as getStoreValue } from "svelte/store";
    import { ensureWhiteboardTab } from "./whiteboard/tabManager";
    import { setWhiteboardFile, setWhiteboardGlobal, WHITEBOARD_TAB_PATH } from "./whiteboard/state";
    import { ensureDrawioTab } from "./drawio/tabManager";
    import { DRAWIO_TAB_PATH, setDrawioFile } from "./drawio/state";
    import { exists } from "@tauri-apps/plugin-fs";
    import { openConfirmModal } from "./utility/confirmModalStore";
    import { ensureDefaultWhiteboardFile, getWhiteboardStorageDirPath } from "./whiteboard/defaultFile";
    import { ensureDefaultDrawioFile, getDrawioStorageDirPath } from "./drawio/defaultWorkspace";

    const SETTINGS_TAB_PATH = "Settings";

    function isTabOpen(path: string): boolean {
        return Boolean($editorTabs?.find?.((tab) => tab?.path === path));
    }

    function isTabActive(path: string): boolean {
        return Boolean($editorTabs?.find?.((tab) => tab?.path === path && tab?.active));
    }

    async function toggleSettings() {
        if (isTabActive(SETTINGS_TAB_PATH)) {
            await closeTabByPath(SETTINGS_TAB_PATH);
            return;
        }

        if (isTabOpen(SETTINGS_TAB_PATH)) {
            await focusTabByPath(SETTINGS_TAB_PATH);
            return;
        }

        const translate = getStoreValue(t);
        const tabview = document.getElementById("tabview");
        if (!tabview) return;
        addTab(
            SETTINGS_TAB_PATH,
            translate("sidebar.settings"),
            new settings({ target: tabview }),
            { labelKey: "sidebar.settings" },
        );
    }

    let whiteboardActive = false;
    $: whiteboardActive = Boolean($editorTabs?.find?.((tab) => tab?.path === WHITEBOARD_TAB_PATH && tab?.active));
    let whiteboardOpen = false;
    $: whiteboardOpen = Boolean($editorTabs?.find?.((tab) => tab?.path === WHITEBOARD_TAB_PATH));

    async function confirmWorkspaceInitIfMissing(params: {
        dirName: string;
        dirPath: string;
    }): Promise<boolean> {
        try {
            if (await exists(params.dirPath)) {
                return true;
            }
        } catch (err) {
            console.warn("[Sidebar] failed to check init dir existence", params.dirPath, err);
        }

        const translate = getStoreValue(t);
        return await openConfirmModal({
            title: translate("workspaceInit.title", { dirName: params.dirName }),
            message: translate("workspaceInit.message", { dirPath: params.dirPath }),
            cancelLabel: translate("workspaceInit.cancel"),
            confirmLabel: translate("workspaceInit.confirm"),
            confirmStyle: "primary",
        });
    }

    async function toggleWhiteboard() {
        if (whiteboardActive) {
            await closeTabByPath(WHITEBOARD_TAB_PATH);
            return;
        }

        // If it's already open but not active, just focus it - no need to re-run workspace init logic.
        if (whiteboardOpen) {
            await focusTabByPath(WHITEBOARD_TAB_PATH);
            return;
        }

        const storageDir = await getWhiteboardStorageDirPath();
        const ok = await confirmWorkspaceInitIfMissing({
            dirName: "excalidraw",
            dirPath: storageDir,
        });
        if (!ok) return;

        try {
            const defaultPath = await ensureDefaultWhiteboardFile();
            const label = defaultPath.split(/[/\\]/).pop() ?? defaultPath;
            setWhiteboardFile(defaultPath, { label });
        } catch (err) {
            console.error("[Sidebar] failed to open default whiteboard file", err);
            setWhiteboardGlobal();
            return;
        }
        ensureWhiteboardTab();
    }

    let drawioActive = false;
    $: drawioActive = Boolean($editorTabs?.find?.((tab) => tab?.path === DRAWIO_TAB_PATH && tab?.active));
    let drawioOpen = false;
    $: drawioOpen = Boolean($editorTabs?.find?.((tab) => tab?.path === DRAWIO_TAB_PATH));

    async function toggleDrawioWorkspace() {
        if (drawioActive) {
            await closeTabByPath(DRAWIO_TAB_PATH);
            return;
        }

        if (drawioOpen) {
            await focusTabByPath(DRAWIO_TAB_PATH);
            return;
        }

        const storageDir = await getDrawioStorageDirPath();
        const ok = await confirmWorkspaceInitIfMissing({
            dirName: "drawio",
            dirPath: storageDir,
        });
        if (!ok) return;

        try {
            const defaultPath = await ensureDefaultDrawioFile();
            const label = defaultPath.split(/[/\\]/).pop() ?? defaultPath;
            setDrawioFile(defaultPath, { label });
        } catch (err) {
            console.error("[Sidebar] failed to open default draw.io file", err);
            return;
        }
        ensureDrawioTab();
    }

</script>

<div id="sidebar">
    {#each $sidebartabs as tab}
        <SidebarTab
            id={`tool-${tab.id}`}
            active={$showsidebarview ? false : ($activeid === tab.id)}
            label={$t(tab.labelKey ?? tab.tabname)}
            on:click={() => {toggleActive(tab)}}
        >
            <svelte:component this={tab.icon}/>
        </SidebarTab>
    {/each}
    <SidebarTab
        id="left-tool-whiteboard"
        active={whiteboardActive}
        label={$t("sidebar.whiteboard")}
        on:click={toggleWhiteboard}
    >
        <Palette />
    </SidebarTab>
    <SidebarTab
        id="left-tool-drawio"
        active={drawioActive}
        label={$t("sidebar.drawio")}
        on:click={toggleDrawioWorkspace}
    >
        <Shapes />
    </SidebarTab>
    <div class="spacer" />
    <div class="divider" />
    <div class="bottom">
        <SidebarTab
            id="left-tool-settings"
            active={isTabActive(SETTINGS_TAB_PATH)}
            label={$t("sidebar.settings")}
            on:click={toggleSettings}
        >
            <SettingsIcon />
        </SidebarTab>
    </div>
</div>

<script lang="ts" context="module">
    import { writable, get } from "svelte/store"; 
    class Tool {
        tabname: string;
        content;
        constructor(tabname: string, content) {
            this.tabname = tabname;
            this.content = content;
        }
    }

    const sidebartabs = writable([
        {id: 0, tabname: "Explorer", labelKey: "sidebar.explorer", icon: Folder, content: FileTree},
    ]);

    export let activeid = writable(-1);
    let active = -1;
    export let showsidebarview = writable(false);
    export let tool = writable(null);

    export const toggleActive = (tab: { id: any; tabname: any; icon: any, content: any }) => {
        if (active === tab.id) {
            active = -1;
            activeid.set(-1);
            showsidebarview.set(false);
        }
        else {
            activeid.set(tab.id);
            active = tab.id;
            showsidebarview.set(true);
            tool.set(new Tool(tab.tabname, tab.content));
        }
        fitTerminal();
    }

    export function openFileTree() {
        const tab = get(sidebartabs)[0];
        if (active === tab.id) return;
        
        activeid.set(tab.id);
        active = tab.id;
        showsidebarview.set(true);
        tool.set(new Tool(tab.tabname, tab.content));
    }
</script>

<style lang="scss">
    #sidebar {
        --sidebar-font-size: var(--ui-font-size, 16px);
        --sidebar-width: clamp(40px, calc(var(--sidebar-font-size) * 3.2), 72px);
        --sidebar-gap: clamp(2px, calc(var(--sidebar-font-size) * 0.25), 12px);
        --sidebar-padding-x: clamp(2px, calc(var(--sidebar-font-size) * 0.2), 12px);
        --sidebar-padding-y: clamp(2px, calc(var(--sidebar-font-size) * 0.28), 14px);
        --sidebar-divider-thickness: clamp(1px, calc(var(--sidebar-font-size) * 0.05), 2px);
        --sidebar-icon-size: clamp(18px, calc(var(--sidebar-font-size) * 1.35), 32px);
        --sidebar-tab-height: clamp(32px, calc(var(--sidebar-font-size) * 2.1), 66px);
        --sidebar-tab-padding-block: clamp(2px, calc(var(--sidebar-font-size) * 0.18), 10px);
        --sidebar-tab-padding-inline: clamp(4px, calc(var(--sidebar-font-size) * 0.32), 12px);
        --sidebar-radius: clamp(4px, calc(var(--sidebar-font-size) * 0.22), 10px);
        height: 100%;
        width: var(--sidebar-width);
        min-width: var(--sidebar-width);
        flex: 0 0 var(--sidebar-width);
        display: flex;
        flex-direction: column;
        align-items: center;
        padding: var(--sidebar-padding-y) var(--sidebar-padding-x);
        box-sizing: border-box;
        gap: var(--sidebar-gap);
    }
    .spacer { flex: 1 1 auto; width: 100%; }
    .divider {
        width: 70%;
        height: var(--sidebar-divider-thickness);
        margin: calc(var(--sidebar-gap) * 0.75) auto;
    }
    .bottom {
        display: flex;
        flex-direction: column;
        width: 100%;
        align-items: center;
        gap: var(--sidebar-gap);
    }
</style>
