import { getRootPath } from "../tree/normalizedStore";
import { appLocalDataDir, join } from "@tauri-apps/api/path";
import { exists, mkdir, writeTextFile } from "@tauri-apps/plugin-fs";
import { getWorkspaceRecent } from "../workspaceRecents";
import { formatTimestampSlug } from "../utils/timestamp";

const DRAWIO_DIR_NAME = "drawio";
const DRAWIO_FILE_EXTENSION = ".drawio";

const DEFAULT_DRAWIO_DOCUMENT = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<mxGraphModel dx="827" dy="1169" grid="1" gridSize="10" guides="1" tooltips="1" connect="1"',
    '  arrows="1" fold="1" page="1" pageScale="1" pageWidth="827" pageHeight="1169" math="0" shadow="0">',
    "  <root>",
    '    <mxCell id="0"/>',
    '    <mxCell id="1" parent="0"/>',
    "  </root>",
    "</mxGraphModel>",
    "",
].join("\n");

async function resolveDrawioBaseDir(): Promise<string> {
    const root = getRootPath();
    if (root && root.trim()) {
        return root;
    }
    return await appLocalDataDir();
}

export async function getDrawioStorageDirPath(): Promise<string> {
    const baseDir = await resolveDrawioBaseDir();
    return await join(baseDir, DRAWIO_DIR_NAME);
}

async function ensureDrawioDir(): Promise<string> {
    const dir = await getDrawioStorageDirPath();
    if (!(await exists(dir))) {
        await mkdir(dir, { recursive: true });
    }
    return dir;
}

async function ensureUniqueFilePath(dir: string, baseName: string): Promise<string> {
    let attempt = 0;
    while (true) {
        const suffix = attempt === 0 ? "" : `_${attempt}`;
        const candidate = `${baseName}${suffix}${DRAWIO_FILE_EXTENSION}`;
        const fullPath = await join(dir, candidate);
        if (!(await exists(fullPath))) {
            return fullPath;
        }
        attempt += 1;
    }
}

export async function ensureDefaultDrawioFile(): Promise<string> {
    const workspace = getRootPath();
    const recent = getWorkspaceRecent("drawio", workspace);
    if (recent) {
        try {
            if (await exists(recent)) {
                return recent;
            }
        } catch (_) {
            // ignore stale errors
        }
    }
    return await createDrawioFile();
}

export async function createNewDrawioFile(): Promise<string> {
    return await createDrawioFile();
}

async function createDrawioFile(): Promise<string> {
    const dir = await ensureDrawioDir();
    const timestamp = formatTimestampSlug();
    const targetPath = await ensureUniqueFilePath(dir, timestamp);
    await writeTextFile(targetPath, DEFAULT_DRAWIO_DOCUMENT);
    return targetPath;
}
