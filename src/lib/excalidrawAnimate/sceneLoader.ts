import type { AppState, BinaryFiles } from "@excalidraw/excalidraw/types";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { SceneData } from "./svgBuilder";

export class ExcalidrawSceneError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "ExcalidrawSceneError";
    }
}

function sanitizeElements(raw: any): ExcalidrawElement[] {
    if (!Array.isArray(raw)) return [];
    const safeElements: ExcalidrawElement[] = [];
    for (const element of raw) {
        if (!element || typeof element !== "object" || element.isDeleted) continue;
        if (typeof element.type !== "string" || typeof element.id !== "string") continue;
        const cloned: any = { ...element, isDeleted: false };
        if (Array.isArray(cloned.points)) {
            cloned.points = cloned.points.filter(
                (pt: unknown) =>
                    Array.isArray(pt) &&
                    pt.length === 2 &&
                    pt.every((value) => typeof value === "number" && Number.isFinite(value)),
            );
        }
        if (typeof cloned.text !== "string") {
            cloned.text = "";
        }
        safeElements.push(cloned);
    }
    return safeElements;
}

function normalizeAppState(raw: any): AppState {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        return { collaborators: {} } as AppState;
    }
    const { collaborators, ...rest } = raw as AppState & { collaborators?: any };
    let normalizedCollaborators: Record<string, any> = {};
    if (collaborators instanceof Map) {
        normalizedCollaborators = Object.fromEntries(collaborators);
    } else if (Array.isArray(collaborators)) {
        normalizedCollaborators = Object.fromEntries(collaborators);
    } else if (collaborators && typeof collaborators === "object") {
        normalizedCollaborators = collaborators as Record<string, any>;
    }
    return {
        ...(rest as Record<string, any>),
        collaborators: normalizedCollaborators,
    } as AppState;
}

function normalizeFiles(raw: any): BinaryFiles {
    if (!raw || typeof raw !== "object") {
        return {};
    }
    return raw as BinaryFiles;
}

function validateExcalidrawData(parsed: any) {
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new ExcalidrawSceneError("文件内容不是有效的 JSON 对象");
    }
    if (parsed.type && parsed.type !== "excalidraw") {
        throw new ExcalidrawSceneError("并非 Excalidraw 文件");
    }
    if (!Array.isArray(parsed.elements)) {
        throw new ExcalidrawSceneError("缺少 elements 数组");
    }
    if (
        typeof parsed.appState !== "undefined" &&
        (parsed.appState === null || typeof parsed.appState !== "object" || Array.isArray(parsed.appState))
    ) {
        throw new ExcalidrawSceneError("appState 数据格式不正确");
    }
    if (
        typeof parsed.files !== "undefined" &&
        (parsed.files === null || typeof parsed.files !== "object" || Array.isArray(parsed.files))
    ) {
        throw new ExcalidrawSceneError("files 数据格式不正确");
    }
}

export function parseSceneFromString(content: string): SceneData {
    if (!content.trim()) {
        throw new ExcalidrawSceneError("白板文件为空");
    }
    let parsed: any;
    try {
        parsed = JSON.parse(content);
    } catch (err) {
        throw new ExcalidrawSceneError("无法解析白板文件内容");
    }
    validateExcalidrawData(parsed);
    return {
        elements: sanitizeElements(parsed.elements),
        appState: normalizeAppState(parsed.appState),
        files: normalizeFiles(parsed.files),
    };
}
