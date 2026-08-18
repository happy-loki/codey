import { getRootPath } from "../tree/normalizedStore";
import { appLocalDataDir, join } from "@tauri-apps/api/path";
import { exists, mkdir, writeTextFile } from "@tauri-apps/plugin-fs";
import { getWorkspaceRecent } from "../workspaceRecents";
import { formatTimestampSlug } from "../utils/timestamp";

const WHITEBOARD_DIR_NAME = "excalidraw";
const WHITEBOARD_FILE_EXTENSION = ".excalidraw";

const DEFAULT_WHITEBOARD_DOCUMENT = JSON.stringify(
    {
        type: "excalidraw",
        version: 2,
        source: "arthas",
        elements: [],
        appState: {
            viewBackgroundColor: "#ffffff",
            gridSize: null,
        },
        files: {},
    },
    null,
    2,
) + "\n";

async function resolveWhiteboardBaseDir(): Promise<string> {
    const root = getRootPath();
    if (root && root.trim()) {
        return root;
    }
    return await appLocalDataDir();
}

export async function getWhiteboardStorageDirPath(): Promise<string> {
    const baseDir = await resolveWhiteboardBaseDir();
    return await join(baseDir, WHITEBOARD_DIR_NAME);
}

export async function ensureWhiteboardStorageDir(): Promise<string> {
    const dir = await getWhiteboardStorageDirPath();
    if (!(await exists(dir))) {
        await mkdir(dir, { recursive: true });
    }
    return dir;
}

async function ensureUniqueWhiteboardPath(dir: string, baseName: string): Promise<string> {
    let attempt = 0;
    while (attempt < 5000) {
        const suffix = attempt === 0 ? "" : `_${attempt}`;
        const candidate = `${baseName}${suffix}${WHITEBOARD_FILE_EXTENSION}`;
        const fullPath = await join(dir, candidate);
        if (!(await exists(fullPath))) {
            return fullPath;
        }
        attempt += 1;
    }
    throw new Error("Unable to allocate unique whiteboard filename");
}

async function tryGetRecentWhiteboardFile(): Promise<string | null> {
    const workspace = getRootPath();
    const recent = getWorkspaceRecent("whiteboard", workspace);
    if (!recent) {
        return null;
    }
    try {
        if (await exists(recent)) {
            return recent;
        }
    } catch (_) {
        return null;
    }
    return null;
}

async function createWhiteboardFile(): Promise<string> {
    const dir = await ensureWhiteboardStorageDir();
    const timestamp = formatTimestampSlug();
    const targetPath = await ensureUniqueWhiteboardPath(dir, timestamp);
    await writeTextFile(targetPath, DEFAULT_WHITEBOARD_DOCUMENT);
    return targetPath;
}

export async function ensureDefaultWhiteboardFile(): Promise<string> {
    const recent = await tryGetRecentWhiteboardFile();
    if (recent) {
        return recent;
    }
    return await createWhiteboardFile();
}

export async function createNewWhiteboardFile(): Promise<string> {
    return await createWhiteboardFile();
}
