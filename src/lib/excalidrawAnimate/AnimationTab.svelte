<script lang="ts">
    import { onDestroy } from "svelte";
    import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
    import { is_dark_theme } from "../../config/themehandler";
    import {
        animationTarget,
        animationPlaybackPrefs,
        type AnimationTarget,
        type AnimationPlaybackPrefs,
    } from "./state";
    import { parseSceneFromString, ExcalidrawSceneError } from "./sceneLoader";
    import {
        buildAnimatedSvg,
        type ThemeVariant,
        type SceneData,
    } from "./svgBuilder";
    import { exportAnimatedSvgFile, exportSvgSequenceZip, exportAnimatedGif } from "./exporter";
    import { Loader2, Pause, Play, RefreshCcw, Repeat, RotateCcw, SkipForward, Download, Layers, Minus, Plus, Check, Square, Save, ListOrdered, ChevronUp, ChevronDown, Undo2, Ungroup, Group, Film } from "lucide-svelte";
    import { t } from "../i18n";
    import { ANIMATION_META_KEY, type AnimationTimelineMap, type AnimationTimelineEntry } from "./constants";
    import ElementThumbnail from "./ElementThumbnail.svelte";
    import GroupThumbnail from "./GroupThumbnail.svelte";
    import { addNotification, NotifType, updateNotification } from "../Notifications/notifications";

    export let hidden = false;

    type ExportingState = {
        svg: boolean;
        svgSequence: boolean;
        gif: boolean;
    };

    const SPEED_STEP = 0.25;
    const SPEED_MIN = 0.25;
    const SPEED_MAX = 10;

    let target: AnimationTarget = { kind: "none" };
    let playbackPrefs: AnimationPlaybackPrefs = { speed: 1, loop: false };
    let stageViewport: HTMLDivElement | null = null;
    let stageEl: HTMLDivElement | null = null; // 内容容器，应用缩放
    let svgTemplate: SVGSVGElement | null = null;
    let currentSvg: SVGSVGElement | null = null;
    let pendingSvg: SVGSVGElement | null = null;
    let baseFinishedMs = 0;
    let effectiveFinishedMs = 0;
    let appliedSpeed = 1;
    let loading = false;
    let error: string | null = null;
    let paused = false;
    let loadToken = 0;
    let loadedPath: string | null = null;
    let loadedTheme: ThemeVariant | null = null;
    let sceneData: SceneData | null = null;
    let exportTheme: ThemeVariant = "light";
    let exportThemeLocked = false;
    let exportIncludeBackground = true;
    let exportGifLoop = true;
    let exporting: ExportingState = { svg: false, svgSequence: false, gif: false };
    let loopRaf: number | null = null;
    let zoom = 1;
    let fitZoom = 1;
    let autoFit = true;
    let pinchLastDistance: number | null = null;
    let pinchCenter: { clientX: number; clientY: number } | null = null;
    let offsetX = 0;
    let offsetY = 0;
    let panPointerId: number | null = null;
    let isPanning = false;
    let panStartX = 0;
    let panStartY = 0;
    let panOriginX = 0;
    let panOriginY = 0;
    let panPending: { x: number; y: number } | null = null;
    let panRaf: number | null = null;
    let touchZoomPending: { scale: number; focal: { clientX: number; clientY: number } | null } | null = null;
    let touchZoomRaf: number | null = null;
    let stageViewportRectCache: DOMRectReadOnly | null = null;
    type StageStyleKey = "width" | "height" | "transform" | "transformOrigin";
    type SvgStyleKey = "transform" | "transformOrigin";
    const stageStyleCache: Record<StageStyleKey, string> = {
        width: "",
        height: "",
        transform: "",
        transformOrigin: "",
    };
    const svgStyleCache: Record<SvgStyleKey, string> = {
        transform: "",
        transformOrigin: "",
    };
    let viewportWidth = 0;
    let viewportHeight = 0;
    let svgIntrinsicWidth = 0;
    let svgIntrinsicHeight = 0;
    let selectedSpeed = formatSpeedValue(playbackPrefs.speed);
    let resolvedSpeed = clampSpeed(playbackPrefs.speed);
    type TimelineRow = {
        id: string;
        label: string;
        type: string;
        originalIndex: number;
        hasCustomOrder: boolean;
        detail?: string;
        element: SceneData["elements"][number];
        groupId: string | null;
        groupOrigin: "virtual" | "excalidraw" | null;
        groupSize: number;
        memberIds: string[];
        elements: SceneData["elements"][number][];
    };
    type TranslateFn = (key: string, params?: Record<string, string | number>) => string;
    let translateFn: TranslateFn = (key) => key;
    const unsubscribeTranslate = t.subscribe((fn) => {
        translateFn = fn;
    });

    function translate(key: string, params?: Record<string, string | number>) {
        return translateFn ? translateFn(key, params) : key;
    }

    let timelineOverrides: AnimationTimelineMap = {};
    let timelineSourceSnapshot: AnimationTimelineMap = {};
    let timelineRows: TimelineRow[] = [];
    // 以时间轴“行”为单位的选中集，存 row.id，避免成员/组混淆导致高亮错乱
    let timelineSelection = new Set<string>();
    const isRowSelected = (row: TimelineRow) => timelineSelection.has(row.id);
    let timelineSelectionSnapshot: Set<string> = new Set();
    let timelineSelectionAnchor: string | null = null;
    let selectedRows: TimelineRow[] = [];
    let canGroupSelection = false;
    let canUngroupSelection = false;
    let timelineTrackEl: HTMLDivElement | null = null;
    const timelineRowRefs = new Map<string, HTMLDivElement>();
    let isMarqueeSelecting = false;
    let marqueePointerId: number | null = null;
    let marqueeOrigin: { x: number; y: number } | null = null;
    let marqueeRect: { left: number; top: number; right: number; bottom: number } | null = null;
    let marqueeBox: { left: number; top: number; width: number; height: number } | null = null;
    let marqueeTrackRect: DOMRect | null = null;
    let marqueeBaseSelection = new Set<string>();
    let marqueeAdditive = false;
    let timelineEditorOpen = false;
    let timelineDirty = false;
    let timelineSaving = false;
    let timelineMessageKey: string | null = null;
    let timelineErrorMessage: string | null = null;
    let loadedRawContent: string | null = null;
    let timelineDraggingId: string | null = null;
    let timelineDragOverId: string | null = null;
    let timelineDragOverPosition: "before" | "after" | null = null;

    const ZOOM_MIN = 0.2;
    const ZOOM_MAX = 4;
    const ZOOM_STEP = 0.1;
    const WHEEL_ZOOM_FACTOR = 0.0012;
    const PAN_PADDING = 32;
    const PAN_EPSILON = 0.5;
    let wheelPending:
        | {
              deltaX: number;
              deltaY: number;
              ctrlKey: boolean;
              clientX: number;
              clientY: number;
          }
        | null = null;
    let wheelRaf: number | null = null;

    const clampZoom = (value: number, opts?: { allowBelowMin?: boolean }) => {
        const min = opts?.allowBelowMin ? 0.05 : ZOOM_MIN;
        return Math.min(ZOOM_MAX, Math.max(min, value));
    };

    const hasContentDimensions = () => svgIntrinsicWidth > 0 && svgIntrinsicHeight > 0;

    function setStageStyle(key: StageStyleKey, value: string) {
        if (!stageEl) return;
        if (stageStyleCache[key] === value) return;
        stageStyleCache[key] = value;
        switch (key) {
            case "width":
                stageEl.style.width = value;
                break;
            case "height":
                stageEl.style.height = value;
                break;
            case "transform":
                stageEl.style.transform = value;
                break;
            case "transformOrigin":
                stageEl.style.transformOrigin = value;
                break;
        }
    }

    function setSvgStyle(key: SvgStyleKey, value: string) {
        if (!currentSvg) return;
        if (svgStyleCache[key] === value) return;
        svgStyleCache[key] = value;
        switch (key) {
            case "transform":
                currentSvg.style.transform = value;
                break;
            case "transformOrigin":
                currentSvg.style.transformOrigin = value;
                break;
        }
    }

    function resetStageStyles() {
        stageStyleCache.width = "";
        stageStyleCache.height = "";
        stageStyleCache.transform = "";
        stageStyleCache.transformOrigin = "";
        stageViewportRectCache = null;
        if (stageEl) {
            stageEl.style.width = "";
            stageEl.style.height = "";
            stageEl.style.transform = "";
            stageEl.style.transformOrigin = "";
        }
    }

    function resetSvgStyles(svg?: SVGSVGElement | null) {
        svgStyleCache.transform = "";
        svgStyleCache.transformOrigin = "";
        const target = svg ?? currentSvg;
        if (target) {
            target.style.transform = "";
            target.style.transformOrigin = "";
        }
    }

    function resetPanState() {
        offsetX = 0;
        offsetY = 0;
        isPanning = false;
        panPointerId = null;
        pinchLastDistance = null;
        pinchCenter = null;
        panPending = null;
        if (panRaf !== null) {
            cancelAnimationFrame(panRaf);
            panRaf = null;
        }
        cancelTouchZoomSchedule();
    }

    function applyViewTransform() {
        if (!stageEl || !currentSvg) return;
        
        // 容器只做平移（不缩放），平移不会导致残影
        const stageTransform = offsetX || offsetY ? `translate(${offsetX}px, ${offsetY}px)` : "";
        setStageStyle("transform", stageTransform);
        setStageStyle("transformOrigin", "center center");
        
        // SVG 从中心缩放，保持原有坐标系统和焦点缩放逻辑正确
        // 关键：SVG 应用缩放避免残影，容器用 overflow:visible 允许溢出
        setSvgStyle("transformOrigin", "center center");
        setSvgStyle("transform", `scale(${zoom})`);
    }

    function syncStageContentSize() {
        if (!stageEl) return;
        // 初始化时设置为原始尺寸，applyViewTransform 会根据 zoom 调整
        setStageStyle("width", svgIntrinsicWidth > 0 ? `${svgIntrinsicWidth}px` : "");
        setStageStyle("height", svgIntrinsicHeight > 0 ? `${svgIntrinsicHeight}px` : "");
    }

    function captureSvgIntrinsicSize(svg: SVGSVGElement | null) {
        if (!svg) {
            svgIntrinsicWidth = 0;
            svgIntrinsicHeight = 0;
            syncStageContentSize();
            return;
        }
        const vb = svg.viewBox?.baseVal;
        if (vb?.width && vb?.height) {
            svgIntrinsicWidth = vb.width;
            svgIntrinsicHeight = vb.height;
            syncStageContentSize();
            return;
        }
        const widthAttr = Number(svg.getAttribute("width"));
        const heightAttr = Number(svg.getAttribute("height"));
        if (Number.isFinite(widthAttr) && widthAttr > 0 && Number.isFinite(heightAttr) && heightAttr > 0) {
            svgIntrinsicWidth = widthAttr;
            svgIntrinsicHeight = heightAttr;
            syncStageContentSize();
            return;
        }
        let renderedWidth = svg.clientWidth;
        let renderedHeight = svg.clientHeight;
        if ((!renderedWidth || !renderedHeight) && svg.getBoundingClientRect) {
            const rect = svg.getBoundingClientRect();
            renderedWidth = renderedWidth || rect.width;
            renderedHeight = renderedHeight || rect.height;
        }
        try {
            const bbox = svg.getBBox();
            svgIntrinsicWidth = bbox?.width || renderedWidth || 1;
            svgIntrinsicHeight = bbox?.height || renderedHeight || 1;
        } catch (_) {
            svgIntrinsicWidth = renderedWidth || 1;
            svgIntrinsicHeight = renderedHeight || 1;
        }
        syncStageContentSize();
    }

    function updateViewportMetrics() {
        if (!stageViewport) {
            viewportWidth = 0;
            viewportHeight = 0;
            return;
        }
        const rect = stageViewport.getBoundingClientRect();
        const padding = 32; // stage padding * 2
        viewportWidth = Math.max(rect.width - padding, 1);
        viewportHeight = Math.max(rect.height - padding, 1);
    }

    function getPanLimits(z = zoom) {
        if (!hasContentDimensions() || !viewportWidth || !viewportHeight) {
            return { x: 0, y: 0 };
        }
        const scaledWidth = svgIntrinsicWidth * z;
        const scaledHeight = svgIntrinsicHeight * z;
        const overflowX = Math.max(0, scaledWidth - viewportWidth);
        const overflowY = Math.max(0, scaledHeight - viewportHeight);
        return {
            x: overflowX ? overflowX / 2 + PAN_PADDING : 0,
            y: overflowY ? overflowY / 2 + PAN_PADDING : 0,
        };
    }

    function clampOffsets(x: number, y: number, z = zoom) {
        const limits = getPanLimits(z);
        return {
            x: limits.x ? Math.min(limits.x, Math.max(-limits.x, x)) : 0,
            y: limits.y ? Math.min(limits.y, Math.max(-limits.y, y)) : 0,
        };
    }

    const hasPanRoom = (z = zoom) => {
        const limits = getPanLimits(z);
        return limits.x > PAN_EPSILON || limits.y > PAN_EPSILON;
    };

    const unsubscribeTarget = animationTarget.subscribe((value) => {
        const previousPath = target.kind === "file" ? target.path : null;
        target = value;
        const nextPath = value.kind === "file" ? value.path : null;
        if (!nextPath) {
            cleanupSvg();
            svgTemplate = null;
            loadedPath = null;
            sceneData = null;
            timelineOverrides = {};
            timelineSourceSnapshot = {};
            timelineRows = [];
            timelineSelection = new Set();
            timelineSelectionAnchor = null;
            timelineDirty = false;
            timelineMessageKey = null;
            timelineErrorMessage = null;
            loadedRawContent = null;
            resetTimelineDragState();
            return;
        }
        if (nextPath !== previousPath) {
            void loadScene(nextPath, resolveTheme(), { forceReload: true });
            return;
        }
        if (loadedTheme && loadedTheme !== resolveTheme()) {
            if (sceneData) {
                void rebuildFromCurrentScene(resolveTheme());
            } else {
                void loadScene(nextPath, resolveTheme(), { forceReload: true });
            }
        }
    });

    const unsubscribePrefs = animationPlaybackPrefs.subscribe((prefs) => {
        playbackPrefs = prefs;
    });

    onDestroy(() => {
        unsubscribeTarget();
        unsubscribePrefs();
        unsubscribeTranslate();
        cleanupSvg();
        stopLoopWatcher();
        if (stageResizeObserver) {
            stageResizeObserver.disconnect();
            stageResizeObserver = null;
        }
        stageViewportLastSize = null;
        stageViewportPendingSize = null;
        stageViewportRectCache = null;
        if (stageResizeRaf !== null) {
            cancelAnimationFrame(stageResizeRaf);
            stageResizeRaf = null;
        }
        if (wheelRaf !== null) {
            cancelAnimationFrame(wheelRaf);
            wheelRaf = null;
        }
        if (panRaf !== null) {
            cancelAnimationFrame(panRaf);
            panRaf = null;
        }
    });

    $: themeVariant = resolveTheme();
    $: if (!exportThemeLocked) {
        exportTheme = themeVariant;
    }
    $: activePath = target.kind === "file" ? target.path : "";
    $: appliedLabel = target.kind === "file" ? target.label : "";
    $: stageReady = Boolean(currentSvg && !loading && !error);
    $: formattedDuration = effectiveFinishedMs ? formatDuration(effectiveFinishedMs) : "--";
    $: hasFile = target.kind === "file";
    $: showEmptyState = !hasFile;
    $: if (!hasFile) {
        timelineEditorOpen = false;
    }
    $: if (svgTemplate && playbackPrefs.speed > 0 && appliedSpeed !== playbackPrefs.speed) {
        rebuildPlayerSvg();
    }
    $: canPanNow = hasPanRoom();
    $: if (hidden && currentSvg) {
        pauseAnimation(true);
    } else if (!hidden && currentSvg && !paused) {
        try {
            currentSvg.unpauseAnimations();
        } catch {}
    }
    $: if (playbackPrefs.loop && currentSvg && effectiveFinishedMs > 0 && stageReady) {
        startLoopWatcher();
    } else {
        stopLoopWatcher();
    }
    $: timelineSelectionSnapshot = new Set(timelineSelection);
    $: selectedRows = timelineRows.filter((row) => timelineSelectionSnapshot.has(row.id));
    $: canGroupSelection = selectedRows.length >= 2;
    $: canUngroupSelection = selectedRows.some((row) => row.groupId);

    function resolveTheme(): ThemeVariant {
        return $is_dark_theme ? "dark" : "light";
    }

    function cleanupSvg() {
        if (currentSvg) {
            resetSvgStyles(currentSvg);
            currentSvg.remove();
        }
        if (stageEl) {
            stageEl.innerHTML = "";
            resetStageStyles();
        }
        currentSvg = null;
        pendingSvg = null;
        captureSvgIntrinsicSize(null);
        resetPanState();
        fitZoom = 1;
        zoom = 1;
    }

    function attachSvg(svg: SVGSVGElement) {
        cleanupSvg();
        pendingSvg = svg;
        maybeMountSvg();
    }

    const FIT_MARGIN = 16; // 与 stage padding 保持一致，保证适应时正好留出灰色边距

    function computeFitZoom() {
        if (!hasContentDimensions() || !viewportWidth || !viewportHeight) {
            return 1;
        }
        const usableWidth = Math.max(1, viewportWidth - FIT_MARGIN * 2);
        const usableHeight = Math.max(1, viewportHeight - FIT_MARGIN * 2);
        const scale = Math.min(
            usableWidth / svgIntrinsicWidth,
            usableHeight / svgIntrinsicHeight,
        );
        return clampZoom(scale, { allowBelowMin: true });
    }

    type ZoomOptions = {
        focal?: { clientX: number; clientY: number };
        viewportRect?: DOMRectReadOnly | null;
        preserveAutoFit?: boolean;
        allowBelowMin?: boolean;
    };

    function updateZoom(value: number, options: ZoomOptions = {}) {
        const { focal, viewportRect, preserveAutoFit = false, allowBelowMin = false } = options;
        const clamped = clampZoom(value, { allowBelowMin });
        if (!preserveAutoFit) {
            autoFit = false;
        }
        const prevZoom = zoom;
        zoom = clamped;

        if (!hasContentDimensions() || !stageViewport) {
            offsetX = 0;
            offsetY = 0;
            applyViewTransform();
            return;
        }

        const minimalZoom = fitZoom + 1e-4;
        const panAvailable = hasPanRoom(clamped);
        if (autoFit || !panAvailable || clamped <= minimalZoom) {
            offsetX = 0;
            offsetY = 0;
            isPanning = false;
            applyViewTransform();
            return;
        }

        if (!focal) {
            const adjusted = clampOffsets(offsetX, offsetY, clamped);
            offsetX = adjusted.x;
            offsetY = adjusted.y;
            applyViewTransform();
            return;
        }

        const rect = viewportRect ?? stageViewportRectCache ?? stageViewport.getBoundingClientRect();
        stageViewportRectCache = rect;
        // 鼠标相对于 viewport 中心的坐标
        const focalX = focal.clientX - (rect.left + rect.width / 2);
        const focalY = focal.clientY - (rect.top + rect.height / 2);
        
        // 关键：考虑容器的平移和 SVG 的缩放
        // 1. 减去容器平移得到相对于容器中心的坐标
        // 2. 除以 SVG 缩放得到 SVG 内的原始坐标点
        const pointX = (focalX - offsetX) / prevZoom;
        const pointY = (focalY - offsetY) / prevZoom;
        
        // 计算新的偏移量，使得该点在新缩放下仍然对准鼠标位置
        const nextOffsetX = focalX - pointX * clamped;
        const nextOffsetY = focalY - pointY * clamped;
        
        const adjusted = clampOffsets(nextOffsetX, nextOffsetY, clamped);
        offsetX = adjusted.x;
        offsetY = adjusted.y;
        applyViewTransform();
    }

    function applyWheelInteraction(payload: {
        deltaX: number;
        deltaY: number;
        ctrlKey: boolean;
        clientX: number;
        clientY: number;
    }) {
        const { deltaX, deltaY, ctrlKey, clientX, clientY } = payload;
        const isPinchZoom = ctrlKey;
        const rect = stageViewportRectCache ?? stageViewport?.getBoundingClientRect() ?? null;
        stageViewportRectCache = rect;
        if (isPinchZoom) {
            const delta = -deltaY;
            if (Math.abs(delta) < 1e-2) return;
            const magnitude = Math.min(Math.abs(delta) * WHEEL_ZOOM_FACTOR, 0.5);
            const factor = delta > 0 ? 1 + magnitude : 1 / (1 + magnitude);
            autoFit = false;
            updateZoom(zoom * factor, {
                focal: { clientX, clientY },
                viewportRect: rect ?? undefined,
            });
            return;
        }
        if (hasPanRoom()) {
            autoFit = false;
            schedulePanUpdate(offsetX - deltaX, offsetY - deltaY);
            return;
        }
        const delta = -deltaY;
        if (Math.abs(delta) < 1e-2) return;
        const magnitude = Math.min(Math.abs(delta) * WHEEL_ZOOM_FACTOR, 0.5);
        const factor = delta > 0 ? 1 + magnitude : 1 / (1 + magnitude);
        autoFit = false;
        updateZoom(zoom * factor, {
            focal: { clientX, clientY },
            viewportRect: rect ?? undefined,
        });
    }

    function handleStageWheel(event: WheelEvent) {
        if (!currentSvg) return;
        event.preventDefault();
        const next =
            wheelPending ?? {
                deltaX: 0,
                deltaY: 0,
                ctrlKey: false,
                clientX: event.clientX,
                clientY: event.clientY,
            };
        next.deltaX += event.deltaX;
        next.deltaY += event.deltaY;
        next.clientX = event.clientX;
        next.clientY = event.clientY;
        next.ctrlKey = next.ctrlKey || event.ctrlKey;
        wheelPending = next;
        if (wheelRaf !== null) {
            return;
        }
        wheelRaf = requestAnimationFrame(() => {
            wheelRaf = null;
            const payload = wheelPending;
            wheelPending = null;
            if (!payload || !currentSvg) {
                return;
            }
            applyWheelInteraction(payload);
        });
    }

    const getTouchDistance = (event: TouchEvent) => {
        if (event.touches.length < 2) return null;
        const [a, b] = [event.touches[0], event.touches[1]];
        return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    };

    const getTouchCenter = (event: TouchEvent) => {
        if (event.touches.length < 2) return null;
        const [a, b] = [event.touches[0], event.touches[1]];
        return {
            clientX: (a.clientX + b.clientX) / 2,
            clientY: (a.clientY + b.clientY) / 2,
        };
    };

    function handleTouchStart(event: TouchEvent) {
        if (event.touches.length === 2) {
            autoFit = false;
            pinchLastDistance = getTouchDistance(event);
            pinchCenter = getTouchCenter(event);
            cancelTouchZoomSchedule();
            if (pinchLastDistance) {
                event.preventDefault();
            }
        }
    }

    function handleTouchMove(event: TouchEvent) {
        if (event.touches.length < 2 || pinchLastDistance == null) {
            return;
        }
        const distance = getTouchDistance(event);
        if (!distance || distance <= 0) return;
        const ratio = distance / pinchLastDistance;
        pinchLastDistance = distance;
        pinchCenter = getTouchCenter(event);
        scheduleTouchZoom(ratio, pinchCenter || null);
        event.preventDefault();
    }

    function handleTouchEnd(event: TouchEvent) {
        if (event.touches.length < 2) {
            pinchLastDistance = null;
            pinchCenter = null;
            cancelTouchZoomSchedule();
        }
    }

    const pointerSupportsPan = (event: PointerEvent) =>
        event.pointerType === "mouse" || event.pointerType === "pen";

    function handlePointerDown(event: PointerEvent) {
        if (!pointerSupportsPan(event)) return;
        if (event.pointerType === "mouse" && event.button !== 0) return;
        if (!hasPanRoom()) return;
        autoFit = false;
        isPanning = true;
        panPointerId = event.pointerId;
        panStartX = event.clientX;
        panStartY = event.clientY;
        panOriginX = offsetX;
        panOriginY = offsetY;
        panPending = null;
        try {
            stageViewport?.setPointerCapture(event.pointerId);
        } catch (_) {}
        event.preventDefault();
    }

    function handlePointerMove(event: PointerEvent) {
        if (!isPanning || event.pointerId !== panPointerId) return;
        event.preventDefault();
        const deltaX = event.clientX - panStartX;
        const deltaY = event.clientY - panStartY;
        schedulePanUpdate(panOriginX + deltaX, panOriginY + deltaY);
    }

    function schedulePanUpdate(x: number, y: number) {
        panPending = { x, y };
        if (panRaf !== null) return;
        panRaf = requestAnimationFrame(() => {
            panRaf = null;
            if (!panPending) return;
            const clamped = clampOffsets(panPending.x, panPending.y);
            panPending = null;
            offsetX = clamped.x;
            offsetY = clamped.y;
            applyViewTransform();
        });
    }

    function scheduleTouchZoom(scaleDelta: number, focal: { clientX: number; clientY: number } | null) {
        if (!Number.isFinite(scaleDelta) || scaleDelta <= 0) return;
        const next = touchZoomPending ?? { scale: 1, focal };
        next.scale *= scaleDelta;
        next.focal = focal ?? next.focal;
        touchZoomPending = next;
        if (touchZoomRaf !== null) {
            return;
        }
        touchZoomRaf = requestAnimationFrame(() => {
            touchZoomRaf = null;
            const payload = touchZoomPending;
            touchZoomPending = null;
            if (!payload) {
                return;
            }
            if (Math.abs(payload.scale - 1) < 1e-3) {
                return;
            }
            autoFit = false;
            const rect = stageViewportRectCache ?? stageViewport?.getBoundingClientRect() ?? null;
            stageViewportRectCache = rect;
            updateZoom(zoom * payload.scale, {
                focal: payload.focal ?? undefined,
                viewportRect: rect ?? undefined,
            });
        });
    }

    function cancelTouchZoomSchedule() {
        touchZoomPending = null;
        if (touchZoomRaf !== null) {
            cancelAnimationFrame(touchZoomRaf);
            touchZoomRaf = null;
        }
    }

    function endPointerPan(event?: PointerEvent) {
        if (panPointerId != null && event && event.pointerId !== panPointerId) {
            return;
        }
        if (panPointerId != null) {
            try {
                stageViewport?.releasePointerCapture(panPointerId);
            } catch (_) {}
        }
        panPointerId = null;
        isPanning = false;
        panOriginX = offsetX;
        panOriginY = offsetY;
        panPending = null;
        if (panRaf !== null) {
            cancelAnimationFrame(panRaf);
            panRaf = null;
        }
    }

    function handlePointerUp(event: PointerEvent) {
        if (panPointerId == null) return;
        endPointerPan(event);
    }

    function handleZoomStep(delta: number) {
        autoFit = false;
        updateZoom(zoom + delta);
    }

    function handleZoomReset() {
        autoFit = false;
        updateZoom(1);
    }

    function handleZoomFit() {
        autoFit = true;
        fitZoom = computeFitZoom();
        updateZoom(fitZoom, { preserveAutoFit: true, allowBelowMin: true });
    }

    function maybeMountSvg() {
        if (!stageEl || !pendingSvg) return;
        stageEl.innerHTML = "";
        stageEl.appendChild(pendingSvg);
        currentSvg = pendingSvg;
        pendingSvg = null;
        captureSvgIntrinsicSize(currentSvg);
        updateViewportMetrics();
        fitZoom = computeFitZoom();
        // 进入时强制自适应，避免沿用上一次缩放状态导致首屏过小
        autoFit = true;
        updateZoom(fitZoom, {
            preserveAutoFit: true,
            allowBelowMin: true,
        });
    }

    $: if (stageEl && pendingSvg) {
        maybeMountSvg();
    }

    let stageResizeObserver: ResizeObserver | null = null;
    let stageResizeRaf: number | null = null;
    let stageViewportPendingSize: { width: number; height: number } | null = null;
    let stageViewportLastSize: { width: number; height: number } | null = null;

    function handleStageViewportResize(size?: { width: number; height: number }) {
        if (size) {
            viewportWidth = Math.max(size.width - 32, 1);
            viewportHeight = Math.max(size.height - 32, 1);
        } else {
            updateViewportMetrics();
        }
        if (!currentSvg) {
            return;
        }
        fitZoom = computeFitZoom();
        if (autoFit) {
            updateZoom(fitZoom, {
                preserveAutoFit: true,
                allowBelowMin: true,
            });
            return;
        }
        const clamped = clampOffsets(offsetX, offsetY);
        if (clamped.x !== offsetX || clamped.y !== offsetY) {
            offsetX = clamped.x;
            offsetY = clamped.y;
            applyViewTransform();
        }
    }

    function scheduleStageViewportResize(size?: { width: number; height: number }) {
        stageViewportPendingSize = size ?? stageViewportPendingSize;
        if (stageResizeRaf !== null) {
            cancelAnimationFrame(stageResizeRaf);
        }
        stageResizeRaf = requestAnimationFrame(() => {
            stageResizeRaf = null;
            const pendingSize = stageViewportPendingSize;
            stageViewportPendingSize = null;
            handleStageViewportResize(pendingSize ?? undefined);
        });
    }

    $: if (stageViewport) {
        const rect = stageViewport.getBoundingClientRect();
        stageViewportLastSize = { width: rect.width, height: rect.height };
        stageViewportRectCache = null;
        handleStageViewportResize({ width: rect.width, height: rect.height });
        if (stageResizeObserver) {
            stageResizeObserver.disconnect();
        }
        stageResizeObserver = new ResizeObserver((entries) => {
            const entry = entries[0];
            if (!entry) return;
            const borderSize = (entry.borderBoxSize && entry.borderBoxSize[0]) || null;
            const width = borderSize?.inlineSize ?? entry.contentRect.width;
            const height = borderSize?.blockSize ?? entry.contentRect.height;
            const last = stageViewportLastSize;
            const changed = !last || Math.abs(last.width - width) >= 0.5 || Math.abs(last.height - height) >= 0.5;
            if (!changed) return;
            stageViewportLastSize = { width, height };
            stageViewportRectCache = null;
            scheduleStageViewportResize({ width, height });
        });
        stageResizeObserver.observe(stageViewport, { box: "border-box" });
    } else if (stageResizeObserver) {
        stageResizeObserver.disconnect();
        stageResizeObserver = null;
        stageViewportLastSize = null;
        stageViewportPendingSize = null;
        if (stageResizeRaf !== null) {
            cancelAnimationFrame(stageResizeRaf);
            stageResizeRaf = null;
        }
    }

    async function rebuildFromCurrentScene(theme: ThemeVariant = resolveTheme()) {
        if (!sceneData) return;
        const token = ++loadToken;
        loading = true;
        error = null;
        cleanupSvg();
        try {
            const timelineOption = prepareTimelineOption(sceneData, timelineOverrides);
            const buildOptions = timelineOption ? { timeline: timelineOption } : {};
            const { svg, finishedMs } = await buildAnimatedSvg(sceneData, theme, buildOptions);
            if (token !== loadToken) {
                svg.remove();
                return;
            }
            svgTemplate = svg;
            baseFinishedMs = finishedMs;
            loadedTheme = theme;
            rebuildPlayerSvg();
        } catch (err) {
            if (token !== loadToken) {
                return;
            }
            console.error("[AnimationTab] rebuild failed", err);
            if (err instanceof ExcalidrawSceneError) {
                error = err.message;
            } else if (err instanceof Error) {
                error = err.message;
            } else {
                error = String(err ?? "重建失败");
            }
            svgTemplate = null;
        } finally {
            if (token === loadToken) {
                loading = false;
            }
        }
    }

    function cloneTimelineMap(map: AnimationTimelineMap = {}): AnimationTimelineMap {
        return JSON.parse(JSON.stringify(map ?? {}));
    }

    function sanitizeTimelineMap(
        map: AnimationTimelineMap,
        validIds?: Set<string>,
    ): AnimationTimelineMap {
        const result: AnimationTimelineMap = {};
        Object.entries(map || {}).forEach(([id, entry]) => {
            if (validIds && !validIds.has(id)) {
                return;
            }
            const normalized: AnimationTimelineEntry = {};
            if (typeof entry?.order === "number" && Number.isFinite(entry.order)) {
                normalized.order = entry.order;
            }
            if (
                typeof entry?.duration === "number" &&
                Number.isFinite(entry.duration)
            ) {
                normalized.duration = entry.duration;
            }
            if (entry && Object.prototype.hasOwnProperty.call(entry, "groupId")) {
                if (entry.groupId === null) {
                    normalized.groupId = null;
                } else if (typeof entry.groupId === "string") {
                    const trimmed = entry.groupId.trim();
                    if (trimmed) {
                        normalized.groupId = trimmed;
                    }
                }
            }
            if (Object.keys(normalized).length) {
                result[id] = normalized;
            }
        });
        return result;
    }

    function timelineMapsEqual(
        a: AnimationTimelineMap,
        b: AnimationTimelineMap,
        validIds?: Set<string>,
    ): boolean {
        const sanitizedA = sanitizeTimelineMap(a, validIds);
        const sanitizedB = sanitizeTimelineMap(b, validIds);
        const aKeys = Object.keys(sanitizedA);
        const bKeys = Object.keys(sanitizedB);
        if (aKeys.length !== bKeys.length) return false;
        return aKeys.every((key) => {
            const entryA = sanitizedA[key];
            const entryB = sanitizedB[key];
            if (!entryB) return false;
            return (
                entryA.order === entryB.order &&
                entryA.duration === entryB.duration &&
                entryA.groupId === entryB.groupId
            );
        });
    }

    function extractLegacyOrderFromId(id: string): number | undefined {
        const match = id.match(/animateOrder:(-?\d+)/);
        if (!match) return undefined;
        const value = Number(match[1]);
        return Number.isFinite(value) ? value : undefined;
    }

    function getAnimationMetaFromAppState(appState: SceneData["appState"]) {
        const raw = appState ? (appState as any)[ANIMATION_META_KEY] : undefined;
        if (!raw || typeof raw !== "object") {
            return {};
        }
        const meta: AnimationTimelineMap = {};
        Object.entries(raw as Record<string, AnimationTimelineEntry>).forEach(
            ([id, entry]) => {
                if (!entry || typeof entry !== "object") return;
                const normalized: AnimationTimelineEntry = {};
                if (typeof entry.order === "number" && Number.isFinite(entry.order)) {
                    normalized.order = entry.order;
                }
                if (
                    typeof entry.duration === "number" &&
                    Number.isFinite(entry.duration)
                ) {
                    normalized.duration = entry.duration;
                }
                if (Object.prototype.hasOwnProperty.call(entry, "groupId")) {
                    if (entry.groupId === null) {
                        normalized.groupId = null;
                    } else if (typeof entry.groupId === "string") {
                        const trimmed = entry.groupId.trim();
                        if (trimmed) {
                            normalized.groupId = trimmed;
                        }
                    }
                }
                if (Object.keys(normalized).length) {
                    meta[id] = normalized;
                }
            },
        );
        return meta;
    }

    function deriveTimelineFromScene(scene: SceneData): AnimationTimelineMap {
        const meta = getAnimationMetaFromAppState(scene.appState);
        const timeline = cloneTimelineMap(meta);
        scene.elements.forEach((element) => {
            const existing = timeline[element.id];
            if (!existing || typeof existing.order !== "number") {
                const legacy = extractLegacyOrderFromId(element.id);
                if (typeof legacy === "number") {
                    timeline[element.id] = { ...(existing || {}), order: legacy };
                }
            }
        });
        return timeline;
    }

    function buildTimelineRows(
        elements: SceneData["elements"],
        timeline: AnimationTimelineMap,
    ): TimelineRow[] {
        if (!elements?.length) return [];
        const elementMap = new Map(elements.map((el) => [el.id, el]));
        const grouped: Record<string, { members: SceneData["elements"][number][]; origin: "excalidraw" | "virtual" }> = {};
        const standalone: SceneData["elements"][number][] = [];
        elements.forEach((element) => {
            const resolved = resolveEffectiveGroup(element, timeline);
            if (resolved) {
                if (!grouped[resolved.key]) {
                    grouped[resolved.key] = { members: [], origin: resolved.origin };
                }
                grouped[resolved.key].members.push(element);
            } else {
                standalone.push(element);
            }
        });
        type Entry = {
            id: string;
            elements: SceneData["elements"][number][];
            groupId: string | null;
            groupOrigin: "virtual" | "excalidraw" | null;
            memberIds: string[];
            originalIndex: number;
        };

        const entries: Entry[] = [];
        Object.entries(grouped).forEach(([groupId, { members, origin }]) => {
            if (!members.length) return;
            const firstIndex = elements.indexOf(members[0]);
            entries.push({
                id: `group:${groupId}`,
                elements: members,
                groupId,
                groupOrigin: origin,
                memberIds: members.map((m) => m.id),
                originalIndex: firstIndex >= 0 ? firstIndex : 0,
            });
        });
        standalone.forEach((element) => {
            entries.push({
                id: element.id,
                elements: [element],
                groupId: null,
                groupOrigin: null,
                memberIds: [element.id],
                originalIndex: elements.indexOf(element),
            });
        });

        const enriched = entries.map((entry) => {
            const representative = entry.elements[0];
            const orderValue = resolveEntryOrder(entry.memberIds, timeline);
            const numericOrder =
                typeof orderValue === "number" && Number.isFinite(orderValue)
                    ? orderValue
                    : null;
            return {
                id: entry.id,
                label: buildEntryLabel(entry),
                type: entry.groupId ? "group" : representative.type,
                originalIndex: entry.originalIndex,
                orderValue: numericOrder,
                hasCustomOrder: numericOrder !== null,
                detail: entry.groupId
                    ? formatGroupDetail(
                          entry.elements.length,
                          formatElementDetail(representative, elementMap),
                      )
                    : formatElementDetail(representative, elementMap),
                element: representative,
                groupId: entry.groupId,
                groupOrigin: entry.groupOrigin ?? (entry.groupId ? "excalidraw" : null),
                groupSize: entry.elements.length,
                memberIds: entry.memberIds,
                elements: entry.elements,
            };
        });
        enriched.sort((a, b) => {
            if (a.orderValue !== null && b.orderValue !== null) {
                return a.orderValue - b.orderValue;
            }
            if (a.orderValue !== null) return -1;
            if (b.orderValue !== null) return 1;
            return a.originalIndex - b.originalIndex;
        });
        return enriched.map(
            ({
                id,
                label,
                type,
                originalIndex,
                hasCustomOrder,
                detail,
                element,
                groupId,
                groupOrigin,
                groupSize,
                memberIds,
                elements,
            }) => ({
                id,
                label,
                type,
                originalIndex,
                hasCustomOrder,
                detail,
                element,
                groupId,
                groupOrigin,
                groupSize,
                memberIds,
                elements,
            }),
        );
    }

    function formatElementLabel(element: SceneData["elements"][number], index: number) {
        const text = typeof element.text === "string" ? element.text.trim() : "";
        if (text) {
            return text.replace(/\s+/g, " ").slice(0, 80);
        }
        return `${translateType(element.type)} #${index + 1}`;
    }

    function formatElementDetail(
        element: SceneData["elements"][number],
        elementMap: Map<string, SceneData["elements"][number]>,
    ) {
        if (element.type === "arrow") {
            const from = resolveBindingLabel(element.startBinding, elementMap);
            const to = resolveBindingLabel(element.endBinding, elementMap);
            if (from || to) {
                return `${from || translate("animation.orderDetailStart")} → ${to || translate("animation.orderDetailEnd")}`;
            }
            return translate("animation.type.arrow");
        }
        if (element.type === "text") {
            return translate("animation.type.text");
        }
        if (element.type === "image") {
            return translate("animation.type.image");
        }
        const width = Math.max(1, Math.round(Math.abs(element.width ?? 0)));
        const height = Math.max(1, Math.round(Math.abs(element.height ?? 0)));
        const size = `${width}×${height}`;
        return `${formatElementTypeName(element.type)} • ${size}`;
    }

    function buildEntryLabel(
        entry: {
            groupId: string | null;
            elements: SceneData["elements"][number][];
            originalIndex: number;
        },
    ) {
        if (entry.groupId && entry.elements.length) {
            const representative = entry.elements[0];
            return translate("animation.orderGroupCardTitle", {
                type: formatElementTypeName(representative.type),
                count: entry.elements.length,
            });
        }
        const element = entry.elements[0];
        const index = entry.originalIndex >= 0 ? entry.originalIndex : 0;
        return formatElementLabel(element, index);
    }

    function resolveBindingLabel(
        binding: { elementId?: string | null } | null | undefined,
        elementMap: Map<string, SceneData["elements"][number]>,
    ) {
        if (!binding?.elementId) return "";
        const target = elementMap.get(binding.elementId);
        if (!target) return "";
        const text = typeof target.text === "string" ? target.text.trim() : "";
        if (text) {
            return text.replace(/\s+/g, " ").slice(0, 40);
        }
        return formatElementTypeName(target.type);
    }

    function formatElementTypeName(type: string) {
        return translateType(type);
    }

    function translateType(type: string) {
        const key = `animation.type.${type}`;
        const translated = translate(key);
        if (translated !== key) return translated;
        const fallback = translate("animation.type.unknown");
        return fallback !== "animation.type.unknown" ? fallback : type;
    }

    function formatGroupDetail(count: number, sampleDetail: string) {
        const base = translate("animation.orderMemberCount", { count });
        return sampleDetail ? `${base} • ${sampleDetail}` : base;
    }

    function buildClipTitle(row: TimelineRow) {
        const base = formatElementTypeName(row.element?.type ?? row.type);
        if (row.groupSize > 1) {
            return translate("animation.orderClipGroupTitle", { type: base });
        }
        return base || translate("animation.type.unknown");
    }

    function getPrimaryGroupId(element: SceneData["elements"][number]) {
        const ids = Array.isArray(element.groupIds) ? element.groupIds : [];
        if (!ids.length) return null;
        return ids[ids.length - 1] ?? null;
    }

    function resolveEffectiveGroup(
        element: SceneData["elements"][number],
        timeline: AnimationTimelineMap,
    ) {
        const meta = timeline[element.id];
        if (meta && Object.prototype.hasOwnProperty.call(meta, "groupId")) {
            if (meta.groupId === null) {
                return null;
            }
            const trimmed = typeof meta.groupId === "string" ? meta.groupId.trim() : "";
            if (trimmed) {
                return { key: trimmed, origin: "virtual" as const };
            }
            return null;
        }
        const primary = getPrimaryGroupId(element);
        return primary ? { key: primary, origin: "excalidraw" as const } : null;
    }

    function resolveEntryOrder(
        memberIds: string[],
        timeline: AnimationTimelineMap,
    ): number | null {
        const orders = memberIds
            .map((id) => timeline[id]?.order)
            .filter((value): value is number => typeof value === "number");
        if (!orders.length) return null;
        return Math.min(...orders);
    }

    function prepareTimelineOption(
        scene: SceneData,
        overrides: AnimationTimelineMap,
    ): AnimationTimelineMap | undefined {
        const validIds = new Set(scene.elements.map((el) => el.id));
        const sanitized = sanitizeTimelineMap(overrides, validIds);
        return Object.keys(sanitized).length ? sanitized : undefined;
    }

    function recomputeTimelineRows() {
        if (!sceneData) {
            timelineRows = [];
            resetTimelineDragState();
            return;
        }
        timelineRows = buildTimelineRows(sceneData.elements, timelineOverrides);
        resetTimelineDragState();
        rebuildSelectionAfterRowsChange();
    }

    function rebuildSelectionAfterRowsChange() {
        const validRowIds = new Set(timelineRows.map((row) => row.id));
        const next = new Set<string>();
        timelineSelection.forEach((id) => {
            if (validRowIds.has(id)) next.add(id);
        });
        timelineSelection = next;
        if (timelineSelection.size === 0) {
            timelineSelectionAnchor = null;
        } else if (timelineSelectionAnchor && !validRowIds.has(timelineSelectionAnchor)) {
            timelineSelectionAnchor = null;
        }
    }

    function updateSelectionByRowIds(ids: string[], options: { additive?: boolean } = {}) {
        const next = options.additive ? new Set(timelineSelectionSnapshot) : new Set<string>();
        ids.forEach((id) => next.add(id));
        timelineSelection = next;
    }

    function clearSelection() {
        timelineSelection = new Set();
        timelineSelectionAnchor = null;
    }

    function handleClipClick(event: MouseEvent, row: TimelineRow) {
        if ((event.target as HTMLElement | null)?.closest(".clip-actions")) {
            return;
        }
        if (event.shiftKey) {
            if (timelineSelectionAnchor) {
                selectRangeToRow(row);
            } else {
                timelineSelectionAnchor = row.id;
                updateSelectionByRowIds([row.id]);
            }
            return;
        }
        const additive = event.ctrlKey || event.metaKey;
        updateSelectionByRowIds([row.id], { additive });
        timelineSelectionAnchor = row.id;
    }

    function selectRangeToRow(targetRow: TimelineRow) {
        const anchorId = timelineSelectionAnchor ?? targetRow.id;
        const anchorIndex = timelineRows.findIndex((row) => row.id === anchorId);
        const targetIndex = timelineRows.findIndex((row) => row.id === targetRow.id);
        if (anchorIndex === -1 || targetIndex === -1) {
            updateSelectionByRowIds([targetRow.id]);
            timelineSelectionAnchor = targetRow.id;
            return;
        }
        const [start, end] = anchorIndex <= targetIndex ? [anchorIndex, targetIndex] : [targetIndex, anchorIndex];
        const rowsInRange = timelineRows.slice(start, end + 1);
        const next = new Set<string>();
        rowsInRange.forEach((row) => next.add(row.id));
        timelineSelection = next;
        // 保持原始锚点，符合常见 Shift 选择习惯
    }

    function generateVirtualGroupId() {
        return `timeline:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    }

    function handleGroupSelection() {
        if (!selectedRows.length || selectedRows.length < 2) return;
        const newGroupId = generateVirtualGroupId();
        const nextOverrides = cloneTimelineMap(timelineOverrides);
        selectedRows.forEach((row) => {
            row.memberIds.forEach((memberId) => {
                const entry = nextOverrides[memberId] || {};
                entry.groupId = newGroupId;
                nextOverrides[memberId] = entry;
            });
        });
        timelineOverrides = nextOverrides;
        markTimelineDirty(true);
        timelineSelection = new Set(selectedRows.map((row) => row.id));
        timelineSelectionAnchor = selectedRows[selectedRows.length - 1]?.id ?? null;
        recomputeTimelineRows();
        void rebuildFromCurrentScene();
    }

    function handleUngroupSelection() {
        if (!selectedRows.length || !selectedRows.some((row) => row.groupId)) return;
        const nextOverrides = cloneTimelineMap(timelineOverrides);
        selectedRows.forEach((row) => {
            row.memberIds.forEach((memberId) => {
                const entry = nextOverrides[memberId] || {};
                entry.groupId = null;
                nextOverrides[memberId] = entry;
            });
        });
        timelineOverrides = nextOverrides;
        markTimelineDirty(true);
        recomputeTimelineRows();
        // 解绑后保持原有行仍选中（按行 ID）
        const ids = selectedRows.map((row) => row.id);
        const validIds = ids.filter((id) => timelineRows.some((r) => r.id === id));
        timelineSelection = new Set(validIds);
        const lastSelectedRow = [...timelineRows].reverse().find((row) => validIds.includes(row.id));
        timelineSelectionAnchor = lastSelectedRow?.id ?? null;
        void rebuildFromCurrentScene();
    }

    function normalizeRect(rect: { left: number; right: number; top: number; bottom: number }) {
        return {
            left: Math.min(rect.left, rect.right),
            right: Math.max(rect.left, rect.right),
            top: Math.min(rect.top, rect.bottom),
            bottom: Math.max(rect.top, rect.bottom),
        };
    }

    function rectanglesIntersect(
        a: { left: number; right: number; top: number; bottom: number },
        b: DOMRect,
    ) {
        return a.left <= b.right && a.right >= b.left && a.top <= b.bottom && a.bottom >= b.top;
    }

    function markTimelineDirty(force = false) {
        if (!sceneData) return;
        const validIds = new Set(sceneData.elements.map((el) => el.id));
        const dirty = !timelineMapsEqual(
            timelineOverrides,
            timelineSourceSnapshot,
            validIds,
        );
        timelineDirty = force ? true : dirty;
        if (timelineDirty) {
            timelineMessageKey = null;
        }
        timelineErrorMessage = null;
    }

    function moveTimelineRow(id: string, delta: number) {
        const index = timelineRows.findIndex((row) => row.id === id);
        if (index < 0) return;
        moveTimelineRowToIndex(id, index + delta);
    }

    function moveTimelineRowToIndex(id: string, targetIndex: number) {
        const currentIndex = timelineRows.findIndex((row) => row.id === id);
        if (currentIndex < 0) return;
        let insertIndex = targetIndex;
        if (insertIndex < 0) insertIndex = 0;
        if (insertIndex > timelineRows.length) insertIndex = timelineRows.length;
        const updated = [...timelineRows];
        const [moved] = updated.splice(currentIndex, 1);
        if (currentIndex < insertIndex) {
            insertIndex -= 1;
        }
        if (insertIndex < 0) insertIndex = 0;
        if (insertIndex > updated.length) insertIndex = updated.length;
        updated.splice(insertIndex, 0, moved);
        replaceTimelineRows(updated);
    }

    function replaceTimelineRows(rows: TimelineRow[]) {
        timelineRows = rows;
        timelineOverrides = rebuildTimelineMapFromRows(rows, timelineOverrides);
        markTimelineDirty();
        void rebuildFromCurrentScene();
        resetTimelineDragState();
    }

    function resetTimelineDragState() {
        timelineDraggingId = null;
        timelineDragOverId = null;
        timelineDragOverPosition = null;
    }

    function handleTimelineDragStart(event: DragEvent, row: TimelineRow) {
        event.stopPropagation();
        timelineDraggingId = row.id;
        timelineDragOverId = null;
        timelineDragOverPosition = null;
        event.dataTransfer?.setData("text/plain", row.id);
        if (event.dataTransfer) {
            event.dataTransfer.effectAllowed = "move";
        }
    }

    function handleTimelineDragEnd() {
        resetTimelineDragState();
    }

    function registerTimelineRowRef(id: string, node: HTMLDivElement | null) {
        if (!node) {
            timelineRowRefs.delete(id);
            return;
        }
        timelineRowRefs.set(id, node);
    }

    function timelineRowRefAction(node: HTMLDivElement, rowId: string) {
        registerTimelineRowRef(rowId, node);
        return {
            destroy() {
                registerTimelineRowRef(rowId, null);
            },
        };
    }

    function handleTimelineDragOver(event: DragEvent, row: TimelineRow) {
        if (!timelineDraggingId || row.id === timelineDraggingId) return;
        event.preventDefault();
        event.stopPropagation();
        const target = event.currentTarget as HTMLElement | null;
        if (!target) return;
        const rect = target.getBoundingClientRect();
        const relativeX = event.clientX - rect.left;
        const before = relativeX < rect.width / 2;
        timelineDragOverId = row.id;
        timelineDragOverPosition = before ? "before" : "after";
    }

    function handleTimelineDrop(event: DragEvent, row: TimelineRow) {
        if (!timelineDraggingId) return;
        event.preventDefault();
        event.stopPropagation();
        const targetId = row.id;
        const before =
            timelineDragOverId === targetId
                ? timelineDragOverPosition === "before"
                : false;
        const targetIndex = timelineRows.findIndex((item) => item.id === targetId);
        if (targetIndex < 0) {
            handleTimelineDragEnd();
            return;
        }
        const insertIndex = before ? targetIndex : targetIndex + 1;
        moveTimelineRowToIndex(timelineDraggingId, insertIndex);
        handleTimelineDragEnd();
    }

    function handleTimelineTrackDragOver(event: DragEvent) {
        if (!timelineDraggingId) return;
        event.preventDefault();
        event.stopPropagation();
        timelineDragOverId = null;
        timelineDragOverPosition = "after";
    }

    function handleTimelineTrackDrop(event: DragEvent) {
        if (!timelineDraggingId) return;
        event.preventDefault();
        event.stopPropagation();
        moveTimelineRowToIndex(timelineDraggingId, timelineRows.length);
        handleTimelineDragEnd();
    }

    function handleTimelineTrackPointerDown(event: PointerEvent) {
        if (event.button !== 0) return;
        if ((event.target as HTMLElement).closest(".timeline-clip")) return;
        if (!timelineTrackEl) return;
        if (!event.shiftKey) {
            clearSelection();
        }
        isMarqueeSelecting = true;
        marqueePointerId = event.pointerId;
        marqueeOrigin = { x: event.clientX, y: event.clientY };
        marqueeRect = {
            left: event.clientX,
            right: event.clientX,
            top: event.clientY,
            bottom: event.clientY,
        };
        marqueeTrackRect = timelineTrackEl.getBoundingClientRect();
        marqueeBaseSelection = new Set(timelineSelection);
        marqueeAdditive = event.shiftKey;
        timelineTrackEl.setPointerCapture(event.pointerId);
        updateMarqueeVisuals();
        event.preventDefault();
    }

    function handleTimelineTrackPointerMove(event: PointerEvent) {
        if (!isMarqueeSelecting || event.pointerId !== marqueePointerId) return;
        marqueeRect = {
            left: marqueeOrigin?.x ?? event.clientX,
            right: event.clientX,
            top: marqueeOrigin?.y ?? event.clientY,
            bottom: event.clientY,
        };
        updateMarqueeVisuals();
        applyMarqueeSelection();
        event.preventDefault();
    }

    function handleTimelineTrackPointerUp(event: PointerEvent) {
        if (!isMarqueeSelecting || event.pointerId !== marqueePointerId) return;
        finalizeMarqueeSelection();
        event.preventDefault();
    }

    function handleTimelineTrackPointerCancel(event: PointerEvent) {
        if (!isMarqueeSelecting || event.pointerId !== marqueePointerId) return;
        finalizeMarqueeSelection();
    }

    function updateMarqueeVisuals() {
        if (!marqueeRect || !marqueeTrackRect) {
            marqueeBox = null;
            return;
        }
        const normalized = normalizeRect(marqueeRect);
        marqueeBox = {
            left: normalized.left - marqueeTrackRect.left,
            top: normalized.top - marqueeTrackRect.top,
            width: Math.abs(normalized.right - normalized.left),
            height: Math.abs(normalized.bottom - normalized.top),
        };
    }

    function applyMarqueeSelection() {
        if (!marqueeRect) return;
        const normalized = normalizeRect(marqueeRect);
        const draft = new Set<string>();
        timelineRows.forEach((row) => {
            const node = timelineRowRefs.get(row.id);
            if (!node) return;
            const rect = node.getBoundingClientRect();
            if (rectanglesIntersect(normalized, rect)) {
                draft.add(row.id);
            }
        });
        const base = marqueeAdditive ? new Set(marqueeBaseSelection) : new Set<string>();
        draft.forEach((id) => base.add(id));
        timelineSelection = base;
    }

    function finalizeMarqueeSelection() {
        if (!timelineTrackEl || marqueePointerId === null) {
            resetMarqueeState();
            return;
        }
        if (timelineTrackEl.hasPointerCapture(marqueePointerId)) {
            timelineTrackEl.releasePointerCapture(marqueePointerId);
        }
        resetMarqueeState();
        const lastSelectedRow = [...timelineRows]
            .reverse()
            .find((row) => isRowSelected(row));
        timelineSelectionAnchor = lastSelectedRow?.id ?? null;
    }

    function resetMarqueeState() {
        isMarqueeSelecting = false;
        marqueePointerId = null;
        marqueeOrigin = null;
        marqueeRect = null;
        marqueeBox = null;
        marqueeTrackRect = null;
        marqueeBaseSelection = new Set();
        marqueeAdditive = false;
    }

    function rebuildTimelineMapFromRows(
        rows: TimelineRow[],
        previous: AnimationTimelineMap,
    ): AnimationTimelineMap {
        const map: AnimationTimelineMap = {};
        let orderCounter = 0;
        rows.forEach((row) => {
            row.memberIds.forEach((memberId) => {
                const prevEntry = previous[memberId] || {};
                map[memberId] = {
                    ...prevEntry,
                    order: orderCounter,
                    groupId: row.groupOrigin === "virtual" ? row.groupId ?? null : prevEntry.groupId,
                };
                orderCounter += 1;
            });
        });
        return map;
    }

    function resetTimelineEdits() {
        timelineOverrides = cloneTimelineMap(timelineSourceSnapshot);
        recomputeTimelineRows();
        timelineDirty = false;
        timelineMessageKey = null;
        timelineErrorMessage = null;
        void rebuildFromCurrentScene();
    }

    async function saveTimelineEdits() {
        if (target.kind !== "file" || !sceneData) return;
        timelineSaving = true;
        timelineMessageKey = null;
        timelineErrorMessage = null;
        try {
            const path = target.path;
            const baseContent =
                loadedRawContent ?? (await readTextFile(path));
            const parsed = JSON.parse(baseContent);
            const nextAppState =
                (parsed.appState && typeof parsed.appState === "object"
                    ? parsed.appState
                    : {}) ?? {};
            const validIds = new Set(sceneData.elements.map((el) => el.id));
            const sanitized = sanitizeTimelineMap(timelineOverrides, validIds);
            if (Object.keys(sanitized).length) {
                nextAppState[ANIMATION_META_KEY] = sanitized;
            } else {
                delete nextAppState[ANIMATION_META_KEY];
            }
            parsed.appState = nextAppState;
            const nextContent = JSON.stringify(parsed, null, 2);
            await writeTextFile(path, nextContent);
            loadedRawContent = nextContent;
            timelineSourceSnapshot = cloneTimelineMap(sanitized);
            timelineOverrides = cloneTimelineMap(sanitized);
            timelineDirty = false;
            timelineMessageKey = "animation.orderEditorSaved";
            sceneData = parseSceneFromString(nextContent);
            recomputeTimelineRows();
            void rebuildFromCurrentScene();
        } catch (err) {
            console.error("[AnimationTab] save timeline failed", err);
            timelineErrorMessage =
                err instanceof Error ? err.message : String(err ?? "保存失败");
        } finally {
            timelineSaving = false;
        }
    }

    async function loadScene(path: string, theme: ThemeVariant, options: { forceReload?: boolean } = {}) {
        if (!path) return;
        if (!options.forceReload && path === loadedPath && theme === loadedTheme && svgTemplate) {
            rebuildPlayerSvg();
            return;
        }
        const token = ++loadToken;
        loading = true;
        error = null;
        autoFit = true;
        cleanupSvg();
        try {
            const content = await readTextFile(path);
            loadedRawContent = content;
            const scene = parseSceneFromString(content);
            const derivedTimeline = deriveTimelineFromScene(scene);
            timelineOverrides = cloneTimelineMap(derivedTimeline);
            timelineSourceSnapshot = cloneTimelineMap(derivedTimeline);
            timelineDirty = false;
            timelineMessageKey = null;
            timelineErrorMessage = null;
            sceneData = scene;
            timelineRows = buildTimelineRows(scene.elements, timelineOverrides);
            timelineSelection = new Set();
            timelineSelectionAnchor = null;
            resetTimelineDragState();
            const timelineOption = prepareTimelineOption(scene, timelineOverrides);
            const buildOptions = timelineOption ? { timeline: timelineOption } : {};
            const { svg, finishedMs } = await buildAnimatedSvg(scene, theme, buildOptions);
            if (token !== loadToken) {
                svg.remove();
                return;
            }
            svgTemplate = svg;
            baseFinishedMs = finishedMs;
            loadedPath = path;
            loadedTheme = theme;
            exportThemeLocked = false;
            rebuildPlayerSvg();
        } catch (err) {
            if (token !== loadToken) {
                return;
            }
            console.error("[AnimationTab] load failed", err);
            if (err instanceof ExcalidrawSceneError) {
                error = err.message;
            } else if (err instanceof Error) {
                error = err.message;
            } else {
                error = String(err ?? "加载失败");
            }
            svgTemplate = null;
            loadedPath = null;
            sceneData = null;
            timelineOverrides = {};
            timelineSourceSnapshot = {};
            timelineRows = [];
            timelineSelection = new Set();
            timelineSelectionAnchor = null;
            timelineDirty = false;
            resetTimelineDragState();
        } finally {
            if (token === loadToken) {
                loading = false;
            }
        }
    }

    function rebuildPlayerSvg() {
        if (!svgTemplate) return;
        const clone = svgTemplate.cloneNode(true) as SVGSVGElement;
        effectiveFinishedMs = applyPlaybackSpeed(clone, playbackPrefs.speed || 1);
        appliedSpeed = playbackPrefs.speed || 1;
        attachSvg(clone);
        autoplayFromStart();
    }

    function applyPlaybackSpeed(svg: SVGSVGElement, speed: number): number {
        const safeSpeed = speed > 0 ? speed : 1;
        const scale = 1 / safeSpeed;
        const nodes = svg.querySelectorAll<SVGElement>("animate, animateMotion, animateTransform");
        nodes.forEach((node) => {
            scaleTimingAttribute(node, "begin", scale);
            scaleTimingAttribute(node, "dur", scale);
        });
        return Math.max(0, Math.round(baseFinishedMs * scale));
    }

    function scaleTimingAttribute(node: SVGElement, attr: string, scale: number) {
        const raw = node.getAttribute(attr);
        if (!raw) return;
        const updated = raw.replace(/(-?\d+(?:\.\d+)?)(ms|s)?/gi, (match, value, unit) => {
            if (value == null) {
                return match;
            }
            const numeric = Number(value);
            if (!Number.isFinite(numeric)) {
                return match;
            }
            const normalizedUnit = unit?.toLowerCase();
            const baseMs = normalizedUnit === "s" ? numeric * 1000 : numeric;
            const scaledMs = baseMs * scale;
            if (normalizedUnit === "s") {
                return `${formatTimeValue(scaledMs / 1000)}s`;
            }
            const suffix = normalizedUnit === "ms" ? "ms" : "";
            return `${formatTimeValue(scaledMs)}${suffix}`;
        });
        node.setAttribute(attr, updated);
    }

    function formatTimeValue(value: number): string {
        if (!Number.isFinite(value)) return "0";
        if (Math.abs(value) < 1e-6) return "0";
        const rounded = Math.round(value * 1000) / 1000;
        if (Math.abs(rounded - Math.trunc(rounded)) < 1e-3) {
            return Math.trunc(rounded).toString();
        }
        return rounded.toFixed(3).replace(/\.0+$/, "").replace(/0+$/, "");
    }

    function autoplayFromStart() {
        if (!currentSvg) return;
        try {
            currentSvg.setCurrentTime(0);
            currentSvg.unpauseAnimations();
            paused = false;
        } catch (err) {
            console.warn("[AnimationTab] autoplay failed", err);
        }
    }

    function restartAnimation() {
        if (!currentSvg) return;
        try {
            currentSvg.setCurrentTime(0);
            currentSvg.unpauseAnimations();
            paused = false;
        } catch (err) {
            console.warn("[AnimationTab] restart failed", err);
        }
    }

    function pauseAnimation(silent = false) {
        if (!currentSvg) return;
        try {
            currentSvg.pauseAnimations();
            if (!silent) {
                paused = true;
            }
        } catch (err) {
            console.warn("[AnimationTab] pause failed", err);
        }
    }

    function resumeAnimation() {
        if (!currentSvg) return;
        try {
            currentSvg.unpauseAnimations();
            paused = false;
        } catch (err) {
            console.warn("[AnimationTab] resume failed", err);
        }
    }

    function jumpToEnd() {
        if (!currentSvg || !effectiveFinishedMs) return;
        try {
            currentSvg.setCurrentTime(effectiveFinishedMs / 1000);
            currentSvg.pauseAnimations();
            paused = true;
        } catch (err) {
            console.warn("[AnimationTab] jumpToEnd failed", err);
        }
    }

    function togglePlayback() {
        if (!currentSvg) return;
        if (paused) {
            resumeAnimation();
        } else {
            pauseAnimation();
        }
    }

    function startLoopWatcher() {
        stopLoopWatcher();
        const tick = () => {
            if (!currentSvg || !playbackPrefs.loop || !effectiveFinishedMs) {
                loopRaf = null;
                return;
            }
            try {
                const now = currentSvg.getCurrentTime() * 1000;
                if (now >= effectiveFinishedMs - 16) {
                    currentSvg.setCurrentTime(0);
                    currentSvg.unpauseAnimations();
                }
            } catch {}
            loopRaf = requestAnimationFrame(tick);
        };
        loopRaf = requestAnimationFrame(tick);
    }

    function stopLoopWatcher() {
        if (loopRaf !== null) {
            cancelAnimationFrame(loopRaf);
            loopRaf = null;
        }
    }

    $: {
        const next = clampSpeed(playbackPrefs.speed);
        resolvedSpeed = next;
        const formatted = formatSpeedValue(next);
        if (formatted !== selectedSpeed) {
            selectedSpeed = formatted;
        }
    }

    function handleSpeedInput(event: Event) {
        const inputEl = event.currentTarget as HTMLInputElement | null;
        if (!inputEl) return;
        const value = inputEl.value;
        selectedSpeed = value;
        const parsed = Number(value);
        if (Number.isFinite(parsed) && parsed > 0) {
            commitSpeedValue(parsed);
        }
    }

    function handleSpeedBlur(event: Event) {
        const inputEl = event.currentTarget as HTMLInputElement | null;
        const parsed = inputEl ? Number(inputEl.value) : NaN;
        const fallback = Number.isFinite(parsed) && parsed > 0 ? parsed : resolvedSpeed;
        const normalized = clampSpeed(snapSpeed(fallback));
        selectedSpeed = formatSpeedValue(normalized);
        commitSpeedValue(normalized);
    }

    function adjustSpeed(delta: number) {
        const next = clampSpeed(snapSpeed(resolvedSpeed + delta));
        selectedSpeed = formatSpeedValue(next);
        commitSpeedValue(next);
    }

    function commitSpeedValue(value: number) {
        const clamped = clampSpeed(snapSpeed(value));
        animationPlaybackPrefs.update((prefs) => ({ ...prefs, speed: clamped }));
    }

    function clampSpeed(value: number): number {
        const safe = Number.isFinite(value) && value > 0 ? value : 1;
        return Math.min(SPEED_MAX, Math.max(SPEED_MIN, safe));
    }

    function snapSpeed(value: number): number {
        return Math.round(value / SPEED_STEP) * SPEED_STEP;
    }

    function formatSpeedValue(value: number): string {
        if (!Number.isFinite(value)) return "1";
        const rounded = Math.round(value * 100) / 100;
        return String(rounded);
    }

    function toggleLoop() {
        animationPlaybackPrefs.update((prefs) => ({ ...prefs, loop: !prefs.loop }));
    }

    function formatDuration(ms: number): string {
        if (!ms) return "0s";
        const seconds = ms / 1000;
        if (seconds < 10) {
            return `${seconds.toFixed(1)}s`;
        }
        if (seconds < 60) {
            return `${seconds.toFixed(0)}s`;
        }
        const minutes = Math.floor(seconds / 60);
        const rest = Math.floor(seconds % 60)
            .toString()
            .padStart(2, "0");
        return `${minutes}:${rest}`;
    }

    function deriveDefaultFileName(): string {
        if (!target || target.kind !== "file") return "excalidraw-animation";
        const base = target.label || target.path.split(/[/\\]/).pop() || "excalidraw";
        return base.replace(/\.excalidraw$/i, "") || "excalidraw";
    }

    function formatExportTargetLabel(path: string): string {
        if (!path) return "animation.gif";
        const normalized = path.replace(/\\/g, "/");
        const parts = normalized.split("/");
        const fileName = parts[parts.length - 1];
        if (fileName && fileName.trim()) {
            return fileName;
        }
        return normalized || "animation.gif";
    }

    function resetSvgPreviewTransforms(svg: SVGSVGElement) {
        svg.style.transform = "";
        svg.style.transformOrigin = "";
    }

    function createExportSvg(): SVGSVGElement | null {
        if (svgTemplate) {
            const clone = svgTemplate.cloneNode(true) as SVGSVGElement;
            applyPlaybackSpeed(clone, playbackPrefs.speed || 1);
            resetSvgPreviewTransforms(clone);
            return clone;
        }
        if (currentSvg) {
            const clone = currentSvg.cloneNode(true) as SVGSVGElement;
            resetSvgPreviewTransforms(clone);
            return clone;
        }
        return null;
    }

    async function handleExportSvg() {
        const exportSvg = createExportSvg();
        if (!exportSvg) return;
        exporting = { ...exporting, svg: true };
        try {
            await exportAnimatedSvgFile(exportSvg, {
                defaultFileName: `${deriveDefaultFileName()}-animate.svg`,
                theme: exportTheme,
                includeBackground: exportIncludeBackground,
            });
        } catch (err) {
            console.error("[AnimationTab] export svg failed", err);
            error = err instanceof Error ? err.message : String(err ?? "导出失败");
        } finally {
            exporting = { ...exporting, svg: false };
        }
    }

    async function handleExportSequence() {
        if (!sceneData) return;
        exporting = { ...exporting, svgSequence: true };
        try {
            await exportSvgSequenceZip(sceneData, {
                theme: exportTheme,
                includeBackground: exportIncludeBackground,
                defaultFileName: `${deriveDefaultFileName()}-frames`,
            });
        } catch (err) {
            console.error("[AnimationTab] export sequence failed", err);
            error = err instanceof Error ? err.message : String(err ?? "导出失败");
        } finally {
            exporting = { ...exporting, svgSequence: false };
        }
    }

    async function handleExportGif() {
        if (!sceneData) return;
        exporting = { ...exporting, gif: true };
        let pendingNotificationId: number | null = null;
        let pendingFileLabel: string | null = null;
        try {
            const resultPath = await exportAnimatedGif(
                sceneData,
                {
                    theme: exportTheme,
                    includeBackground: exportIncludeBackground,
                    defaultFileName: `${deriveDefaultFileName()}-animate`,
                    estimatedDurationMs: effectiveFinishedMs || baseFinishedMs || undefined,
                    shouldLoop: exportGifLoop,
                },
                {
                    onConfirmed: ({ path }) => {
                        pendingFileLabel = formatExportTargetLabel(path);
                        const title = translate("animation.notifications.gifExportPendingTitle", {
                            name: pendingFileLabel,
                        });
                        const message = translate("animation.notifications.gifExportPendingMessage");
                        pendingNotificationId = addNotification(NotifType.Message, title, [], message);
                    },
                },
            );
            if (resultPath) {
                const label = pendingFileLabel ?? formatExportTargetLabel(resultPath);
                const successTitle = translate("animation.notifications.gifExportSuccessTitle", {
                    name: label,
                });
                const successMessage = translate("animation.notifications.gifExportSuccessMessage");
                if (pendingNotificationId !== null) {
                    updateNotification(pendingNotificationId, {
                        type: NotifType.Success,
                        title: successTitle,
                        message: successMessage,
                    });
                    pendingNotificationId = null;
                } else {
                    addNotification(NotifType.Success, successTitle, [], successMessage);
                }
            }
        } catch (err) {
            console.error("[AnimationTab] export gif failed", err);
            const label = pendingFileLabel ?? translate("animation.notifications.gifExportDefaultName");
            const failureTitle = translate("animation.notifications.gifExportFailedTitle", { name: label });
            const failureMessage = translate("animation.notifications.gifExportFailedMessage");
            if (pendingNotificationId !== null) {
                updateNotification(pendingNotificationId, {
                    type: NotifType.Error,
                    title: failureTitle,
                    message: failureMessage,
                });
            } else {
                addNotification(NotifType.Error, failureTitle, [], failureMessage);
            }
            error = err instanceof Error ? err.message : String(err ?? "导出失败");
        } finally {
            exporting = { ...exporting, gif: false };
        }
    }

    function markExportTheme(value: ThemeVariant) {
        exportThemeLocked = true;
        exportTheme = value;
    }

    function toggleExportTheme() {
        const next = exportTheme === "dark" ? "light" : "dark";
        markExportTheme(next);
    }

    function handleReload() {
        if (activePath) {
            void loadScene(activePath, resolveTheme(), { forceReload: true });
        }
    }
</script>

    <div class="animation-tab" class:hidden={hidden} class:dark-theme={$is_dark_theme}>
    {#if showEmptyState}
        <div class="animation-empty">
            <p>{$t('animation.emptyStateMessage')}</p>
            <p class="hint">{$t('animation.emptyStateHint')}</p>
        </div>
    {:else}
        <div class="toolbar">
            <!-- 播放控制 -->
            <div class="toolbar-group">
                <button type="button" class="toolbar-btn" on:click={togglePlayback} disabled={!stageReady}>
                    {#if paused}
                        <Play size={16} strokeWidth={1.5} />
                    {:else}
                        <Pause size={16} strokeWidth={1.5} />
                    {/if}
                    <span>{paused ? $t('animation.play') : $t('animation.pause')}</span>
                </button>
                
                <button type="button" class="toolbar-btn" on:click={restartAnimation} disabled={!stageReady}>
                    <RotateCcw size={16} strokeWidth={1.5} />
                    <span>{$t('animation.restart')}</span>
                </button>
                
                <button type="button" class="toolbar-btn" on:click={jumpToEnd} disabled={!stageReady}>
                    <SkipForward size={16} strokeWidth={1.5} />
                    <span>{$t('animation.jumpToEnd')}</span>
                </button>
                
                <button
                    type="button"
                    class="toolbar-btn"
                    class:active={playbackPrefs.loop}
                    on:click={toggleLoop}
                    disabled={!stageReady}
                >
                    <Repeat size={16} strokeWidth={1.5} />
                    <span>{$t('animation.loop')}</span>
                </button>
            </div>

            <!-- 播放速度 -->
            <div class="toolbar-group">
                <button
                    type="button"
                    class="toolbar-btn"
                    on:click={() => adjustSpeed(-SPEED_STEP)}
                    disabled={!stageReady || resolvedSpeed <= SPEED_MIN}
                >
                    <Minus size={16} strokeWidth={1.5} />
                    <span>{$t('animation.slower')}</span>
                </button>
                
                <span class="speed-label">{selectedSpeed}x</span>
                
                <button
                    type="button"
                    class="toolbar-btn"
                    on:click={() => adjustSpeed(SPEED_STEP)}
                    disabled={!stageReady || resolvedSpeed >= SPEED_MAX}
                >
                    <Plus size={16} strokeWidth={1.5} />
                    <span>{$t('animation.faster')}</span>
                </button>
            </div>

            <!-- 缩放控制 -->
            <div class="toolbar-group">
                <button
                    type="button"
                    class="toolbar-btn"
                    on:click={() => handleZoomStep(-ZOOM_STEP)}
                    disabled={!stageReady || zoom <= ZOOM_MIN + 1e-4}
                    title="缩小"
                >
                    <Minus size={16} strokeWidth={1.5} />
                    <span>缩小</span>
                </button>
                <span class="speed-label">{Math.round(zoom * 100)}%</span>
                <button
                    type="button"
                    class="toolbar-btn"
                    on:click={() => handleZoomStep(ZOOM_STEP)}
                    disabled={!stageReady || zoom >= ZOOM_MAX - 1e-4}
                    title="放大"
                >
                    <Plus size={16} strokeWidth={1.5} />
                    <span>放大</span>
                </button>
                <button
                    type="button"
                    class="toolbar-btn"
                    on:click={handleZoomFit}
                    disabled={!stageReady}
                    title="适应窗口"
                >
                    <RefreshCcw size={16} strokeWidth={1.5} />
                    <span>适应</span>
                </button>
                <button
                    type="button"
                    class="toolbar-btn"
                    on:click={handleZoomReset}
                    disabled={!stageReady}
                    title="100%"
                >
                    <RotateCcw size={16} strokeWidth={1.5} />
                    <span>100%</span>
                </button>
            </div>

            <!-- 导出功能 -->
            <div class="toolbar-group toolbar-group--right">
                <button type="button" class="toolbar-btn" on:click={() => exportIncludeBackground = !exportIncludeBackground}>
                    {#if exportIncludeBackground}
                        <Check size={16} strokeWidth={1.5} />
                    {:else}
                        <Square size={16} strokeWidth={1.5} />
                    {/if}
                    {$t('animation.exportBackground')}
                </button>
                
                <button type="button" class="toolbar-btn" on:click={toggleExportTheme}>
    {$t('animation.exportTheme')} {exportTheme === "dark" ? $t('animation.dark') : $t('animation.light')}
                </button>

                <button
                    type="button"
                    class="toolbar-btn"
                    class:active={exportGifLoop}
                    on:click={() => (exportGifLoop = !exportGifLoop)}
                    title={$t(exportGifLoop ? "animation.gifLoopOn" : "animation.gifLoopOff")}
                >
                    <Repeat size={16} strokeWidth={1.5} />
                    <span>{$t(exportGifLoop ? "animation.gifLoopOn" : "animation.gifLoopOff")}</span>
                </button>
                 
                <button type="button" class="toolbar-btn" on:click={handleExportSvg} disabled={!stageReady || exporting.svg}>
                    {#if exporting.svg}
                        <Loader2 size={16} class="spin" />
                    {:else}
                        <Download size={16} strokeWidth={1.5} />
                    {/if}
                    {$t('animation.exportSvg')}
                </button>
                
                <button type="button" class="toolbar-btn" on:click={handleExportSequence} disabled={!stageReady || exporting.svgSequence}>
                    {#if exporting.svgSequence}
                        <Loader2 size={16} class="spin" />
                    {:else}
                        <Layers size={16} strokeWidth={1.5} />
                    {/if}
                    {$t('animation.exportSequence')}
                </button>
                
                <button type="button" class="toolbar-btn" on:click={handleExportGif} disabled={!stageReady || exporting.gif}>
                    {#if exporting.gif}
                        <Loader2 size={16} class="spin" />
                    {:else}
                        <Film size={16} strokeWidth={1.5} />
                    {/if}
                    {$t('animation.exportGif')}
                </button>
            </div>

            <!-- 信息显示 -->
            <div class="toolbar-group">
                <button
                    type="button"
                    class="toolbar-btn"
                    on:click={() => (timelineEditorOpen = !timelineEditorOpen)}
                    disabled={!sceneData}
                >
                    <ListOrdered size={16} strokeWidth={1.5} />
                    <span>{$t('animation.editOrder')}</span>
                    {#if timelineDirty}
                        <span class="unsaved-dot" aria-hidden="true"></span>
                    {/if}
                </button>

                <span class="duration-chip">{$t('animation.duration')} {formattedDuration}</span>
                
                <button type="button" class="toolbar-btn" on:click={handleReload} disabled={!activePath || loading}>
                    <RefreshCcw size={16} strokeWidth={1.5} />
                    {$t('animation.reload')}
                </button>
            </div>
        </div>

        <section class="animation-stage">
            <div
                class="stage"
                bind:this={stageViewport}
                class:pannable={canPanNow}
                class:panning={isPanning}
                on:wheel|nonpassive={handleStageWheel}
                on:pointerdown={handlePointerDown}
                on:pointermove={handlePointerMove}
                on:pointerup={handlePointerUp}
                on:pointerleave={handlePointerUp}
                on:pointercancel={handlePointerUp}
                on:touchstart|nonpassive={handleTouchStart}
                on:touchmove|nonpassive={handleTouchMove}
                on:touchend={handleTouchEnd}
            >
                <div class="stage-content" bind:this={stageEl}></div>
            </div>
            {#if loading}
                <div class="stage-overlay">
                    <Loader2 size={24} class="spin" />
                    <span>{$t('animation.generating')}</span>
                </div>
            {:else if error}
                <div class="stage-overlay stage-overlay--error">
                    <p>{error}</p>
                    <button type="button" on:click={handleReload}>{$t('animation.retry')}</button>
                </div>
            {:else if !currentSvg}
                <div class="stage-overlay">
                    {$t('animation.noSvg')}
                </div>
            {/if}
        </section>
        {#if timelineEditorOpen && timelineRows.length}
            <section class="timeline-editor">
                <div class="timeline-header">
                    <p class="timeline-tip">
                        {$t('animation.orderEditorHint')}
                    </p>
                    <div class="timeline-actions">
                        <button
                            type="button"
                            class="toolbar-btn"
                            on:click={handleGroupSelection}
                            disabled={!canGroupSelection || timelineSaving}
                        >
                            <Group size={16} strokeWidth={1.5} />
                            {$t('animation.orderGroup')}
                        </button>
                        <button
                            type="button"
                            class="toolbar-btn"
                            on:click={handleUngroupSelection}
                            disabled={!canUngroupSelection || timelineSaving}
                        >
                            <Ungroup size={16} strokeWidth={1.5} />
                            {$t('animation.orderUngroup')}
                        </button>
                        <button
                            type="button"
                            class="toolbar-btn"
                            on:click={resetTimelineEdits}
                            disabled={!timelineDirty || timelineSaving}
                        >
                            <Undo2 size={16} strokeWidth={1.5} />
                            {$t('animation.orderEditorReset')}
                        </button>
                        <button
                            type="button"
                            class="toolbar-btn"
                            on:click={saveTimelineEdits}
                            disabled={!timelineDirty || timelineSaving}
                        >
                            {#if timelineSaving}
                                <Loader2 size={16} class="spin" />
                            {:else}
                                <Save size={16} strokeWidth={1.5} />
                            {/if}
                            {$t('animation.orderEditorSave')}
                        </button>
                    </div>
                </div>
                {#if timelineMessageKey}
                    <p class="timeline-message success">{$t(timelineMessageKey)}</p>
                {/if}
                {#if timelineErrorMessage}
                    <p class="timeline-message error">{timelineErrorMessage}</p>
                {/if}
                    <div
                        class="timeline-track"
                        bind:this={timelineTrackEl}
                        on:pointerdown={handleTimelineTrackPointerDown}
                    on:pointermove={handleTimelineTrackPointerMove}
                    on:pointerup={handleTimelineTrackPointerUp}
                    on:pointercancel={handleTimelineTrackPointerCancel}
                    on:dragover|preventDefault={handleTimelineTrackDragOver}
                    on:drop|preventDefault={handleTimelineTrackDrop}
                >
                    {#each timelineRows as row, index (row.id)}
                        <div
                            class="timeline-clip"
                            class:dragging={timelineDraggingId === row.id}
                            class:drop-before={timelineDragOverId === row.id && timelineDragOverPosition === "before"}
                            class:drop-after={timelineDragOverId === row.id && timelineDragOverPosition === "after"}
                            class:selected={timelineSelectionSnapshot.has(row.id)}
                            draggable="true"
                            use:timelineRowRefAction={row.id}
                            on:dragstart={(event) => handleTimelineDragStart(event, row)}
                            on:dragend={handleTimelineDragEnd}
                            on:dragover={(event) => handleTimelineDragOver(event, row)}
                            on:drop={(event) => handleTimelineDrop(event, row)}
                            on:click|stopPropagation={(event) => handleClipClick(event, row)}
                        >
                            <div class="clip-order-badge">
                                {index + 1}
                            </div>
                            <div class="clip-thumb" title={formatElementTypeName(row.element?.type ?? row.type)}>
                                {#if row.groupSize > 1}
                                    <GroupThumbnail elements={row.elements} size={96} />
                                {:else}
                                    <ElementThumbnail element={row.element} size={88} />
                                {/if}
                            </div>
                            <div class="clip-label">
                                <span class="clip-label__title">{buildClipTitle(row)}</span>
                                {#if row.groupSize > 1}
                                    <span class="clip-label__badge">{row.groupSize}</span>
                                {/if}
                            </div>
                        </div>
                    {/each}
                    {#if marqueeBox}
                        <div
                            class="timeline-marquee"
                            style={`left:${marqueeBox.left}px;top:${marqueeBox.top}px;width:${marqueeBox.width}px;height:${marqueeBox.height}px;`}
                        ></div>
                    {/if}
                </div>
            </section>
        {/if}
    {/if}
</div>

<style lang="scss">
    .animation-tab {
        display: flex;
        flex-direction: column;
        flex: 1 1 0; /* 让整个 Tab 在父级里占满并可收缩，避免被裁切 */
        height: 100%;
        min-height: 0; /* 允许子项在 flex 容器内正确收缩 */
        padding: 0;
        gap: 0;
        overflow: hidden auto; /* 高度不足时允许垂直滚动，避免顶部控件被裁剪 */
        color: var(--foreground, #333);
        background: var(--tab-toolbar-background, #f5f5f5);
    }

    .dark-theme .animation-tab {
        color: var(--foreground, #e2e8f0);
        background: var(--tab-toolbar-background, #0f172a);
    }

    .animation-tab.hidden {
        display: none;
    }



    .toolbar {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 12px;
        padding: 8px 12px;
        background: var(--panel-background, #f5f5f5);
        border-bottom: 1px solid var(--border-color, #e0e0e0);
        flex-shrink: 0;
    }

    .dark-theme .toolbar {
        background: var(--panel-background, #1e293b);
        border-bottom: 1px solid var(--border-color, #334155);
    }

    .toolbar-group {
        display: flex;
        align-items: center;
        gap: 0;
        background: rgba(0, 0, 0, 0.05);
        border-radius: 6px;
        padding: 2px;
        border: 1px solid rgba(0, 0, 0, 0.1);
    }

    .dark-theme .toolbar-group {
        background: rgba(255, 255, 255, 0.05);
        border: 1px solid rgba(255, 255, 255, 0.1);
    }

    .toolbar-group--right {
        margin-left: auto;
    }

    .toolbar-btn {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 6px 8px;
        border: none;
        background: transparent;
        color: var(--foreground, #333);
        cursor: pointer;
        border-radius: 4px;
        font-size: 12px;
        transition: all 0.15s ease;
        white-space: nowrap;
        position: relative;
        height: 28px;
        box-sizing: border-box;
    }

    .toolbar-group .toolbar-btn:first-child {
        border-top-left-radius: 4px;
        border-bottom-left-radius: 4px;
    }

    .toolbar-group .toolbar-btn:last-child {
        border-top-right-radius: 4px;
        border-bottom-right-radius: 4px;
    }

    .toolbar-group .toolbar-btn:not(:first-child):not(:last-child) {
        border-radius: 0;
    }

    .toolbar-btn:hover:not(:disabled) {
        background: rgba(59, 130, 246, 0.1);
        color: #3b82f6;
    }

    .toolbar-btn:active {
        transform: scale(0.95);
    }

    .toolbar-btn.active {
        background: rgba(59, 130, 246, 0.1);
        color: #3b82f6;
    }

    .toolbar-btn:disabled {
        opacity: 0.45;
        cursor: not-allowed;
        color: var(--foreground, #333);
    }

    .toolbar-divider {
        width: 1px;
        height: 20px;
        background: var(--border-color, #e0e0e0);
        margin: 0 8px;
    }

    .speed-display {
        display: flex;
        align-items: center;
        background: transparent;
        border-radius: 0;
        padding: 4px 8px;
        height: auto;
        min-width: 40px;
    }

    .speed-input {
        width: 100%;
        min-width: 32px;
        background: transparent;
        border: none;
        color: var(--foreground, #333);
        text-align: center;
        font-size: 12px;
        font-weight: 500;
        outline: none;
    }

    .toolbar-checkbox {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        cursor: pointer;
        font-size: 12px;
        color: var(--foreground, #333);
        white-space: nowrap;
        padding: 6px 8px;
        border-radius: 4px;
        transition: all 0.15s ease;
        position: relative;
        height: 28px;
        box-sizing: border-box;
    }

    .toolbar-group .toolbar-checkbox:first-child {
        border-top-left-radius: 4px;
        border-bottom-left-radius: 4px;
    }

    .toolbar-group .toolbar-checkbox:last-child {
        border-top-right-radius: 4px;
        border-bottom-right-radius: 4px;
    }

    .toolbar-checkbox:hover {
        background: rgba(59, 130, 246, 0.1);
        color: #3b82f6;
    }

    .toolbar-checkbox input[type="checkbox"] {
        display: none;
    }

    .checkmark {
        width: 14px;
        height: 14px;
        border: 1px solid var(--border-color, #e0e0e0);
        border-radius: 3px;
        background: transparent;
        position: relative;
        transition: all 0.15s ease;
    }

    .toolbar-checkbox input[type="checkbox"]:checked + .checkmark {
        background: #3b82f6;
        border-color: #3b82f6;
    }

    .toolbar-checkbox input[type="checkbox"]:checked + .checkmark::after {
        content: "✓";
        position: absolute;
        top: -2px;
        left: 1px;
        color: white;
        font-size: 10px;
        font-weight: bold;
    }

    .duration-chip {
        font-size: 11px;
        padding: 6px 8px;
        border-radius: 4px;
        background: transparent;
        color: var(--foreground, #333);
        white-space: nowrap;
        position: relative;
        height: 28px;
        box-sizing: border-box;
        display: flex;
        align-items: center;
    }

    .toolbar-group .duration-chip:first-child {
        border-top-left-radius: 4px;
        border-bottom-left-radius: 4px;
    }

    .toolbar-group .duration-chip:last-child {
        border-top-right-radius: 4px;
        border-bottom-right-radius: 4px;
    }

    .speed-label {
        font-size: 12px;
        padding: 6px 8px;
        color: var(--foreground, #333);
        white-space: nowrap;
        font-weight: 500;
        height: 28px;
        box-sizing: border-box;
        display: flex;
        align-items: center;
    }

    @media (max-width: 768px) {
        .toolbar {
            gap: 6px;
        }
    }

    .animation-stage {
        position: relative;
        flex: 1 1 0;
        min-height: 280px; /* 避免高度被挤压到只显示局部 */
        background: rgba(2, 6, 23, 0.45);
        overflow: hidden;
    }

    .stage {
        width: 100%;
        height: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 16px;
        overflow: hidden;
        box-sizing: border-box;
        touch-action: none;
        user-select: none;
        cursor: default;
    }

    .stage.pannable {
        cursor: grab;
    }

    .stage.panning {
        cursor: grabbing;
    }

    .stage-content {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        flex: 0 0 auto;
        overflow: visible; /* 关键：允许 SVG 缩放后溢出容器 */
        /* 容器只做平移，不会导致残影 */
        transform-origin: center center;
        will-change: transform;
        /* 禁用过渡，让平移瞬间响应，与 SVG 缩放同步 */
        transition: none;
    }

    .stage svg {
        width: auto;
        height: auto;
        max-width: none;
        max-height: none;
        flex-shrink: 0;
        pointer-events: none;
        /* SVG 从中心缩放，保持原有坐标计算逻辑，避免残影 */
        transform-origin: center center;
        will-change: transform;
        /* 不使用过渡动画，让缩放瞬间响应，更接近原生图片缩放体验 */
        transition: none;
    }

    .stage-overlay {
        position: absolute;
        inset: 0;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 8px;
        font-size: 0.95rem;
        backdrop-filter: blur(2px);
        background: rgba(15, 23, 42, 0.55);
        text-align: center;
        padding: 16px;
    }

    .stage-overlay--error {
        color: #fecaca;
    }

    .stage-overlay--error button {
        margin-top: 4px;
        border-radius: 6px;
        padding: 6px 14px;
        border: 1px solid rgba(248, 113, 113, 0.8);
        background: transparent;
        color: inherit;
    }

    .animation-empty {
        margin: auto;
        text-align: center;
        color: rgba(248, 250, 252, 0.8);
        max-width: 520px;
        line-height: 1.6;
        padding: 20px;
    }

    .animation-empty .hint {
        font-size: 0.85rem;
        color: rgba(248, 250, 252, 0.6);
        margin-top: 8px;
    }

    .spin {
        animation: spin 1.2s linear infinite;
    }

    .timeline-editor {
        border-top: 1px solid var(--border-color, #e0e0e0);
        background: var(--panel-background, #f8fafc);
        padding: 8px 12px 12px;
        display: flex;
        flex-direction: column;
        gap: 8px;
    }

    .dark-theme .timeline-editor {
        border-top: 1px solid var(--border-color, #334155);
        background: var(--panel-background, #0f172a);
    }

    .timeline-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
    }

    .timeline-tip {
        margin: 0;
        font-size: 12px;
        color: rgba(15, 23, 42, 0.7);
    }

    .dark-theme .timeline-tip {
        color: rgba(226, 232, 240, 0.75);
    }

    .timeline-actions {
        display: flex;
        gap: 8px;
        align-items: center;
    }

    .timeline-track {
        display: flex;
        gap: 10px;
        padding: 10px 4px;
        overflow-x: auto;
        scroll-snap-type: x proximity;
        position: relative;
        user-select: none;
        border: 1px dashed var(--border-color, rgba(148, 163, 184, 0.5));
        border-radius: 12px;
        background: rgba(148, 163, 184, 0.08);
    }

    .dark-theme .timeline-track {
        border-color: rgba(94, 234, 212, 0.3);
        background: rgba(15, 23, 42, 0.35);
    }

    .timeline-clip {
        display: flex;
        flex-direction: column;
        align-items: stretch;
        gap: 6px;
        padding: 8px;
        border: 1px solid var(--border-color, #e0e0e0);
        border-radius: 10px;
        background: #fff;
        width: 120px;
        min-width: 120px;
        cursor: grab;
        position: relative;
        transition: border-color 0.15s ease, box-shadow 0.15s ease;
        scroll-snap-align: start;
    }

    .timeline-clip.selected {
        border-color: #2563eb;
        box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.15);
        background: rgba(37, 99, 235, 0.05);
    }

    .dark-theme .timeline-clip.selected {
        border-color: #60a5fa;
        background: rgba(96, 165, 250, 0.18);
        box-shadow: 0 0 0 2px rgba(96, 165, 250, 0.25);
    }

    .timeline-clip.dragging {
        opacity: 0.6;
        cursor: grabbing;
    }

    .timeline-clip.drop-before::before,
    .timeline-clip.drop-after::after {
        content: "";
        position: absolute;
        top: 6px;
        bottom: 6px;
        width: 3px;
        background: #3b82f6;
        border-radius: 999px;
    }

    .timeline-clip.drop-before::before {
        left: -4px;
    }

    .timeline-clip.drop-after::after {
        right: -4px;
    }

    .dark-theme .timeline-clip {
        border: 1px solid var(--border-color, #334155);
        background: rgba(255, 255, 255, 0.04);
    }

    .timeline-clip:hover {
        border-color: #3b82f6;
        box-shadow: 0 6px 18px rgba(59, 130, 246, 0.2);
    }

    .clip-order-badge {
        position: absolute;
        top: 6px;
        right: 6px;
        min-width: 24px;
        height: 20px;
        padding: 0 6px;
        border-radius: 999px;
        background: rgba(59, 130, 246, 0.2);
        color: #1d4ed8;
        font-weight: 700;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        font-size: 11px;
    }

    .dark-theme .clip-order-badge {
        background: rgba(59, 130, 246, 0.35);
        color: #bfdbfe;
    }

    .clip-thumb {
        width: 100%;
        aspect-ratio: 1 / 1;
        border-radius: 8px;
        background: rgba(15, 23, 42, 0.05);
        display: flex;
        align-items: center;
        justify-content: center;
        position: relative;
        overflow: hidden;
    }

    .dark-theme .clip-thumb {
        background: rgba(148, 163, 184, 0.12);
    }

    .clip-label {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        font-size: 11px;
        font-weight: 600;
        color: var(--foreground, #1f2937);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .clip-label__title {
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .clip-label__badge {
        min-width: 20px;
        padding: 0 6px;
        height: 18px;
        border-radius: 999px;
        background: rgba(15, 118, 110, 0.12);
        color: #0f766e;
        font-size: 10px;
        font-weight: 700;
        text-align: center;
        line-height: 18px;
    }

    .dark-theme .clip-label__badge {
        background: rgba(34, 211, 238, 0.18);
        color: #67e8f9;
    }

    .dark-theme .clip-label {
        color: #e5e7eb;
    }

    .timeline-message {
        margin: 0;
        font-size: 12px;
        padding: 6px 8px;
        border-radius: 4px;
    }

    .timeline-message.success {
        background: rgba(34, 197, 94, 0.15);
        color: #15803d;
    }

    .timeline-message.error {
        background: rgba(239, 68, 68, 0.15);
        color: #b91c1c;
    }

    .timeline-marquee {
        position: absolute;
        border: 1px dashed rgba(37, 99, 235, 0.9);
        background: rgba(37, 99, 235, 0.15);
        pointer-events: none;
        border-radius: 4px;
    }

    .unsaved-dot {
        width: 7px;
        height: 7px;
        background: #f97316;
        border-radius: 50%;
        display: inline-block;
        margin-left: 4px;
    }

    @keyframes spin {
        from {
            transform: rotate(0deg);
        }
        to {
            transform: rotate(360deg);
        }
    }
</style>
