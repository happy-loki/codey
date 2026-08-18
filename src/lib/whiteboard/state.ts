import { writable, get } from "svelte/store";
import { closeTabByPath } from "../EditorTabList.svelte";
import { canonicalPathKey, normalizeFsPath } from "../utils/pathNormalize";
import { recordWorkspaceRecent } from "../workspaceRecents";
import { getRootPath } from "../tree/normalizedStore";
import { animationTarget, ANIMATION_TAB_PATH, clearAnimationTargetIfMatch } from "../excalidrawAnimate/state";

export const WHITEBOARD_TAB_PATH = "whiteboard://default";

export type WhiteboardTarget =
    | { kind: "global"; label?: string | null }
    | { kind: "file"; path: string; label?: string | null };

function preferWorkspaceSeparator(path: string): string {
    if (!path) return "";
    const root = getRootPath();
    const prefersBackslash = root.includes("\\") || /^[a-zA-Z]:\\/.test(root);
    // Keep internal normalization for comparisons while matching the workspace style for display/state.
    return prefersBackslash ? path.replace(/\//g, "\\") : path;
}

function normalizePath(raw: string | null | undefined): string {
    const normalized = normalizeFsPath(raw);
    if (!normalized) return "";
    return preferWorkspaceSeparator(normalized);
}

export const whiteboardTarget = writable<WhiteboardTarget>({ kind: "global" });

export function setWhiteboardGlobal(label?: string | null) {
    whiteboardTarget.set({ kind: "global", label: label ?? null });
}

export function setWhiteboardFile(path: string, options: { label?: string | null } = {}) {
    const normalized = normalizePath(path);
    if (!normalized) {
        whiteboardTarget.set({ kind: "global" });
        return;
    }
    whiteboardTarget.set({
        kind: "file",
        path: normalized,
        label: options.label ?? null,
    });
    const animationInfo = get(animationTarget);
    const targetKey = canonicalPathKey(normalized);
    if (animationInfo?.kind === "file" && canonicalPathKey(animationInfo.path) === targetKey) {
        clearAnimationTargetIfMatch(animationInfo.path);
        closeTabByPath(ANIMATION_TAB_PATH, { force: true }).catch(() => {});
    }
    recordWorkspaceRecent("whiteboard", normalized, getRootPath());
    closeTabByPath(normalized, { force: true }).catch(() => {});
}

export function isExcalidrawPath(path: string | null | undefined): boolean {
    if (typeof path !== "string") return false;
    const normalized = path.trim().toLowerCase();
    return normalized.endsWith(".excalidraw");
}

const suppressedWhiteboardSaves = new Set<string>();

export function suppressWhiteboardSavesForPath(path: string | null | undefined) {
    const key = canonicalPathKey(path);
    if (!key) return;
    suppressedWhiteboardSaves.add(key);
}

export function resumeWhiteboardSavesForPath(path: string | null | undefined) {
    if (path === undefined) {
        suppressedWhiteboardSaves.clear();
        return;
    }
    const key = canonicalPathKey(path);
    if (!key) return;
    suppressedWhiteboardSaves.delete(key);
}

export function isWhiteboardSaveSuppressed(path: string | null | undefined): boolean {
    const key = canonicalPathKey(path);
    if (!key) return false;
    return suppressedWhiteboardSaves.has(key);
}
