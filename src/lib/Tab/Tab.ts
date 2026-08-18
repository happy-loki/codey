import { writable, get } from "svelte/store";
import Editor from "../Editor.svelte";
import ImagePreview from "../ImagePreview.svelte";
import UnsupportedFileTab from "../UnsupportedFileTab.svelte";
import {   ask } from '@tauri-apps/plugin-dialog';
import { invoke } from "@tauri-apps/api/core"
// Use Tauri command to sync tabs to Rust state (v2 event listen API differs)
import { saveFile } from "../File";
// import { warn } from "tauri-plugin-log-api";
import { warn, info } from '@tauri-apps/plugin-log';
import { appSettings } from "../../config/config";
import { isMarkdownActive, previewMode } from "../preview";
import { t } from "../i18n";
import { whiteboardTarget, WHITEBOARD_TAB_PATH, setWhiteboardGlobal, suppressWhiteboardSavesForPath, resumeWhiteboardSavesForPath } from "../whiteboard/state";
import { drawioTarget, DRAWIO_TAB_PATH, clearDrawioTarget } from "../drawio/state";
import { animationTarget, ANIMATION_TAB_PATH, clearAnimationTargetIfMatch, resetAnimationTarget } from "../excalidrawAnimate/state";
import { normalizeFsPath, canonicalPathKey } from "../utils/pathNormalize";

export class Tab {
    id = 0;
    activeid = this.id;
    tablist = [];
    Tab; // Tab class
    activeTab = null;
    hidden = writable(true);
    isfile = writable(false);
    tabs = writable([]);
    constructor (Tab) {
        this.Tab = Tab;
    }

    setActive(id: number) {
        const previousId = this.activeid;
        for (let tab of this.tablist) {
            if (tab.id === id) {
                this.activeid = id;
                tab.active = true;
                if (tab.isfile) {
                    this.isfile.set(true);
                    tab.content.focus();
                } else {
                    this.isfile.set(false);
                }
                this.activeTab = tab;
            } else {
                tab.active = false;
            }
        }
        this.tabs.set(this.tablist);
        this.updateView();
        // 依据当前活动标签即时判断是否为 Markdown 文件
        try {
            const t: any = this.activeTab;
            let isMd = false;
            if (t && t.isfile) {
                const info = t.content?.getFileInfo?.() || {} as any;
                const langName = String(info.language || "").toLowerCase();
                const ext = String(info.fileType || "").toLowerCase();
                const p = String(info.path || "").toLowerCase();
                const n = String(info.filename || "").toLowerCase();
                isMd = (
                    langName.includes("markdown") ||
                    ext === ".md" || ext === "md" || ext === ".markdown" || ext === "markdown" ||
                    p.endsWith(".md") || p.endsWith(".markdown") ||
                    n.endsWith(".md") || n.endsWith(".markdown")
                );
            }
            isMarkdownActive.set(isMd);
        } catch {}

        if (previousId !== id) {
            try {
                if (get(previewMode) !== "edit") {
                    previewMode.set("edit");
                }
            } catch {}
        }

        // If user activates a non-diff tab, close all diff-style tabs (VS Code-like UX)
        try {
            const selected = this.tablist.find(t => t.id === id);
            const isDiff = (tt) => {
                if (!tt || typeof tt.path !== 'string') return false;
                return tt.path.startsWith('diff://')
                    || tt.path.startsWith('multi-diff://')
                    || tt.path.startsWith('view-all://');
            };
            if (selected && !isDiff(selected)) {
                const toClose = this.tablist.filter(t => isDiff(t));
                // Close asynchronously to avoid interfering with current setActive flow
                for (const d of toClose) {
                    // best-effort close; ignore rejections
                    Promise.resolve(this.closeTab(d.id)).catch(() => {});
                }
            }
        } catch {}

        // 同步逻辑改由 EditorTabList.svelte 统一触发，避免重复调用与重复日志
    }
    updateTabs() {
        if (this.tablist.length > 0) {
            this.hidden.set(false);
        }

        this.tabs.set(this.tablist);
        this.setActive(this.id);
        this.id++;
        // setActive already syncs; nothing extra needed here.
    }

    private static looksLikeFsPath(path: string): boolean {
        if (typeof path !== "string") return false;
        const trimmed = path.trim();
        if (!trimmed) return false;
        const lower = trimmed.toLowerCase();
        if (lower.startsWith("file://") || lower.startsWith("vscode-file://")) {
            return true;
        }
        if (lower.includes("://")) {
            // internal schemes like diff://, multi-diff://, etc.
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

    private static tabKey(path: string): string {
        if (!Tab.looksLikeFsPath(path)) {
            return path;
        }
        return canonicalPathKey(path);
    }

    tabOpen(path: string) {
        const targetKey = Tab.tabKey(path);
        for (const tab of this.tablist) {
            const tabPath = typeof tab?.path === "string" ? tab.path : "";
            if (Tab.tabKey(tabPath) === targetKey) {
                this.setActive(tab.id);
                return true;
            }
        }
        return false;
    }
    addTab(path: string = "", label: string = "", content = null, options: { labelKey?: string | null } = {}) {
        // dont add tabs that are already open
        if (this.tabOpen(path)) {
            return;
        }
        
        let tab = new this.Tab(this.id, label, content, path, options);
        this.tablist = [...this.tablist, tab];

        this.updateTabs();
    }
    async addEditorTab(path: string, label: string = "") {
        await releaseExclusiveEditors(this, path);
        if (this.tabOpen(path)) {
            return;
        }
        const lower = (path || "").toLowerCase();
        const isImage = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg"].some(ext => lower.endsWith(ext));

        let tab;
        if (isImage) {
            const content = new ImagePreview({ target: document.getElementById("tabview"), props: { path } });
            tab = new this.Tab(this.id, label, content, path);
            tab.isfile = false;
            tab.isimage = true;
            (tab as any).isUnsupported = false;
            tab.saved = true;
        } else {
            const settings = await appSettings;
            const editorConfig: any = await settings.get("editor");
            const defaultTabSize = (() => {
                const value = editorConfig?.tabSize;
                if (typeof value === "number" && Number.isFinite(value)) return value;
                const numeric = Number(value);
                return Number.isFinite(numeric) ? numeric : 4;
            })();
            let fileData = {text: "", encoding: "UTF-8", extension: "", bom: false, spaces: defaultTabSize};
            try {
                fileData = await invoke("read_file", {path: path});
                if (fileData.spaces === 0) {
                    fileData.spaces = defaultTabSize;
                }
            } catch (error) {
                warn(`Can't read file content in ${path}. Setting to empty string. Error: ${error} [Tab.ts:79]`);
            }
            const content = new Editor({target: document.getElementById("tabview"), props: { content: fileData.text, initialTabSize: fileData.spaces }});
            tab = new this.Tab(this.id, label, content, path);
            tab.isfile = true;
            tab.isimage = false;
            (tab as any).isUnsupported = false;
            tab.saved = true;

            content.updateFileInfo({
                "filename": tab.label,
                "path": tab.path,
                "fileType": fileData.extension,
                "language": await content.getLang(fileData.extension),
                "encoding": fileData.encoding,
                "hasBom": fileData.bom,
                "spaces": fileData.spaces,
                "readonly": false,
            });
        }
        this.tablist = [...this.tablist, tab];

        this.updateTabs();
        // updateTabs -> setActive -> sync
    }

    async addUnsupportedFileTab(path: string, label: string = "") {
        await releaseExclusiveEditors(this, path);
        if (this.tabOpen(path)) {
            return;
        }

        const settings = await appSettings;
        const editorConfig: any = await settings.get("editor");
        const defaultTabSize = (() => {
            const value = editorConfig?.tabSize;
            if (typeof value === "number" && Number.isFinite(value)) return value;
            const numeric = Number(value);
            return Number.isFinite(numeric) ? numeric : 4;
        })();
        const extension = (() => {
            const m = /(\.[^./\\]+)$/.exec(path || "");
            return m ? m[1] : "";
        })();

        const content = new UnsupportedFileTab({ target: document.getElementById("tabview"), props: { path } });
        const tab = new this.Tab(this.id, label, content, path);
        tab.isfile = true;
        tab.isimage = false;
        (tab as any).isUnsupported = true;
        tab.saved = true;

        try {
            content.updateFileInfo({
                filename: tab.label,
                path: tab.path,
                fileType: extension,
                language: "binary",
                encoding: "binary",
                hasBom: false,
                spaces: defaultTabSize,
                readonly: true,
            });
        } catch {}

        this.tablist = [...this.tablist, tab];
        this.updateTabs();
    }
    async closeTab(tabid: number, options: { force?: boolean } = {}) {
        const force = Boolean(options?.force);
        const target = this.tablist.find(t => t.id === tabid);
        if (!target) {
            return;
        }
        if (!force && !(await this.confirmSpecialTabClose(target))) {
            return;
        }
        if (this.activeid === tabid) {
            for (let i = 0; i <= this.tablist.length - 1; i++) {
                if (!force && this.tablist[i].id === tabid && !this.tablist[i].saved) {
                    if (await ask(`Do you want to save ${this.tablist[i].label} before closing?`)) {
                        await saveFile();
                    }
                }
                // set right tab active
                if (this.tablist[i].id === tabid && this.tablist[i + 1]) {
                    this.setActive(this.tablist[i + 1].id);
                    break;
                }
                // set left tab active
                else if (this.tablist[i].id === tabid && this.tablist[i - 1]) {
                    this.setActive(this.tablist[i - 1].id);
                    break;
                }
            }
        }
        // 安全销毁：目标标签可能已被其他逻辑提前关闭或切换时被清理
        try {
            const target: any = this.tablist.find(t => t.id === tabid);
            if (target && target.content && typeof target.content.$destroy === 'function') {
                target.content.$destroy();
            }
        } catch {}
        if (target?.path === WHITEBOARD_TAB_PATH) {
            setWhiteboardGlobal();
        } else if (target?.path === ANIMATION_TAB_PATH) {
            resetAnimationTarget();
        }
        this.tablist = this.tablist.filter(t => t.id !== tabid);
        this.tabs.set(this.tablist);

        if (this.tablist.length === 0) {
            this.hidden.set(true);
            this.isfile.set(false);
            this.id = 0;
        }
        // 同步改由 EditorTabList.svelte 统一触发
    }

    async confirmSpecialTabClose(tab: any): Promise<boolean> {
        const content = tab?.content;
        if (!content || typeof content.hasUnsavedChanges !== "function") {
            return true;
        }
        let dirty = false;
        try {
            dirty = Boolean(content.hasUnsavedChanges());
        } catch (error) {
            console.warn('[Tab] hasUnsavedChanges check failed', error);
            dirty = false;
        }
        if (!dirty) {
            return true;
        }
        let translate: (key: string, vars?: Record<string, any>) => string = (key) => key;
        try {
            translate = get(t);
        } catch {}
        const title = translate("drawioWorkspace.confirmClose.title");
        const message = translate("drawioWorkspace.confirmClose.message");
        const okLabel = translate("drawioWorkspace.confirmClose.confirm");
        const cancelLabel = translate("drawioWorkspace.confirmClose.cancel");
        try {
            const confirmed = await ask(message, {
                title,
                kind: "warning",
                okLabel,
                cancelLabel,
            });
            return confirmed;
        } catch (err) {
            console.warn('[Tab] draw.io close confirmation failed, falling back to default dialog', err);
            return await ask(message, title);
        }
    }
    async closeAllTabs() {
        await this.closeTab(this.activeid);
        const temp = [...this.tablist].reverse(); // js just loves to be inconsistent with its array functions innit
        for (const tab of temp) {
            await this.closeTab(tab.id);
        }
    }

    async closeOtherTabs(tabid: number) {
        const targetIndex = this.tablist.findIndex((tab) => tab.id === tabid);
        if (targetIndex === -1) {
            return;
        }
        this.setActive(tabid);
        const ids = this.tablist
            .filter((tab) => tab.id !== tabid)
            .map((tab) => tab.id);
        for (const id of ids) {
            await this.closeTab(id);
        }
    }

    async closeTabsToLeft(tabid: number) {
        const targetIndex = this.tablist.findIndex((tab) => tab.id === tabid);
        if (targetIndex <= 0) {
            if (targetIndex === 0) {
                this.setActive(tabid);
            }
            return;
        }
        this.setActive(tabid);
        const ids = this.tablist
            .slice(0, targetIndex)
            .map((tab) => tab.id);
        for (const id of ids) {
            await this.closeTab(id);
        }
    }

    async closeTabsToRight(tabid: number) {
        const targetIndex = this.tablist.findIndex((tab) => tab.id === tabid);
        if (targetIndex === -1 || targetIndex === this.tablist.length - 1) {
            if (targetIndex !== -1) {
                this.setActive(tabid);
            }
            return;
        }
        this.setActive(tabid);
        const ids = this.tablist
            .slice(targetIndex + 1)
            .map((tab) => tab.id);
        for (const id of ids) {
            await this.closeTab(id);
        }
    }
    updateView() {
        for (let tab of this.tablist) {
            tab.updateView(this.activeid);
        }
    }
    refreshTabList() {
        this.tabs.set(this.tablist);
    }

    // 同步函数已迁移至 EditorTabList.svelte
}

function samePath(a: string, b: string): boolean {
    return canonicalPathKey(a) === canonicalPathKey(b);
}

async function closeTabByInternalPath(instance: Tab, path: string) {
    const target = instance.tablist.find((t) => t && t.path === path);
    if (target) {
        logExclusiveRelease("close", path, `tabId=${target.id}`);
        await instance.closeTab(target.id, { force: true });
    } else {
        logExclusiveRelease("close-miss", path, "<not-found>");
    }
}

async function releaseExclusiveEditors(instance: Tab, path: string | null | undefined) {
    const normalized = normalizeFsPath(path);
    if (!normalized) return;

    const whiteboardInfo = get(whiteboardTarget);
    if (whiteboardInfo?.kind === "file" && typeof whiteboardInfo.path === "string" && samePath(whiteboardInfo.path, normalized)) {
        logExclusiveRelease("whiteboard", whiteboardInfo.path, normalized);
        suppressWhiteboardSavesForPath(whiteboardInfo.path);
        try {
            await closeTabByInternalPath(instance, WHITEBOARD_TAB_PATH);
        } finally {
            setWhiteboardGlobal();
            resumeWhiteboardSavesForPath(whiteboardInfo.path);
        }
    }
    const animationInfo = get(animationTarget);
    if (animationInfo?.kind === "file" && typeof animationInfo.path === "string" && samePath(animationInfo.path, normalized)) {
        logExclusiveRelease("animation", animationInfo.path, normalized);
        clearAnimationTargetIfMatch(animationInfo.path);
        await closeTabByInternalPath(instance, ANIMATION_TAB_PATH);
    }

    const drawioInfo = get(drawioTarget);
    if (drawioInfo?.kind === "file" && typeof drawioInfo.path === "string" && samePath(drawioInfo.path, normalized)) {
        logExclusiveRelease("drawio", drawioInfo.path, normalized);
        clearDrawioTarget();
        await closeTabByInternalPath(instance, DRAWIO_TAB_PATH);
    }

}

function logExclusiveRelease(kind: "whiteboard" | "drawio" | "animation" | "close" | "close-miss", activePath: string, requestedPath: string) {
    const message = `[Tabs] releaseExclusiveEditors: closing ${kind} tab (active=${activePath}) for requested path=${requestedPath}`;
    try { info(message); } catch {}
    try { console.info(message); } catch {}
}
