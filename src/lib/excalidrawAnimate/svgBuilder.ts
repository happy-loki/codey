import {
    exportToSvg,
    getNonDeletedElements,
} from "@excalidraw/excalidraw";
import type { AppState, BinaryFiles } from "@excalidraw/excalidraw/types";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { animateSvg } from "./animate";
import { SVG_EXPORT_PADDING } from "./constants";
import type { AnimationTimelineMap } from "./constants";

export type ThemeVariant = "light" | "dark";

export type SceneData = {
    elements: readonly ExcalidrawElement[];
    appState: AppState;
    files: BinaryFiles;
};

export type AnimatedSvgResult = {
    svg: SVGSVGElement;
    finishedMs: number;
};

const THEME_FILTER = "invert(93%) hue-rotate(180deg)";
const IMAGE_CORRECTION = "invert(100%) hue-rotate(180deg) saturate(1.25)";

export const applyThemeToSvg = (svg: SVGSVGElement, theme: ThemeVariant): SVGSVGElement => {
    if (theme !== "dark") return svg;

    const cloned = svg.cloneNode(true) as SVGSVGElement;
    cloned.style.filter = THEME_FILTER;

    cloned.querySelectorAll<SVGImageElement>("image").forEach((img) => {
        const href = img.getAttribute("href") || img.getAttribute("xlink:href") || "";
        if (/^data:image\/svg\+xml/i.test(href) || /\.svg(?:$|\?)/i.test(href)) {
            return;
        }
        const current = img.style.filter?.trim() || "";
        if (!current.includes(IMAGE_CORRECTION)) {
            img.style.filter = current ? `${current} ${IMAGE_CORRECTION}` : IMAGE_CORRECTION;
        }
    });

    return cloned;
};

export async function buildAnimatedSvg(
    scene: SceneData,
    theme: ThemeVariant,
    options: {
        startMs?: number;
        pointerImg?: string;
        pointerWidth?: string;
        pointerHeight?: string;
        timeline?: AnimationTimelineMap;
    } = {},
): Promise<AnimatedSvgResult> {
    const elements = getNonDeletedElements(scene.elements);
    const svg = await exportToSvg({
        elements,
        files: scene.files,
        appState: scene.appState,
        exportPadding: SVG_EXPORT_PADDING,
    });
    const themedSvg = applyThemeToSvg(svg, theme);
    const result = animateSvg(themedSvg, elements, options);
    return { svg: themedSvg, finishedMs: result.finishedMs };
}
