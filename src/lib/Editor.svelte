<script lang="ts">
    import { onMount, onDestroy, tick } from "svelte";
    import { writable as writableStore, get as getStoreValue } from "svelte/store";
    import { saveFile, createTimestampedNewFile } from "./File";
    import { appSettings } from "../config/config";
    import { warn } from '@tauri-apps/plugin-log';
    import { writeText, readText } from "@tauri-apps/plugin-clipboard-manager";
    import { watchImmediate, type UnwatchFn } from "@tauri-apps/plugin-fs";
    import { invoke } from "@tauri-apps/api/core";
    import { addNotification, NotifType } from "./Notifications/notifications";
    import { emitScroll, subscribeScroll, syncScrollActive } from "./markdown/syncScroll";
    import { editorViewStore, type MonacoEditor } from "./editorViewStore";
    import { t } from "./i18n";
    import { monaco } from "./monaco/instance";
    import { applyLanguageToModel, detectLanguage, type MonacoLanguageDescriptor } from "./monaco/language-service";
    import { getMonacoThemeId } from "./monaco/theme";
    import { openSearchPopup } from "./searchPopupStore";
    import { isMarkdownActive, previewMode } from "./preview";
    import { normalizeMonoFontFamily, SYSTEM_MONO_FONT_STACK } from "../config/fontStacks";

    import { openContextMenu as openGlobalContextMenu, type MenuItem } from "./utility/contextMenuService";

    const isMacPlatform = typeof navigator !== "undefined" && /mac/i.test(navigator?.platform || "");
    const SHORTCUT_LOG_TAG = "[Editor/shortcut]";
    const TEXT_FOCUS_CTX = "editorTextFocus";

    function logShortcut(event: string, details: Record<string, unknown> = {}) {
        try {
            // console.info(`${SHORTCUT_LOG_TAG} ${event}`, details);
        } catch (_) {
            /* logging best effort */
        }
    }

    function triggerDefaultClipboard(action: "copy" | "cut" | "paste") {
        if (!editor) return;
        const commandMap = {
            copy: "editor.action.clipboardCopyAction",
            cut: "editor.action.clipboardCutAction",
            paste: "editor.action.clipboardPasteAction"
        } as const;
        const command = commandMap[action];
        if (!command) return;
        try {
            editor.trigger("keyboard", command, null);
            logShortcut("fallback", { action });
        } catch (e) {
            console.warn(`${SHORTCUT_LOG_TAG} fallback failed`, { action, error: e });
        }
    }

    function resolveClipboardRange(model: monaco.editor.ITextModel, selection: monaco.Selection | null): monaco.Selection | null {
        if (selection && !selection.isEmpty()) {
            return selection;
        }
        const position = editor?.getPosition();
        if (!position) {
            return null;
        }
        const lineNumber = position.lineNumber;
        const lineCount = model.getLineCount();
        const isLastLine = lineNumber >= lineCount;
        const maxColumn = model.getLineMaxColumn(lineNumber);
        if (isLastLine) {
            return new monaco.Selection(lineNumber, 1, lineNumber, maxColumn);
        }
        return new monaco.Selection(lineNumber, 1, lineNumber + 1, 1);
    }

    function handleContextMenu(e: MouseEvent) {
        e.preventDefault();
        if (!editor) return;
        const model = editor.getModel() ?? monacoModel;
        const target = editor.getTargetAtClientPoint(e.clientX, e.clientY);
        if (model && target?.position) {
            const clickOffset = model.getOffsetAt(target.position);
            const selections = editor.getSelections() ?? [];
            const hasNonEmpty = selections.some((selection) => !selection.isEmpty());
            const insideExisting = selections.some((selection) => {
                const start = model.getOffsetAt(selection.getStartPosition());
                const end = model.getOffsetAt(selection.getEndPosition());
                return clickOffset >= start && clickOffset <= end;
            });
            if (!hasNonEmpty || !insideExisting) {
                const pos = target.position;
                editor.setSelection(new monaco.Selection(pos.lineNumber, pos.column, pos.lineNumber, pos.column));
            }
        }

        const selection = editor.getSelection();
        const hasSelection = !!(selection && !selection.isEmpty());
        const translate = getStoreValue(t);
        const shortcut = (key: string) => (isMacPlatform ? "Cmd+" + key : "Ctrl+" + key);

        const items: MenuItem[] = [
            {
                name: translate("editorContext.addToAIChat"),
                action: () => { void handleAddToAIChat(); },
            },
            { type: "separator", id: "editor-menu-sep" },
            {
                name: translate("editorContext.findReplace"),
                shortcut: shortcut("F"),
                action: () => handleFindReplace(),
            },
            {
                name: translate("editorContext.cut"),
                shortcut: shortcut("X"),
                disabled: !hasSelection,
                action: () => { void handleCut(); },
            },
            {
                name: translate("editorContext.copy"),
                shortcut: shortcut("C"),
                disabled: !hasSelection,
                action: () => { void handleCopy(); },
            },
            {
                name: translate("editorContext.paste"),
                shortcut: shortcut("V"),
                action: () => { void handlePaste(); },
            },
        ];

        openGlobalContextMenu(items, e.clientX, e.clientY);
    }

    async function writeClipboardText(txt: string): Promise<boolean> {
        const normalized = typeof txt === "string" ? txt : String(txt ?? "");
        try {
            await writeText(normalized);
            logShortcut("clipboard.write.plugin", { length: normalized.length });
            return true;
        } catch (pluginError) {
            console.warn(`${SHORTCUT_LOG_TAG} plugin write failed`, pluginError);
            try {
                if (navigator?.clipboard?.writeText) {
                    await navigator.clipboard.writeText(normalized);
                    logShortcut("clipboard.write.navigator", { length: normalized.length });
                    return true;
                }
            } catch (navError) {
                console.warn(`${SHORTCUT_LOG_TAG} navigator clipboard write failed`, navError);
                if (document.queryCommandSupported?.("copy")) {
                    document.execCommand("copy");
                    logShortcut("clipboard.write.execCommand", { length: normalized.length });
                    return true;
                }
            }
        }
        logShortcut("clipboard.write.failed", { length: normalized.length });
        return false;
    }

    async function handleCopy() {
        if (!editor) return;
        const model = editor.getModel() ?? monacoModel;
        if (!model) return;
        const selection = editor.getSelection();
        const range = resolveClipboardRange(model, selection);
        if (!range) {
            logShortcut("copy.range.missing");
            triggerDefaultClipboard("copy");
            return;
        }
        const txt = model.getValueInRange(range);
        const wrote = await writeClipboardText(txt);
        logShortcut("copy", { usedCustomRange: selection ? selection.isEmpty() : true, length: txt.length, wrote });
        if (!wrote) {
            triggerDefaultClipboard("copy");
        }
    }

    async function handleCut() {
        if (!editor) return;
        const model = editor.getModel() ?? monacoModel;
        if (!model) return;
        const selection = editor.getSelection();
        const range = resolveClipboardRange(model, selection);
        if (!range) {
            logShortcut("cut.range.missing");
            triggerDefaultClipboard("cut");
            return;
        }
        const txt = model.getValueInRange(range);
        const copied = await writeClipboardText(txt);
        logShortcut("cut", { usedCustomRange: selection ? selection.isEmpty() : true, length: txt.length, copied });
        if (!copied) {
            triggerDefaultClipboard("cut");
            return;
        }
        editor.executeEdits("codey-context-menu", [
            { range, text: "", forceMoveMarkers: true }
        ]);
    }

    async function handlePaste() {
        if (!editor) return;
        try {
            const txt = await readText();
            const selection = editor.getSelection();
            const model = editor.getModel() ?? monacoModel;
            if (!selection || !model) {
                return;
            }
            if (txt != null && txt !== "") {
                editor.executeEdits("codey-context-menu", [
                    { range: selection, text: txt, forceMoveMarkers: true }
                ]);
            }
            logShortcut("paste", { length: txt?.length ?? 0, usedPlugin: true });
        } catch (pluginError) {
            console.warn(`${SHORTCUT_LOG_TAG} paste plugin failed`, pluginError);
            triggerDefaultClipboard("paste");
        }
    }

    async function handleAddToAIChat() {
        if (!editor) return;
        const model = editor.getModel() ?? monacoModel;
        const selection = editor.getSelection();
        if (!model || !selection || selection.isEmpty()) {
            addNotification(NotifType.Warning, "未选择任何内容", [], "请选择要添加到 Agent 会话的代码片段");
            return;
        }

        const selectedText = model.getValueInRange(selection);
        const currentPath = ($file_info.path || "").trim();

        if (!currentPath) {
            addNotification(NotifType.Warning, "缺少文件路径", [], "保存文件后再尝试添加到 Agent 会话");
            return;
        }

        const startLine = selection.startLineNumber;
        const endLine = selection.endLineNumber;

        const resolvedLanguage = (() => {
            const lang = ($file_info.language || "").trim();
            if (lang) return lang;
            const segments = currentPath.split(".");
            if (segments.length < 2) return "Unknown";
            const ext = segments.pop()?.toLowerCase() ?? "";
            if (!ext) return "Unknown";
            const match = detectLanguage({ extension: ext });
            return match?.label ?? "Unknown";
        })();

        try {
            // 通过 commands 将代码片段添加到 Agent 会话附件队列
            await commands.addToAIChat.command(
                selectedText,
                currentPath,
                resolvedLanguage,
                startLine,
                endLine
            );
        } catch (error) {
            console.error("Failed to add to Agent chat:", error);
        }
    }

    function handleFindReplace() {
        if (!editor) return;
        const selection = editor.getSelection();
        const model = editor.getModel() ?? monacoModel;
        const query = selection && model && !selection.isEmpty()
            ? model.getValueInRange(selection)
            : undefined;
        editor.focus();
        editor.trigger("codey", "actions.find", query ? { searchString: query } : undefined);
    }

    let ref: HTMLDivElement | null = null;
    let editor: MonacoEditor | null = null;
    let monacoModel: monaco.editor.ITextModel | null = null;
    let pendingLanguageDescriptor: MonacoLanguageDescriptor | null = null;
    let currentLanguageDescriptor: MonacoLanguageDescriptor | null = null;
    let lineHeightRatio: number | null = null;
    let letterSpacingPx = 0;
    let pendingTabSize: number | null = null;
    let lineWrappingEnabled = false;
    const editorDisposables: monaco.IDisposable[] = [];
    const customCommandIds: string[] = [];
    let editorReady = false;
    const DEFAULT_LINE_HEIGHT_RATIO = 1.5;

    function resolveEditorFontWeight(): string {
        try {
            const platform = document?.documentElement?.getAttribute("data-platform") || "";
            // WebView2 + CJK fallback fonts can appear visually thin at normal(400).
            // Slightly increase only on Windows to better match VS Code's perceived weight.
            if (platform === "windows") return "500";
        } catch {}
        return "400";
    }

    export let hidden = false;
    export let content = "";
    export let initialTabSize: number | null = null;
    const file_info = writableStore({
        "filename": "",
        "path": "",
        "fileType": "",
        "language": "",
        "encoding": "",
        "hasBom": false,
        "spaces": 0,
        "readonly": false,
    });

    let fileWatchStop: UnwatchFn | null = null;
    let watchedPath: string | null = null;
    let fsReloadTimer: number | null = null;
    let fsReloadInProgress = false;
    let fsReloadPending = false;
    let fsReloadLastAt = 0;
    let suppressNextAutoSave = false;

    function coerceTabSize(value: unknown): number | null {
        const numeric = typeof value === "number" ? value : Number(value);
        if (!Number.isFinite(numeric)) return null;
        const rounded = Math.floor(numeric);
        if (rounded < 1) return null;
        return Math.max(1, rounded);
    }

    async function ensureFontsReady(fontFamily: string, fontSize: number): Promise<void> {
        try {
            const fonts: any = (document as any)?.fonts;
            if (!fonts) return;
            const family = String(fontFamily ?? "").trim();
            if (family) {
                await fonts.load(`${Math.max(1, Math.floor(fontSize || 14))}px ${family}`);
            }
            await fonts.ready;
        } catch (_) {
            // best effort
        }
    }

    function scheduleReady() {
        if (editorReady) return;
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                if (editor) {
                    try { editor.layout(); } catch {}
                    try { (editor as any).render?.(true); } catch {}
                }
                editorReady = true;
            });
        });
    }

    export function relayout() {
        // Called by the app shell when pane sizes change (Splitpanes resize / dock).
        // Monaco does not reliably relayout on container resize without an explicit call.
        requestAnimationFrame(() => {
            try { editor?.layout?.(); } catch {}
        });
    }

    function getModel(): monaco.editor.ITextModel | null {
        return editor?.getModel() ?? monacoModel;
    }

    function getCurrentContent(): string {
        const model = getModel();
        return model ? model.getValue() : content;
    }

    type LocalSaveSnapshot = {
        text: string;
        expiresAt: number;
    };
    const LOCAL_SAVE_SNAPSHOT_TTL = 2000; // ms
    const MAX_LOCAL_SAVE_SNAPSHOTS = 3;
    let pendingLocalSaveSnapshots: LocalSaveSnapshot[] = [];

    function now(): number {
        try {
            return performance.now();
        } catch (_) {
            return Date.now();
        }
    }

    function pruneLocalSaveSnapshots(reference = now()) {
        if (!pendingLocalSaveSnapshots.length) return;
        pendingLocalSaveSnapshots = pendingLocalSaveSnapshots.filter((entry) => entry.expiresAt > reference);
    }

    function recordLocalSaveSnapshot(text: string) {
        const normalized = typeof text === "string" ? text : String(text ?? "");
        pruneLocalSaveSnapshots();
        pendingLocalSaveSnapshots.push({
            text: normalized,
            expiresAt: now() + LOCAL_SAVE_SNAPSHOT_TTL
        });
        if (pendingLocalSaveSnapshots.length > MAX_LOCAL_SAVE_SNAPSHOTS) {
            pendingLocalSaveSnapshots.splice(0, pendingLocalSaveSnapshots.length - MAX_LOCAL_SAVE_SNAPSHOTS);
        }
    }

    function matchesLocalSaveSnapshot(text: string): boolean {
        pruneLocalSaveSnapshots();
        return pendingLocalSaveSnapshots.some((entry) => entry.text === text);
    }

    function cleanupFileWatcher() {
        if (fileWatchStop) {
            try { fileWatchStop(); } catch (err) { console.warn('[filewatch] stop failed', err); }
            console.info('[filewatch] watcher disposed for', watchedPath);
        }
        fileWatchStop = null;
        watchedPath = null;
        if (fsReloadTimer) {
            clearTimeout(fsReloadTimer);
            fsReloadTimer = null;
        }
    }

    async function ensureFileWatcher(rawPath: string) {
        const next = typeof rawPath === 'string' ? rawPath.trim() : "";
        // console.info('[filewatch] ensure watcher for path', next);
        if (!next) {
            // console.info('[filewatch] empty path → cleanup');
            cleanupFileWatcher();
            return;
        }
        if (watchedPath === next) {
            // console.info('[filewatch] reuse existing watcher for', next);
            return;
        }
        cleanupFileWatcher();
        try {
            fileWatchStop = await watchImmediate(next, (event) => {
                // try {
                //     console.info('[filewatch] event received', { path: next, type: event?.type, paths: event?.paths });
                // } catch {}
                scheduleFsReload();
            });
            watchedPath = next;
            // console.info('[filewatch] watcher attached', next);
        } catch (e) {
            watchedPath = null;
            fileWatchStop = null;
            console.warn('[filewatch] watcher attach failed', { path: next, error: e });
            try { warn(`Failed to watch file ${next}: ${e}`); } catch {}
        }
    }

    const FS_RELOAD_DEBOUNCE_MS = 300;
    const FS_RELOAD_POST_RELOAD_DELAY_MS = 200;
    const FS_RELOAD_COOLDOWN_MS = 400;

    function scheduleFsReload(delay = FS_RELOAD_DEBOUNCE_MS) {
        if (!watchedPath) return;
        fsReloadPending = true;
        if (fsReloadTimer) {
            clearTimeout(fsReloadTimer);
        }
        // console.info('[filewatch] schedule reload', { path: watchedPath, delay });
        fsReloadTimer = window.setTimeout(() => {
            fsReloadTimer = null;
            void maybeRunFsReload();
        }, Math.max(0, delay));
    }

    function maybeRunFsReload() {
        if (!watchedPath) return;
        if (fsReloadInProgress) {
            return;
        }
        const elapsed = now() - fsReloadLastAt;
        if (elapsed < FS_RELOAD_COOLDOWN_MS) {
            scheduleFsReload(FS_RELOAD_COOLDOWN_MS - elapsed);
            return;
        }
        void reloadFromDisk();
    }

    async function reloadFromDisk() {
        if (!watchedPath) return;
        console.info('[filewatch] reloadFromDisk start', watchedPath);
        if (fsReloadInProgress) {
            // A reload is already running; mark pending and let the completion path
            // schedule a single follow-up reload (debounced) to avoid thrash.
            fsReloadPending = true;
            // console.info('[filewatch] reload already running; pending flag set');
            return;
        }
        fsReloadInProgress = true;
        fsReloadPending = false;
        try {
            const data: any = await invoke("read_file", { path: watchedPath });
            if (!data) return;
            const incoming = typeof data.text === "string" ? data.text : String(data.text ?? "");
            const current = getCurrentContent();
            console.info('[filewatch] fetched content length', incoming.length, 'current length', current.length);
            if (incoming !== current) {
                if (matchesLocalSaveSnapshot(incoming)) {
                    console.info('[filewatch] skip reload (local save snapshot match)');
                } else {
                    console.info('[filewatch] applying new content');
                    setExternalContent(incoming);
                }
            }
            let languageName = $file_info.language;
            try {
                languageName = await getLang(data.extension);
            } catch (_) {}
            const filename = watchedPath.split(/[\\/]/).pop() ?? watchedPath;
            const spacesValue = (typeof data.spaces === 'number' && data.spaces > 0) ? data.spaces : getSpaces();
            updateFileInfo({
                "filename": filename,
                "path": watchedPath,
                "fileType": data.extension,
                "language": languageName,
                "encoding": data.encoding,
                "hasBom": data.bom,
                "spaces": spacesValue,
                "readonly": false,
            });
        } catch (e) {
            try { warn(`Failed to reload file ${watchedPath}: ${e}`); } catch {}
        } finally {
            fsReloadInProgress = false;
            fsReloadLastAt = now();
            if (fsReloadPending) {
                console.info('[filewatch] scheduling follow-up reload');
                scheduleFsReload(FS_RELOAD_POST_RELOAD_DELAY_MS);
            }
            console.info('[filewatch] reload complete');
        }
    }

    export function updateFileInfo(file) {
        file_info.set(file);
        const candidatePath = typeof file?.path === 'string' ? file.path.trim() : "";
        const filename = typeof file?.filename === 'string' ? file.filename.trim() : "";
        const effectivePath = !candidatePath || candidatePath === filename ? "" : candidatePath;
        // console.info('[filewatch] updateFileInfo', { candidatePath, filename, effectivePath });
        void ensureFileWatcher(effectivePath);
    }
    $: if (!hidden) {
        try {
            activeInfo.set($file_info as any);
        } catch (_) {
            // ignore sync errors when bus not ready
        }
    }
    $: if (!hidden && editor && !editorReady) {
        scheduleReady();
    }
    export function getFileInfo() {
        return $file_info;
    }
    export function getFileContent() {
        const model = getModel();
        // Avoid syncing the entire buffer into Svelte state on every keystroke; pull from Monaco on demand.
        return model ? model.getValue() : content;
    }
    export function registerLocalSaveSnapshot(text: string) {
        if (typeof text !== "string") return;
        recordLocalSaveSnapshot(text);
    }
    export function setExternalContent(text: string) {
        const model = getModel();
        if (!model) {
            content = text;
            return;
        }
        const currentValue = model.getValue();
        if (currentValue === text) return;
        const selections = editor?.getSelections() ?? null;
        const prevScrollTop = editor?.getScrollTop() ?? 0;
        suppressNextAutoSave = true;
        model.pushEditOperations(
            selections,
            [{ range: model.getFullModelRange(), text }],
            () => selections ?? null
        );
        content = text;
        requestAnimationFrame(() => {
            if (!editor) return;
            const layout = editor.getLayoutInfo();
            const viewportHeight = Number.isFinite((layout as any)?.height) ? (layout as any).height : 0;
            const maxScroll = Math.max(0, editor.getScrollHeight() - viewportHeight);
            const clamped = Math.max(0, Math.min(prevScrollTop, maxScroll));
            editor.setScrollTop(clamped);
        });
    }
    export async function getLang(ext) {
        try {
            let norm = String(ext || "").trim();
            if (norm.startsWith(".")) norm = norm.slice(1);
            norm = norm.toLowerCase();
            const descriptor = detectLanguage({ extension: norm });
            setLangMode(descriptor);
            return descriptor.label;
        } catch (e) {
            try { warn(`getLang failed for ext "${ext}": ${e}`); } catch {}
            return "Unknown";
        }
    }
    function setLangMode(descriptor: MonacoLanguageDescriptor) {
        if (!editor) {
            pendingLanguageDescriptor = descriptor;
            return;
        }
        applyLanguageToModel(editor.getModel(), descriptor);
        currentLanguageDescriptor = descriptor;
        language.set(descriptor.label);
    }
    export function getEncoding() {
        return $file_info.encoding;
    }
    export function hasBom() {
        return $file_info.hasBom;
    }
    export function getSpaces() {
        return $file_info.spaces;
    }
    export function getView() {
        return editor;
    }
    // Jump to a specific line/column (1-based), center in view
    export function scrollToLine(line: number, column: number = 1) {
        if (!editor) return;
        const model = getModel();
        if (!model) return;
        const ln = Math.max(1, Math.min(model.getLineCount(), Math.floor(line || 1)));
        const col = Math.max(1, Math.floor(column || 1));
        editor.setSelection({
            startLineNumber: ln,
            startColumn: col,
            endLineNumber: ln,
            endColumn: col
        });
        editor.revealPositionInCenter({ lineNumber: ln, column: col });
        editor.focus();
        updateLineInfo();
    }
    function normalizeTabSize(input) {
        const n = Number(input);
        if (!Number.isFinite(n) || n < 1) return 4;
        return Math.max(1, Math.floor(n));
    }
    export function setTabSize(size) {
        const n = normalizeTabSize(size);
        spaces.set(n);
        const model = getModel();
        if (model) {
            model.updateOptions({ tabSize: n, insertSpaces: true });
        } else {
            pendingTabSize = n;
        }
        if (editor) {
            editor.updateOptions({ tabSize: n });
        } else {
            pendingTabSize = n;
        }
    }
    export function setScheme(scheme) {
        if (ref) {
            ref.dataset.scheme = scheme ? "dark" : "light";
        }
    }
    export function setTheme() {
        if (editor) {
            monaco.editor.setTheme(getMonacoThemeId());
        }
    }
    export function setFontFamily(family: string) {
        if (!editor) return;
        editor.updateOptions({ fontFamily: family });
    }
    export function setFontSize(size: number) {
        if (!editor) return;
        editor.updateOptions({ fontSize: size });
        if (lineHeightRatio) {
            const computed = Math.max(1, Math.round(size * lineHeightRatio));
            editor.updateOptions({ lineHeight: computed });
        }
    }
    export function setLineWrapping(enabled: boolean) {
        lineWrappingEnabled = enabled;
        if (editor) {
            editor.updateOptions({ wordWrap: enabled ? "on" : "off" });
        }
    }

    export function setLetterSpacing(value: number) {
        const numeric = Number(value);
        letterSpacingPx = Number.isFinite(numeric) ? numeric : 0;
        if (!editor) return;
        editor.updateOptions({ letterSpacing: letterSpacingPx });
    }

    function applyLineHeight() {
        if (!editor) return;
        const ratio = lineHeightRatio ?? DEFAULT_LINE_HEIGHT_RATIO;
        const fontSize = editor.getOption(monaco.editor.EditorOption.fontSize) ?? 14;
        const pixelValue = Math.max(1, Math.round(fontSize * ratio));
        editor.updateOptions({ lineHeight: pixelValue });
    }
    export function setLineHeightValue(height: string) {
        const numeric = Number.parseFloat(String(height));
        if (Number.isFinite(numeric) && numeric > 0) {
            lineHeightRatio = numeric;
        } else {
            lineHeightRatio = null;
        }
        applyLineHeight();
    }


    import { activeDoc, activeInfo } from "./editorBus";
    import { commands } from "../config/commands";

    let editorScrollSubscription: (() => void) | null = null;
    let editorActiveSubscription: (() => void) | null = null;
    let editorScrollRaf = 0;
    let suppressEditorScroll = false;
    let docSyncFrame = 0;
    let lastPublishedDoc = "";
    let lastPublishedPath = "";
    let lastHiddenValue = hidden;
    let previewModeSubscription: (() => void) | null = null;
    let markdownActiveSubscription: (() => void) | null = null;

    const DOC_PUBLISH_DEBOUNCE_MS = 200;
    const AUTOSAVE_DEBOUNCE_MS = 1000;
    let publishTimer: number | null = null;

    function shouldPublishActiveDoc(): boolean {
        // Markdown preview rendering is synchronous and expensive; avoid updating the
        // preview pipeline while user is in pure edit mode.
        try {
            if (!getStoreValue(isMarkdownActive)) return false;
            return getStoreValue(previewMode) !== "edit";
        } catch {
            return false;
        }
    }

    function publishActiveSnapshot(nextDoc?: string) {
        if (hidden) return;
        const model = getModel();
        if (!model) return;

        const resolvedDoc = typeof nextDoc === "string" ? nextDoc : model.getValue();
        const nextPath = String(($file_info as any)?.path ?? "");

        const currentDoc = getStoreValue(activeDoc);
        if (resolvedDoc !== currentDoc) {
            activeDoc.set(resolvedDoc);
        }
        lastPublishedDoc = resolvedDoc;

        const currentInfo = getStoreValue(activeInfo);
        const currentPath = String((currentInfo as any)?.path ?? "");
        if (nextPath !== currentPath) {
            activeInfo.set($file_info as any);
        }
        lastPublishedPath = nextPath;
    }

    function schedulePublishActiveSnapshot(force = false) {
        if (hidden) return;
        if (!shouldPublishActiveDoc()) return;
        const model = getModel();
        if (!model) return;

        const run = () => {
            publishTimer = null;
            // Read the full buffer only when we actually need to feed the preview bus.
            const nextDoc = model.getValue();
            publishActiveSnapshot(nextDoc);
        };

        if (force) {
            if (publishTimer) {
                clearTimeout(publishTimer);
                publishTimer = null;
            }
            run();
            return;
        }

        if (publishTimer) {
            clearTimeout(publishTimer);
        }
        publishTimer = window.setTimeout(run, DOC_PUBLISH_DEBOUNCE_MS);
    }

    function getEditorViewportHeight(): number {
        if (!editor) {
            return 0;
        }
        const layout = editor.getLayoutInfo();
        if (layout && Number.isFinite(layout.height)) {
            return layout.height;
        }
        const domNode = editor.getDomNode();
        return domNode?.clientHeight ?? 0;
    }

    function getEditorScrollRatio(): number {
        if (!editor) return 0;
        const viewportHeight = getEditorViewportHeight();
        const max = editor.getScrollHeight() - viewportHeight;
        if (max <= 0) return 0;
        return editor.getScrollTop() / max;
    }

    function scheduleEditorEmit() {
        if (suppressEditorScroll) return;
        if (editorScrollRaf) return;
        editorScrollRaf = requestAnimationFrame(() => {
            editorScrollRaf = 0;
            emitScroll("editor", getEditorScrollRatio());
        });
    }

    function applyEditorScroll(ratio: number) {
        if (!editor) return;
        const viewportHeight = getEditorViewportHeight();
        const max = editor.getScrollHeight() - viewportHeight;
        const target = max <= 0 ? 0 : ratio * max;
        suppressEditorScroll = true;
        editor.setScrollTop(target);
        requestAnimationFrame(() => {
            suppressEditorScroll = false;
        });
    }

    onMount(async () => {
        if (!ref) return;
        const settings = await appSettings;
        const editorConfig: any = await settings.get("editor");
        const initialFontSize = (() => {
            const value = editorConfig?.fontSize;
            if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
            const numeric = Number(value);
            return Number.isFinite(numeric) && numeric > 0 ? numeric : 14;
        })();
        const initialFontFamily = normalizeMonoFontFamily(editorConfig?.fontFamily, SYSTEM_MONO_FONT_STACK);
        if (editorConfig?.lineHeight != null) {
            const numeric = Number.parseFloat(String(editorConfig.lineHeight));
            lineHeightRatio = Number.isFinite(numeric) && numeric > 0 ? numeric : null;
        }
        lineWrappingEnabled = Boolean(editorConfig?.lineWrapping);
        const startingTabSize = coerceTabSize(initialTabSize) ?? coerceTabSize(editorConfig?.tabSize) ?? 4;
        const initialLineHeight = Math.max(1, Math.round(initialFontSize * (lineHeightRatio ?? DEFAULT_LINE_HEIGHT_RATIO)));
        const smoothScrollingEnabled = Boolean(editorConfig?.smoothScrolling);
        const initialFontWeight = resolveEditorFontWeight();
        letterSpacingPx = (() => {
            const value = editorConfig?.letterSpacing;
            if (typeof value === "number" && Number.isFinite(value)) return value;
            const numeric = Number(value);
            return Number.isFinite(numeric) ? numeric : 0;
        })();

        await ensureFontsReady(initialFontFamily, initialFontSize);

        monacoModel = monaco.editor.createModel(content ?? "", "plaintext");
        monacoModel.updateOptions({ tabSize: startingTabSize, insertSpaces: true });
        editor = monaco.editor.create(ref, {
            model: monacoModel,
            theme: getMonacoThemeId(),
            automaticLayout: true,
            scrollBeyondLastLine: false,
            minimap: { enabled: false },
            renderLineHighlight: "all",
            renderLineHighlightOnlyWhenFocus: false,
            wordWrap: lineWrappingEnabled ? "on" : "off",
            folding: true,
            foldingHighlight: true,
            showFoldingControls: "mouseover",
            fontFamily: initialFontFamily,
            fontSize: initialFontSize,
            lineHeight: initialLineHeight,
            letterSpacing: letterSpacingPx,
            fontWeight: initialFontWeight,
            tabSize: startingTabSize,
            lineNumbers: "on",
            // VS Code keeps scroll feel "tight"; smooth scrolling + scroll-sync can feel floaty in WebView.
            // Allow opting in via settings, but default to false for a more "snappy" editor.
            smoothScrolling: smoothScrollingEnabled,
            contextmenu: false
        });
        editorViewStore.set(editor);
        try {
            spaces.set(startingTabSize);
        } catch {}
        editorDisposables.push(editor.onDidChangeModelContent(() => {
            scheduleDocSync();
        }));
        editorDisposables.push(editor.onDidChangeCursorPosition(() => {
            updateLineInfo();
            reportCursorPosition();
        }));
        editorDisposables.push(editor.onDidScrollChange(() => {
            scheduleEditorEmit();
        }));

        try {
            customCommandIds.push(
                editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyF, () => {
                    logShortcut("shortcut.findReplace");
                    openSearchPopup();
                }, TEXT_FOCUS_CTX)
            );
        } catch (commandError) {
            console.warn("[Editor] Failed to add custom commands", commandError);
        }

        editorScrollSubscription = subscribeScroll("editor", (ratio) => {
            applyEditorScroll(ratio);
        });

        editorActiveSubscription = syncScrollActive.subscribe((active) => {
            if (active) {
                emitScroll("editor", getEditorScrollRatio());
            }
        });

        // When user switches into Markdown split/preview mode without typing,
        // force-publish the current buffer so the preview is not blank.
        try {
            previewModeSubscription = previewMode.subscribe(() => {
                schedulePublishActiveSnapshot(true);
            });
        } catch {}
        try {
            markdownActiveSubscription = isMarkdownActive.subscribe(() => {
                schedulePublishActiveSnapshot(true);
            });
        } catch {}

        // Apply pending language choice once editor is ready
        if (pendingLanguageDescriptor) {
            const descriptor = pendingLanguageDescriptor;
            pendingLanguageDescriptor = null;
            setLangMode(descriptor);
        }

        scheduleReady();
        // If this editor is (or becomes) the active tab before focus() runs,
        // ensure the markdown preview gets the correct document once Monaco is ready.
        schedulePublishActiveSnapshot(true);
        setTimeout(() => {
            ensureEditorFocus();
        }, 0);
    });

    onDestroy(() => {
        if (fsReloadTimer) {
            clearTimeout(fsReloadTimer);
            fsReloadTimer = null;
        }
        cleanupFileWatcher();
        if (docSyncFrame) {
            cancelAnimationFrame(docSyncFrame);
            docSyncFrame = 0;
        }
        if (editorScrollSubscription) {
            editorScrollSubscription();
            editorScrollSubscription = null;
        }
        if (editorActiveSubscription) {
            editorActiveSubscription();
            editorActiveSubscription = null;
        }
        if (previewModeSubscription) {
            previewModeSubscription();
            previewModeSubscription = null;
        }
        if (markdownActiveSubscription) {
            markdownActiveSubscription();
            markdownActiveSubscription = null;
        }
        if (editorScrollRaf) {
            cancelAnimationFrame(editorScrollRaf);
            editorScrollRaf = 0;
        }
        if (publishTimer) {
            clearTimeout(publishTimer);
            publishTimer = null;
        }
        for (const disposable of editorDisposables.splice(0)) {
            try { disposable.dispose(); } catch {}
        }
        customCommandIds.splice(0).forEach((id) => {
            // Monaco doesn't expose a public "removeCommand" API; guard for any internal implementation.
            try { (editor as any)?.removeCommand?.(id); } catch {}
        });
        if (editor) {
            editor.dispose();
            editor = null;
        }
        if (monacoModel) {
            monacoModel.dispose();
            monacoModel = null;
        }
        editorViewStore.set(null);
    });

    let _timer: number | null = null;
    function scheduleAutoSave() {
        if (_timer) {
            clearTimeout(_timer);
            _timer = null;
        }
        if (suppressNextAutoSave) {
            suppressNextAutoSave = false;
            return;
        }
        _timer = window.setTimeout(async () => {
            _timer = null;
            if (!$file_info.path || $file_info.path === $file_info.filename || $file_info.path === "") {
                console.warn("No path found. Cannot save");
                return;
            }
            try {
                await saveFile();
            } catch (e) {
                console.warn("Autosave failed", e);
            }
        }, AUTOSAVE_DEBOUNCE_MS);
    }

    function scheduleDocSync() {
        const model = getModel();
        if (!model) return;
        if (docSyncFrame) {
            cancelAnimationFrame(docSyncFrame);
        }
        docSyncFrame = requestAnimationFrame(() => {
            docSyncFrame = 0;
            // Keep heavy work (full-buffer reads + markdown rendering pipeline) off the hot typing path.
            scheduleAutoSave();
            schedulePublishActiveSnapshot(false);
        });
    }
    export async function focus() {
        if (!editor) return;
        editorViewStore.set(editor);
        await tick();
        editor.focus();
        editorViewStore.set(editor);
        updateLineInfo();
        language.set($file_info.language);
        encoding.set({value: $file_info.encoding, hasBom: $file_info.hasBom});
        const desiredTabSize = Number($file_info.spaces);
        if (Number.isFinite(desiredTabSize) && desiredTabSize > 0) {
            const model = getModel();
            const currentTabSize = model?.getOptions()?.tabSize;
            if (currentTabSize !== desiredTabSize) {
                setTabSize(desiredTabSize);
            }
        }
        const model = getModel();
        if (model) {
            schedulePublishActiveSnapshot(true);
        }
    }

    $: if (hidden !== lastHiddenValue) {
        lastHiddenValue = hidden;
        if (!hidden) {
            // Tab became visible: ensure markdown preview uses the correct active document.
            publishActiveSnapshot();
        }
    }

    // Enhanced focus management to ensure keyboard events are properly handled
    function ensureEditorFocus() {
        if (editor && ref && !ref.contains(document.activeElement)) {
            logShortcut("focus.ensure", { activeElement: document.activeElement?.tagName });
            editor.focus();
        }
    }

    // Handle keyboard events at the container level to ensure proper focus
    function handleContainerFocus() {
        ensureEditorFocus();
    }

    export function updateLineInfo(position?: monaco.Position | null) {
        const model = getModel();
        const pos = position ?? editor?.getPosition();
        if (!model || !pos) return;
        line_info.set({ line: pos.lineNumber.toString(), column: pos.column.toString() });
    }

    // Report cursor position to backend for Auto Context feature
    let cursorReportTimeout: number | null = null;
    function reportCursorPosition() {
        const currentPath = ($file_info.path || "").trim();
        if (!currentPath) return; // No file path, skip reporting
        
        // Debounce cursor position updates (report at most once per 500ms)
        if (cursorReportTimeout) {
            clearTimeout(cursorReportTimeout);
            cursorReportTimeout = null;
        }
        
        cursorReportTimeout = window.setTimeout(() => {
            const pos = editor?.getPosition();
            const model = getModel();
            if (!pos || !model) return;
            const lineNumber = pos.lineNumber - 1; // Convert to 0-based
            const columnNumber = pos.column - 1; // 0-based column
            
            // Get all open tabs
            const allTabs = get(tabs) || [];
            const paths = allTabs
                .filter((t: any) => t && t.isfile && typeof t.path === 'string')
                .map((t: any) => t.path);
            
            // Report to backend
            invoke('hostbridge_update_tabs', {
                paths,
                active: currentPath,
                cursorLine: lineNumber,
                cursorColumn: columnNumber,
            }).catch(err => {
                console.warn('[Editor] Failed to report cursor position:', err);
            });
        }, 500);
    }

    async function handleKeyDown(e) {
        let key = e.code;
        switch(key) {
            case "ArrowRight": case "ArrowLeft": case "ArrowDown": case "ArrowUp":
                updateLineInfo();
        }
    }

    function shouldHandleEditorPaste(target: EventTarget | null): boolean {
        if (!editor || hidden) return false;
        const domNode = editor.getDomNode();
        if (!domNode) return false;
        let element = (target as HTMLElement | null) ?? (document.activeElement as HTMLElement | null);
        if (!element) return false;
        if (!domNode.contains(element)) return false;
        const tag = element.tagName;
        if (tag === "INPUT" || element.isContentEditable) {
            return false;
        }
        if (tag === "TEXTAREA") {
            return element.classList.contains("inputarea");
        }
        return true;
    }

    function handleWindowPaste(event: ClipboardEvent) {
        if (!shouldHandleEditorPaste(event.target)) {
            return;
        }
        event.preventDefault();
        // Monaco also listens for paste events; stop propagation so we don't paste twice.
        event.stopPropagation();
        (event as any).stopImmediatePropagation?.();
        void handlePaste();
    }
</script>
<script lang="ts" context="module">
    import { tabs } from "./EditorTabList.svelte";
    import { get, writable } from "svelte/store";
    import { is_dark_theme } from "../config/themehandler";

    export const line_info = writable({line: "-", column: "-"});
    export const language = writable("Unknown");
    export const encoding = writable({value: "UTF-8", hasBom: false});
    export const spaces = writable(4);
    export function setEditorFontSize(value: number) {
        for (const tab of get(tabs)) {
            if (tab.isfile) {
                tab.content.setFontSize(value);
            }
        }
    }
    export function setEditorFontFamily(family: string) {
        for (const tab of get(tabs)) {
            if (tab.isfile) {
                tab.content.setFontFamily(family);
            }
        }
    }
    export function setEditorLineHeight(height: string) {
        for (const tab of get(tabs)) {
            if (tab.isfile && typeof tab.content?.setLineHeightValue === "function") {
                tab.content.setLineHeightValue(height);
            }
        }
    }
    export function setEditorLetterSpacing(value: number) {
        for (const tab of get(tabs)) {
            if (tab.isfile && typeof tab.content?.setLetterSpacing === "function") {
                tab.content.setLetterSpacing(value);
            }
        }
    }
    export function setEditorTabSize(size) {
        for (const tab of get(tabs)) {
            if (tab.isfile && !(tab as any)?.isUnsupported) {
                tab.content.setTabSize(size);
            }
        }
    }
    export function setEditorLineWrapping(enabled: boolean) {
        for (const tab of get(tabs)) {
            if (tab.isfile && !(tab as any)?.isUnsupported && typeof tab.content?.setLineWrapping === "function") {
                tab.content.setLineWrapping(enabled);
            }
        }
    }
    export function setColorScheme() {
        for (const tab of get(tabs)) {
            if (tab.isfile && !(tab as any)?.isUnsupported) {
                try {
                    if (typeof tab.content?.setScheme === "function") {
                        tab.content.setScheme(get(is_dark_theme));
                    }
                } catch {}
            }
        }
    }
    export function setEditorTheme() {
        for (const tab of get(tabs)) {
            if (tab.isfile && !(tab as any)?.isUnsupported) {
                try {
                    if (typeof tab.content?.setTheme === "function") {
                        tab.content.setTheme();
                    }
                } catch {}
            }
        }
    }
</script>

<svelte:window on:paste|capture={handleWindowPaste} />
<div
    bind:this={ref}
    class="editor"
    class:hidden
    class:ready={editorReady}
    on:mousedown={() => updateLineInfo()}
    on:keydown={handleKeyDown}
    on:focusin={handleContainerFocus}
    on:contextmenu={handleContextMenu}
>
</div>

<style lang="scss">
    .editor {
        height: 100%;
        width: 100%;
        position: absolute;
        inset: 0;
        z-index: 0;
        opacity: 0;
        transition: opacity 60ms ease-out;

        :global(.monaco-editor),
        :global(.monaco-editor .overflow-guard) {
            height: 100%;
        }

        :global(.monaco-editor) {
            outline: none;
        }

        :global(.monaco-editor .margin) {
            min-width: calc(4ch + 12px);
        }

        :global(.monaco-editor .margin .line-numbers) {
            min-width: calc(4ch + 12px);
            padding: 0 6px;
            text-align: right;
        }

        :global(.monaco-editor .view-lines) {
            padding: 0 8px 200px 0;
        }

        :global(.monaco-editor .scroll-decoration) {
            box-shadow: none;
        }

        :global(.monaco-editor .decorationsOverviewRuler) {
            display: none;
        }
    }

    .hidden {
        visibility: hidden;
        pointer-events: none;
    }

    .ready {
        opacity: 1;
    }

    .editor:not(.hidden) {
        z-index: 1;
    }


</style>
