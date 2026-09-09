import { path } from "@tauri-apps/api";
import { invoke } from "@tauri-apps/api/core";
import { open, save, ask, confirm } from "@tauri-apps/plugin-dialog";
import { t } from "./i18n";
import { openConfirmModal } from "./utility/confirmModalStore";
import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";
import { openPath } from "@tauri-apps/plugin-opener";

import { get, writable } from "svelte/store";
import {
    tabs,
    addEditorTab,
    renameTab,
    closeTab,
    refreshTabs,
    closeAllTabs,
} from "./EditorTabList.svelte";
import { DRAWIO_TAB_PATH } from "./drawio/state";
import { activeInfo } from "./editorBus";
import { filetree } from "./FileTree.svelte";
import {
    initRoot,
    applyChildren,
    setExpandedByPath,
    getNodeByPath,
    applyRemove,
    applyRename,
    setSelectedPath,
    getRootPath,
    requestReveal,
    selectedPath as selectedTreePath,
    setNodeStatus,
    getChildrenEpoch,
    type FsEntry,
} from "./tree/normalizedStore";
// import { watchImmediate } from "tauri-plugin-fs-watch-api";
import { rename, exists, mkdir } from "@tauri-apps/plugin-fs";
import { openFileTree } from "./Sidebar.svelte";
// import { info, trace, warn, error } from "tauri-plugin-log-api";
import { info, trace, warn, error } from "@tauri-apps/plugin-log";
import { homeDir, join, sep as sepFunc } from "@tauri-apps/api/path";
const sep = sepFunc();
import { appSettings } from "../config/config";
import { closeBottomPanel } from "./Statusbar.svelte";
import { closeTerminal } from "./Terminal.svelte";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getMarkdownCssPath, refreshCustomCss } from "./markdown/styleStore";
import { canonicalPathKey, normalizeFsPath } from "./utils/pathNormalize";

const watchedScopes = new Set<string>();
let currentRootKey: string | null = null;

function fileBasename(p: string | null | undefined): string {
    if (typeof p !== "string") return "";
    const trimmed = p.trim();
    if (!trimmed) return "";
    return trimmed.split(/[\\/]/).filter(Boolean).pop() ?? "";
}

function directoryPrefixOf(p: string | null | undefined): string {
    if (typeof p !== "string") return "";
    const trimmed = p.trim();
    if (!trimmed) return "";
    const sepLocal = detectSeparator(trimmed);
    const idx = trimmed.lastIndexOf(sepLocal);
    if (idx < 0) return "";
    return trimmed.slice(0, idx + 1);
}

function normalizeWatchKey(path: string): string {
    if (typeof path !== "string") return "";
    let key = path.trim();
    if (!key) return "";
    key = key.replace(/\\/g, "/");
    if (key.length > 1) {
        key = key.replace(/\/+/g, "/");
        if (key.endsWith("/")) {
            key = key.replace(/\/+$/, "");
            if (key === "") key = "/";
        }
    }
    return key;
}

function requestWatchScope(path: string, watch: boolean) {
    const key = normalizeWatchKey(path);
    if (!key) return;
    if (!watch && currentRootKey && key === currentRootKey) {
        // 根目录始终保持监听，忽略关闭请求
        if (!watchedScopes.has(key)) {
            watchedScopes.add(key);
        }
        return;
    }
    if (watch) {
        if (watchedScopes.has(key)) return;
        watchedScopes.add(key);
    } else {
        if (!watchedScopes.has(key)) return;
        watchedScopes.delete(key);
    }
    void invoke("update_fs_watch_scope", { path, watch }).catch((err) => {
        if (watch) {
            watchedScopes.delete(key);
        } else {
            watchedScopes.add(key);
        }
        warn(
            `[fs_watch_scope] failed to ${
                watch ? "add" : "remove"
            } ${path}: ${err}`
        );
    });
}

function resetWatchScopes(rootPath: string) {
    watchedScopes.clear();
    currentRootKey = null;
    if (rootPath) {
        currentRootKey = normalizeWatchKey(rootPath) || null;
        requestWatchScope(rootPath, true);
    }
}

function dropWatchScope(path: string) {
    requestWatchScope(path, false);
}

function transferWatchScope(oldPath: string, newPath: string) {
    const oldKey = normalizeWatchKey(oldPath);
    if (!oldKey || !watchedScopes.has(oldKey)) return;
    requestWatchScope(oldPath, false);
    requestWatchScope(newPath, true);
}

export function syncWatchScope(path: string, expanded: boolean) {
    if (!path) return;
    requestWatchScope(path, expanded);
}

export function resetWatchScopeToRoot(rootPath: string) {
    resetWatchScopes(rootPath);
}

export function trimWatchScopesToRoot() {
    try {
        const root = get(workingDir);
        if (root) {
            resetWatchScopes(root);
        }
    } catch {}
}

export async function openFile() {
    let newPath = (await open()) as string;
    if (newPath === null) return;
    let filename = fileBasename(newPath);
    addEditorTab(newPath, filename);
}

function detectSeparator(p: string): string {
    if (p.includes("\\")) return "\\";
    return "/";
}

function parentPathOf(p: string): string | null {
    if (!p) return null;
    const sepLocal = detectSeparator(p);
    const idx = p.lastIndexOf(sepLocal);
    if (idx <= 0) return null;
    return p.slice(0, idx);
}

function pathInTreeStyle(targetPath: string, rootPath: string): string {
    if (!rootPath) return targetPath;
    const target = normalizeFsPath(targetPath);
    const root = normalizeFsPath(rootPath).replace(/\/+$/, "");
    const targetKey = canonicalPathKey(target);
    const rootKey = canonicalPathKey(root);
    if (!target || !root || !rootKey || targetKey === rootKey) {
        return targetKey === rootKey ? rootPath : targetPath;
    }
    if (!targetKey.startsWith(`${rootKey}/`)) return targetPath;

    const relative = target.slice(root.length).replace(/^\/+/, "");
    const separator = rootPath.includes("\\") ? "\\" : "/";
    return `${rootPath.replace(/[\\/]+$/, "")}${separator}${relative.replace(/\//g, separator)}`;
}

async function loadDirectorySnapshot(path: string) {
    const snapshotEpoch = getChildrenEpoch(path);
    const applyIfFresh = (entries: FsEntry[]) => {
        if (getChildrenEpoch(path) !== snapshotEpoch) {
            trace(`[snapshot] skip stale result for ${path}`);
            return;
        }
        applyChildren(path, entries);
    };
    try {
        const entries = (await invoke("list_children", {
            parentPath: path,
        })) as FsEntry[];
        applyIfFresh(entries);
    } catch (err) {
        try {
            applyIfFresh([]);
        } catch {}
    }
}

export async function revealInTreeView(targetPath: string) {
    if (typeof targetPath !== "string" || targetPath.trim() === "") {
        return;
    }
    const normalizedPath = targetPath.trim();
    if (normalizedPath.includes("://")) {
        return;
    }
    const workspaceRoot = getRootPath();
    const treeTargetPath =
        getNodeByPath(normalizedPath)?.path ??
        pathInTreeStyle(normalizedPath, workspaceRoot);
    try {
        openFileTree();
    } catch {}
    const directories: string[] = [];
    let targetNode = getNodeByPath(treeTargetPath);
    let current: string | null = targetNode?.isDirectory
        ? targetNode.path
        : parentPathOf(treeTargetPath);
    const guard = new Set<string>();
    while (current && !guard.has(current)) {
        guard.add(current);
        directories.push(current);
        if (workspaceRoot && canonicalPathKey(current) === canonicalPathKey(workspaceRoot)) {
            break;
        }
        const next = parentPathOf(current);
        if (!next || next === current) {
            break;
        }
        current = next;
    }
    directories.reverse();
    for (const dir of directories) {
        await loadDirectorySnapshot(dir);
        try {
            setExpandedByPath(dir, true);
        } catch {}
        requestWatchScope(dir, true);
    }
    // Directory snapshots may have introduced the target with the filesystem's
    // actual casing. Use that spelling for strict row selection/reveal matching.
    targetNode = getNodeByPath(treeTargetPath);
    const resolvedTreeTargetPath = targetNode?.path ?? treeTargetPath;
    const parent = targetNode?.isDirectory
        ? targetNode.path
        : parentPathOf(resolvedTreeTargetPath);
    if (parent && !directories.includes(parent)) {
        await loadDirectorySnapshot(parent);
        try {
            setExpandedByPath(parent, true);
        } catch {}
        requestWatchScope(parent, true);
    }
    try {
        setSelectedPath(resolvedTreeTargetPath);
    } catch {}
    requestReveal(resolvedTreeTargetPath);
}

export const workspaceName = writable("Untitled Workspace");
export const dirToLoad = writable("");
export const dirLoadFail = writable(false);
export const workingDir = writable(await homeDir());
// Active directory change version to guard against stale async updates
let currentDirVersion = 0;
// Unwatch function for the active directory watcher
let unwatchDir: null | (() => void) = null; // legacy; 将移除
let unlistenFsDiff: UnlistenFn | null = null;

// Tree rebuild single-flight scheduler (debounced, tailing execution)
type UpdateKind = "modify" | "structural";
const treeScheduler = {
    inProgress: false,
    scheduled: false,
    pendingType: null as UpdateKind | null,
    pendingRawTypes: new Set<string>() as Set<string>,
    timer: null as any,
    delay: 400,
    idleResetTimer: null as any,
    directory: "" as string,
    version: 0,
};

function classifyUpdateType(t?: string): UpdateKind {
    return t === "modify" ? "modify" : "structural";
}

function mergeUpdateKind(a: UpdateKind | null, b: UpdateKind): UpdateKind {
    if (a === "structural" || b === "structural") return "structural";
    return "modify";
}

function scheduleRun() {
    if (treeScheduler.timer) clearTimeout(treeScheduler.timer);
    if (treeScheduler.idleResetTimer)
        clearTimeout(treeScheduler.idleResetTimer);
    treeScheduler.timer = setTimeout(runRebuild, treeScheduler.delay);
    // If system stays quiet for 2s, reset delay to base
    treeScheduler.idleResetTimer = setTimeout(() => {
        treeScheduler.delay = 400;
    }, 2000);
}

export function requestTreeUpdate(
    updateType: string,
    directory: string,
    version: number
) {
    const kind = classifyUpdateType(updateType);
    treeScheduler.directory = directory;
    treeScheduler.version = version;
    treeScheduler.pendingType = mergeUpdateKind(
        treeScheduler.pendingType,
        kind
    );
    try {
        treeScheduler.pendingRawTypes.add(updateType || "unknown");
    } catch {}
    trace(
        `[tree-scheduler] request: type=${kind}, pending=${treeScheduler.pendingType}, inProgress=${treeScheduler.inProgress}, delay=${treeScheduler.delay} [File.ts]`
    );
    if (treeScheduler.inProgress) {
        treeScheduler.scheduled = true; // queue a follow-up run after current completes
        return;
    }
    scheduleRun();
}

async function runRebuild() {
    const pending = treeScheduler.pendingType;
    treeScheduler.pendingType = null;
    if (!pending) return;
    // pick a representative raw event type for UX/progress decisions
    const rawTypes = new Set(treeScheduler.pendingRawTypes);
    treeScheduler.pendingRawTypes.clear();
    const pickType = (): string => {
        const has = (x: string) => rawTypes.has(x);
        if (has("remove")) return "remove";
        if (has("create")) return "create";
        if (has("rename")) return "rename";
        if (has("modify")) return "modify";
        // fallback to structural
        return pending === "modify" ? "modify" : "structural";
    };
    const representative = pickType();

    if (pending === "modify" && representative === "modify") {
        info(`[tree-scheduler] skip rebuild for 'modify' [File.ts]`);
        // back off slightly while there is churn
        treeScheduler.delay = Math.min(treeScheduler.delay * 2, 1000);
        if (treeScheduler.scheduled || treeScheduler.pendingType) {
            treeScheduler.scheduled = false;
            scheduleRun();
        }
        return;
    }

    treeScheduler.inProgress = true;
    info(
        `[tree-scheduler] rebuild start (delay=${treeScheduler.delay}ms) [File.ts]`
    );
    try {
        await updateTree(
            treeScheduler.directory,
            representative,
            treeScheduler.version
        );
    } catch (e) {
        warn(`[-] rebuild failed: ${e} [File.ts]`);
    } finally {
        treeScheduler.inProgress = false;
        // exponential backoff while receiving frequent requests
        treeScheduler.delay = Math.min(treeScheduler.delay * 2, 1000);
        if (treeScheduler.scheduled || treeScheduler.pendingType) {
            treeScheduler.scheduled = false;
            scheduleRun();
        } else {
            if (treeScheduler.idleResetTimer)
                clearTimeout(treeScheduler.idleResetTimer);
            treeScheduler.idleResetTimer = setTimeout(() => {
                treeScheduler.delay = 400;
            }, 2000);
        }
        info(`[tree-scheduler] rebuild end [File.ts]`);
    }
}

async function confirmInterruptActiveThreadBeforeOpenWorkspace(): Promise<boolean> {
    try {
        const guard = await invoke<{
            requiresConfirmation?: boolean;
            threadId?: string | null;
            turnId?: string | null;
        }>("codex_interrupt_guard_state");
        if (!guard?.requiresConfirmation) {
            return true;
        }
        const translate = get(t);
        const ok = await openConfirmModal({
            title: translate("dialogs.openFolderConfirmTitle"),
            message: translate("dialogs.openFolderConfirmMessage"),
            cancelLabel: translate("dialogs.openFolderConfirmCancel"),
            confirmLabel: translate("dialogs.openFolderConfirmConfirm"),
            confirmStyle: "danger",
        });
        return ok;
    } catch (error) {
        warn(
            `[workspace-open] failed to query codex interrupt guard: ${error}`
        );
        return true;
    }
}

export async function openFolderDialog() {
    dirLoadFail.set(false);
    let directory = (await open({ directory: true })) as string;
    if (!directory) return;
    const ok = await confirmInterruptActiveThreadBeforeOpenWorkspace();
    if (!ok) return;
    dirLoadFail.set(false);
    info(`Opening folder in: ${directory} [File.ts:25]`);
    localStorage.setItem("lastDir", directory);
    closeBottomPanel();
    closeTerminal();
    closeAllTabs();
    loadDir(directory);
    saveToRecent(directory);
}

export async function openFolder(directory) {
    const ok = await confirmInterruptActiveThreadBeforeOpenWorkspace();
    if (!ok) return;
    dirLoadFail.set(false);
    info(`Opening folder in: ${directory} [File.ts:25]`);
    localStorage.setItem("lastDir", directory);
    closeBottomPanel();
    closeTerminal();
    closeAllTabs();
    loadDir(directory);
    saveToRecent(directory);
}

export async function loadDir(directory) {
    if (!directory) {
        warn("Directory path is null. Aborting... [File.ts:30]");
        return;
    }
    // Bump version and cancel any previous watchers/updaters
    const prevVersion = currentDirVersion;
    currentDirVersion++;
    const version = currentDirVersion;

    // Update workspace state as early as possible so any consumers (Codex thread list scope, etc.)
    // see the new cwd immediately, even if cleanup below takes time.
    resetWatchScopes("");
    dirToLoad.set(directory.split(sep).pop());
    workingDir.set(directory);
    try {
        await invoke("set_workspace_dir", { path: directory });
    } catch {}

    if (unwatchDir) {
        try {
            unwatchDir();
        } catch {}
        unwatchDir = null;
    }
    if (unlistenFsDiff) {
        try {
            await unlistenFsDiff();
        } catch {}
        unlistenFsDiff = null;
    }
    try {
        if (prevVersion > 0)
            await invoke("stop_fs_indexer", { version: prevVersion });
    } catch {}

    // if file path is not in the configured scope already, add it
    // TODO: should configure this so it doesnt access restricted paths based on user permissions
    await invoke("attempt_file_access", {
        app_handle: getCurrentWebviewWindow(),
        p: directory,
    });
    openFileTree();

    // Initial full build to render first paint
    const directoryName = await updateTree(directory, "", version);
    if (!directoryName) {
        // Clear workspace state if load failed
        try {
            await invoke("set_workspace_dir", { path: null });
        } catch {}
        return;
    }
    // 启动 Rust 索引器并监听 diff（不再使用 JS watcher）
    try {
        await invoke("start_fs_indexer", { root: directory, version });
    } catch (e) {
        warn(`[fs_indexer] 启动失败: ${e}`);
    }
    resetWatchScopes(directory);
    if (unlistenFsDiff) {
        try {
            await unlistenFsDiff();
        } catch {}
        unlistenFsDiff = null;
    }
    // 前端侧合并批处理：将同一 parentPath 的 UpsertChildren 合并为“取最后一次”，并与 Remove/Rename 一起在 120ms 内批量应用
    const upsertBuffer = new Map<string, FsEntry[]>();
    let removeQueue: string[] = [];
    let renameQueue: Array<{
        oldPath: string;
        newPath: string;
        newName: string;
    }> = [];
    let flushTimer: any = null;
    const flushNow = () => {
        // 应用顺序：rename → remove → upsert（upsert 是目录快照，放最后覆盖最可靠）
        if (renameQueue.length) {
            for (const r of renameQueue) {
                try {
                    applyRename(r.oldPath, r.newPath, r.newName);
                } catch {}
            }
            renameQueue = [];
        }
        if (removeQueue.length) {
            for (const p of removeQueue) {
                cancelDeletionMonitor(p);
                try {
                    applyRemove(p);
                } catch {}
                trace(`[flushNow] 已删除节点: ${p}`);
            }
            removeQueue = [];
            // 不需要主动刷新父目录，Rust 端的 notify 会自动发送 UpsertChildren 事件
        }
        if (upsertBuffer.size) {
            for (const [parent, entries] of upsertBuffer.entries()) {
                try {
                    applyChildren(parent, entries);
                } catch {}
            }
            upsertBuffer.clear();
        }
    };
    const scheduleFlush = (delay = 200) => {
        if (flushTimer) return;
        flushTimer = setTimeout(() => {
            flushTimer = null;
            flushNow();
        }, delay);
    };

    unlistenFsDiff = await listen("fs_diff", (ev: any) => {
        const p = ev.payload || {};
        if (p.version !== currentDirVersion) return; // 版本不符，丢弃
        const kind: string = String(p.kind || "");
        switch (kind) {
            case "UpsertChildren":
            case "upsertChildren": {
                const parent = p.parentPath as string;
                const entries = (p.entries || []) as FsEntry[];
                trace(
                    `[fs_diff] UpsertChildren: parent=${parent}, entries=${entries.length}`
                );
                upsertBuffer.set(parent, entries);
                scheduleFlush(120);
                break;
            }
            case "RemovePaths":
            case "removePaths": {
                const entries = Array.isArray(p.paths) ? p.paths : [];
                trace(
                    `[fs_diff] RemovePaths: 收到 ${entries.length} 个删除条目`
                );
                const matched: string[] = [];
                for (const entry of entries) {
                    if (!entry || typeof entry.path !== "string") continue;
                    const target = entry.path;
                    const fp =
                        typeof entry.fingerprint === "string"
                            ? entry.fingerprint
                            : null;
                    if (shouldApplyRemoval(target, fp)) {
                        matched.push(target);
                        trace(`[fs_diff] RemovePaths: 匹配删除 ${target}`);
                    } else {
                        trace(
                            `[fs_diff] RemovePaths: 跳过删除 ${target} (指纹不匹配)`
                        );
                    }
                }
                if (matched.length) {
                    removeQueue.push(...matched);
                    for (const target of matched) {
                        dropWatchScope(target);
                    }
                    scheduleFlush(60);
                }
                break;
            }
            case "RenamePath":
            case "renamePath": {
                renameQueue.push({
                    oldPath: p.oldPath,
                    newPath: p.newPath,
                    newName: p.newName,
                });
                if (
                    typeof p.oldPath === "string" &&
                    typeof p.newPath === "string"
                ) {
                    transferWatchScope(p.oldPath, p.newPath);
                }
                scheduleFlush(120);
                break;
            }
            case "EndInitial":
            case "endInitial":
            case "Checkpoint":
            case "checkpoint": {
                // 里程碑到达时尽快刷新当前队列
                if (flushTimer) {
                    clearTimeout(flushTimer);
                    flushTimer = null;
                }
                flushNow();
                break;
            }
            default:
                break;
        }
    });

    workspaceName.set(directoryName);
}

export const treeLoading = writable(false);
let progressTimeout = null;
let loadInterval = null;
let delayedRefreshTimer: any = null;
// track a pending cut source (for Cut → Paste move semantics)
let cutSourcePath: string | null = null;
async function updateTree(
    directory,
    updateType = "",
    expectedVersion?: number
) {
    let loadTime = 0;

    clearTimeout(progressTimeout);
    clearInterval(loadInterval);

    // If a new directory load started, abandon this update early (before toggling loading state)
    if (
        expectedVersion !== undefined &&
        expectedVersion !== currentDirVersion
    ) {
        trace(
            `[updateTree] abort due to version change (expected=${expectedVersion}, current=${currentDirVersion}) [File.ts]`
        );
        return null;
    }

    // dont show directory loading bar for simple file changes (modify/create/remove)
    if (
        updateType !== "modify" &&
        updateType !== "create" &&
        updateType !== "remove"
    ) {
        treeLoading.set(true);
        loadInterval = setInterval(() => {
            loadTime++;
        }, 1000);
    }

    // 仅修改事件不触发重建
    const quickDirectoryName = get(dirToLoad);
    if (updateType === "modify") {
        trace(`[updateTree] skip (modify) for: ${quickDirectoryName}`);
        return quickDirectoryName;
    }

    let tree;
    try {
        tree = (await invoke("list_children", {
            parentPath: directory,
        })) as FsEntry[];
    } catch (e) {
        error(`Cannot load directory: ${directory}. Error: ${e} [File.ts:73]`);
        cancelDirectoryLoad("Cannot load directory");
        return null;
    }
    if (!tree || tree === undefined) {
        error(
            `Cannot load directory: ${directory}. Directory is empty or inaccessible. [File.ts:73]`
        );
        cancelDirectoryLoad("Cannot load directory");
        return null;
    }

    if (loadTime > 100) {
        warn("Directory load time was too long. Aborting... [File.ts:79]");
        trace(
            `Cancelled directory load after ${loadTime} seconds. Directory: ${tree} [File.ts]`
        );

        cancelDirectoryLoad("Error: Directory load timeout.");
        return null;
    }

    let directoryName = get(dirToLoad);

    // 使用新的懒加载策略：初始只加载3层
    trace(`[updateTree] 开始构建目录树: ${directoryName}`);
    // Guard again in case version changed during async operations
    if (
        expectedVersion !== undefined &&
        expectedVersion !== currentDirVersion
    ) {
        trace(
            `[updateTree] abort mid-run due to version change (expected=${expectedVersion}, current=${currentDirVersion}) [File.ts]`
        );
        treeLoading.set(false);
        return null;
    }
    // 规范化模型：初始化根并仅填充首层子项，避免大数组渲染
    if (
        expectedVersion !== undefined &&
        expectedVersion !== currentDirVersion
    ) {
        return null;
    }
    initRoot(directoryName, directory);
    applyChildren(directory, sortTree(tree));
    // 为兼容旧的 FileTree.svelte 判空逻辑，设置一个轻量根节点占位
    const rootPlaceholder: TreeNode[] = [
        {
            id: -1,
            name: directoryName,
            path: directory,
            children: [],
            isDirectory: true,
            isLoaded: true,
            hasChildren: true,
        },
    ];
    filetree.set(rootPlaceholder);
    clearInterval(loadInterval);

    //TODO: move this to a log file
    if (updateType !== "modify") {
        if (loadTime < 45) {
            trace(
                `Directory load time: ${
                    loadTime < 1 ? "less than 1" : loadTime
                }s [File.ts]`
            );
        }
    }
    // 保持全局节点 id 单调递增，避免懒加载/后台更新后出现重复 id
    // id = 0;
    treeLoading.set(false);
    trace(
        `[updateTree] 目录树构建完成(规范化): ${directoryName}, 首层子项: ${
            (tree || []).length
        }`
    );
    return directoryName;
}

// 你的 UI 节点类型
type TreeNode = {
    id: number;
    name: string;
    path: string;
    children?: TreeNode[];
    isDirectory?: boolean;
    isLoaded?: boolean;
    hasChildren?: boolean;
    fingerprint?: string | null;
    status?: "normal" | "deleting";
};

// 目录优先 + 自然序名称排序
function sortTree(entries: FsEntry[]): FsEntry[] {
    return [...entries].sort((a, b) => {
        if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
        return a.name.localeCompare(b.name, undefined, {
            numeric: true,
            sensitivity: "base",
        });
    });
}

export async function expandNode(node: TreeNode): Promise<void> {
    // 改为作用于规范化存储：按路径加载子项，并自动展开
    const targetPath = (node as any).path;
    const targetName = (node as any).name;
    const isDir = (node as any).isDirectory ?? true;
    if (!isDir) return;
    trace(`[expandNode] 展开节点(规范化): ${targetName}`);
    try {
        const entries = (await invoke("list_children", {
            parentPath: targetPath,
        })) as FsEntry[];
        applyChildren(targetPath, entries);
        setExpandedByPath(targetPath, true);
        requestWatchScope(targetPath, true);
    } catch (err) {
        warn(`[expandNode] 展开失败: ${targetName} - ${err}`);
        // 标记为已加载但无子项（通过 applyChildren 空数组实现）
        applyChildren(targetPath, []);
        setExpandedByPath(targetPath, true);
        requestWatchScope(targetPath, true);
    }
}

type DeletionMonitor = {
    cancel: () => void;
};

const deletionMonitors = new Map<string, DeletionMonitor>();

function refreshParentSnapshot(path: string | null | undefined) {
    if (!path) return;
    const parent = parentPathOf(path);
    if (!parent) return;
    void loadDirectorySnapshot(parent)
        .then(() => {
            try {
                requestWatchScope(parent, true);
            } catch {}
        })
        .catch(() => {});
}

function cancelDeletionMonitor(path: string) {
    const monitor = deletionMonitors.get(path);
    if (monitor) {
        try {
            monitor.cancel();
        } catch {}
        deletionMonitors.delete(path);
    }
}

function startDeletionMonitor(path: string, fingerprint: string | null) {
    if (!path || deletionMonitors.has(path)) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;
    const startedAt = Date.now();
    const maxWait = 30_000;
    const interval = 1_200;

    const cleanup = () => {
        cancelled = true;
        if (timer) clearTimeout(timer);
        deletionMonitors.delete(path);
    };

    const schedule = () => {
        if (cancelled) return;
        timer = setTimeout(() => {
            void poll();
        }, interval);
    };

    const poll = async () => {
        if (cancelled) return;
        const node = getNodeByPath(path);
        if (!node) {
            cleanup();
            refreshParentSnapshot(path);
            return;
        }
        if (
            fingerprint &&
            node.fingerprint &&
            node.fingerprint !== fingerprint
        ) {
            setNodeStatus(path, null);
            cleanup();
            refreshParentSnapshot(path);
            return;
        }
        if (node.status !== "deleting") {
            cleanup();
            refreshParentSnapshot(path);
            return;
        }
        let stillExists = true;
        try {
            stillExists = await exists(path);
        } catch {
            stillExists = false;
        }
        if (!stillExists) {
            try {
                applyRemove(path);
            } catch {}
            try {
                requestTreeUpdate("remove", get(workingDir), currentDirVersion);
            } catch {}
            setNodeStatus(path, null);
            cleanup();
            refreshParentSnapshot(path);
            return;
        }
        if (Date.now() - startedAt > maxWait) {
            setNodeStatus(path, null);
            cleanup();
            refreshParentSnapshot(path);
            return;
        }
        schedule();
    };

    deletionMonitors.set(path, { cancel: cleanup });
    schedule();
}

export function cancelDirectoryLoad(msg: string) {
    clearInterval(loadInterval);

    dirLoadFail.set(true);
    dirToLoad.set(msg);
    progressTimeout = setTimeout(() => {
        treeLoading.set(false);
    }, 5000);
}

export async function moveFile(source: string, dest: string, file: string) {
    if (file === dest) {
        return;
    }
    const filename = file.split(sep).pop();
    if (
        !(await confirm(
            `Are you sure you want to move "${filename}" from "./${source
                .split(sep)
                .pop()}" into "./${dest.split(sep).pop()}?"`,
            { title: "Codey: Move File" }
        ))
    ) {
        return;
    }

    try {
        await rename(file, `${dest}${sep}${filename}`);
        const tab = get(tabs).find(
            (t) => t.path === `${source}${sep}${filename}`
        );
        if (tab === undefined) return;
        tab.path = `${dest}${sep}${filename}`;
        refreshTabs();
    } catch (e) {
        error(`Cannot move ${file} into ${dest}. Error: ${e} [File.ts:159]`);
    }
}

export async function saveFile(saveAs = false) {
    const allTabs = get(tabs);
    const activeDrawioTab = allTabs.find(
        (t) => t?.active && t?.path === DRAWIO_TAB_PATH
    );
    if (
        activeDrawioTab &&
        typeof activeDrawioTab.content?.triggerSave === "function"
    ) {
        try {
            await activeDrawioTab.content.triggerSave();
        } catch (err) {
            console.warn("Drawio save failed", err);
        }
        return;
    }

    const tab = allTabs.find((t) => t.active && t.isfile);
    if (!tab) {
        return;
    }
    const info =
        typeof tab.content?.getFileInfo === "function"
            ? tab.content.getFileInfo()
            : null;
    if (info && (info as any).readonly) {
        return;
    }
    if (
        typeof tab.content?.getFileContent !== "function" ||
        typeof tab.content?.getEncoding !== "function" ||
        typeof tab.content?.hasBom !== "function"
    ) {
        return;
    }
    const currentPath = typeof tab.path === "string" ? tab.path : "";
    // Prefer the editor's own file info path when available; some flows may temporarily
    // desync `tab.path` (e.g., separator normalization), and we should not pop Save As
    // if we can determine a real file path.
    const infoPathRaw =
        typeof (info as any)?.path === "string"
            ? String((info as any).path)
            : "";
    const infoFilenameRaw =
        typeof (info as any)?.filename === "string"
            ? String((info as any).filename)
            : "";
    const infoPath = infoPathRaw.trim();
    const infoFilename = infoFilenameRaw.trim();
    const resolvedPath =
        infoPath && infoPath !== infoFilename ? infoPath : currentPath;
    // `tab.path` may use either `\` or `/` separators (e.g. canonicalized paths on Windows),
    // so checking only the platform separator can incorrectly treat real file paths as "unsaved",
    // which would pop a Save As dialog on every autosave tick.
    const hasDirectory = /[\\/]/.test(resolvedPath);
    if (!hasDirectory || resolvedPath === "" || saveAs) {
        let newPath = await save({ defaultPath: `${tab.label}.txt` });
        if (newPath === null) return;

        tab.path = newPath;
        tab.label = fileBasename(newPath);
    } else if (resolvedPath && resolvedPath !== currentPath) {
        tab.path = resolvedPath;
    }
    const contentSnapshot = tab.content.getFileContent();
    if (typeof tab.content.registerLocalSaveSnapshot === "function") {
        try {
            tab.content.registerLocalSaveSnapshot(contentSnapshot);
        } catch (err) {
            console.warn("registerLocalSaveSnapshot failed", err);
        }
    }
    // write changes to the file
    await invoke("write_file", {
        path: tab.path,
        content: contentSnapshot,
        enc: tab.content.getEncoding(),
        hasBom: tab.content.hasBom(),
    });
    try {
        const markdownCssPath = await getMarkdownCssPath();
        if (markdownCssPath && tab.path === markdownCssPath) {
            refreshCustomCss();
        }
    } catch {}
    const fileType = await path.extname(tab.path);
    tab.content.updateFileInfo({
        filename: tab.label,
        path: tab.path,
        fileType: fileType,
        encoding: tab.content.getEncoding(),
        hasBom: tab.content.hasBom(),
        language: await tab.content.getLang(fileType),
        readonly: false,
    });
    tab.setActive(tab.id);
    updateSaveState(true);
}

export function updateSaveState(saved = true) {
    // Prefer active file tab, but guard if none is active (e.g., diff tab active
    // while background editor updates via setExternalContent).
    const tab = get(tabs).find((t) => t.active && t.isfile);
    if (!tab) {
        return; // nothing to update; avoid throwing when no active file tab
    }
    if (saved) {
        tab.saved = true;
        return; // prevents this being fired on every state check
    }
    tab.saved = false;
    tab.setActive(tab.id);
}

export async function openInExplorer(path: string) {
    const targetPath = (path || "").trim();
    if (!targetPath) return;
    trace(`Opening ${targetPath} in system explorer... [File.ts]`);
    try {
        const isFile = await invoke<boolean>("is_file", { path: targetPath });
        if (isFile) {
            try {
                await invoke("reveal_in_file_manager", { path: targetPath });
                return;
            } catch (revealErr) {
                warn(
                    `Native reveal failed for ${targetPath}: ${revealErr} [File.ts]`
                );
            }
            const parentDir = parentDirectoryOf(targetPath);
            if (parentDir) {
                await openPath(parentDir);
            }
            return;
        }
        await openPath(targetPath);
    } catch (err) {
        warn(`Failed to open ${targetPath} in explorer: ${err} [File.ts]`);
    }
}

export async function moveToTrash(p: string) {
    const name = p.split(sep).pop();
    if (!(await ask(`Are you sure you want to delete ${name}?`))) return;
    const node = getNodeByPath(p);
    const fingerprint = node?.fingerprint ?? null;
    try {
        setNodeStatus(p, "deleting");
    } catch {}
    startDeletionMonitor(p, fingerprint);

    // Start deletion in background; don't await to avoid UI jank
    invoke("delete_file", { path: p, perm: false, fingerprint }).catch((e) => {
        error(`Cannot remove ${p}. Error: ${e} [File.ts:moveToTrash]`);
        cancelDeletionMonitor(p);
        try {
            setNodeStatus(p, null);
        } catch {}
    });

    // Close any open editor tab for this file
    const tab = get(tabs).find((t) => t.path === p);
    if (tab) closeTab(tab.id);
}

function shouldApplyRemoval(
    targetPath: string,
    fingerprint: string | null
): boolean {
    try {
        const node = getNodeByPath(targetPath);
        if (!node) {
            cancelDeletionMonitor(targetPath);
            return true;
        }
        const nodeFp = node.fingerprint ?? null;
        const hasPayloadFp =
            typeof fingerprint === "string" && fingerprint.length > 0;
        const hasNodeFp = typeof nodeFp === "string" && nodeFp.length > 0;

        if (hasPayloadFp && hasNodeFp && nodeFp !== fingerprint) {
            cancelDeletionMonitor(targetPath);
            setNodeStatus(targetPath, null);
            refreshParentSnapshot(targetPath);
            try {
                requestTreeUpdate("create", get(workingDir), currentDirVersion);
            } catch {}
            return false;
        }

        if ((!hasPayloadFp || !hasNodeFp) && node.status !== "deleting") {
            cancelDeletionMonitor(targetPath);
            setNodeStatus(targetPath, null);
            refreshParentSnapshot(targetPath);
            return false;
        }

        cancelDeletionMonitor(targetPath);
        return true;
    } catch {
        cancelDeletionMonitor(targetPath);
        return true;
    }
}

export async function createFolder(p) {
    try {
        await mkdir(p);
    } catch (e) {
        error(`Cannot create folder in path ${p}. Error: ${e} [File.ts:216]`);
    }
}
function formatTimestampForFilename(date: Date): string {
    const pad = (value: number, size = 2) =>
        value.toString().padStart(size, "0");
    const ms = Math.floor(date.getMilliseconds() / 10); // 前两位毫秒
    return [
        pad(date.getFullYear(), 4),
        pad(date.getMonth() + 1),
        pad(date.getDate()),
        pad(date.getHours()),
        pad(date.getMinutes()),
        pad(date.getSeconds()),
        pad(ms),
    ].join("");
}

function parentDirectoryOf(pathStr: string | null | undefined): string | null {
    if (!pathStr) return null;
    const normalized = pathStr.trim();
    if (normalized === "") return null;
    const sepLocal = normalized.includes("\\") ? "\\" : "/";
    const idx = normalized.lastIndexOf(sepLocal);
    if (idx <= 0) return null;
    return normalized.slice(0, idx);
}

function isDirectoryPath(pathStr: string | null | undefined): boolean {
    if (!pathStr || pathStr.trim() === "") return false;
    try {
        const node = getNodeByPath(pathStr);
        return !!node?.isDirectory;
    } catch {
        return false;
    }
}

async function resolveNewFileDirectory(): Promise<string> {
    const active = get(activeInfo);
    const selected = get(selectedTreePath);
    const workspace = get(workingDir) ?? "";

    const candidates: (string | null | undefined)[] = [
        parentDirectoryOf(active?.path),
        isDirectoryPath(selected) ? selected : parentDirectoryOf(selected),
        workspace,
    ];

    for (const candidate of candidates) {
        if (typeof candidate === "string" && candidate.trim() !== "") {
            return candidate;
        }
    }
    return workspace;
}

async function ensureUniqueFilePath(
    directory: string,
    baseName: string,
    extension: string
): Promise<string> {
    let name = `${baseName}${extension}`;
    let attempt = 1;
    while (await exists(await join(directory, name))) {
        name = `${baseName}_${attempt}${extension}`;
        attempt++;
    }
    return await join(directory, name);
}

export async function createTimestampedNewFile() {
    try {
        const directory = await resolveNewFileDirectory();
        const timestamp = formatTimestampForFilename(new Date());
        const baseName = `${timestamp}_newfile`;
        const extension = ".md";
        const fullPath = await ensureUniqueFilePath(
            directory,
            baseName,
            extension
        );
        await createFile(fullPath);
        try {
            await revealInTreeView(fullPath);
        } catch {}
    } catch (err) {
        error(
            `Cannot create timestamped file. Error: ${err} [File.ts:newFile]`
        );
    }
}

export async function createFile(p) {
    try {
        await invoke("write_file", {
            path: p,
            content: "",
            enc: "UTF-8",
            hasBom: false,
        });
        try {
            setSelectedPath(p);
        } catch {}
        try {
            requestReveal(p);
        } catch {}
        try {
            requestTreeUpdate("create", get(workingDir), currentDirVersion);
        } catch {}
    } catch (e) {
        error(`Cannot create file in path ${p}. Error: ${e} [File.ts:223]`);
    }
    addEditorTab(p, fileBasename(p));
}

export async function renameFile(filename: string, oldpath: string) {
    let isFile = false;
    if (filename.length === 0) {
        warn("Cannot rename file with length 0 [File.ts:230]");
        return false;
    }
    isFile = await invoke("is_file", { path: oldpath });
    // Reject path separators in filename regardless of platform separator, otherwise
    // we can end up generating an invalid `newpath` and breaking subsequent autosaves.
    if (isFile && /[\\/]/.test(filename)) {
        warn("Cannot rename from invalid file name [File.ts:234]");
        return false;
    }
    const newpath = `${directoryPrefixOf(oldpath)}${filename}`;
    try {
        // use @tauri-apps/plugin-fs rename to avoid recursive call
        await rename(oldpath, newpath);
    } catch (e) {
        error(`Cannot rename ${oldpath}. Error: ${e} [File.ts:242]`);
        return false;
    }
    // 乐观更新规范化存储
    try {
        applyRename(oldpath, newpath, filename);
    } catch {}
    if (isFile) {
        let tab = get(tabs).find(
            (t) => t.active && t.isfile && t.path === oldpath
        );
        if (
            tab &&
            tab.content &&
            typeof tab.content.updateFileInfo === "function"
        ) {
            renameTab(tab, filename, newpath);
            try {
                const fileType = await path.extname(newpath);
                const language = await tab.content.getLang(fileType);
                const info =
                    typeof tab.content.getFileInfo === "function"
                        ? tab.content.getFileInfo()
                        : null;
                const encoding =
                    typeof tab.content.getEncoding === "function"
                        ? tab.content.getEncoding()
                        : info?.encoding ?? "UTF-8";
                const hasBomFlag =
                    typeof tab.content.hasBom === "function"
                        ? tab.content.hasBom()
                        : info?.hasBom ?? false;
                const spaces =
                    typeof tab.content.getSpaces === "function"
                        ? tab.content.getSpaces()
                        : typeof info?.spaces === "number"
                        ? info.spaces
                        : 4;
                const readonly = Boolean((info as any)?.readonly);
                const nextInfo = {
                    filename: filename,
                    path: newpath,
                    fileType: fileType,
                    language: language,
                    encoding: encoding,
                    hasBom: hasBomFlag,
                    spaces: spaces,
                    readonly: readonly,
                } as const;
                tab.content.updateFileInfo(nextInfo);
                try {
                    const updated =
                        typeof tab.content.getFileInfo === "function"
                            ? tab.content.getFileInfo()
                            : nextInfo;
                    activeInfo.set(updated as any);
                } catch {}
            } catch (e) {
                warn(
                    `Failed to refresh editor metadata after rename: ${e} [File.ts:236]`
                );
            }
        }
        return true;
    }
    const oldPrefix = `${oldpath}${detectSeparator(oldpath)}`;
    let openTabs = get(tabs).filter(
        (t) => typeof t?.path === "string" && t.path.startsWith(oldPrefix)
    );
    for (const tab of openTabs) {
        tab.path = `${newpath}${detectSeparator(newpath)}${tab.label}`;
    }
    refreshTabs();
    return true;
}

export async function readFile(path) {
    const settings = await appSettings;
    const editorConfig: any = await settings.get("editor");
    const defaultTabSize = (() => {
        const value = editorConfig?.tabSize;
        if (typeof value === "number" && Number.isFinite(value)) return value;
        const numeric = Number(value);
        return Number.isFinite(numeric) ? numeric : 4;
    })();
    let fileData = {
        text: "",
        encoding: "UTF-8",
        extension: "",
        bom: false,
        spaces: defaultTabSize,
    };
    try {
        fileData = await invoke("read_file", { path: path });
        if (fileData.spaces === 0) {
            fileData.spaces = defaultTabSize;
        }
    } catch (error) {
        warn(
            `Can't read file content in ${path}. Setting to empty string. Error: ${error}`,
            { file: "Tab.ts", line: 79 }
        );
    }
    return fileData;
}

export async function pasteFile(dest) {
    const copied = await readText();
    const filename = fileBasename(copied);
    const destSep = detectSeparator(dest || "");
    let newpath = `${dest}${destSep}${filename}`;
    if (!(await exists(copied)) || (await exists(newpath))) return;
    // If user used Cut earlier, move instead of copy
    if (cutSourcePath && cutSourcePath === copied) {
        try {
            const srcDir = directoryPrefixOf(copied).replace(/[\\/]+$/, "");
            await moveFile(srcDir, dest, copied); // (sourceDir, destDir, filePath)
        } finally {
            cutSourcePath = null;
        }
        try {
            requestTreeUpdate("rename", get(workingDir), currentDirVersion);
        } catch {}
        return;
    }
    const fileData = await readFile(copied);

    if (
        !(await confirm(
            `Are you sure you want to copy "${filename}" from "./${fileBasename(
                copied
            )}" into "./${fileBasename(dest)}?"`,
            { title: "Codey: Move File" }
        ))
    ) {
        return;
    }
    try {
        await invoke("write_file", {
            path: newpath,
            content: fileData.text,
            enc: fileData.encoding,
            hasBom: fileData.bom,
            spaces: fileData.spaces,
        });
        // hint scheduler to refresh lightly after create
        try {
            requestTreeUpdate("create", get(workingDir), currentDirVersion);
        } catch {}
    } catch (e) {
        error(`Cannot create file in path ${dest}. Error: ${e} [File.ts:287]`);
    }
    addEditorTab(newpath, filename);
}

export function cutPath(p: string) {
    cutSourcePath = p;
    try {
        writeText(p);
    } catch {}
}

export function checkValidFileName(input: string) {
    // refer to https://learn.microsoft.com/en-us/windows/win32/fileio/naming-a-file for invalid characters
    // also https://gist.github.com/doctaphred/d01d05291546186941e1b7ddc02034d3
    const invalidChars = `<>:"|?*${sep}`;
    const invalidKeywords = [
        "CON",
        "PRN",
        "AUX",
        "NUL",
        "COM0",
        "COM1",
        "COM2",
        "COM3",
        "COM4",
        "COM5",
        "COM6",
        "COM7",
        "COM8",
        "COM9",
        "LPT0",
        "LPT1",
        "LPT2",
        "LPT3",
        "LPT4",
        "LPT5",
        "LPT6",
        "LPT7",
        "LPT8",
        "LPT9",
    ];

    // covers all non printable ascii characters (https://en.wikipedia.org/wiki/Control_character)
    for (let i = 0; i < 32; i++) {
        if (input.includes(String.fromCharCode(i))) return false;
    }
    for (const c of invalidChars) {
        if (input.includes(c)) return false;
    }
    for (const keyword of invalidKeywords) {
        if (input.includes(keyword)) return false;
    }
    if (input.endsWith(".")) return false;
    if (input === "") return false;
    return true;
}

export function saveToRecent(path: string) {
    const recent = localStorage.getItem("recentFolders");
    if (!recent) {
        localStorage.setItem("recentFolders", JSON.stringify([path]));
        return;
    }
    const recentFolders = JSON.parse(recent) || [];
    const updatedRecentFolders = [
        path,
        ...recentFolders.filter((f) => f !== path),
    ].slice(0, 20); // keep the 20 most recently used workspaces
    localStorage.setItem("recentFolders", JSON.stringify(updatedRecentFolders));
}
