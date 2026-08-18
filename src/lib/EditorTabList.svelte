<script lang="ts">


    import TabList from "./Tab/TabList.svelte";

    import { Tab } from "./Tab/Tab";
    import { afterUpdate, onMount } from "svelte";
    import { ChevronLeft, ChevronRight, PanelLeftClose } from "lucide-svelte";


    import { invoke } from "@tauri-apps/api/core"
    import { info } from '@tauri-apps/plugin-log';
    import { get } from "svelte/store";

    import { isMarkdownActive } from "./preview";
    import { t as tStore } from "./i18n";




    function computeIsMarkdownLocal(tab): boolean {
        if (!tab || !tab.isfile) return false;
        const info = tab.content?.getFileInfo?.() || {} as any;
        const langName = String(info.language || "").toLowerCase();
        const ext = String(info.fileType || "").toLowerCase();
        const p = String(info.path || "").toLowerCase();
        const n = String(info.filename || "").toLowerCase();
        return (
            langName.includes("markdown") ||
            ext === ".md" || ext === "md" || ext === ".markdown" || ext === "markdown" ||
            p.endsWith(".md") || p.endsWith(".markdown") ||
            n.endsWith(".md") || n.endsWith(".markdown")
        );
    }
    function updateMdActive() {
        try {
            isMarkdownActive.set(computeIsMarkdownLocal(getActiveTab()));
        } catch {}
    }
    import { setSelectedPath } from "./tree/normalizedStore";
    import { isSyncableHostBridgeTab } from "./utils/hostbridgeTabs";

    function computeSyncPayload() {
        try {
            const allTabs: any[] = get(tabs) as any[];
            const paths = allTabs
                .filter(isSyncableHostBridgeTab)
                .map((t) => t.path);
            const active = (allTabs.find((t) => t?.active && isSyncableHostBridgeTab(t))?.path) ?? null;
            return { paths, active };
        } catch (e) {
            return { paths: [], active: null } as { paths: string[]; active: string | null };
        }
    }
    function syncTabsNow(reason: string) {
        const { paths, active } = computeSyncPayload();
        try { setSelectedPath(active ?? null); } catch {}
        const hasFiles = Array.isArray(paths) && paths.length > 0;
        const hasActive = typeof active === 'string' && active.length > 0;
        if (!hasFiles && !hasActive) {
            // 非文件型 Tab 的切换/打开（如 Settings、Welcome）不需要同步给 HostBridge
            return;
        }
        try { info(`[HostBridge/UI] sync ${reason} → paths=${JSON.stringify(paths)} active=${active ?? '<none>'}`) } catch {}
        try { console.log('[HostBridge/UI] sync', reason, '→ paths:', paths, 'active:', active) } catch {}
        invoke('hostbridge_update_tabs', { paths, active }).catch(err => {
            console.warn('[HostBridge/UI] sync failed', reason, err);
        })
    }

    async function handleCloseAllTabs() {
        try {
            await editorTab.closeAllTabs();
        } finally {
            try { setSelectedPath(null); } catch {}
            updateMdActive();
            syncTabsNow('close-all-tabs-button');
        }
    }

    onMount(() => {
        updateMdActive();
        // 初次挂载后主动同步一次 tabs 给 Rust，避免启动时的竞态为空
        syncTabsNow('mount');
    })

    afterUpdate(() => {
        updateMdActive();
    })
</script>
<script lang="ts" context="module">
    import { get as getStore, writable } from "svelte/store";
    import { syncHostBridgeTabs } from "./hostbridgeSync";
    import { setSelectedPath as setSelectedPathStore } from "./tree/normalizedStore";
    import { isSyncableHostBridgeTab as syncableForModule } from "./utils/hostbridgeTabs";
    import { lang, t } from "./i18n";
    import { canonicalPathKey } from "./utils/pathNormalize";

    function looksLikeFsPath(path: string): boolean {
        if (typeof path !== "string") return false;
        const trimmed = path.trim();
        if (!trimmed) return false;
        const lower = trimmed.toLowerCase();
        if (lower.startsWith("file://") || lower.startsWith("vscode-file://")) {
            return true;
        }
        if (lower.includes("://")) {
            return false;
        }
        if (/[\\/]/.test(trimmed)) {
            return true;
        }
        if (/^[a-zA-Z]:/.test(trimmed)) {
            return true;
        }
        return false;
    }

    function computeModuleSyncPayload() {
        const allTabs: any[] = getStore(tabs) as any[];
        const paths = allTabs.filter(syncableForModule).map((t) => t.path);
        const active = (allTabs.find((t) => t?.active && syncableForModule(t))?.path) ?? null;
        return { paths, active } as { paths: string[]; active: string | null };
    }

    async function syncTabsFromModule(reason: string) {
        try {
            const { paths, active } = computeModuleSyncPayload();
            try { setSelectedPathStore(active ?? null); } catch {}
            await syncHostBridgeTabs(paths, active, reason);
        } catch {}
    }

    let activetabid = null;
    class EditorTab {
        id: number;
        label: string;
        active: boolean;
        path: string;
        content;
        isfile: boolean;
        isimage: boolean;
        saved = true;
        labelKey: string | null;
        constructor(id: number, label = "", content = null, path = "", options: { labelKey?: string | null } = {}) {
            this.id = id;
            this.label = label === "" ? `Untitled-${id}` : label;
            this.path = path === "" ? this.label : path;
            this.content = content;
            this.isimage = false;
            this.labelKey = options?.labelKey ?? null;
        }
        updateView(id) {
            try {
                if (this.content && typeof this.content.$set === "function") {
                    this.content.$set({ hidden: !(this.id === id) });
                }
            } catch (e) {
                console.warn("[EditorTabList] updateView failed", e);
            }
        }
        refreshView(tab) {
            if (tab.isfile) {
                try {
                    if (typeof tab.content?.setTheme === 'function') {
                        tab.content.setTheme();
                    }
                } catch (e) {
                    console.warn('[EditorTabList] refreshView skipped setTheme due to error', e);
                }
            }
        }
        setActive(id) {
            editorTab.setActive(id);
            activetabid = id;
        }
    }
    const editorTab = new Tab(EditorTab);

    const MAX_HISTORY_LENGTH = 100;
    const historyBack: number[] = [];
    const historyForward: number[] = [];
    let suppressHistoryChange = false;
    let lastHistoryActiveId: number | null = editorTab.activeTab?.id ?? null;
    export const tabHistoryState = writable({ canGoBack: false, canGoForward: false });

    editorTab.tabs.subscribe((list) => {
        const entries = Array.isArray(list) ? list : [];
        const validIds = new Set<number>();
        for (const tab of entries) {
            if (typeof tab?.id === "number") {
                validIds.add(tab.id);
            }
        }
        pruneNavigationStacks(validIds);
        const activeTab = entries.find((t) => t?.active);
        const activeId = typeof activeTab?.id === "number" ? activeTab.id : null;
        if (activeId !== lastHistoryActiveId) {
            if (!suppressHistoryChange && lastHistoryActiveId !== null && validIds.has(lastHistoryActiveId)) {
                pushHistoryValue(historyBack, lastHistoryActiveId);
                historyForward.length = 0;
            }
            lastHistoryActiveId = activeId;
        }
        if (suppressHistoryChange) {
            suppressHistoryChange = false;
        }
        updateTabHistoryState();
    });

    lang.subscribe(() => {
        const translate = getStore(t);
        let changed = false;
        for (const tab of editorTab.tablist) {
            if (tab?.labelKey) {
                const prevLabel = tab.label;
                const nextLabel = translate(tab.labelKey);
                if (typeof nextLabel === "string" && tab.label !== nextLabel) {
                    tab.label = nextLabel;
                    if (!tab.isfile && tab.path === prevLabel) {
                        tab.path = nextLabel;
                    }
                    changed = true;
                }
            }
        }
        if (changed) {
            editorTab.tabs.set([...editorTab.tablist]);
        }
    });

    function updateMdActive() {
        try {
            isMarkdownActive.set(computeIsMarkdown(editorTab.activeTab));
        } catch {}
    }
    export async function addTab(path?: string, label?: string, content = null, options: { labelKey?: string | null } = {}) {
        editorTab.addTab(path, label, content, options);
        updateMdActive();
        // 在 module 作用域内独立计算 payload 并同步，避免引用实例作用域变量
        try {
            await syncTabsFromModule('add-tab');
        } catch {}
    }
    export async function addEditorTab(path?: string, label?: string) {
        // no debug tracing
        // Be resilient if backend capability probing fails: try open anyway, fallback to NotSupported
        let supported: boolean | null = null;
        if (path) {
            try {
                supported = await invoke("is_supported", { path });
            } catch (e) {
                // Treat as supported on probe failure to avoid blocking all files
                supported = null;
            }
        }
        if (path && supported === false) {
            await editorTab.addUnsupportedFileTab(path, label ?? (path.split(/[/\\]/).pop() || path));
            updateMdActive();
            try {
                await syncTabsFromModule('add-unsupported-file-tab');
            } catch {}
            return;
        }
        await editorTab.addEditorTab(path, label);
        updateMdActive();
        try {
            await syncTabsFromModule('add-editor-tab');
        } catch {}
    }
    // Open or focus a file tab, then jump to a specific line/column
    export async function openFileAtLine(path: string, line: number, column: number = 1) {
        try {
            if (!path) return;
            // If already open, focus it; otherwise open
            const existing = looksLikeFsPath(path)
                ? findTabByCanonicalPath(path)
                : editorTab.tablist.find(t => t && t.path === path);
            if (existing) {
                editorTab.setActive(existing.id);
            } else {
                const label = (path.split(/[/\\]/).pop() || path);
                await addEditorTab(path, label);
            }
            // Find active tab for this path and scroll
            const target = looksLikeFsPath(path)
                ? findTabByCanonicalPath(path)
                : editorTab.tablist.find(t => t && t.path === path);
            if (target && target.isfile && target.content && typeof target.content.scrollToLine === 'function') {
                // Delay slightly to ensure the editor is laid out
                setTimeout(() => {
                    try { target.content.scrollToLine(line, column); } catch {}
                }, 0);
            }
        } catch {}
    }
    export async function closeTab(tabid: number, options: { force?: boolean } = {}) {
        await editorTab.closeTab(tabid, options);
    }
    export async function closeActiveTab() {
        await editorTab.closeTab(activetabid);
    }
    function findTabByCanonicalPath(path: string) {
        const key = canonicalPathKey(path);
        if (!key) return null;
        return editorTab.tablist.find((t) => t && canonicalPathKey(t.path) === key) || null;
    }

    export async function closeTabByPath(path: string, options: { force?: boolean } = {}) {
        if (typeof path !== "string" || !path) return;
        const target = findTabByCanonicalPath(path);
        if (!target) return;
        await editorTab.closeTab(target.id, options);
        updateMdActive();
        try {
            await syncTabsFromModule('close-by-path');
        } catch {}
    }
    export async function closeTabsByPrefix(prefix: string, options: { force?: boolean } = {}) {
        if (typeof prefix !== "string" || prefix.length === 0) return;
        const targets = editorTab.tablist.filter(
            (t) => t && typeof t.path === "string" && t.path.startsWith(prefix)
        );
        if (targets.length === 0) return;
        for (const tab of targets) {
            await editorTab.closeTab(tab.id, options);
        }
        updateMdActive();
        try {
            await syncTabsFromModule('close-by-prefix');
        } catch {}
    }
    export function renameTab(tab, label, path, options: { labelKey?: string | null } = {}) {
        if (tab) {
            tab.label = label;
            tab.path = path;
            tab.labelKey = options?.labelKey ?? null;
            editorTab.setActive(tab.id);
        }
    }
    export async function closeAllTabs() {
        await editorTab.closeAllTabs();
        try { setSelectedPathStore(null); } catch {}
        try { await syncHostBridgeTabs([], null, 'close-all'); } catch {}
    }
    export async function closeOtherTabs(tabid: number) {
        await editorTab.closeOtherTabs(tabid);
        updateMdActive();
        try {
            await syncTabsFromModule('close-others');
        } catch {}
    }
    export async function closeTabsToLeft(tabid: number) {
        await editorTab.closeTabsToLeft(tabid);
        updateMdActive();
        try {
            await syncTabsFromModule('close-left');
        } catch {}
    }
    export async function closeTabsToRight(tabid: number) {
        await editorTab.closeTabsToRight(tabid);
        updateMdActive();
        try {
            await syncTabsFromModule('close-right');
        } catch {}
    }
    export function getActiveTab() {
        return editorTab.activeTab;
    }
    export function getCurrentEditor() {
        return editorTab.activeTab?.content ?? null;
    }

    export function relayoutActiveEditor() {
        try {
            const ed: any = getCurrentEditor();
            ed?.relayout?.();
        } catch {}
    }
    function computeIsMarkdown(tab): boolean {
        if (!tab || !tab.isfile) return false;
        const info = tab.content?.getFileInfo?.() || {} as any;
        const langName = String(info.language || "").toLowerCase();
        const ext = String(info.fileType || "").toLowerCase();
        const p = String(info.path || "").toLowerCase();
        const n = String(info.filename || "").toLowerCase();
        return (
            langName.includes("markdown") ||
            ext === ".md" || ext === "md" || ext === ".markdown" || ext === "markdown" ||
            p.endsWith(".md") || p.endsWith(".markdown") ||
            n.endsWith(".md") || n.endsWith(".markdown")
        );
    }
    export function refreshTabs() {
        editorTab.refreshTabList();
    }

    // 兼容旧引用：工具栏逻辑已移除，此函数保留为 no-op
    export function updateTablistWidth() {
        // intentionally empty
    }

    export async function focusTabByPath(path: string) {
        if (typeof path !== "string" || !path) return;
        const target = looksLikeFsPath(path)
            ? findTabByCanonicalPath(path)
            : editorTab.tablist.find((t) => t && t.path === path);
        if (!target) return;
        editorTab.setActive(target.id);
        updateMdActive();
        try {
            await syncTabsFromModule('focus-by-path');
        } catch {}
    }

    function updateTabHistoryState() {
        tabHistoryState.set({
            canGoBack: historyBack.length > 0,
            canGoForward: historyForward.length > 0
        });
    }

    function pushHistoryValue(stack: number[], value: number) {
        if (stack[stack.length - 1] === value) {
            return;
        }
        stack.push(value);
        if (stack.length > MAX_HISTORY_LENGTH) {
            stack.splice(0, stack.length - MAX_HISTORY_LENGTH);
        }
    }

    function pruneNavigationStacks(validIds: Set<number>) {
        pruneStack(historyBack, validIds);
        pruneStack(historyForward, validIds);
    }

    function pruneStack(stack: number[], validIds: Set<number>) {
        if (stack.length === 0) {
            return;
        }
        const filtered = stack.filter((id) => validIds.has(id));
        if (filtered.length !== stack.length) {
            stack.length = 0;
            stack.push(...filtered);
        }
    }

    function getNextHistoryTarget(stack: number[]): number | null {
        while (stack.length > 0) {
            const candidate = stack.pop();
            if (typeof candidate === "number" && editorTab.tablist.some((t) => t && t.id === candidate)) {
                return candidate;
            }
        }
        return null;
    }

    async function activateHistoryTarget(targetId: number | null, reason: 'history-back' | 'history-forward') {
        if (typeof targetId !== "number") {
            updateTabHistoryState();
            return;
        }
        const target = editorTab.tablist.find((t) => t && t.id === targetId);
        if (!target) {
            updateTabHistoryState();
            return;
        }
        suppressHistoryChange = true;
        editorTab.setActive(target.id);
        updateMdActive();
        try {
            await syncTabsFromModule(reason);
        } catch {}
    }

    export async function navigateTabBack() {
        const targetId = getNextHistoryTarget(historyBack);
        if (targetId === null) {
            updateTabHistoryState();
            return;
        }
        if (typeof lastHistoryActiveId === "number" && lastHistoryActiveId !== targetId) {
            pushHistoryValue(historyForward, lastHistoryActiveId);
        }
        await activateHistoryTarget(targetId, 'history-back');
        updateTabHistoryState();
    }

    export async function navigateTabForward() {
        const targetId = getNextHistoryTarget(historyForward);
        if (targetId === null) {
            updateTabHistoryState();
            return;
        }
        if (typeof lastHistoryActiveId === "number" && lastHistoryActiveId !== targetId) {
            pushHistoryValue(historyBack, lastHistoryActiveId);
        }
        await activateHistoryTarget(targetId, 'history-forward');
        updateTabHistoryState();
    }

    export let hidden = editorTab.hidden;
    export let isfile = editorTab.isfile;
    export let tabs = editorTab.tabs;
</script>
<div id="editor-tabs" class:hidden={$hidden}>
    <div class="tabstrip">
        <div class="tab-history-controls">
            <button
                type="button"
                class="tab-history-button"
                title="Go to previous tab"
                aria-label="Go to previous tab"
                on:click|stopPropagation={navigateTabBack}
                disabled={!$tabHistoryState.canGoBack}
            >
                <ChevronLeft size={16} stroke-width={2} />
            </button>
            <button
                type="button"
                class="tab-history-button"
                title="Go to next tab"
                aria-label="Go to next tab"
                on:click|stopPropagation={navigateTabForward}
                disabled={!$tabHistoryState.canGoForward}
            >
                <ChevronRight size={16} stroke-width={2} />
            </button>
        </div>
        <TabList tabs={tabs}
            on:closetab={async (e) => {
                await closeTab(e.detail.tabid);
                updateMdActive();
                syncTabsNow('close-tab');
            }}
            on:select={(e) => {
                editorTab.setActive(e.detail.tabid);
                updateMdActive();
                syncTabsNow('tab-select');
            }}
        ></TabList>
        <div class="tab-actions">
            <button
                type="button"
                class="tab-action-button"
                title={$tStore("tabContext.closeAll")}
                aria-label={$tStore("tabContext.closeAll")}
                on:click|stopPropagation={handleCloseAllTabs}
                disabled={$tabs.length === 0}
            >
                <PanelLeftClose size={16} stroke-width={2} />
            </button>
        </div>
    </div>
    <!-- 工具栏已迁移到 ActivePathBar，这里不再渲染任何工具区 -->
</div>

<style lang="scss">
    .hidden {
        visibility: hidden;
    }
    #editor-tabs {
        width: 100%;
        display: flex;
        /* 允许在父级中横向收缩 */
        min-width: 0;
    }

    .tabstrip {
        display: flex;
        flex: 1 1 auto;
        min-width: 0;
        align-items: stretch;
    }

    .tab-history-controls {
        display: flex;
        align-items: center;
        gap: 4px;
        padding: 0 6px;
        border-right: 1px solid hsl(var(--border));
        background-color: var(--editor-background, hsl(var(--background)));
        flex: 0 0 auto;
    }

    .tab-history-button,
    .tab-action-button {
        width: calc(var(--header-control-height, 32px) - 4px);
        height: calc(var(--header-control-height, 32px) - 4px);
        border: none;
        border-radius: 6px;
        background: transparent;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        color: hsl(var(--muted-foreground));
        transition: color 0.15s ease, background 0.15s ease;
        cursor: pointer;
    }

    .tab-history-button:disabled,
    .tab-action-button:disabled {
        opacity: 0.4;
        cursor: default;
    }

    .tab-history-button:not(:disabled):hover,
    .tab-action-button:not(:disabled):hover {
        color: hsl(var(--foreground));
        background-color: hsl(var(--foreground) / 0.08);
    }

    .tab-history-button:not(:disabled):active,
    .tab-action-button:not(:disabled):active {
        background-color: hsl(var(--foreground) / 0.15);
    }

    .tab-actions {
        display: flex;
        align-items: center;
        padding: 0 6px;
        border-left: 1px solid hsl(var(--border));
        background-color: var(--editor-background, hsl(var(--background)));
        flex: 0 0 auto;
    }
</style>
