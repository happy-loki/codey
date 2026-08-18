import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import { writeTextFile, writeFile } from "@tauri-apps/plugin-fs";
import { invoke } from "@tauri-apps/api/core";
import { strToU8, zipSync } from "fflate";
import { exportToSvg, getNonDeletedElements } from "@excalidraw/excalidraw";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { SceneData, ThemeVariant } from "./svgBuilder";
import { applyThemeToSvg } from "./svgBuilder";
import {
    ANIMATION_META_KEY,
    SVG_EXPORT_PADDING,
    type AnimationTimelineEntry,
    type AnimationTimelineMap,
} from "./constants";

export type ExportAppearanceOptions = {
    theme: ThemeVariant;
    includeBackground: boolean;
};

type GifExportOptions = ExportAppearanceOptions & {
    defaultFileName: string;
    estimatedDurationMs?: number;
    shouldLoop?: boolean;
};

type GifExportLifecycle = {
    onConfirmed?: (event: { path: string }) => void;
};

type GifFramePayload = {
    svg: string;
    delayMs: number;
};

const MAX_SEQUENCE_FRAMES = 80;

function ensureExtension(path: string, extension: string): string {
    if (!path.toLowerCase().endsWith(extension)) {
        return `${path}${extension}`;
    }
    return path;
}

function normalizeSvg(svg: SVGSVGElement, appearance: ExportAppearanceOptions): SVGSVGElement {
    let clone = svg.cloneNode(true) as SVGSVGElement;
    if (!appearance.includeBackground) {
        const firstRect = clone.querySelector("rect");
        firstRect?.remove();
    }
    if (appearance.theme === "dark") {
        clone = applyThemeToSvg(clone, "dark");
    }
    return clone;
}

function serializeSvg(svg: SVGSVGElement): string {
    const serializer = new XMLSerializer();
    const raw = serializer.serializeToString(svg);
    return raw.endsWith("\n") ? raw : `${raw}\n`;
}

export async function exportAnimatedSvgFile(
    svg: SVGSVGElement,
    options: ExportAppearanceOptions & { defaultFileName: string },
): Promise<string | null> {
    const clone = svg.cloneNode(true) as SVGSVGElement;
    try {
        clone.pauseAnimations?.();
        clone.setCurrentTime?.(0);
    } catch {}
    const normalized = normalizeSvg(clone, options);
    const serialized = serializeSvg(normalized);
    const targetPath = await saveDialog({
        defaultPath: ensureExtension(options.defaultFileName || "excalidraw-animate", ".svg"),
        filters: [{ name: "SVG", extensions: ["svg"] }],
    });
    if (!targetPath) {
        return null;
    }
    await writeTextFile(targetPath, serialized);
    return targetPath;
}

function parseAnimateOrder(element: ExcalidrawElement, fallback: number): number {
    const match = typeof element.id === "string" ? element.id.match(/animateOrder:(-?\d+)/) : null;
    if (!match) return fallback;
    const value = Number(match[1]);
    return Number.isFinite(value) ? value : fallback;
}

function sanitizeTimelineMapFromScene(scene: SceneData): AnimationTimelineMap {
    const raw = scene?.appState
        ? ((scene.appState as any)[ANIMATION_META_KEY] as AnimationTimelineMap)
        : undefined;
    if (!raw || typeof raw !== "object") {
        return {};
    }
    const sanitized: AnimationTimelineMap = {};
    Object.entries(raw as AnimationTimelineMap).forEach(([id, entry]) => {
        if (!entry || typeof entry !== "object") return;
        const normalized: AnimationTimelineEntry = {};
        if (typeof entry.order === "number" && Number.isFinite(entry.order)) {
            normalized.order = entry.order;
        }
        if (typeof entry.duration === "number" && Number.isFinite(entry.duration)) {
            normalized.duration = entry.duration;
        }
        if (Object.prototype.hasOwnProperty.call(entry, "groupId")) {
            if (entry.groupId === null) {
                normalized.groupId = null;
            } else if (typeof entry.groupId === "string") {
                const trimmed = entry.groupId.trim();
                if (trimmed) {
                    normalized.groupId = trimmed;
                } else {
                    normalized.groupId = null;
                }
            }
        }
        if (Object.keys(normalized).length) {
            sanitized[id] = normalized;
        }
    });
    return sanitized;
}

function resolveElementOrders(
    elements: readonly ExcalidrawElement[],
    timeline: AnimationTimelineMap,
): number[] {
    return elements.map((element, index) => {
        const entry = timeline[element.id];
        const order = entry?.order;
        if (typeof order === "number" && Number.isFinite(order)) {
            return order;
        }
        return parseAnimateOrder(element, index);
    });
}

function buildFrameThresholds(orders: readonly number[], limit = MAX_SEQUENCE_FRAMES): number[] {
    if (!orders.length) {
        return [];
    }
    const unique = [...new Set(orders)].sort((a, b) => a - b);
    if (!Number.isFinite(limit) || limit <= 0 || unique.length <= limit) {
        return unique;
    }
    const result: number[] = [];
    const step = unique.length / limit;
    for (let i = 0; i < limit; i += 1) {
        const idx = Math.min(unique.length - 1, Math.round(i * step));
        const value = unique[idx];
        if (!result.length || result[result.length - 1] !== value) {
            result.push(value);
        }
    }
    if (result[result.length - 1] !== unique[unique.length - 1]) {
        result[result.length - 1] = unique[unique.length - 1];
    }
    return result;
}

function buildSnapshotElements(
    elements: readonly ExcalidrawElement[],
    orders: readonly number[],
    threshold: number,
): ExcalidrawElement[] {
    return elements.map((element, index) => {
        const order = orders[index];
        if (order <= threshold) {
            return element;
        }
        if (element.opacity === 0) {
            return element;
        }
        return {
            ...element,
            opacity: 0,
        } as ExcalidrawElement;
    });
}

export async function exportSvgSequenceZip(
    scene: SceneData,
    options: ExportAppearanceOptions & { defaultFileName: string },
): Promise<string | null> {
    const elements = getNonDeletedElements(scene.elements);
    if (!elements.length) {
        throw new Error("没有可用的元素");
    }
    const timeline = sanitizeTimelineMapFromScene(scene);
    const orders = resolveElementOrders(elements, timeline);
    const thresholds = buildFrameThresholds(orders, MAX_SEQUENCE_FRAMES);
    if (!thresholds.length) {
        throw new Error("无法计算动画序列");
    }
    const entries: Record<string, Uint8Array> = {};
    for (let i = 0; i < thresholds.length; i += 1) {
        const threshold = thresholds[i];
        const snapshot = buildSnapshotElements(elements, orders, threshold);
        const svg = await exportToSvg({
            elements: snapshot,
            appState: scene.appState,
            files: scene.files,
            exportPadding: SVG_EXPORT_PADDING,
        });
        const normalized = normalizeSvg(svg, options);
        const serialized = serializeSvg(normalized);
        const filename = `frame-${String(i + 1).padStart(3, "0")}.svg`;
        entries[filename] = strToU8(serialized, true);
    }
    if (!Object.keys(entries).length) {
        throw new Error("没有可导出的帧");
    }
    const zipData = zipSync(entries, { level: 9 });
    const targetPath = await saveDialog({
        defaultPath: ensureExtension(options.defaultFileName || "excalidraw-frames", ".zip"),
        filters: [{ name: "ZIP", extensions: ["zip"] }],
    });
    if (!targetPath) {
        return null;
    }
    await writeFile(targetPath, zipData);
    return targetPath;
}

function parseDimensionValue(value: string | null | undefined): number | null {
    if (!value) return null;
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (/%/.test(trimmed) || trimmed.toLowerCase() === "auto") {
        return null;
    }
    const numeric = parseFloat(trimmed);
    return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}

function resolveSvgDimensions(svg: SVGSVGElement): { width: number; height: number } | null {
    let width = parseDimensionValue(svg.getAttribute("width"));
    let height = parseDimensionValue(svg.getAttribute("height"));
    if ((!width || !height) && svg.viewBox?.baseVal) {
        width = width ?? svg.viewBox.baseVal.width;
        height = height ?? svg.viewBox.baseVal.height;
    }
    if ((!width || !height) && svg.hasAttribute("viewBox")) {
        const raw = svg.getAttribute("viewBox") || "";
        const parts = raw
            .trim()
            .split(/[\s,]+/)
            .map((part) => Number(part))
            .filter((num) => Number.isFinite(num));
        if (parts.length === 4) {
            width = width ?? Math.abs(parts[2]);
            height = height ?? Math.abs(parts[3]);
        }
    }
    if (!width || !height) {
        return null;
    }
    return { width, height };
}

async function buildGifFramePayloads(
    scene: SceneData,
    options: ExportAppearanceOptions,
): Promise<{ frames: GifFramePayload[]; width: number; height: number }> {
    const elements = getNonDeletedElements(scene.elements);
    if (!elements.length) {
        throw new Error("没有可用的元素");
    }
    const timeline = sanitizeTimelineMapFromScene(scene);
    const orders = resolveElementOrders(elements, timeline);
    const thresholds = buildFrameThresholds(orders, Number.POSITIVE_INFINITY);
    if (!thresholds.length) {
        throw new Error("无法计算动画帧");
    }
    const baseSvg = await exportToSvg({
        elements,
        appState: scene.appState,
        files: scene.files,
        exportPadding: SVG_EXPORT_PADDING,
    });
    const baseSize = resolveSvgDimensions(normalizeSvg(baseSvg, options));
    if (!baseSize) {
        throw new Error("无法解析 SVG 尺寸");
    }

    const frames: GifFramePayload[] = [];
    for (let i = 0; i < thresholds.length; i += 1) {
        const threshold = thresholds[i];
        const snapshot = buildSnapshotElements(elements, orders, threshold);
        const svg = await exportToSvg({
            elements: snapshot,
            appState: scene.appState,
            files: scene.files,
            exportPadding: SVG_EXPORT_PADDING,
        });
        const normalized = normalizeSvg(svg, options);
        const serialized = serializeSvg(normalized);
        frames.push({ svg: serialized, delayMs: 0 });
    }
    if (!frames.length) {
        throw new Error("没有可导出的帧");
    }
    return {
        frames,
        width: Math.max(1, Math.round(baseSize.width)),
        height: Math.max(1, Math.round(baseSize.height)),
    };
}

export async function exportAnimatedGif(
    scene: SceneData,
    options: GifExportOptions,
    lifecycle?: GifExportLifecycle,
): Promise<string | null> {
    const { frames, width, height } = await buildGifFramePayloads(scene, options);
    const estimatedTotal = Math.max(
        options.estimatedDurationMs ?? frames.length * 400,
        frames.length * 80,
    );
    const baseDelay = Math.max(60, Math.round(estimatedTotal / frames.length));
    frames.forEach((frame) => {
        frame.delayMs = baseDelay;
    });
    const targetPath = await saveDialog({
        defaultPath: ensureExtension(options.defaultFileName || "excalidraw-animate", ".gif"),
        filters: [{ name: "GIF", extensions: ["gif"] }],
    });
    if (!targetPath) {
        return null;
    }
    lifecycle?.onConfirmed?.({ path: targetPath });
    await invoke("export_animation_gif", {
        path: targetPath,
        width,
        height,
        frames,
        shouldLoop: options.shouldLoop ?? true,
    });
    return targetPath;
}
