<script lang="ts">
    import type { SceneData } from "./svgBuilder";

    export let elements: SceneData["elements"] = [];
    export let size = 56;

    const PADDING = 8;

    type NormalizedElement =
        | {
              kind: "rect";
              id: string;
              x: number;
              y: number;
              width: number;
              height: number;
              stroke: string;
              fill: string;
              rx: number;
              ry: number;
          }
        | {
              kind: "ellipse";
              id: string;
              cx: number;
              cy: number;
              rx: number;
              ry: number;
              stroke: string;
              fill: string;
          }
        | {
              kind: "diamond";
              id: string;
              points: string;
              stroke: string;
              fill: string;
          }
        | {
              kind: "path";
              id: string;
              d: string;
              stroke: string;
          }
        | {
              kind: "text";
              id: string;
              x: number;
              y: number;
              text: string;
              stroke: string;
          }
        | {
              kind: "image";
              id: string;
              x: number;
              y: number;
              width: number;
              height: number;
              stroke: string;
              fill: string;
          };

    type NormalizedScene = {
        width: number;
        height: number;
        items: NormalizedElement[];
    };

    $: normalized = normalizeElements(elements);

    function normalizeElements(elements: SceneData["elements"]): NormalizedScene | null {
        if (!elements?.length) return null;
        const bounds = computeBounds(elements);
        if (!bounds) return null;
        const items: NormalizedElement[] = [];
        const offsetX = bounds.minX;
        const offsetY = bounds.minY;
        const width = bounds.width || 1;
        const height = bounds.height || 1;

        elements.forEach((el) => {
            const stroke = el.strokeColor || "#1f2937";
            const fill =
                el.backgroundColor && el.backgroundColor !== "transparent"
                    ? el.backgroundColor
                    : "none";
            switch (el.type) {
                case "rectangle": {
                    const rx =
                        el.roundness && el.roundness.type === 3
                            ? Math.min(Math.abs(el.width), Math.abs(el.height)) * 0.25
                            : 0;
                    items.push({
                        kind: "rect",
                        id: el.id,
                        x: el.x - offsetX + PADDING,
                        y: el.y - offsetY + PADDING,
                        width: Math.max(1, Math.abs(el.width)),
                        height: Math.max(1, Math.abs(el.height)),
                        stroke,
                        fill,
                        rx,
                        ry: rx,
                    });
                    break;
                }
                case "ellipse": {
                    items.push({
                        kind: "ellipse",
                        id: el.id,
                        cx: el.x - offsetX + PADDING + Math.max(1, Math.abs(el.width)) / 2,
                        cy: el.y - offsetY + PADDING + Math.max(1, Math.abs(el.height)) / 2,
                        rx: Math.max(1, Math.abs(el.width)) / 2,
                        ry: Math.max(1, Math.abs(el.height)) / 2,
                        stroke,
                        fill,
                    });
                    break;
                }
                case "diamond": {
                    const w = Math.max(1, Math.abs(el.width));
                    const h = Math.max(1, Math.abs(el.height));
                    const cx = el.x - offsetX + PADDING + w / 2;
                    const cy = el.y - offsetY + PADDING + h / 2;
                    const points = [
                        `${cx} ${cy - h / 2}`,
                        `${cx + w / 2} ${cy}`,
                        `${cx} ${cy + h / 2}`,
                        `${cx - w / 2} ${cy}`,
                    ].join(" ");
                    items.push({
                        kind: "diamond",
                        id: el.id,
                        points,
                        stroke,
                        fill,
                    });
                    break;
                }
                case "arrow":
                case "line": {
                    const d = buildLinearPath(el, offsetX, offsetY);
                    if (d) {
                        items.push({
                            kind: "path",
                            id: el.id,
                            d,
                            stroke,
                        });
                    }
                    break;
                }
                case "freedraw": {
                    const d = buildLinearPath(el, offsetX, offsetY);
                    if (d) {
                        items.push({
                            kind: "path",
                            id: el.id,
                            d,
                            stroke,
                        });
                    }
                    break;
                }
                case "text": {
                    items.push({
                        kind: "text",
                        id: el.id,
                        x: el.x - offsetX + PADDING + Math.max(1, Math.abs(el.width)) / 2,
                        y: el.y - offsetY + PADDING + Math.max(1, Math.abs(el.height)) / 2,
                        text: (el.text || "").trim(),
                        stroke,
                    });
                    break;
                }
                case "image": {
                    items.push({
                        kind: "image",
                        id: el.id,
                        x: el.x - offsetX + PADDING,
                        y: el.y - offsetY + PADDING,
                        width: Math.max(1, Math.abs(el.width)),
                        height: Math.max(1, Math.abs(el.height)),
                        stroke,
                        fill: fill === "none" ? "rgba(148,163,184,0.25)" : fill,
                    });
                    break;
                }
                default: {
                    items.push({
                        kind: "rect",
                        id: el.id,
                        x: el.x - offsetX + PADDING,
                        y: el.y - offsetY + PADDING,
                        width: Math.max(1, Math.abs(el.width || 12)),
                        height: Math.max(1, Math.abs(el.height || 12)),
                        stroke,
                        fill,
                        rx: 0,
                        ry: 0,
                    });
                    break;
                }
            }
        });

        return {
            width: width + PADDING * 2,
            height: height + PADDING * 2,
            items,
        };
    }

    function computeBounds(elements: SceneData["elements"]) {
        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;
        elements.forEach((el) => {
            const bounds = elementBounds(el);
            if (!bounds) return;
            if (bounds.minX < minX) minX = bounds.minX;
            if (bounds.minY < minY) minY = bounds.minY;
            if (bounds.maxX > maxX) maxX = bounds.maxX;
            if (bounds.maxY > maxY) maxY = bounds.maxY;
        });
        if (!isFinite(minX) || !isFinite(minY) || !isFinite(maxX) || !isFinite(maxY)) {
            return null;
        }
        return {
            minX,
            minY,
            width: Math.max(1, maxX - minX),
            height: Math.max(1, maxY - minY),
        };
    }

    function elementBounds(el: SceneData["elements"][number]) {
        if (el.type === "arrow" || el.type === "line" || el.type === "freedraw") {
            if (!el.points?.length) return null;
            const xs = el.points.map((p) => p[0] + el.x);
            const ys = el.points.map((p) => p[1] + el.y);
            return {
                minX: Math.min(...xs),
                minY: Math.min(...ys),
                maxX: Math.max(...xs),
                maxY: Math.max(...ys),
            };
        }
        const width = Math.max(1, Math.abs(el.width || 0));
        const height = Math.max(1, Math.abs(el.height || 0));
        return {
            minX: el.x,
            minY: el.y,
            maxX: el.x + width,
            maxY: el.y + height,
        };
    }

    function buildLinearPath(
        el: SceneData["elements"][number],
        offsetX: number,
        offsetY: number,
    ) {
        if (!el.points?.length) return "";
        return el.points
            .map(([px, py], index) => {
                const x = px + el.x - offsetX + PADDING;
                const y = py + el.y - offsetY + PADDING;
                return `${index === 0 ? "M" : "L"}${x} ${y}`;
            })
            .join(" ");
    }
</script>

<div class="thumb" style={`width:${size}px;height:${size}px`}>
    {#if normalized}
        <svg
            viewBox={`0 0 ${normalized.width} ${normalized.height}`}
            width={size}
            height={size}
            aria-hidden="true"
        >
            {#each normalized.items as item (item.id)}
                {#if item.kind === "rect"}
                    <rect
                        x={item.x}
                        y={item.y}
                        width={item.width}
                        height={item.height}
                        rx={item.rx}
                        ry={item.ry}
                        stroke={item.stroke}
                        fill={item.fill}
                        stroke-width="2"
                    />
                {:else if item.kind === "ellipse"}
                    <ellipse
                        cx={item.cx}
                        cy={item.cy}
                        rx={item.rx}
                        ry={item.ry}
                        stroke={item.stroke}
                        fill={item.fill}
                        stroke-width="2"
                    />
                {:else if item.kind === "diamond"}
                    <polygon
                        points={item.points}
                        stroke={item.stroke}
                        fill={item.fill}
                        stroke-width="2"
                    />
                {:else if item.kind === "path"}
                    <path
                        d={item.d}
                        stroke={item.stroke}
                        fill="none"
                        stroke-width="2"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                    />
                {:else if item.kind === "text"}
                    <text
                        x={item.x}
                        y={item.y}
                        text-anchor="middle"
                        dominant-baseline="middle"
                        font-size="14"
                        fill={item.stroke}
                    >
                        {item.text.slice(0, 6) || "TXT"}
                    </text>
                {:else if item.kind === "image"}
                    <g>
                        <rect
                            x={item.x}
                            y={item.y}
                            width={item.width}
                            height={item.height}
                            stroke={item.stroke}
                            fill={item.fill}
                            stroke-width="2"
                            rx="6"
                        />
                        <text
                            x={item.x + item.width / 2}
                            y={item.y + item.height / 2}
                            text-anchor="middle"
                            dominant-baseline="middle"
                            font-size="12"
                            fill={item.stroke}
                        >
                            IMG
                        </text>
                    </g>
                {/if}
            {/each}
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
