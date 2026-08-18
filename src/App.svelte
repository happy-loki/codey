<script lang="ts">
    import Header from "./lib/Header.svelte";
    import Sidebar, { showsidebarview, tool} from "./lib/Sidebar.svelte";
	import { Pane, Splitpanes } from 'svelte-splitpanes';
    import SidebarView from "./lib/SidebarView.svelte";
    import Statusbar, { showBottomPanel, editortool } from "./lib/Statusbar.svelte";
    import EditorTabList, { hidden, relayoutActiveEditor, tabs as editorTabs } from "./lib/EditorTabList.svelte";
    import ActivePathBar from "./lib/ActivePathBar.svelte";
    import { onMount, tick } from "svelte";
    import { getCurrentWebviewWindow, WebviewWindow } from '@tauri-apps/api/webviewWindow';
    import { invoke } from "@tauri-apps/api/core";
    import { getVersion } from "@tauri-apps/api/app";
    import { writable, get } from "svelte/store";
    import InputModal from "./lib/Modals/InputModal.svelte";
    import RenameModal from "./lib/Modals/RenameModal.svelte";
    import { loadDefaultSettings } from "./config/config";
    // import { error } from "tauri-plugin-log-api";
	import { error } from '@tauri-apps/plugin-log';
    import ToolView from "./lib/ToolView.svelte";
    import { getExtensions } from "./config/extensionhandler";
    import { fitTerminal } from "./lib/Terminal.svelte";
    import { loadDir } from "./lib/File";
    import NotificationToasts from "./lib/Notifications/NotificationToasts.svelte";
    import { NotifType, addNotification, toasts } from "./lib/Notifications/notifications";
    import { open  } from "@tauri-apps/plugin-shell";
	import { addTab } from "./lib/EditorTabList.svelte"; 
	import Welcome from "./lib/Welcome.svelte";
    import { previewMode, isMarkdownActive, showMarkdownToolbar } from "./lib/preview";
	import MarkdownPreview from "./lib/MarkdownPreview.svelte";
    import MarkdownPreviewActions from "./lib/MarkdownPreviewActions.svelte";
	import MarkdownThemeControls from "./lib/MarkdownThemeControls.svelte";
    import RightSidebar, { showrightsidebarview, righttool, registerRightTabs, openRightTab } from "./lib/RightSidebar.svelte";
    import AiIcon from "./lib/Icons/ClinePanelIcon.svelte";
    import CodexPanel from "./lib/codex/CodexPanel.svelte";
    import { initDiffEvents } from "./lib/tools/diffStore";
    import { initMultiDiffEvents } from "./lib/tools/multiDiffHost";
    import { initFileBridgeEvents } from "./lib/tools/fileBridge";
    import { listen } from "@tauri-apps/api/event";
    // Initialize in-app i18n (independent from cline webview)
    import { initLang as initUiLang, t, lang as uiLangStore } from "./lib/i18n";
    import type { Lang } from "./lib/i18n";
    import ContextMenuHost from "./lib/utility/ContextMenuHost.svelte";
    import ConfirmModalHost from "./lib/utility/ConfirmModalHost.svelte";
    import MarkdownToolbar from "./lib/MarkdownToolbar.svelte";
    import DrawioDialog from "./lib/markdown/DrawioDialog.svelte";
    import { checkForUpdates as runUpdateCheck, getUpdatePreferences, getPendingUpdateAnnouncement, clearPendingUpdateAnnouncement } from "./lib/updater";
    import { updatesDisabled } from "./lib/env";
    import { readinessState, markSettingsReady } from "./lib/appReady";
    import { getReleaseNotesSummary } from "./lib/releaseNotes";
    import { ensureHostImeGuard } from "./lib/utility/imeGuard";

	let resolution = writable(0);

	let minPanelSize = 10;
	let panelSize = 15;
    // Remember last non-zero left sidebar size so hiding can collapse to 0 without losing the user's width.
    let panelPrevSize = panelSize;
	let bottomPanelSize = 20;
    // Agent 面板（ChatView/CodexPanel）的宽度占 main 区域的百分比（仅在显示时生效）
    let agentPanelSize = 40;
    let agentPanelPrevSize = agentPanelSize;
	let bottomPanelPrevSize = 20;
    // Tools (bottom panel) can optionally take the full height when there are no editor tabs.
    // This mirrors Terminal's behavior; Search is included too.
    const rightTabs = [
        { id: 1, tabname: "Agent", labelKey: "sidebar.codex", icon: AiIcon, content: CodexPanel },
    ];

    const PROJECT_URL = "https://github.com/lokizhou/arthas";
    const PROJECT_ISSUES_URL = `${PROJECT_URL}/issues/new/choose`;
    const LAST_VERSION_KEY = "arthas:lastVersion";
    const WELCOME_NOTIFICATION_KEY = "arthas:notifications:welcome:v1";

    function safeGetLocalStorage(key: string): string | null {
        try {
            return localStorage.getItem(key);
        } catch {
            return null;
        }
    }

    function safeSetLocalStorage(key: string, value: string) {
        try {
            localStorage.setItem(key, value);
        } catch {}
    }

    function summarizeNotes(notes: string): string {
        const normalized = notes
            .replace(/\r?\n|\r/g, " ")
            .replace(/\s+/g, " ")
            .trim();
        if (!normalized) {
            return "";
        }
        return normalized.length > 180 ? `${normalized.slice(0, 177)}...` : normalized;
    }

    function shouldAllowNativeContextMenu(target: EventTarget | null): boolean {
        if (!(target instanceof Element)) {
            return false;
        }

        if (target.closest("[data-allow-context-menu]")) {
            return true;
        }

        if (target.closest("input, textarea, select")) {
            return true;
        }

        if (target.closest("[contenteditable]")) {
            return true;
        }

        if (target instanceof HTMLElement && target.isContentEditable) {
            return true;
        }

        return false;
    }

    function handleWindowContextMenu(event: MouseEvent) {
        if (shouldAllowNativeContextMenu(event.target)) {
            return;
        }

        event.preventDefault();
    }

    async function maybeAnnounceUpdate(
        translate: (key: string, params?: Record<string, string | number>) => string,
        currentLang: Lang
    ) {
        let currentVersion = "";
        try {
            currentVersion = await getVersion();
        } catch {
            return;
        }
        const storedVersion = safeGetLocalStorage(LAST_VERSION_KEY);
        const announcement = getPendingUpdateAnnouncement();
        let shown = false;
        const releaseSummary =
            getReleaseNotesSummary(currentVersion, currentLang) ?? getReleaseNotesSummary(currentVersion, "en");

        if (announcement && announcement.version === currentVersion) {
            const summaryFromUpdate = summarizeNotes(announcement.notes ?? "");
            const summary = releaseSummary || summaryFromUpdate;
            const message = summary
                ? translate("notifications.update.announcementMessage", { notes: summary })
                : translate("notifications.update.announcementNoNotes", { version: currentVersion });
            const title = translate("notifications.update.announcementTitle", { version: currentVersion });
            const actions = [
                { label: translate("notifications.actions.viewReleaseNotes"), action: () => { open(PROJECT_URL); } }
            ];
            addNotification(NotifType.Message, title, actions, message);
            clearPendingUpdateAnnouncement();
            shown = true;
        }

        if (!shown && storedVersion && storedVersion !== currentVersion) {
            const summary = releaseSummary;
            const title = translate("notifications.update.announcementTitle", { version: currentVersion });
            const message = summary
                ? translate("notifications.update.announcementMessage", { notes: summary })
                : translate("notifications.update.announcementNoNotes", { version: currentVersion });
            const actions = [
                { label: translate("notifications.actions.viewReleaseNotes"), action: () => { open(PROJECT_URL); } }
            ];
            addNotification(NotifType.Message, title, actions, message);
            shown = true;
        }

        safeSetLocalStorage(LAST_VERSION_KEY, currentVersion);
    }

    // Register HostBridge listeners as early as possible (before mount)
    (async () => {
        try {
            await initDiffEvents();
            await initMultiDiffEvents();
            await initFileBridgeEvents();
            // Debug: echo any diff events at app level
            try {
                await listen("hostbridge://diff", (evt) => {
                    console.log("[App] diff event tapped", evt.payload);
                });
            } catch (e) { /* no-op */ }
        } catch (e) { console.error("init hostbridge listeners failed", e); }
    })();

    const appWindowPromise = getCurrentWebviewWindow();
    let splashClosed = false;
    let windowShown = false;
    let readinessTimeout: ReturnType<typeof setTimeout> | null = null;
    let frontendNotified = false;

    async function notifyFrontendComplete() {
        try {
            console.log("Frontend ready; notifying backend...");
            await invoke("set_complete", { task: "frontend" });
        } catch (err) {
            console.error("Failed to notify backend of frontend readiness", err);
            throw err;
        }
    }

    async function closeSplashWindow() {
        if (splashClosed) {
            return;
        }
        try {
            await invoke("close_splashscreen");
            splashClosed = true;
            return;
        } catch (err) {
            console.warn("Backend close_splashscreen failed", err);
        }

        const splash = WebviewWindow.getByLabel("splashscreen");
        if (!splash) {
            splashClosed = true;
            return;
        }

        try {
            try {
                await splash.hide();
            } catch {}
            await splash.close();
        } catch (err) {
            console.warn("Failed to close splashscreen window via frontend fallback", err);
        } finally {
            splashClosed = true;
        }
    }

    async function showWindow() {
        if (windowShown) return;
        windowShown = true;
        try {
            const win = await appWindowPromise;
            await win.show();
            try { await win.maximize(); } catch {}
            try { await win.setFocus(); } catch {}
        } catch (err) {
            console.error("Failed to show window", err);
        } finally {
            queueMicrotask(() => { void closeSplashWindow(); });
            if (readinessTimeout) {
                clearTimeout(readinessTimeout);
                readinessTimeout = null;
            }
            if (!frontendNotified) {
                frontendNotified = true;
                notifyFrontendComplete().catch((err) => {
                    console.error("Failed to notify backend of frontend readiness", err);
                    frontendNotified = false;
                });
            }
        }
    }

    $: if ($readinessState.ready && !frontendNotified) {
        frontendNotified = true;
        notifyFrontendComplete().catch((err) => {
            console.error("Failed to notify backend of frontend readiness", err);
            frontendNotified = false;
        });
    }

    let removeImeGuard: (() => void) | null = null;

    onMount(() => {
        removeImeGuard = ensureHostImeGuard();

        // Defensive: if the WebView loses focus mid-drag, `svelte-splitpanes` can miss mouseup and
        // leave the app in a "dragging" state (global resize cursor + panes pointer-events disabled).
        const onWindowBlur = () => forceEndSplitpanesDrag("window-blur");
        const onVisibilityChange = () => {
            if (document.visibilityState !== "visible") {
                forceEndSplitpanesDrag("document-hidden");
            }
        };
        window.addEventListener("blur", onWindowBlur);
        document.addEventListener("visibilitychange", onVisibilityChange);
        splitpanesDragCleanup = () => {
            window.removeEventListener("blur", onWindowBlur);
            document.removeEventListener("visibilitychange", onVisibilityChange);
        };

        readinessTimeout = setTimeout(async () => {
            if (!windowShown) {
                try {
                    const win = await appWindowPromise;
                    if (await win.isVisible()) {
                        windowShown = true;
                        return;
                    }
                } catch (err) {
                    console.warn("Failed to query window visibility", err);
                }
                console.warn("App readiness timeout hit; forcing window visible");
                void showWindow();
            }
        }, 8000);

        // Run async initialization without returning a Promise to onMount
        (async () => {
            try { initUiLang(); } catch {}
            try { await initDiffEvents(); await initFileBridgeEvents(); } catch {}
            registerRightTabs(rightTabs);
            // Open Agent on startup; CodexPanel uses the external Codex CLI runtime directly.
            openRightTab(1);
            await getExtensions();
            try {
                await loadDefaultSettings();
            } catch (err) {
                console.error("Failed to load default settings", err);
            } finally {
                markSettingsReady();
            }
            if (!updatesDisabled) {
                try {
                    const prefs = getUpdatePreferences();
                    if (prefs.autoCheck) {
                        queueMicrotask(() => {
                            runUpdateCheck({ silent: true }).catch((error) => {
                                console.warn("Auto update check failed", error);
                            });
                        });
                    }
                } catch (error) {
                    console.warn("Failed to schedule auto update check", error);
                }
            }
            let dir = localStorage.getItem("lastDir");
            if (dir) {
                loadDir(dir);
            } else {
                const translate = get(t);
                const welcomeLabel = translate("welcome.tabTitle");
                addTab("Welcome", welcomeLabel, new Welcome({target: document.getElementById("tabview")}), { labelKey: "welcome.tabTitle" });
            }

            const translate = get(t);
            const currentLang = get(uiLangStore) as Lang;
            await maybeAnnounceUpdate(translate, currentLang);

            let size = await getCurrentWebviewWindow().innerSize();
            resolution.set(size.width);
            updateMinPanelSize();

            addNotification(NotifType.Message, translate("notifications.welcome.title"), [
                {label: translate("notifications.actions.learnMore"), action: () => {open(PROJECT_URL)}}, 
                {label: translate("notifications.actions.createIssue"), action: () => {open(PROJECT_ISSUES_URL)}} 
            ], translate("notifications.welcome.message"), WELCOME_NOTIFICATION_KEY);

            getCurrentWebviewWindow().onResized((e) => {
                resolution.set(e.payload.width);
                updateMinPanelSize();
            })
        })();

        queueMicrotask(() => {
            void showWindow();
        });

        // Swallow noisy Windows-specific unhandled rejections (e.g., os error 0/6/258) to keep console clean
        window.onunhandledrejection = (e) => {
            const msg = String((e as any)?.reason ?? '');
            const noisy = /(os error\s*(0|6|258))|invalid handle/i.test(msg);
            if (!noisy) {
                try { error(msg); } catch {}
            }
            try { (e as any).preventDefault?.(); } catch {}
            return false as any;
        }

        // Enable DevTools via keyboard in Release: only Ctrl+Shift+I.
        // Let F12 fall through to the WebView's default behavior.
        const onKey = async (ev: KeyboardEvent) => {
            // Disable F5 to prevent page reload / default behavior
            if (ev.key === "F5") {
                ev.preventDefault();
                return;
            }
            // Disable Ctrl+R / Cmd+R to prevent reload
            const isReloadCombo = (ev.ctrlKey || ev.metaKey) && (ev.key === "r" || ev.key === "R");
            if (isReloadCombo) {
                ev.preventDefault();
                return;
            }
            // Disable Ctrl+Shift+G / Cmd+Shift+G to avoid browser find-previous behavior
            const isFindPrevCombo =
                (ev.ctrlKey || ev.metaKey) && ev.shiftKey && (ev.key === "g" || ev.key === "G");
            if (isFindPrevCombo) {
                ev.preventDefault();
                return;
            }
            // Disable print / save / open to avoid browser dialogs
            const isPrintCombo = (ev.ctrlKey || ev.metaKey) && (ev.key === "p" || ev.key === "P");
            if (isPrintCombo) {
                ev.preventDefault();
                return;
            }
            const isSaveCombo = (ev.ctrlKey || ev.metaKey) && (ev.key === "s" || ev.key === "S");
            if (isSaveCombo) {
                ev.preventDefault();
                return;
            }
            const isOpenCombo = (ev.ctrlKey || ev.metaKey) && (ev.key === "o" || ev.key === "O");
            if (isOpenCombo) {
                ev.preventDefault();
                return;
            }
            // Disable Ctrl+N / Cmd+N to prevent browser "new window" behavior from stealing the shortcut.
            // The actual "New File" action is handled by the native Tauri menu accelerator.
            const isNewCombo = (ev.ctrlKey || ev.metaKey) && (ev.key === "n" || ev.key === "N");
            if (isNewCombo) {
                ev.preventDefault();
                return;
            }
            const isCtrlShiftI = (ev.ctrlKey || ev.metaKey) && ev.shiftKey && (ev.key === 'I' || ev.key === 'i');
            if (isCtrlShiftI) {
                try { await (getCurrentWebviewWindow() as any)?.openDevtools?.(); } catch (e) { console.error(e); }
                ev.preventDefault();
            }
        };
        window.addEventListener('keydown', onKey);
        // Clean up on hot-reload/unmount
        return () => {
            window.removeEventListener('keydown', onKey);
            removeImeGuard?.();
            removeImeGuard = null;
            splitpanesDragCleanup?.();
            splitpanesDragCleanup = null;
            if (readinessTimeout) {
                clearTimeout(readinessTimeout);
                readinessTimeout = null;
            }
        };
    })

	function updatePanelSize(e) {
        if (!e?.detail?.[0] || typeof e.detail[0].size !== "number") return;
        const sz = e.detail[0].size;
        panelSize = sz;
        if ($showsidebarview && sz > 0) {
            panelPrevSize = sz;
        }
	}

	let updateMinPanelSizeTimer: ReturnType<typeof setTimeout> | null = null;
	let lastFocusCheckTime = 0;
	let cachedFocusState = true;
	const FOCUS_CHECK_THROTTLE = 1000; // 1秒内只检查一次焦点状态

	async function updateMinPanelSize() {
		// 防抖：避免在短时间内多次调用
		if (updateMinPanelSizeTimer) {
			clearTimeout(updateMinPanelSizeTimer);
		}

			updateMinPanelSizeTimer = setTimeout(async () => {
				fitTerminal();
                relayoutActiveEditor();

				const width = $resolution;
                // When the window is minimized/restoring, some platforms report transient 0-width
                // (or the document is not visible). Avoid clamping panel sizes in those states.
                if (typeof document !== "undefined") {
                    if (document.visibilityState !== "visible" || !document.hasFocus()) {
                        updateMinPanelSizeTimer = null;
                        return;
                    }
                }
                if (!width || width <= 0) {
                    updateMinPanelSizeTimer = null;
                    return;
                }
            // Keep the FileTree usable, but don't let it consume too much width on small windows.
            // Splitpanes uses percentages, so we derive a min-percent from a small px target and cap it.
            const targetPx = 140;
            let newMin = Math.round((targetPx / width) * 100);
            newMin = Math.max(10, Math.min(20, newMin));

			// Guard against redundant assignments that trigger resize loops on macOS
			const needsMinUpdate = minPanelSize !== newMin;
			// Only clamp the left sidebar when it is visible. When hidden we intentionally set size=0.
			const needsPanelClamp = $showsidebarview && panelSize < newMin && panelSize !== newMin;
			if (!needsMinUpdate && !needsPanelClamp) {
				return;
			}

			// 节流焦点检查：避免频繁调用 Tauri API
			const now = Date.now();
			if (now - lastFocusCheckTime > FOCUS_CHECK_THROTTLE) {
				try {
					const win = await appWindowPromise;
					cachedFocusState = await win.isFocused();
					lastFocusCheckTime = now;
				} catch (err) {
					cachedFocusState = true;
				}
			}

			if (!cachedFocusState) {
				return;
			}

			if (needsMinUpdate) {
				minPanelSize = newMin;
			}

			if (needsPanelClamp) {
				panelSize = newMin;
			}

			updateMinPanelSizeTimer = null;
		}, 100); // 100ms 防抖延迟
	}
    // Count tabs that should force the editor area to stay visible:
    // - file/image/unsupported-file tabs
    // - codex diff tabs (diff://, multi-diff://, view-all://) for approval flow
    // Placeholder tabs like Welcome/Settings should not affect tool-only layout.
    $: hasEditorTabs =
        Array.isArray($editorTabs) &&
        $editorTabs.some((t: any) => {
            if (!t) return false;
            if (t.isfile || t.isimage) return true;
            if (typeof t.path !== "string") return false;
            return (
                t.path.startsWith("diff://") ||
                t.path.startsWith("multi-diff://") ||
                t.path.startsWith("view-all://")
            );
        });

    // Center area has meaningful content when there is any tab at all.
    // This prevents the Agent panel from taking 100% width and hiding tabs like Welcome/Settings/Drawio/etc.
    $: hasCenterContentTabs =
        Array.isArray($editorTabs) &&
        $editorTabs.some((t: any) => t && typeof t.path === "string");

    // Agent (CodexPanel) is controlled by the right sidebar toggle, but we render it inside the main work area
    // (not as a permanent right column) so that closing chat doesn't reserve blank space.
    $: agentVisible =
        $showrightsidebarview && !!$righttool?.content && $righttool?.tabname === "Agent";
    // When there is no center content at all, allow certain tools to take the whole center height.
    // As soon as any tab is opened (Settings/Welcome/editor/diff), exit tool-only mode so the tabview
    // occupies the top area and the tool panel stays in the bottom split.
    $: toolOnly =
        !hasCenterContentTabs &&
        $showBottomPanel &&
        ($editortool?.name === "Terminal" || $editortool?.name === "Search");

    // If center has no useful content and the bottom panel is closed, let Agent take the whole main area.
    // Note: "useful content" includes non-file tabs like Settings/Drawio/Whiteboard.
    $: editorEmpty = !hasCenterContentTabs && !$showBottomPanel;

    $: {
        // Left sidebar width:
        // - hidden => 0 (overlay keeps the file tree mounted and scrollable off-screen)
        // - shown => restore previous width (or clamp to minPanelSize)
        if (!$showsidebarview) {
            if (panelSize !== 0) {
                panelPrevSize = panelSize;
            }
            panelSize = 0;
        } else if (panelSize === 0) {
            panelSize = Math.max(minPanelSize, Math.min(80, panelPrevSize || 15));
        }

        // Agent panel width:
        // - hidden => 0 (but keep it mounted to avoid re-creating the chat thread)
        // - editor empty + agent visible => 100
        // - otherwise => restore previous width
        if (!agentVisible) {
            if (agentPanelSize !== 0 && agentPanelSize !== 100) {
                agentPanelPrevSize = agentPanelSize;
            }
            agentPanelSize = 0;
        } else if (editorEmpty) {
            if (agentPanelSize !== 100 && agentPanelSize !== 0) {
                agentPanelPrevSize = agentPanelSize;
            }
            agentPanelSize = 100;
        } else if (agentPanelSize === 0 || agentPanelSize === 100) {
            agentPanelSize = Math.max(20, Math.min(60, agentPanelPrevSize || 40));
        } else {
            // Remember a sane size while the user drags the splitter.
            agentPanelPrevSize = agentPanelSize;
        }

        // Bottom panel: collapse to size 0 when hidden; restore previous size when shown
        if (!$showBottomPanel) {
            if (bottomPanelSize !== 0) bottomPanelPrevSize = bottomPanelSize;
            bottomPanelSize = 0;
        } else if (toolOnly) {
            if (bottomPanelSize !== 100) {
                if (bottomPanelSize !== 0) bottomPanelPrevSize = bottomPanelSize;
                bottomPanelSize = 100;
            }
        } else if (bottomPanelSize === 0 || bottomPanelSize === 100) {
            bottomPanelSize = Math.max(5, bottomPanelPrevSize);
        }
    }

    function forceEndSplitpanesDrag(reason: string) {
        // svelte-splitpanes sets `document.body.style.cursor` + disables pointer-events on panes while dragging.
        // If mouseup is missed (WebView loses focus, etc.), the app can look "frozen" and show resize cursor everywhere.
        try {
            const anyDragging = document.querySelector(".splitpanes--dragging");
            const bodyCursor = (document.body?.style?.cursor ?? "").trim();
            if (!anyDragging && !bodyCursor) return;
        } catch {
            // If DOM query fails, still try the safe cleanup below.
        }
        void reason;

        try {
            document.dispatchEvent(
                new MouseEvent("mouseup", {
                    bubbles: true,
                    cancelable: true,
                    view: window
                })
            );
        } catch {}

        try {
            document.body.style.cursor = "";
        } catch {}

        // Best-effort: if the active splitter class remains on the DOM, remove it to restore hit testing visuals.
        try {
            for (const el of Array.from(
                document.querySelectorAll(".splitpanes__splitter.splitpanes__splitter__active")
            )) {
                el.classList.remove("splitpanes__splitter__active");
            }
        } catch {}
    }

    let splitpanesDragCleanup: (() => void) | null = null;

    // Safety net: if any tab is present while the bottom panel is full-height (100%),
    // force the bottom panel back to a sane split so the tabview isn't hidden behind tools.
    $: if (hasCenterContentTabs && $showBottomPanel && bottomPanelSize === 100) {
        const prev = typeof bottomPanelPrevSize === "number" ? bottomPanelPrevSize : 20;
        bottomPanelSize = Math.max(5, Math.min(80, prev));
    }

    // When the Agent panel size changes programmatically (e.g. editorEmpty -> restore),
    // Svelte-splitpanes doesn't always emit a drag resize event. Ensure Monaco/Terminal relayout.
    let lastAgentPanelSize = agentPanelSize;
    $: if (agentPanelSize !== lastAgentPanelSize) {
        lastAgentPanelSize = agentPanelSize;
        void tick().then(() => {
            try { relayoutActiveEditor(); } catch {}
            try { fitTerminal(); } catch {}
        });
    }

    // Same for the bottom panel: programmatic changes (e.g. terminalOnly toggling) should relayout.
    let lastBottomPanelSizeForRelayout = bottomPanelSize;
    $: if (bottomPanelSize !== lastBottomPanelSizeForRelayout) {
        lastBottomPanelSizeForRelayout = bottomPanelSize;
        void tick().then(() => {
            try { relayoutActiveEditor(); } catch {}
            try { fitTerminal(); } catch {}
        });
    }

</script>
<script lang="ts" context="module">
	export const _openPopup = writable(false);
	// 控制是否需要让页面进入模态态（加 inert）
	export const _popupModal = writable(false);
	const popupProps = writable({});
	const popup = writable(null);
	_openPopup.subscribe((isOpen) => {
		if (!isOpen) {
			popup.set(null);
			popupProps.set({});
			_popupModal.set(false);
		}
	});
	export const fullscreen = writable(false);

	type Button = {
		name: string, 
		action, 
		disabled?: boolean, 
		style?: "primary" | "secondary" | "accent" | "danger",
		type?: "button" | "submit" | "reset",
		cancel?: boolean
	}

export function openInputModal(title: string, description: string, buttons: Button[], options: { modal?: boolean } = {}, path = "") {
		popup.set(InputModal);
	popupProps.set({title, description, buttons, options, path});
		_popupModal.set(!!options?.modal);
		_openPopup.set(true);
}
export function openRenameModal(title: string, description: string, buttons: Button[], path: string, options: { modal?: boolean } = {}) {
		popup.set(RenameModal);
	popupProps.set({title, description, buttons, path});
		_popupModal.set(!!options?.modal);
		_openPopup.set(true);
}

// QuickSearchModal 已移除；搜索弹层改为使用 SearchPopup + 全局 store
</script>

<svelte:window on:contextmenu={handleWindowContextMenu}></svelte:window>

<div id="_" inert={$_openPopup && $_popupModal}>
	{#if !$fullscreen}
		<Header />
	{/if}
	<div id="main" class:fullscreen={$fullscreen}>
    <Sidebar />
    <div class="workspace-shell">
        <Splitpanes
            on:resized={updatePanelSize}
            on:resize={updateMinPanelSize}
            theme="editor-panes"
            class={`workspace-panes ${$showsidebarview ? "" : "left-collapsed"}`}
        >
			<!-- Left spacer pane: reserves width + provides draggable splitter; UI is mounted in overlay. -->
			<Pane bind:size={panelSize} minSize={$showsidebarview ? minPanelSize : 0} maxSize={80} class="left-spacer-pane">
				<div class="left-spacer"></div>
			</Pane>

			<Pane minSize={20}>
                <!--
                    Main area uses a stable split:
                    - left: editor workspace (incl. bottom tool / terminal)
                    - right: Agent spacer pane (for sizing + splitter only)

                    IMPORTANT: We do NOT mount the Agent UI inside the spacer pane. When the spacer
                    collapses to 0% (hidden), some browsers + virtualized lists may reset scroll.
                    Instead, we mount the Agent UI in an absolute-positioned overlay that sits on top
                    of the spacer region. This preserves the chat's scroll state naturally without
                    scrollTop hacks, while still letting the editor reclaim space when hidden.
                -->
                <div class="main-area-shell">
                    <Splitpanes
                        theme="editor-panes"
                        class={`editor-panes ${agentPanelSize === 0 || agentPanelSize === 100 ? "agent-collapsed" : ""}`}
                        on:resize={() => {
                            fitTerminal();
                            relayoutActiveEditor();
                        }}
                    >
                    <Pane minSize={0}>
                        <div class="__">
                            <Splitpanes
                                horizontal
                                theme="editor-panes"
                                on:resize={fitTerminal}
                                class="{$showBottomPanel ? '' : 'hidden'} {toolOnly ? 'terminal-only' : ''}"
                            >
                                <Pane size={$showBottomPanel ? 100 - bottomPanelSize : 100} minSize={toolOnly ? 0 : 10}>
                                    <div id="container">
                                        <EditorTabList />
                                        <ActivePathBar />
                                        <div id="workarea" class={"mode-" + ($isMarkdownActive ? $previewMode : "edit")}>
                                            <div id="editor-pane">
                                                {#if $isMarkdownActive && $previewMode !== "preview" && $showMarkdownToolbar}
                                                    <MarkdownToolbar />
                                                {/if}
                                                <div id="tabview" class:hidden={$hidden}></div>
                                            </div>
                                            {#if $isMarkdownActive && $previewMode === "split"}
                                                <div class="workarea-divider"></div>
                                            {/if}
                                            <div id="preview-container">
                                                {#if $isMarkdownActive && $previewMode !== "edit"}
                                                    {#if $showMarkdownToolbar}
                                                        <MarkdownThemeControls />
                                                    {/if}
                                                    <div class="preview-shell">
                                                        {#if $showMarkdownToolbar}
                                                            <MarkdownPreviewActions />
                                                        {/if}
                                                        <MarkdownPreview />
                                                    </div>
                                                {/if}
                                            </div>
                                        </div>
                                    </div>
                                </Pane>
                                {#if $editortool}
                                    <Pane
                                        bind:size={bottomPanelSize}
                                        maxSize={toolOnly ? 100 : 80}
                                        minSize={5}
                                        class="view-bottom-pane"
                                    >
                                        <ToolView
                                            name={$editortool.name}
                                            options={$editortool.options}
                                            buttons={$editortool.buttons}
                                            headerContent={$editortool.header}
                                        ></ToolView>
                                    </Pane>
                                {/if}
                            </Splitpanes>
                        </div>
                    </Pane>
                    <!-- Spacer pane: reserves width + provides draggable splitter; UI is mounted in overlay. -->
                    <!-- Prevent dragging past the minimum chat width to avoid the splitter "overrunning" the overlay. -->
                    <Pane
                        bind:size={agentPanelSize}
                        minSize={agentVisible && !editorEmpty ? 20 : 0}
                        maxSize={100}
                        class="agent-spacer-pane"
                    >
                        <div class="agent-spacer"></div>
                    </Pane>
                    </Splitpanes>

                    {#if $righttool?.tabname === "Agent"}
                        <div
                            class="agent-overlay"
                            class:visible={agentVisible}
                            style={`width:${Math.max(20, Math.min(100, agentVisible ? agentPanelSize : (agentPanelPrevSize || 40)))}%;`}
                            aria-hidden={!agentVisible}
                        >
                            <SidebarView content={$righttool?.content} showTreeLoading={false} />
                        </div>
                    {/if}
                </div>
			</Pane>
        </Splitpanes>

        <!-- Left sidebar overlay: keep mounted even when hidden to preserve FileTree scroll position naturally. -->
        {#if $tool?.content}
            <div
                class="left-overlay"
                class:visible={$showsidebarview}
                style={`width:${Math.max(minPanelSize, Math.min(80, $showsidebarview ? panelSize : (panelPrevSize || panelSize || 15)))}%;`}
                aria-hidden={!$showsidebarview}
            >
                <SidebarView content={$tool.content} showTreeLoading={true} />
            </div>
        {/if}
    </div>
        <RightSidebar tabs={rightTabs} />
    </div>
	<Statusbar />
	{#if Array.isArray($toasts) && $toasts.length !== 0}
		<NotificationToasts />
	{/if}
    <DrawioDialog />
</div>

{#if $popup && $_openPopup}
    <svelte:component this={$popup} {...$popupProps}></svelte:component>
{/if}

<ConfirmModalHost />

<!-- 全局右键菜单宿主：统一承载所有上下文菜单 -->
<ContextMenuHost />

<style lang="scss">
	.__ {
		height: 100%;
		/* 恢复默认滚动策略（无需强制隐藏横向滚动） */
		overflow: visible;
		:global(.hidden) {
			:global(.splitpanes__splitter) {
				display: none;
			}
		}
	}
    #main {
        display: flex;
        /* 让中间的 Splitpanes 在横向可收缩，不挤掉右侧栏 */
        > :global(.splitpanes) {
            flex: 1 1 auto;
            min-width: 0;
        }
    }

    /* Main center area shell: provides a stable containing block for the Agent overlay. */
    .main-area-shell {
        position: relative;
        height: 100%;
        width: 100%;
        min-width: 0;
        min-height: 0;
        overflow: hidden;
    }

    /* Workspace shell: provides a containing block for the left overlay (file tree) and the main splitpanes. */
    .workspace-shell {
        position: relative;
        flex: 1 1 auto;
        min-width: 0;
        min-height: 0;
        height: 100%;
        overflow: hidden;
    }

    /* Outer splitpanes (left sidebar + main area). */
    :global(.splitpanes.workspace-panes) {
        height: 100%;
    }

    /* Left spacer pane: reserved width inside Splitpanes (splitter + sizing), but no UI content. */
    :global(.left-spacer-pane) {
        background: transparent;
        overflow: hidden;
    }

    .left-spacer {
        width: 100%;
        height: 100%;
    }

    /* Left UI (FileTree/Explorer/etc) is mounted as an overlay over the spacer region. */
    .left-overlay {
        position: absolute;
        top: 0;
        left: 0;
        bottom: 0;
        transform: translateX(calc(-100% - 16px));
        opacity: 0;
        pointer-events: none;
        transition: transform 0.18s ease, opacity 0.18s ease;
        z-index: 20;
        background: var(--sidebar-surface, var(--editor-background));
        border-right: 1px solid var(--window-borderColor, rgba(100, 116, 139, 0.35));
    }

    .left-overlay.visible {
        transform: translateX(0);
        opacity: 1;
        pointer-events: auto;
    }

    /* Hide the left splitter when the left pane is collapsed to 0. */
    :global(.splitpanes.workspace-panes.left-collapsed > .splitpanes__splitter:first-of-type) {
        display: none;
    }

    /* Keep splitters draggable above overlays (both outer + inner splitpanes).
       The "frozen editor + resize cursor everywhere" bug is addressed via drag-state cleanup logic,
       not by pushing splitters behind overlays (which breaks dragging entirely). */
    :global(.splitpanes.workspace-panes > .splitpanes__splitter),
    :global(.splitpanes.editor-panes > .splitpanes__splitter) {
        position: relative;
        z-index: 30;
    }

    /* Agent spacer: reserved width inside Splitpanes (splitter + sizing), but no UI content. */
    :global(.agent-spacer-pane) {
        background: transparent;
        overflow: hidden;
    }

    .agent-spacer {
        width: 100%;
        height: 100%;
    }

    /* Agent UI is mounted as an overlay over the spacer region so it never becomes 0px wide. */
    .agent-overlay {
        position: absolute;
        top: 0;
        right: 0;
        bottom: 0;
        transform: translateX(calc(100% + 16px));
        opacity: 0;
        pointer-events: none;
        transition: transform 0.18s ease, opacity 0.18s ease;
        z-index: 20;
        background: var(--sidebar-surface, var(--editor-background));
        border-left: 1px solid var(--window-borderColor, rgba(100, 116, 139, 0.35));
    }

    .agent-overlay.visible {
        transform: translateX(0);
        opacity: 1;
        pointer-events: auto;
    }

    #container {
        height: 100%;
        /* 恢复默认滚动策略，仅保持必要收缩属性 */
        display: flex;            /* vertical layout: tabs on top, workarea fills */
        flex-direction: column;
        min-width: 0;             /* 允许在父级 flex 中收缩 */
        min-height: 0;            /* allow children to shrink */
        background-image: url("/assets/images/Watermark.png");
        background-repeat: no-repeat;
        background-position: center;
    }
    #tabview {
        width: -webkit-fill-available;
        z-index: 0; /* keep underneath the tabs */
        position: relative;
        overflow: hidden;
		flex: 1 1 auto;
		min-height: 0;
    }
	#preview-container {
		height: 100%;
		overflow: hidden;
		display: flex;
		flex-direction: column;
		background-color: var(--preview-surface, var(--editor-background));
		color: var(--preview-text, var(--editor-foreground));
	}
	.preview-shell {
		position: relative;
		flex: 1 1 auto;
		min-height: 0;
	}
    #workarea { display: grid; grid-template-columns: 1fr 0; height: auto; flex: 1 1 auto; min-height: 0; }
    #workarea.mode-edit { grid-template-columns: 1fr 0; }
    #workarea.mode-split { 
        grid-template-columns: 1fr auto 1fr; 
        column-gap: 0; 
    }
    #workarea.mode-preview { grid-template-columns: 0 1fr; }
    
    /* 编辑器和预览之间的分割线 */
    .workarea-divider {
        width: 1px;
        background: color-mix(in srgb, var(--window-borderColor, rgba(100, 116, 139, 0.45)) 82%, transparent);
        align-self: stretch;
        flex-shrink: 0;
    }
    
    :global(.dark) .workarea-divider {
        background: color-mix(in srgb, var(--window-borderColor, rgba(148, 163, 184, 0.5)) 70%, transparent);
    }

    #editor-pane {
        display: flex;
        flex-direction: column;
        min-width: 0;
        min-height: 0;
    }
	.hidden {
		visibility: hidden;
        pointer-events: none;
	}
    :global(.view-bottom-pane) {
		z-index: 1;
	}

    /* Hide the editor<->agent splitter when the agent pane is fully collapsed or fully expanded. */
    :global(.splitpanes.agent-collapsed > .splitpanes__splitter) {
        display: none;
    }

    /* Terminal-only: avoid showing a meaningless splitter when the editor is collapsed to 0 height. */
    :global(.splitpanes.terminal-only > .splitpanes__splitter) {
        display: none;
    }
</style>
