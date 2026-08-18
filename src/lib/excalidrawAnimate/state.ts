import { writable, get } from "svelte/store";
import { closeTabByPath } from "../EditorTabList.svelte";
import { canonicalPathKey, normalizeFsPath } from "../utils/pathNormalize";
import { recordWorkspaceRecent } from "../workspaceRecents";
import { getRootPath } from "../tree/normalizedStore";
import { whiteboardTarget, WHITEBOARD_TAB_PATH, setWhiteboardGlobal } from "../whiteboard/state";

export const ANIMATION_TAB_PATH = "excalidraw-animation://default";

export type AnimationTarget =
    | { kind: "none" }
    | {
          kind: "file";
          path: string;
          label: string;
      };

export type AnimationPlaybackPrefs = {
    speed: number;
    loop: boolean;
};

const PREFS_STORAGE_KEY = "arthas:excalidrawAnimation:prefs";

function loadPrefs(): AnimationPlaybackPrefs {
    if (typeof window === "undefined") {
        return { speed: 1, loop: false };
    }
    try {
        const raw = window.localStorage.getItem(PREFS_STORAGE_KEY);
        if (!raw) return { speed: 1, loop: false };
        const parsed = JSON.parse(raw);
        const speed = typeof parsed?.speed === "number" && parsed.speed > 0 ? parsed.speed : 1;
        const loop = Boolean(parsed?.loop);
        return { speed, loop };
    } catch {
        return { speed: 1, loop: false };
    }
}

function savePrefs(prefs: AnimationPlaybackPrefs) {
    if (typeof window === "undefined") return;
    try {
        window.localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify(prefs));
    } catch {
        // ignore
    }
}

export const animationTarget = writable<AnimationTarget>({ kind: "none" });

export const animationPlaybackPrefs = writable<AnimationPlaybackPrefs>(loadPrefs());

animationPlaybackPrefs.subscribe((prefs) => {
    savePrefs(prefs);
});

export function setAnimationFile(path: string, options: { label?: string | null } = {}) {
    const normalized = normalizeFsPath(path);
    if (!normalized) {
        animationTarget.set({ kind: "none" });
        return;
    }
    const safeLabel = options.label?.trim() || normalized.split(/[/\\]/).pop() || normalized;
    animationTarget.set({ kind: "file", path: normalized, label: safeLabel });
    recordWorkspaceRecent("excalidraw-animation", normalized, getRootPath());
    // 如果白板已打开同一路径，先关闭以保持单实例
    const whiteboard = get(whiteboardTarget);
    const targetKey = canonicalPathKey(normalized);
    if (whiteboard?.kind === "file" && canonicalPathKey(whiteboard.path) === targetKey) {
        setWhiteboardGlobal();
        closeTabByPath(WHITEBOARD_TAB_PATH, { force: true }).catch(() => {});
    }
    closeTabByPath(normalized, { force: true }).catch(() => {});
}

export function clearAnimationTargetIfMatch(path: string | null | undefined) {
    const normalized = normalizeFsPath(path);
    if (!normalized) return;
    animationTarget.update((current) => {
        if (current.kind === "file" && current.path === normalized) {
            return { kind: "none" };
        }
        return current;
    });
}

export function resetAnimationTarget(): void {
    animationTarget.set({ kind: "none" });
}
