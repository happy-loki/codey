import { writable } from "svelte/store";
import { closeTabByPath } from "../EditorTabList.svelte";
import { recordWorkspaceRecent } from "../workspaceRecents";
import { getRootPath } from "../tree/normalizedStore";

export const DRAWIO_TAB_PATH = "drawio://workspace";

export type DrawioTarget =
    | { kind: "none" }
    | { kind: "file"; path: string; label?: string | null };

function normalizePath(raw: string | null | undefined): string {
    if (typeof raw !== "string") return "";
    return raw.trim();
}

export const drawioTarget = writable<DrawioTarget>({ kind: "none" });

export function clearDrawioTarget(): void {
    drawioTarget.set({ kind: "none" });
}

export function setDrawioFile(path: string, options: { label?: string | null } = {}): void {
    const normalized = normalizePath(path);
    if (!normalized) {
        clearDrawioTarget();
        return;
    }
    drawioTarget.set({
        kind: "file",
        path: normalized,
        label: options.label ?? null,
    });
    recordWorkspaceRecent("drawio", normalized, getRootPath());
    closeTabByPath(normalized, { force: true }).catch(() => {});
}

export function isDrawioPath(path: string | null | undefined): boolean {
    if (typeof path !== "string") return false;
    return path.trim().toLowerCase().endsWith(".drawio");
}
