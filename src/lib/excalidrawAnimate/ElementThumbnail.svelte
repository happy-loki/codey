<script lang="ts">
    import type { SceneData } from "./svgBuilder";

    type ElementType = SceneData["elements"][number];

    export let element: ElementType | null = null;
    export let size = 48;

    const PADDING = 4;

    type BaseSpec = {
        viewBoxWidth: number;
        viewBoxHeight: number;
        stroke: string;
        fill: string;
    };

    type RectSpec = BaseSpec & {
        kind: "rect";
        width: number;
        height: number;
        rx: number;
        ry: number;
    };

    type DiamondSpec = BaseSpec & {
        kind: "diamond";
        width: number;
        height: number;
    };

    type EllipseSpec = BaseSpec & {
        kind: "ellipse";
        width: number;
        height: number;
    };

    type PolylineSpec = BaseSpec & {
        kind: "polyline";
        points: [number, number][];
    };

    type PathSpec = BaseSpec & {
        kind: "path";
        d: string;
    };

    type TextSpec = BaseSpec & {
        kind: "text";
        text: string;
    };

    type ImageSpec = BaseSpec & {
        kind: "image";
    };

    type Spec =
        | RectSpec
        | DiamondSpec
        | EllipseSpec
        | PolylineSpec
        | PathSpec
        | TextSpec
        | ImageSpec;

    $: spec = element ? buildSpec(element) : null;

    function strokeColor(ele: ElementType | null | undefined) {
        return ele?.strokeColor || "#1f2937";
    }

    function fillColor(ele: ElementType | null | undefined) {
        if (!ele) return "none";
        const color = ele.backgroundColor;
        if (!color || color === "transparent") {
            return "none";
        }
        return color;
    }

    function positiveSize(value: number | undefined | null) {
        return Math.max(1, Math.abs(value ?? 0));
    }

    function buildSpec(ele: ElementType): Spec | null {
        switch (ele.type) {
            case "rectangle":
                return {
                    kind: "rect",
                    viewBoxWidth: positiveSize(ele.width) + PADDING * 2,
                    viewBoxHeight: positiveSize(ele.height) + PADDING * 2,
                    width: positiveSize(ele.width),
                    height: positiveSize(ele.height),
                    rx: ele.roundness ? Math.min(positiveSize(ele.width), positiveSize(ele.height)) * 0.15 : 0,
                    ry: ele.roundness ? Math.min(positiveSize(ele.width), positiveSize(ele.height)) * 0.15 : 0,
                    stroke: strokeColor(ele),
                    fill: fillColor(ele),
                };
            case "ellipse":
                return {
                    kind: "ellipse",
                    viewBoxWidth: positiveSize(ele.width) + PADDING * 2,
                    viewBoxHeight: positiveSize(ele.height) + PADDING * 2,
                    width: positiveSize(ele.width),
                    height: positiveSize(ele.height),
                    stroke: strokeColor(ele),
                    fill: fillColor(ele),
                };
            case "diamond":
                return {
                    kind: "diamond",
                    viewBoxWidth: positiveSize(ele.width) + PADDING * 2,
                    viewBoxHeight: positiveSize(ele.height) + PADDING * 2,
                    width: positiveSize(ele.width),
                    height: positiveSize(ele.height),
                    stroke: strokeColor(ele),
                    fill: fillColor(ele),
                };
            case "text":
                return {
                    kind: "text",
                    viewBoxWidth: 100,
                    viewBoxHeight: 50,
                    text: (ele.text || "").trim() || "TXT",
                    stroke: strokeColor(ele),
                    fill: "none",
                };
            case "image":
                return {
                    kind: "image",
                    viewBoxWidth: 64,
                    viewBoxHeight: 64,
                    stroke: strokeColor(ele),
                    fill: fillColor(ele),
                };
            case "arrow":
            case "line":
                return polylineSpec(ele);
            case "freedraw":
                return pathSpec(ele);
            default:
                return {
                    kind: "rect",
                    viewBoxWidth: positiveSize(ele.width) + PADDING * 2,
                    viewBoxHeight: positiveSize(ele.height) + PADDING * 2,
                    width: positiveSize(ele.width),
                    height: positiveSize(ele.height),
                    rx: 0,
                    ry: 0,
                    stroke: strokeColor(ele),
                    fill: fillColor(ele),
                };
        }
    }

    function normalizePoints(points: readonly [number, number][]) {
        if (!points?.length) return null;
        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;
        points.forEach(([x, y]) => {
            if (x < minX) minX = x;
            if (y < minY) minY = y;
            if (x > maxX) maxX = x;
            if (y > maxY) maxY = y;
        });
        if (!isFinite(minX) || !isFinite(minY)) return null;
        const width = Math.max(1, maxX - minX);
        const height = Math.max(1, maxY - minY);
        const normalized = points.map(([x, y]) => [
            x - minX + PADDING,
            y - minY + PADDING,
        ]) as [number, number][];
        return {
            width: width + PADDING * 2,
            height: height + PADDING * 2,
            points: normalized,
        };
    }

    function polylineSpec(ele: ElementType): Spec | null {
        if (!ele.points?.length) return null;
        const normalized = normalizePoints(ele.points as [number, number][]);
        if (!normalized) return null;
        return {
            kind: "polyline",
            viewBoxWidth: normalized.width,
            viewBoxHeight: normalized.height,
            points: normalized.points,
            stroke: strokeColor(ele),
            fill: "none",
        };
    }

    function pathSpec(ele: ElementType): Spec | null {
        if (!ele.points?.length) return null;
        const normalized = normalizePoints(ele.points as [number, number][]);
        if (!normalized) return null;
        const d = normalized.points
            .map(([x, y], index) => (index === 0 ? `M${x} ${y}` : `L${x} ${y}`))
            .join(" ");
        return {
            kind: "path",
            viewBoxWidth: normalized.width,
            viewBoxHeight: normalized.height,
            d,
            stroke: strokeColor(ele),
            fill: "none",
        };
    }

    function diamondPoints(width: number, height: number) {
        const halfW = width / 2;
        const halfH = height / 2;
        return [
            [halfW + PADDING, PADDING],
            [width + PADDING, halfH + PADDING],
            [halfW + PADDING, height + PADDING],
            [PADDING, halfH + PADDING],
        ]
            .map(([x, y]) => `${x} ${y}`)
            .join(" ");
    }
</script>

<div class="thumb" style={`width:${size}px;height:${size}px`}>
    {#if element && spec}
        <svg
            viewBox={`0 0 ${spec.viewBoxWidth} ${spec.viewBoxHeight}`}
            width={size}
            height={size}
            aria-hidden="true"
        >
            {#if spec.kind === "rect"}
                <rect
                    x={PADDING}
                    y={PADDING}
                    width={spec.width}
                    height={spec.height}
                    rx={spec.rx}
                    ry={spec.ry}
                    stroke={spec.stroke}
                    fill={spec.fill}
                    stroke-width="2"
                />
            {:else if spec.kind === "ellipse"}
                <ellipse
                    cx={PADDING + spec.width / 2}
                    cy={PADDING + spec.height / 2}
                    rx={spec.width / 2}
                    ry={spec.height / 2}
                    stroke={spec.stroke}
                    fill={spec.fill}
                    stroke-width="2"
                />
            {:else if spec.kind === "diamond"}
                <polygon
                    points={diamondPoints(spec.width, spec.height)}
                    stroke={spec.stroke}
                    fill={spec.fill}
                    stroke-width="2"
                />
            {:else if spec.kind === "polyline"}
                <polyline
                    points={spec.points.map(([x, y]) => `${x} ${y}`).join(" ")}
                    stroke={spec.stroke}
                    fill="none"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                />
            {:else if spec.kind === "path"}
                <path
                    d={spec.d}
                    stroke={spec.stroke}
                    fill="none"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                />
            {:else if spec.kind === "text"}
                <text
                    x="50%"
                    y="50%"
                    dominant-baseline="middle"
                    text-anchor="middle"
                    font-size="18"
                    fill={spec.stroke}
                >
                    {spec.text.slice(0, 4)}
                </text>
            {:else if spec.kind === "image"}
                <g>
                    <rect
                        x={PADDING}
                        y={PADDING}
                        width={spec.viewBoxWidth - PADDING * 2}
                        height={spec.viewBoxHeight - PADDING * 2}
                        fill={spec.fill === "none" ? "rgba(148,163,184,0.25)" : spec.fill}
                        stroke={spec.stroke}
                        stroke-width="2"
                        rx="6"
                    />
                    <text
                        x="50%"
                        y="50%"
                        dominant-baseline="middle"
                        text-anchor="middle"
                        font-size="14"
                        fill={spec.stroke}
                    >
                        IMG
                    </text>
                </g>
            {/if}
        </svg>
    {:else}
        <span class="fallback">--</span>
    {/if}
</div>

<style>
    .thumb {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border-radius: 6px;
        overflow: hidden;
    }

    svg {
        display: block;
    }

    .fallback {
        font-size: 12px;
        color: rgba(51, 65, 85, 0.6);
    }
</style>
