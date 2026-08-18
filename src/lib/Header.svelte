<script lang="ts">
    import { Copy, Minus, Square, X } from 'lucide-svelte';
    import { onMount } from 'svelte';
    import { get as getStoreValue } from "svelte/store";
    import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
    import { invoke } from "@tauri-apps/api/core";
    import type { UnlistenFn } from '@tauri-apps/api/event';
    import { workspaceName, openFolder, openFolderDialog } from "./File";
    import { commands } from "../config/commands";
    import { addTab, focusTabByPath } from "../lib/EditorTabList.svelte";
    import { is_dark_theme } from "../config/themehandler";
    import SearchPopup from "./SearchPopup.svelte";
    import { searchPopupOpen, openSearchPopup, closeSearchPopup } from "./searchPopupStore";
    import Menu from "./utility/Menu.svelte";
    import { t } from "./i18n";
    import Settings from "./Settings.svelte";
    // 导入AI相关组件
    import AiIcon from "./Icons/ClinePanelIcon.svelte";
    import { toggleActiveRight } from "./RightSidebar.svelte";
    import CodexPanel from "./codex/CodexPanel.svelte";
    import { shouldBlockImeEnter } from "./utility/imeGuard";
    
    // 创建Codex tab对象
    const codexTab = { id: 1, tabname: "Agent", labelKey: "sidebar.codex", icon: AiIcon, content: CodexPanel };

    // 搜索输入框状态
    let searchQuery = '';
    let isSearchFocused = false;
    // 全局控制 SearchPopup 的开关（供快捷键与按钮共用）

    let isWindowMaximized = false;
    const detectMacPlatform = () => {
        if (typeof navigator === 'undefined') {
            return false;
        }
        const platform = navigator.platform || '';
        const userAgent = navigator.userAgent || '';
        return /mac/i.test(platform) || /mac os x/i.test(userAgent);
    };

    let isMacPlatform = detectMacPlatform();

    function formatShortcut(shortcut?: string) {
        if (!shortcut) {
            return "";
        }
        return shortcut
            .replace(/CmdOrCtrl/gi, isMacPlatform ? "⌘" : "Ctrl")
            .replace(/Control/gi, "Ctrl")
            .replace(/Alt/gi, isMacPlatform ? "Option" : "Alt")
            .replace(/Shift/gi, "Shift")
            .replace(/Meta/gi, isMacPlatform ? "⌘" : "Win")
            .replace(/\+/g, " + ");
    }

    const MENU_FILE_NEW = "menu.file.new";
    const MENU_FILE_OPEN = "menu.file.open";
    const MENU_FILE_OPEN_FOLDER = "menu.file.open-folder";
    const MENU_APP_PREFERENCES = 'menu.app.preferences';
    const MENU_WORKSPACE_RECENT_PREFIX = "menu.workspace.recent.";
    const RECENT_WORKSPACES_STORAGE_KEY = "recentFolders";
    let recentWorkspaces: string[] = [];
    let windowsMenuItems: Array<{
        menuname: string;
        children: Array<{
            name: string;
            shortcut?: string;
            disabled?: boolean;
            title?: string;
            subtitle?: string;
            action: () => void | Promise<void>;
        }>;
    }> = [];

    function loadRecentWorkspaces() {
        try {
            const raw = localStorage.getItem(RECENT_WORKSPACES_STORAGE_KEY);
            const parsed = raw ? JSON.parse(raw) : [];
            recentWorkspaces = Array.isArray(parsed)
                ? parsed.filter((item) => typeof item === "string" && item.trim()).slice(0, 10)
                : [];
        } catch {
            recentWorkspaces = [];
        }
    }

    async function syncRecentWorkspacesMenu() {
        try {
            await invoke("set_recent_workspaces_menu", { recentWorkspaces });
        } catch {
            // Native menu sync is only needed on platforms with an OS menubar.
        }
    }

    $: windowsMenuItems = [
        {
            menuname: $t("menu.workspace"),
            children: [
                {
                    name: $t("menu.newWorkspace"),
                    shortcut: formatShortcut(commands.openFolder.keybind),
                    title: $t("menu.newWorkspaceTooltip"),
                    subtitle: $t("menu.newWorkspaceTooltip"),
                    action: () => {
                        void openFolderDialog();
                    }
                },
                {
                    name: $t("menu.recentWorkspaces"),
                    disabled: true,
                    action: () => {}
                }
            ].concat(
                recentWorkspaces.length > 0
                    ? recentWorkspaces.map((workspacePath) => ({
                          name: workspacePath,
                          action: () => {
                              void openFolder(workspacePath);
                          }
                      }))
                    : [
                          {
                              name: $t("menu.noRecentWorkspaces"),
                              disabled: true,
                              action: () => {}
                          }
                      ]
            )
        }
    ];

    function handleMenuAction(action: unknown) {
        if (typeof action !== 'string') {
            return;
        }

        switch (action) {
            case MENU_FILE_NEW:
                void commands.addEditorTab.command();
                break;
            case MENU_FILE_OPEN:
                void commands.openFile.command();
                break;
            case MENU_FILE_OPEN_FOLDER:
                void openFolderDialog();
                break;
            case MENU_APP_PREFERENCES:
                void openSettingsTab();
                break;
            default:
                if (action.startsWith(MENU_WORKSPACE_RECENT_PREFIX)) {
                    const index = Number(action.slice(MENU_WORKSPACE_RECENT_PREFIX.length));
                    const workspacePath = Number.isInteger(index) ? recentWorkspaces[index] : null;
                    if (workspacePath) {
                        void openFolder(workspacePath);
                    }
                }
                break;
        }
    }

    async function openSettingsTab() {
        try {
            await focusTabByPath("Settings");
            return;
        } catch {
            // fall through to open
        }
        const translate = getStoreValue(t);
        await addTab(
            "Settings",
            translate("sidebar.settings"),
            new Settings({ target: document.getElementById("tabview") }),
            { labelKey: "sidebar.settings" },
        );
    }

    onMount(() => {
        loadRecentWorkspaces();
        void syncRecentWorkspacesMenu();
        const appWindow = getCurrentWebviewWindow();
        let disposed = false;
        let unlistenFns: UnlistenFn[] = [];

        const init = async () => {
            const baseListeners: Promise<UnlistenFn>[] = [
                appWindow.listen('app://menu', (event) => {
                    handleMenuAction(event.payload);
                })
            ];

            if (!isMacPlatform) {
                try {
                    isWindowMaximized = await appWindow.isMaximized();
                } catch {
                    isWindowMaximized = false;
                }

                baseListeners.push(
                    appWindow.listen('tauri://maximize', () => {
                        isWindowMaximized = true;
                    }),
                    appWindow.listen('tauri://unmaximize', () => {
                        isWindowMaximized = false;
                    })
                );
            }

            const listeners = await Promise.all(baseListeners);

            if (disposed) {
                listeners.forEach((unlisten) => unlisten());
                return;
            }

            unlistenFns = listeners;
        };

        init();

        const refreshRecentWorkspaces = () => {
            loadRecentWorkspaces();
            void syncRecentWorkspacesMenu();
        };
        window.addEventListener("focus", refreshRecentWorkspaces);

        return () => {
            disposed = true;
            unlistenFns.forEach((unlisten) => unlisten());
            unlistenFns = [];
            window.removeEventListener("focus", refreshRecentWorkspaces);
        };
    });

    // 搜索函数
    function handleSearch() {
        if (searchQuery.trim()) {
            commands.searchInWorkspace.command();
        }
    }

    // 处理回车键搜索
    function handleKeyPress(e: KeyboardEvent) {
        if (e.key === 'Enter') {
            if (shouldBlockImeEnter(e)) {
                e.stopPropagation();
                return;
            }
            handleSearch();
        }
    }
    // 跟随应用主题设置 data-theme（dark/light）
    $: document?.documentElement?.setAttribute('data-theme', $is_dark_theme ? 'dark' : 'light');
</script>

<div id="header" class:is-macos={isMacPlatform} data-theme={$is_dark_theme ? 'dark' : 'light'}>
    {#if isMacPlatform}
        <div class="traffic-light-slot"></div>
        <div class="left-drag" data-tauri-drag-region></div>
    {:else}
        <div id="logo"></div>
        <div id="menubar">
            {#each windowsMenuItems as item}
                <Menu menu={item}></Menu>
            {/each}
        </div>
        <div class="divider"></div>
        <div class="spacer" data-tauri-drag-region></div>
    {/if}
    <div class="search-container">
        <button
            type="button"
            class="search-trigger"
            title="Search (Ctrl+Shift+F)"
            on:click={openSearchPopup}
        >
            <span class="search-icon-inline"></span>
            <span class="search-text">
                {$workspaceName ? `${$workspaceName}` : 'Search'}
            </span>
        </button>
    </div>
    <div class="tools">
        <!-- Agent按钮移动到这里 -->
        <button
            type="button"
            class="ai-button codex-button"
            title={$t("sidebar.codex")}
            on:click={() => toggleActiveRight(codexTab)}
        >
            <AiIcon />
            <span class="ai-text">{$t("sidebar.codex")}</span>
        </button>
    </div>
    <div id="handle" data-tauri-drag-region></div>
    {#if $searchPopupOpen}
        <SearchPopup open={$searchPopupOpen} onClose={closeSearchPopup} />
    {/if}
    {#if !isMacPlatform}
        <div id="window-controls">
            <button
                type="button"
                class="window-button"
                id="minimize"
                aria-label="Minimize window"
                title="Minimize window"
                on:click={commands.minimizeWindow.command}
            >
                <Minus class="window-icon" size={16} />
            </button>
            <button
                type="button"
                class="window-button"
                id="maximize"
                aria-label={isWindowMaximized ? 'Restore window' : 'Maximize window'}
                title={isWindowMaximized ? 'Restore window' : 'Maximize window'}
                on:click={commands.maximizeWindow.command}
            >
                {#if isWindowMaximized}
                    <Copy class="window-icon" size={16} />
                {:else}
                    <Square class="window-icon" size={16} />
                {/if}
            </button>
            <button
                type="button"
                class="window-button"
                id="close"
                aria-label="Close window"
                title="Close window"
                on:click={commands.closeWindow.command}
            >
                <X class="window-icon" size={16} />
            </button>
        </div>
    {/if}
</div>

<style lang="scss">
    #header {
        width: 100%;
        display: flex;
        align-items: center;
        position: relative;
        /* Must sit above workspace overlays (Agent/FileTree) so header popups (SearchPopup) remain visible. */
        z-index: 200;
        min-height: calc(var(--header-control-height) + var(--header-gap));
        font-size: var(--header-font-size-base);
    }

    #header.is-macos {
        padding-left: 0;
    }

    .traffic-light-slot {
        width: 72px;
        height: var(--header-control-height);
        pointer-events: none;
        flex: 0 0 72px;
        margin-right: calc(var(--header-gap) * 0.75);
    }

    #logo {
        width: var(--header-logo-width);
        min-width: var(--header-logo-width);
        height: var(--header-control-height);
        background-size: var(--header-logo-size);
        background-repeat: no-repeat;
        background-position: center;
        background-image: url("/assets/images/Icon(1).png");
        z-index: 10;
    }

    #menubar {
        height: 100%;
        display: flex;
        align-items: center;
        z-index: 10;
        margin-left: calc(var(--header-gap) * 0.75);
    }

    .divider {
        width: 0.0625rem;
        height: calc(var(--header-control-height) * 0.7);
        margin: 0 calc(var(--header-gap) * 0.6);
    }

    .spacer {
        flex: 1;
        height: 100%;
        z-index: 10;
    }

    .left-drag {
        flex: 1;
        height: 100%;
        min-width: clamp(120px, 18vw, 320px);
    }


    .search-container {
        position: absolute;
        left: 50%;
        transform: translateX(-50%);
        display: flex;
        align-items: center;
        width: 18%; /* 调整到更合理的宽度 */
        min-width: clamp(160px, calc(var(--header-font-size-base) * 12), 320px);
        max-width: clamp(240px, calc(var(--header-font-size-base) * 18), 420px);
        height: var(--header-control-height);
        z-index: 10;
    }

    .search-input {
        width: 100%;
        height: var(--header-control-height);
        padding: 0 calc(var(--header-padding-x) * 1.25) 0 calc(var(--header-padding-x) + var(--header-icon-size));
        border: 1px solid #3a3a3a;
        border-radius: 8px;
        background-color: #2a2a2a;
        /* 在输入框内绘制放大镜图标 */

        color: #ffffff;
        font-size: 0.875rem;
        outline: none;
        transition: all 0.2s ease;
        position: relative; /* 使 z-index 与绝对定位图标有明确层级关系 */

        &::placeholder {
            color: #969696;
        }

        &:focus {
            border-color: #0078d4;
            box-shadow: 0 0 0 2px rgba(0, 120, 212, 0.2);
            background-color: #252526;
        }

        &:hover {
            border-color: #646464;
            background-color: #2a2d2e;
        }
    }

    .search-icon {
        position: absolute;
        left: 8px;
        top: 50%;
        transform: translateY(-50%);
        color: #ffffff; /* 提高对比度 */
        pointer-events: none;
        z-index: 999; /* 强制位于输入框之上 */
        opacity: 1;
        display: block;
    }

    .search-input:focus + .search-icon {
        color: #cfcfcf;
    }

    #handle {
        position: absolute;
        width: -webkit-fill-available;
        z-index: 9;
    }

    .settings-button {
        height: 100%;
        display: flex;
        justify-content: center;
        align-items: center;
        z-index: 10;
    }
    .tools {
        display: flex;
        justify-content: start;
        align-items: center;
        padding: 0 calc(var(--header-gap) * 1.1);
        margin-left: auto;
        margin-right: calc(var(--header-gap) * 1.6);
        height: 100%;
        z-index: 10;
        flex-shrink: 0;
    }

    #header.is-macos .tools {
        margin-right: clamp(48px, 18vw, 176px); /* 将 AI 按钮往左提 */
    }

    #window-controls {
        height: 100%;
        display: flex;
        z-index: 10;

        .window-button {
            min-width: clamp(32px, calc(var(--header-control-height) * 1.1), 48px);
            height: calc(100% - var(--header-gap));
            margin: calc(var(--header-gap) / 2) 0;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 0 calc(var(--header-gap) * 1.1);
            background: transparent;
            border: none;
            color: inherit;
            cursor: pointer;
            appearance: none;
            transition: background-color 0.2s ease, color 0.2s ease;
            border-radius: 4px;

            &:focus-visible {
                outline: 2px solid rgba(0, 120, 212, 0.6);
                outline-offset: -2px;
            }

            &:hover {
                background-color: rgba(255, 255, 255, 0.08);
            }

            &:active {
                background-color: rgba(255, 255, 255, 0.12);
            }
        }

        #close:hover {
            background-color: #ff3131;
            color: #ffffff;
        }

        .window-icon {
            width: calc(var(--header-icon-size) * 0.75);
            height: calc(var(--header-icon-size) * 0.75);
        }
    }

    .ai-button {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: var(--header-gap);
        padding: 0 var(--header-padding-x);
        height: var(--header-control-height);
        margin: calc(var(--header-gap) * 0.75) 0;
        border: 1px solid rgba(255, 255, 255, 0.2);
        border-radius: 6px;
        background-color: rgba(0, 120, 212, 0.1);
        cursor: pointer;
        transition: all 0.2s ease;
        color: inherit;
        font-size: var(--header-compact-font-size);
        font-weight: 500;
        flex-shrink: 0;
    }

    .ai-button:hover {
        background-color: rgba(0, 120, 212, 0.2);
        border-color: rgba(0, 120, 212, 0.4);
        transform: translateY(-1px);
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
    }
    
    .ai-button:active {
        transform: translateY(0);
        box-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
    }

    .ai-button :global(svg) {
        width: calc(var(--header-icon-size) * 1.4);
        height: calc(var(--header-icon-size) * 1.2);
    }

    .ai-text {
        font-size: var(--header-label-font-size);
        font-weight: 600;
        letter-spacing: 0.5px;
        color: #00d4ff; /* 亮蓝色，科技感强 */
        text-shadow: 0 0 3px rgba(0, 212, 255, 0.3); /* 轻微发光效果 */
    }
    
    /* 隐藏右侧外部放大镜按钮，仅保留输入框内图标 */
    .tools .settings-button {
        display: none;
    }

/* 浅色主题覆盖，形成柔和直角矩形且配色切合主题 */
@media (prefers-color-scheme: light) {
    .search-input {
        background-color: #f3f3f3;
        border-color: #cfcfcf;
        color: #333333;
        &::placeholder {
            color: #6a6a6a;
        }
        /* 浅色主题下的放大镜颜色与大小同步 */
        background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='18' height='18' viewBox='0 0 24 24' fill='none' stroke='%236a6a6a' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Ccircle cx='11' cy='11' r='7'/%3E%3Cline x1='21' y1='21' x2='16.65' y2='16.65'/%3E%3C/svg%3E");
        background-repeat: no-repeat;
        background-position: calc(var(--header-padding-x) * 0.75) 50%;
        background-size: var(--header-icon-size) var(--header-icon-size);
    }

    .search-input:focus {
        border-color: #0078d4; /* 轻微蓝色高亮，贴近 VS Code 风格 */
        box-shadow: 0 0 0 2px rgba(0, 120, 212, 0.2);
        background-color: #f6f6f6;
    }
}
/* 应用内主题覆盖：通过 data-theme=dark / light 控制 */
#header[data-theme="dark"] .search-input {
    background-color: #262626;
    border-color: #3a3a3a;
    color: #eaeaea;
    &::placeholder { color: #9a9a9a; }
    /* 放大镜颜色（深色主题更亮一些） */
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='18' height='18' viewBox='0 0 24 24' fill='none' stroke='%23cfcfcf' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Ccircle cx='11' cy='11' r='7'/%3E%3Cline x1='21' y1='21' x2='16.65' y2='16.65'/%3E%3C/svg%3E");
    background-repeat: no-repeat;
    background-position: calc(var(--header-padding-x) * 0.75) 50%;
    background-size: var(--header-icon-size) var(--header-icon-size);
}
#header[data-theme="dark"] .search-input:focus {
    border-color: #0078d4;
    box-shadow: 0 0 0 2px rgba(0,120,212,0.25);
    background-color: #2b2b2b;
}

#header[data-theme="light"] .search-input {
    background-color: #f3f3f3;
    border-color: #cfcfcf;
    color: #333333;
    &::placeholder { color: #6a6a6a; }
    /* 放大镜颜色（浅色主题较柔和） */
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='18' height='18' viewBox='0 0 24 24' fill='none' stroke='%236a6a6a' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Ccircle cx='11' cy='11' r='7'/%3E%3Cline x1='21' y1='21' x2='16.65' y2='16.65'/%3E%3C/svg%3E");
    background-repeat: no-repeat;
    background-position: calc(var(--header-padding-x) * 0.75) 50%;
    background-size: var(--header-icon-size) var(--header-icon-size);
}
#header[data-theme="light"] .search-input:focus {
    border-color: #0078d4;
    box-shadow: 0 0 0 2px rgba(0,120,212,0.25);
    background-color: #f6f6f6;
}
/* 触发器按钮外观（保持输入框风格，但仅触发弹层） */
.search-trigger {
    width: 100%;
    height: var(--header-control-height);
    padding: 0 var(--header-padding-x);
    border-radius: 6px;
    font-size: var(--header-label-font-size);
    outline: none;
    transition: all 0.2s ease;
    position: relative;
    text-align: center;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--header-gap);
}

.search-icon-inline {
    width: var(--header-icon-size);
    height: var(--header-icon-size);
    background-repeat: no-repeat;
    background-position: center;
    background-size: contain;
    flex-shrink: 0;
}

.search-text {
    display: flex;
    align-items: center;
}

#header[data-theme="dark"] .search-icon-inline {
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='18' height='18' viewBox='0 0 24 24' fill='none' stroke='%23cfcfcf' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Ccircle cx='11' cy='11' r='7'/%3E%3Cline x1='21' y1='21' x2='16.65' y2='16.65'/%3E%3C/svg%3E");
}

#header[data-theme="light"] .search-icon-inline {
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='18' height='18' viewBox='0 0 24 24' fill='none' stroke='%236a6a6a' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Ccircle cx='11' cy='11' r='7'/%3E%3Cline x1='21' y1='21' x2='16.65' y2='16.65'/%3E%3C/svg%3E");
}
.search-trigger:hover {
    /* 颜色在主题块中定义 */
}
.search-trigger:focus {
    /* 颜色在主题块中定义 */
}

/* 主题联动（作用域为 #header 的 data-theme） */
#header[data-theme="dark"] .search-trigger {
    background-color: #262626;
    border: 1px solid #3a3a3a;
    color: #eaeaea;
}
#header[data-theme="dark"] .search-trigger:focus {
    border-color: #0078d4;
    box-shadow: 0 0 0 2px rgba(0,120,212,0.25);
    background-color: #2b2b2b;
}

#header[data-theme="light"] .search-trigger {
    background-color: #f3f3f3;
    border: 1px solid #cfcfcf;
    color: #333333;
}
#header[data-theme="light"] .search-trigger:focus {
    border-color: #0078d4;
    box-shadow: 0 0 2px rgba(0,120,212,0.25);
    background-color: #f6f6f6;
}

/* AI按钮主题适配 */
#header[data-theme="dark"] .ai-button {
    background-color: rgba(0, 120, 212, 0.15);
    border-color: rgba(255, 255, 255, 0.2);
    color: #ffffff;
}

#header[data-theme="dark"] .ai-button:hover {
    background-color: rgba(0, 120, 212, 0.25);
    border-color: rgba(0, 120, 212, 0.5);
}

#header[data-theme="light"] .ai-button {
    background-color: rgba(0, 120, 212, 0.1);
    border-color: rgba(0, 120, 212, 0.3);
    color: #333333;
}

#header[data-theme="light"] .ai-button:hover {
    background-color: rgba(0, 120, 212, 0.2);
    border-color: rgba(0, 120, 212, 0.5);
}

/* AI文字主题颜色适配 */
#header[data-theme="dark"] .ai-text {
    color: #00d4ff; /* 深色主题：亮蓝色 */
    text-shadow: 0 0 6px rgba(0, 212, 255, 0.4);
}

#header[data-theme="light"] .ai-text {
    color: #0078d4; /* 浅色主题：深蓝色 */
    text-shadow: 0 0 4px rgba(0, 120, 212, 0.2);
}

/* 悬停时AI文字的效果 */
#header[data-theme="dark"] .ai-button:hover .ai-text {
    color: #33e0ff;
    text-shadow: 0 0 8px rgba(51, 224, 255, 0.5);
}

#header[data-theme="light"] .ai-button:hover .ai-text {
    color: #005a9e;
    text-shadow: 0 0 6px rgba(0, 90, 158, 0.3);
}

</style>
