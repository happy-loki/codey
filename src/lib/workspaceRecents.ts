import { getRootPath } from "./tree/normalizedStore";
import { canonicalPathKey } from "./utils/pathNormalize";

export type WorkspaceModule = "whiteboard" | "drawio";

type WorkspaceRecentsStore = Record<string, Partial<Record<WorkspaceModule, string>>>;

const STORAGE_KEY = "codey.workspaceRecents.v1";
const GLOBAL_KEY = "__global__";

function hasLocalStorage(): boolean {
    return typeof localStorage !== "undefined";
}

function resolveWorkspacePath(workspaceOverride?: string | null): string {
    if (typeof workspaceOverride === "string" && workspaceOverride.trim()) {
        return workspaceOverride.trim();
    }
    const root = getRootPath();
    if (root && root.trim()) {
        return root.trim();
    }
    return "";
}

function getWorkspaceIdentifier(workspaceOverride?: string | null): string {
    const canonical = canonicalPathKey(resolveWorkspacePath(workspaceOverride));
    if (canonical) {
        return canonical;
    }
    return GLOBAL_KEY;
}

function readStore(): WorkspaceRecentsStore {
    if (!hasLocalStorage()) {
        return {};
    }
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) {
            return {};
        }
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object") {
            return parsed as WorkspaceRecentsStore;
        }
    } catch (err) {
        console.warn("Failed to parse workspace recents store", err);
    }
    return {};
}

function writeStore(store: WorkspaceRecentsStore): void {
    if (!hasLocalStorage()) {
        return;
    }
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
    } catch (err) {
        console.warn("Failed to persist workspace recents store", err);
    }
}

function isPathInsideWorkspace(path: string, workspaceOverride?: string | null): boolean {
    if (!path) {
        return false;
    }
    const workspaceKey = canonicalPathKey(resolveWorkspacePath(workspaceOverride));
    if (!workspaceKey) {
        return true;
    }
    const normalizedPath = canonicalPathKey(path);
    if (!normalizedPath) {
        return false;
    }
    if (normalizedPath === workspaceKey) {
        return true;
    }
    return normalizedPath.startsWith(`${workspaceKey}/`);
}

export function recordWorkspaceRecent(kind: WorkspaceModule, path: string, workspaceOverride?: string | null): void {
    if (!path || !hasLocalStorage()) {
        return;
    }
    const workspaceKey = getWorkspaceIdentifier(workspaceOverride);
    if (workspaceKey !== GLOBAL_KEY && !isPathInsideWorkspace(path, workspaceOverride)) {
        return;
    }
    const store = readStore();
    if (!store[workspaceKey]) {
        store[workspaceKey] = {};
    }
    store[workspaceKey]![kind] = path;
    writeStore(store);
}

export function getWorkspaceRecent(kind: WorkspaceModule, workspaceOverride?: string | null): string | null {
    if (!hasLocalStorage()) {
        return null;
    }
    const workspaceKey = getWorkspaceIdentifier(workspaceOverride);
    const entry = readStore()[workspaceKey]?.[kind];
    if (!entry) {
        return null;
    }
    if (workspaceKey !== GLOBAL_KEY && !isPathInsideWorkspace(entry, workspaceOverride)) {
        return null;
    }
    return entry;
}
