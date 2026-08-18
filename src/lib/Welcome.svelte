<script lang="ts">
    import { openFolderDialog } from "./File";
    import { FolderOpen, Settings } from "lucide-svelte";
    import { addTab } from "./EditorTabList.svelte";
    import settings from "./Settings.svelte";
    import { getVersion } from '@tauri-apps/api/app';
    import { onMount } from "svelte";
    import { t } from "./i18n";
    import { get } from "svelte/store";

    export let hidden = true;

    let appVersion = "";
    onMount(async () => {
        appVersion = await getVersion();
    })

    function openSettingsTab() {
        const translate = get(t);
        addTab("Settings", translate("sidebar.settings"), new settings({target: document.getElementById("tabview")}), { labelKey: "sidebar.settings" });
    }
</script>

<div class="container" class:hidden>
    <div class="content">
        <p class="tagline">
            {$t("welcome.taglineLine1")}
        </p>

        <div class="quick-actions">
            <button on:click={openFolderDialog} title={$t("menu.newWorkspaceTooltip")}>
                <FolderOpen /> {$t("welcome.openWorkspace")}
            </button>
            <button on:click={openSettingsTab}><Settings /> {$t("sidebar.settings")}</button>
        </div>
    </div>

    <div class="version">v{appVersion}</div>
</div>

<style lang="scss">
    .hidden {
        display: none !important;
    }

    .container {
        display: grid;
        grid-template-areas:
            ". header ."
            ". footer .";
        grid-template-columns: 1fr 6fr 1fr;
        grid-template-rows: minmax(min-content, auto) min-content;
        height: 100%;
        width: 100%;
    }

    .content {
        grid-area: header;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
    }

    .tagline {
        margin-bottom: 3rem;
        text-align: center;
        font-size: 1.5rem;
        line-height: 2.2rem;
        color: var(--window-foreground);
        font-weight: 600;
    }
    
    
    .quick-actions {
        width: 160px;
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
    }

    button {
        color: var(--window-foreground);
        display: flex;
        align-items: center;
        justify-content: flex-start;
        width: 100%;
        text-align: left;
        padding: 0.75rem 1rem;
        background: none;
        border: 1px solid transparent;
        border-radius: 6px;
        cursor: pointer;
        font-size: 14px;
        font-weight: 500;
        transition: all 0.2s ease;
    }

    button:hover {
        color: var(--window-linkForeground);
        background: var(--button-hover-bg, rgba(255, 255, 255, 0.05));
        border-color: var(--border-color, rgba(255, 255, 255, 0.1));
    }

    button:focus {
        border: none;
        outline: none;
    }

    button :global(svg) {
        margin-right: 0.75rem;
        width: 18px;
        height: 18px;
        stroke: var(--window-foreground);
        fill: none;
        stroke-width: 1.5;
        transition: stroke 0.2s ease;
        flex-shrink: 0;
    }

    button:hover :global(svg) {
        stroke: var(--window-linkForeground);
    }

    .version {
        color: var(--window-descriptionForeground);
        grid-area: footer;
        text-align: center;
        margin-bottom: 0.5rem;
    }
</style>
