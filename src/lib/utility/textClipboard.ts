import { tick } from "svelte";
import { get as getStoreValue } from "svelte/store";
import { writeText, readText } from "@tauri-apps/plugin-clipboard-manager";
import { t } from "../i18n";
import { openContextMenu, type MenuItem } from "./contextMenuService";

type EditableElement = HTMLInputElement | HTMLTextAreaElement;

interface ClipboardControllerOptions {
    getValue: () => string;
    setValue: (value: string) => void;
    getElement: () => EditableElement | null | undefined;
    afterValueUpdate?: () => void;
    // Enable simple in-memory undo/redo for consumers that need
    // consistent behavior across platforms and custom editing flows.
    enableUndoRedo?: boolean;
    // Optional hook to customize paste behavior.
    // Return true if the paste was fully handled (no text fallback).
    onPaste?: () => Promise<boolean> | boolean;
    // If true, do not intercept Ctrl/Cmd+V; let the native paste event fire
    // so callers can process clipboardData (e.g., image blobs) in an on:paste handler.
    allowNativePasteFallback?: boolean;
}

export interface ClipboardController {
    handleKeyDown: (event: KeyboardEvent) => void;
    handleContextMenu: (event: MouseEvent) => void;
}

const isMacPlatform = typeof navigator !== "undefined" && /mac/i.test(navigator?.platform || "");

export function formatShortcutLabel(key: string) {
    return (isMacPlatform ? "Cmd+" : "Ctrl+") + key;
}

function isPrimaryModifier(event: KeyboardEvent): boolean {
    return event.metaKey || event.ctrlKey;
}

function getSelectionRange(element?: EditableElement | null) {
    if (!element) {
        return { start: 0, end: 0 };
    }
    const start = element.selectionStart ?? 0;
    const end = element.selectionEnd ?? start;
    return { start, end };
}

async function writeClipboard(text: string): Promise<boolean> {
    try {
        await writeText(text);
        return true;
    } catch (_) {
        try {
            if (navigator?.clipboard?.writeText) {
                await navigator.clipboard.writeText(text);
                return true;
            }
        } catch (_) {
            if (document.queryCommandSupported?.("copy")) {
                document.execCommand("copy");
                return true;
            }
        }
    }
    return false;
}

export async function copyPlainTextToClipboard(text: string): Promise<boolean> {
    return writeClipboard(text);
}

async function readClipboard(): Promise<string | null> {
    try {
        const text = await readText();
        if (typeof text === "string") {
            return text;
        }
    } catch (_) {
        try {
            if (navigator?.clipboard?.readText) {
                return await navigator.clipboard.readText();
            }
        } catch (_) {
            /* noop */
        }
    }
    return null;
}

export function createClipboardController(options: ClipboardControllerOptions): ClipboardController {
    const getElement = () => options.getElement() ?? null;
    const enableUndoRedo = Boolean(options.enableUndoRedo);
    const allowNativePasteFallback = Boolean(options.allowNativePasteFallback);

    type Snapshot = {
        value: string;
        start: number;
        end: number;
    };

    const history: Snapshot[] = [];
    let historyIndex = -1;

    function recordCurrentState(): void {
        if (!enableUndoRedo) return;
        const element = getElement();
        if (!element) return;
        const currentValue = options.getValue();
        const { start, end } = getSelectionRange(element);
        const snapshot: Snapshot = { value: currentValue, start, end };
        // Drop any redo branch when committing a new state
        if (historyIndex >= 0 && historyIndex < history.length - 1) {
            history.splice(historyIndex + 1);
        }
        history.push(snapshot);
        historyIndex = history.length - 1;
    }

    // Initialize with the starting state so the first edit is undoable.
    function ensureInitialState(): void {
        if (!enableUndoRedo) return;
        if (historyIndex >= 0) return;
        recordCurrentState();
    }

    async function restoreSnapshot(targetIndex: number): Promise<void> {
        if (!enableUndoRedo) return;
        if (targetIndex < 0 || targetIndex >= history.length) return;
        const element = getElement();
        if (!element) return;
        const snapshot = history[targetIndex];
        historyIndex = targetIndex;
        options.setValue(snapshot.value);
        await tick();
        try {
            element.setSelectionRange(snapshot.start, snapshot.end);
        } catch (_) {
            /* ignore */
        }
        options.afterValueUpdate?.();
    }

    async function undo(): Promise<void> {
        if (!enableUndoRedo) return;
        if (historyIndex <= 0) return;
        await restoreSnapshot(historyIndex - 1);
    }

    async function redo(): Promise<void> {
        if (!enableUndoRedo) return;
        if (historyIndex < 0 || historyIndex >= history.length - 1) return;
        await restoreSnapshot(historyIndex + 1);
    }

    async function replaceSelection(replacement: string, collapseToEnd = true) {
        const element = getElement();
        if (!element) return;
        ensureInitialState();
        const currentValue = options.getValue();
        const { start, end } = getSelectionRange(element);
        const before = currentValue.slice(0, start);
        const after = currentValue.slice(end);
        const nextValue = before + replacement + after;
        options.setValue(nextValue);
        await tick();
        const cursor = collapseToEnd ? start + replacement.length : start;
        try {
            element.setSelectionRange(cursor, cursor);
        } catch (_) {
            /* ignore */
        }
        options.afterValueUpdate?.();
        if (enableUndoRedo) {
            // Commit the post-edit state so undo/redo can navigate history.
            recordCurrentState();
        }
    }

    function getSelectedText(): string | null {
        const element = getElement();
        if (!element) return null;
        const { start, end } = getSelectionRange(element);
        if (start === end) return null;
        const currentValue = options.getValue();
        return currentValue.slice(start, end);
    }

    async function handleCutAction() {
        const selected = getSelectedText();
        if (!selected) return;
        const copied = await writeClipboard(selected);
        if (!copied) return;
        await replaceSelection("", false);
    }

    async function handleCopyAction() {
        const selected = getSelectedText();
        if (!selected) return;
        await writeClipboard(selected);
    }

    async function handlePasteAction() {
        if (options.onPaste) {
            try {
                const handled = await options.onPaste();
                if (handled) {
                    return;
                }
            } catch (_) {
                // fall through to text paste
            }
        }
        const text = await readClipboard();
        if (!text) return;
        await replaceSelection(text, true);
    }

    function buildMenuItems(): MenuItem[] {
        const translate = getStoreValue(t);
        const hasSelection = Boolean(getSelectedText());
        const canUndo = enableUndoRedo && historyIndex > 0;
        const canRedo = enableUndoRedo && historyIndex >= 0 && historyIndex < history.length - 1;
        return [
            {
                id: "clipboard-undo",
                name: translate("editorContext.undo"),
                shortcut: formatShortcutLabel("Z"),
                disabled: !canUndo,
                action: () => {
                    void undo();
                }
            },
            {
                id: "clipboard-redo",
                name: translate("editorContext.redo"),
                shortcut: isMacPlatform ? "Shift+Cmd+Z" : "Ctrl+Y",
                disabled: !canRedo,
                action: () => {
                    void redo();
                }
            },
            { type: "separator" },
            {
                id: "clipboard-cut",
                name: translate("editorContext.cut"),
                shortcut: formatShortcutLabel("X"),
                disabled: !hasSelection,
                action: () => { void handleCutAction(); }
            },
            {
                id: "clipboard-copy",
                name: translate("editorContext.copy"),
                shortcut: formatShortcutLabel("C"),
                disabled: !hasSelection,
                action: () => { void handleCopyAction(); }
            },
            {
                id: "clipboard-paste",
                name: translate("editorContext.paste"),
                shortcut: formatShortcutLabel("V"),
                action: () => { void handlePasteAction(); }
            }
        ];
    }

    function handleKeyDown(event: KeyboardEvent) {
        if (isPrimaryModifier(event) && !event.altKey) {
            const key = event.key.toLowerCase();
            // Undo / Redo
            if (enableUndoRedo && key === "z") {
                const canUndo = historyIndex > 0;
                const canRedo = historyIndex >= 0 && historyIndex < history.length - 1;
                const wantsRedo = event.shiftKey;
                // If we can't service undo/redo from our custom history, don't block the
                // browser/native undo stack (important for <input>/<textarea> typing).
                if ((wantsRedo && !canRedo) || (!wantsRedo && !canUndo)) {
                    return;
                }
                event.preventDefault();
                if (wantsRedo) void redo();
                else void undo();
                return;
            }
            // Select all
            if (key === "a") {
                const element = getElement();
                if (element) {
                    event.preventDefault();
                    const value = options.getValue();
                    const end = value.length;
                    try {
                        element.setSelectionRange(0, end);
                    } catch (_) {
                        /* ignore */
                    }
                }
                return;
            }
            // Cut / Copy / Paste
            if (key === "x" || key === "c" || key === "v") {
                if (key === "v" && allowNativePasteFallback) {
                    // Let native paste event run so clipboardData is available.
                    return;
                }
                event.preventDefault();
                if (key === "x") {
                    void handleCutAction();
                } else if (key === "c") {
                    void handleCopyAction();
                } else {
                    void handlePasteAction();
                }
                return;
            }
        }
    }

    function handleContextMenu(event: MouseEvent) {
        event.preventDefault();
        getElement()?.focus();
        openContextMenu(buildMenuItems(), event.clientX, event.clientY);
    }

    return { handleKeyDown, handleContextMenu };
}
