<script lang="ts">
    import { onMount, onDestroy } from "svelte";
    import { invoke, convertFileSrc } from "@tauri-apps/api/core";
    import { openInExplorer as openPathInExplorer } from "./File";

    export let hidden = false;
    export let path = "";

    let src = "";
    let name = "";
    let objectUrl: string | null = null;
    let containerEl: HTMLDivElement | null = null;
    let panLayerEl: HTMLDivElement | null = null;
    let loadGeneration = 0;
    let isImageLoading = false;
    let isSvg = false;

    const MIN_ZOOM = 0.25;
    const MAX_ZOOM = 8;
    const WHEEL_FACTOR = 1.12;
    const BUTTON_FACTOR = 1.25;
    const ZOOM_EPSILON = 0.005;
    const PAN_GUTTER = 48; // keep a little breathing room when fully panned
    const VIEWPORT_CUSHION = 16; // shrink the usable viewport to avoid flush edges

    let zoom = 1;
    let offsetX = 0;
    let offsetY = 0;
    let stageWidth = 0; // intrinsic image width at 100%
    let stageHeight = 0; // intrinsic image height at 100%
    let viewportWidth = 0; // visible container width (excludes padding)
    let viewportHeight = 0; // visible container height (excludes padding)
    let isPanning = false;
    let panStartX = 0;
    let panStartY = 0;
    let panOriginX = 0;
    let panOriginY = 0;
    let lastLoadedPath = "";
    let resizeObserver: ResizeObserver | null = null;
    let observedContainer: HTMLElement | null = null;
    let observedPan: HTMLElement | null = null;
    let effectiveZoom = 1;
    let canPanInteractive = false;
    let isWheelPanning = false;
    let wheelMomentumTimeout: ReturnType<typeof setTimeout> | null = null;
    let wheelFrame: number | null = null;
    let wheelDeltaX = 0;
    let wheelDeltaY = 0;

    onMount(() => {
        if (typeof ResizeObserver !== "undefined") {
            resizeObserver = new ResizeObserver(() => updateStageMetrics());
        }
        loadNewPath();
    });

    onDestroy(() => {
        resizeObserver?.disconnect();
        cleanupObjectUrl();
        src = "";
        lastLoadedPath = "";
        isSvg = false;
        if (wheelMomentumTimeout) {
            clearTimeout(wheelMomentumTimeout);
            wheelMomentumTimeout = null;
        }
        if (wheelFrame) {
            cancelAnimationFrame(wheelFrame);
            wheelFrame = null;
        }
    });

    $: if (path && path !== lastLoadedPath) {
        loadNewPath();
    } else if (!path && lastLoadedPath) {
        lastLoadedPath = "";
        name = "";
        src = "";
        resetView();
        isSvg = false;
    }

    function cleanupObjectUrl(nextObjectUrl: string | null = null) {
        if (objectUrl && objectUrl !== nextObjectUrl) {
            URL.revokeObjectURL(objectUrl);
        }
        objectUrl = nextObjectUrl;
    }

    async function loadNewPath() {
        if (!path) {
            lastLoadedPath = "";
            name = "";
            src = "";
            resetView();
            cleanupObjectUrl();
            loadGeneration++;
            isImageLoading = false;
            isSvg = false;
            return;
        }
        if (path === lastLoadedPath) return;
        lastLoadedPath = path;
        isSvg = mimeFromPath(path) === "image/svg+xml";
        name = path.split(/\\\\|\//).pop() || "";
        resetView();
        const token = ++loadGeneration;
        isImageLoading = true;
        try {
            const nextSrc = createPreferredSrc(path, token);
            await commitSrcWhenReady(nextSrc, token);
        } catch (_) {
            await fallbackLoad(path, token);
        }
    }

    function createPreferredSrc(targetPath: string, token?: number) {
        const baseSrc = convertFileSrc(targetPath);
        const mime = mimeFromPath(targetPath);
        const needsBuster = mime === "image/svg+xml" || mime === "image/gif";
        if (!needsBuster) {
            return baseSrc;
        }
        const unique = `${Date.now()}-${token ?? loadGeneration}`;
        return baseSrc.includes("?") ? `${baseSrc}&t=${unique}` : `${baseSrc}?t=${unique}`;
    }

    async function commitSrcWhenReady(nextSrc: string, token: number, nextObjectUrl: string | null = null) {
        try {
            await preloadImage(nextSrc);
        } catch (error) {
            if (nextObjectUrl) URL.revokeObjectURL(nextObjectUrl);
            throw error;
        }
        if (token !== loadGeneration) {
            if (nextObjectUrl) URL.revokeObjectURL(nextObjectUrl);
            return;
        }
        const previousObjectUrl = objectUrl;
        src = nextSrc;
        objectUrl = nextObjectUrl;
        if (previousObjectUrl && previousObjectUrl !== objectUrl) {
            URL.revokeObjectURL(previousObjectUrl);
        }
        isImageLoading = false;
    }

    function preloadImage(url: string) {
        const image = new Image();
        image.decoding = "async";
        image.loading = "eager";
        image.src = url;
        const decodePromise =
            typeof image.decode === "function"
                ? image.decode()
                : new Promise<void>((resolve, reject) => {
                      image.onload = () => resolve();
                      image.onerror = () => reject(new Error("Failed to load image"));
                  });
        return decodePromise.finally(() => {
            image.onload = null;
            image.onerror = null;
        });
    }

    function resetView() {
        zoom = 1;
        offsetX = 0;
        offsetY = 0;
        isPanning = false;
    }

    function toUint8Array(input: any): Uint8Array {
        if (input instanceof Uint8Array) return input;
        if (Array.isArray(input)) return new Uint8Array(input);
        if (input && Array.isArray(input.data)) return new Uint8Array(input.data);
        try { return new Uint8Array(input as ArrayBuffer); } catch (_) { return new Uint8Array(); }
    }

    function mimeFromPath(p: string): string {
        const lower = (p || "").toLowerCase();
        if (lower.endsWith(".png")) return "image/png";
        if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
        if (lower.endsWith(".gif")) return "image/gif";
        if (lower.endsWith(".webp")) return "image/webp";
        if (lower.endsWith(".bmp")) return "image/bmp";
        if (lower.endsWith(".svg")) return "image/svg+xml";
        return "application/octet-stream";
    }

    async function fallbackLoad(targetPath: string, token: number = loadGeneration) {
        try {
            const raw = await invoke("read_file_bytes", { path: targetPath });
            const bytes = toUint8Array(raw);
            const blob = new Blob([bytes], { type: mimeFromPath(targetPath) });
            const nextObjectUrl = URL.createObjectURL(blob);
            await commitSrcWhenReady(nextObjectUrl, token, nextObjectUrl);
        } catch (_) {
            if (token !== loadGeneration) return;
            cleanupObjectUrl();
            src = "";
            isImageLoading = false;
        }
    }

    function handleOpenInExplorer() {
        if (!path) return;
        openPathInExplorer(path);
    }

    function zoomIn() {
        setZoom(zoom * BUTTON_FACTOR);
    }

    function zoomOut() {
        setZoom(zoom / BUTTON_FACTOR);
    }

    function resetZoom() {
        setZoom(1);
    }

    function clampZoom(value: number) {
        return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));
    }

    function getPanLimits(z = zoom) {
        if (!stageWidth || !stageHeight || !viewportWidth || !viewportHeight) {
            return { x: 0, y: 0 };
        }
        if (z <= 1 && !isSvg) {
            return { x: 0, y: 0 };
        }
        const scaledWidth = stageWidth * z;
        const scaledHeight = stageHeight * z;
        const overflowX = Math.max(0, scaledWidth - viewportWidth);
        const overflowY = Math.max(0, scaledHeight - viewportHeight);
        const extraX = overflowX ? overflowX / 2 + PAN_GUTTER : 0;
        const extraY = overflowY ? overflowY / 2 + PAN_GUTTER : 0;
        return { x: extraX, y: extraY };
    }

    function hasPanRoom(z = zoom) {
        const limits = getPanLimits(z);
        return Boolean(limits.x || limits.y);
    }

    function touchWheelPan() {
        setWheelPanActive(true);
        if (wheelMomentumTimeout) {
            clearTimeout(wheelMomentumTimeout);
        }
        wheelMomentumTimeout = setTimeout(() => {
            wheelMomentumTimeout = null;
            setWheelPanActive(false);
        }, 180);
    }

    function setWheelPanActive(active: boolean) {
        if (isWheelPanning === active) return;
        isWheelPanning = active;
    }

    function scheduleWheelPan(deltaX: number, deltaY: number, z = zoom) {
        wheelDeltaX += deltaX;
        wheelDeltaY += deltaY;
        if (wheelFrame !== null) return;
        wheelFrame = requestAnimationFrame(() => {
            wheelFrame = null;
            const next = clampOffsets(offsetX + wheelDeltaX, offsetY + wheelDeltaY, z);
            wheelDeltaX = 0;
            wheelDeltaY = 0;
            offsetX = next.x;
            offsetY = next.y;
        });
    }

    function clampOffsets(x: number, y: number, z = zoom) {
        const limits = getPanLimits(z);
        return {
            x: limits.x ? Math.min(limits.x, Math.max(-limits.x, x)) : 0,
            y: limits.y ? Math.min(limits.y, Math.max(-limits.y, y)) : 0,
        };
    }

    function setZoom(nextZoom: number, focal?: { clientX: number; clientY: number }) {
        if (isSvg) {
            zoom = 1;
            const adjusted = clampOffsets(offsetX, offsetY, 1);
            offsetX = adjusted.x;
            offsetY = adjusted.y;
            return;
        }
        const clamped = clampZoom(nextZoom);
        if (Math.abs(clamped - zoom) < ZOOM_EPSILON) {
            return;
        }
        const prevZoom = zoom;
        zoom = clamped;

        if (Math.abs(clamped - 1) <= ZOOM_EPSILON) {
            zoom = 1;
            offsetX = 0;
            offsetY = 0;
            isPanning = false;
            return;
        }

        if (clamped < 1) {
            offsetX = 0;
            offsetY = 0;
            isPanning = false;
            return;
        }

        if (!stageWidth || !stageHeight) {
            return;
        }

        if (focal && containerEl) {
            const containerRect = containerEl.getBoundingClientRect();
            const pointerVectorX = focal.clientX - (containerRect.left + containerRect.width / 2);
            const pointerVectorY = focal.clientY - (containerRect.top + containerRect.height / 2);
            const pointX = (pointerVectorX - offsetX) / prevZoom;
            const pointY = (pointerVectorY - offsetY) / prevZoom;
            const nextOffsetX = pointerVectorX - pointX * clamped;
            const nextOffsetY = pointerVectorY - pointY * clamped;
            const adjusted = clampOffsets(nextOffsetX, nextOffsetY, clamped);
            offsetX = adjusted.x;
            offsetY = adjusted.y;
        } else {
            const adjusted = clampOffsets(offsetX, offsetY, clamped);
            offsetX = adjusted.x;
            offsetY = adjusted.y;
        }
    }

    function handleWheel(event: WheelEvent) {
        if (!src) return;
        event.preventDefault();
        if (isSvg) {
            if (!hasPanRoom(1)) {
                return;
            }
            touchWheelPan();
            scheduleWheelPan(-event.deltaX, -event.deltaY, 1);
            return;
        }

        // 非 SVG 图片：滚轮只负责缩放，不再区分 ctrl 键或触控板手势
        setWheelPanActive(false);
        const dominantDelta = Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX;
        if (dominantDelta === 0) {
            return;
        }
        const direction = dominantDelta < 0 ? 1 : -1;
        const factor = direction > 0 ? WHEEL_FACTOR : 1 / WHEEL_FACTOR;
        setZoom(zoom * factor, { clientX: event.clientX, clientY: event.clientY });
    }

    function handlePointerDown(event: PointerEvent) {
        if ((!isSvg && zoom <= 1) || !panLayerEl || event.button !== 0 || !hasPanRoom(effectiveZoom)) return;
        event.preventDefault();
        isPanning = true;
        panStartX = event.clientX;
        panStartY = event.clientY;
        panOriginX = offsetX;
        panOriginY = offsetY;
        try {
            panLayerEl.setPointerCapture(event.pointerId);
        } catch (_) {
            // ignore
        }
    }

    function handlePointerMove(event: PointerEvent) {
        if (!isPanning) return;
        event.preventDefault();
        const deltaX = event.clientX - panStartX;
        const deltaY = event.clientY - panStartY;
        const next = clampOffsets(panOriginX + deltaX, panOriginY + deltaY);
        offsetX = next.x;
        offsetY = next.y;
    }

    function endPan(event: PointerEvent) {
        if (!isPanning) return;
        isPanning = false;
        try {
            panLayerEl?.releasePointerCapture(event.pointerId);
        } catch (_) {
            // ignore
        }
    }

    function handleImageLoad() {
        updateStageMetrics();
    }

    function parsePx(value: string | null) {
        const parsed = Number.parseFloat(value || "");
        return Number.isFinite(parsed) ? parsed : 0;
    }

    function updateStageMetrics() {
        if (!panLayerEl || !containerEl) return;
        const nextWidth = panLayerEl.offsetWidth;
        const nextHeight = panLayerEl.offsetHeight;
        const nextViewportWidth = containerEl.clientWidth;
        const nextViewportHeight = containerEl.clientHeight;
        if (!nextWidth || !nextHeight || !nextViewportWidth || !nextViewportHeight) return;
        const styles = getComputedStyle(containerEl);
        const paddingX = parsePx(styles.paddingLeft) + parsePx(styles.paddingRight);
        const paddingY = parsePx(styles.paddingTop) + parsePx(styles.paddingBottom);
        stageWidth = nextWidth;
        stageHeight = nextHeight;
        viewportWidth = Math.max(0, nextViewportWidth - paddingX - VIEWPORT_CUSHION * 2);
        viewportHeight = Math.max(0, nextViewportHeight - paddingY - VIEWPORT_CUSHION * 2);
        const adjusted = clampOffsets(offsetX, offsetY);
        offsetX = adjusted.x;
        offsetY = adjusted.y;
    }

    $: effectiveZoom = isSvg ? 1 : zoom;
    $: canPanInteractive = hasPanRoom(effectiveZoom);

    $: if (resizeObserver && containerEl !== observedContainer) {
        if (observedContainer) resizeObserver.unobserve(observedContainer);
        if (containerEl) resizeObserver.observe(containerEl);
        observedContainer = containerEl;
    }

    $: if (resizeObserver && panLayerEl !== observedPan) {
        if (observedPan) resizeObserver.unobserve(observedPan);
        if (panLayerEl) resizeObserver.observe(panLayerEl);
        observedPan = panLayerEl;
    }
</script>

<div class="image-viewer" class:hidden>
    <div class="toolbar">
        <span class="name">{name}</span>
        <span class="spacer"></span>
        <div class="zoom-controls" aria-label="缩放控制">
            <button
                type="button"
                on:click={zoomOut}
                disabled={isSvg || zoom <= MIN_ZOOM + ZOOM_EPSILON}
                aria-label="缩小"
            >-</button>
            <span class="zoom-value">
                {#if isSvg}
                    100%（SVG）
                {:else}
                    {Math.round(zoom * 100)}%
                {/if}
            </span>
            <button
                type="button"
                on:click={zoomIn}
                disabled={isSvg || zoom >= MAX_ZOOM - ZOOM_EPSILON}
                aria-label="放大"
            >+</button>
            <button
                type="button"
                class="reset"
                on:click={resetZoom}
                disabled={isSvg || Math.abs(zoom - 1) <= ZOOM_EPSILON}
            >重置</button>
        </div>
        <button
            type="button"
            class="link"
            on:click={handleOpenInExplorer}
            aria-label="在资源管理器中打开"
        >在资源管理器中打开</button>
    </div>
    <div
        class="image-container"
        bind:this={containerEl}
        on:wheel|nonpassive={handleWheel}
        aria-busy={isImageLoading}
    >
        {#if src}
            <div
                class="image-pan"
                class:interactive={canPanInteractive}
                class:panning={isPanning}
                class:wheeling={isWheelPanning}
                bind:this={panLayerEl}
                style={`--translate-x: ${offsetX}px; --translate-y: ${offsetY}px; --zoom: ${zoom};`}
                on:pointerdown={handlePointerDown}
                on:pointermove={handlePointerMove}
                on:pointerup={endPan}
                on:pointerleave={endPan}
                on:pointercancel={endPan}
            >
                <img
                    src={src}
                    alt={name}
                    draggable="false"
                    on:load={handleImageLoad}
                    on:error={() => fallbackLoad(path)}
                    class:svg-original={isSvg}
                />
                {#if isImageLoading && path}
                    <div class="loading-overlay" aria-live="polite">
                        <div class="loading-spinner" aria-hidden="true"></div>
                        <span>加载中…</span>
                    </div>
                {/if}
            </div>
        {:else}
            <div class="fallback">无法加载图片</div>
        {/if}
    </div>
    <div class="bottom-spacer"></div>
</div>

<svelte:window on:beforeunload={() => { if (objectUrl) URL.revokeObjectURL(objectUrl); }} />

<style lang="scss">
    .image-viewer {
        height: 100%;
        width: 100%;
        display: flex;
        flex-direction: column;
        overflow: hidden;
    }
    .toolbar {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 6px 4px;
        font-size: 12px;
        opacity: 0.85;
    }
    .toolbar .spacer { flex: 1; }
    .toolbar .link {
        cursor: pointer;
        text-decoration: underline;
        background: none;
        border: 0;
        color: inherit;
        font: inherit;
        padding: 0;
    }
    .image-container {
        position: relative;
        flex: 1;
        overflow: hidden;
        background: var(--image-viewer-background, #f5f7fb);
        display: flex;
        align-items: center;
        justify-content: center;
        padding: clamp(16px, 5vh, 48px);
        touch-action: none;
        user-select: none;
    }
    .image-pan {
        position: relative;
        display: flex;
        align-items: center;
        justify-content: center;
        transform: translate3d(var(--translate-x, 0px), var(--translate-y, 0px), 0);
        transition: transform 0.08s ease-out;
        will-change: transform;
    }
    .image-pan.interactive { cursor: grab; }
    .image-pan.panning {
        cursor: grabbing;
        transition: none;
    }
    .image-pan.wheeling {
        transition: none;
    }
    .image-pan img {
        width: auto;
        height: auto;
        max-width: min(100%, 1080px);
        max-height: min(100%, 85vh);
        object-fit: contain;
        image-rendering: auto;
        box-shadow: 0 12px 36px rgba(15, 23, 42, 0.18);
        border-radius: 12px;
        background: var(--image-viewer-background, #f5f7fb);
        user-select: none;
        transform-origin: center center;
        transform: scale(var(--zoom, 1));
        transition: transform 0.08s ease-out;
    }
    .image-pan img.svg-original {
        /* Some SVGs without explicit width/height report a 0x0 intrinsic size in certain WebView engines,
         * which makes <img> render as blank. Force a reasonable layout size while keeping SVG unscaled. */
        width: min(100%, 1080px);
        height: auto;
        max-height: min(100%, 85vh);
        object-fit: contain;
        transform: scale(1);
    }
    .zoom-controls {
        display: flex;
        align-items: center;
        gap: 6px;
        margin-right: 12px;
        font-size: 12px;
    }
    .zoom-controls button {
        width: 28px;
        height: 24px;
        border-radius: 6px;
        border: 1px solid rgba(15, 23, 42, 0.15);
        background: rgba(255, 255, 255, 0.8);
        color: inherit;
        font: inherit;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: 0;
    }
    .zoom-controls button:disabled {
        opacity: 0.35;
        cursor: not-allowed;
    }
    .zoom-controls .zoom-value {
        min-width: 48px;
        text-align: center;
        font-variant-numeric: tabular-nums;
    }
    .zoom-controls .reset {
        border: 0;
        width: auto;
        background: none;
        text-decoration: underline;
        padding: 0 4px;
        height: auto;
    }
    .fallback {
        opacity: 0.7;
        font-size: 13px;
    }
    .loading-overlay {
        position: absolute;
        inset: 0;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 8px;
        background: rgba(245, 247, 251, 0.92);
        color: #475569;
        font-size: 12px;
        pointer-events: none;
        border-radius: 12px;
    }
    .loading-spinner {
        width: 32px;
        height: 32px;
        border-radius: 999px;
        border: 3px solid rgba(71, 85, 105, 0.35);
        border-top-color: rgba(71, 85, 105, 0.9);
        animation: spin 0.8s linear infinite;
    }
    @keyframes spin {
        to {
            transform: rotate(360deg);
        }
    }
    .hidden { display: none !important; }
    .bottom-spacer { height: 8px; }
</style>
