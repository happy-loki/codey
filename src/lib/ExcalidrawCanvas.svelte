<script lang="ts">
    import { createEventDispatcher, onDestroy, onMount } from "svelte";
    import "@excalidraw/excalidraw/index.css";

    type ChangeHandler = (elements: any, appState: any, files: Record<string, any>) => void;
    type PointerHandler = (payload: any) => void;

    export let hidden = false;
    export let initialData: any = null;
    export let onChange: ChangeHandler | null = null;
    export let onPointerUpdate: PointerHandler | null = null;
    export let UIOptions: any = null;
    export let langCode: string | null = null;
    export let viewModeEnabled: boolean = false;
    export let loadingLabel: string = "Loading whiteboard…";
    export let errorLabel: string = "Failed to load whiteboard";
    export let onCreateNewWhiteboard: (() => Promise<void>) | null = null;
    export let newWhiteboardLabel: string = "New Whiteboard";

    let host: HTMLDivElement | null = null;
    let dispose: () => void = () => {};
    let loading = true;
    let error: string | null = null;

    const isMacPlatform = typeof navigator !== "undefined" && /mac/i.test(navigator?.platform || "");
    let restoreClipboardRead: (() => void) | null = null;

    let reactInstance: any = null;
    let reactModule: any = null;
    let excalidrawComponent: any = null;
    let mainMenuComponent: any = null;
    const dispatch = createEventDispatcher<{ fatalError: { reason: string } }>();
    let fatalReported = false;

    function resolveErrorReason(reason: unknown): string {
        if (reason instanceof Error) {
            return reason.message;
        }
        if (typeof reason === "string") {
            return reason;
        }
        return String(reason ?? "Excalidraw error");
    }

    function reportFatal(reason: unknown) {
        if (fatalReported) {
            return;
        }
        fatalReported = true;
        error = resolveErrorReason(reason);
        loading = false;
        dispatch("fatalError", { reason: error });
    }

    function isCanvasActionEnabled(name: string): boolean {
        const actions = UIOptions?.canvasActions;
        if (!actions || typeof actions[name] === "undefined") {
            return true;
        }
        const value = actions[name];
        if (typeof value === "object") {
            return value !== false;
        }
        return value !== false;
    }

    function buildMenuChildren() {
        if (!reactModule || !mainMenuComponent || !mainMenuComponent.DefaultItems) {
            return [];
        }
        const children: any[] = [];
        const DefaultItems = mainMenuComponent.DefaultItems;
        const handleCreate = () => {
            if (typeof onCreateNewWhiteboard === "function") {
                void onCreateNewWhiteboard();
            }
        };
        const newIcon = reactModule.createElement(
            "svg",
            {
                width: 18,
                height: 18,
                viewBox: "0 0 24 24",
                fill: "none",
                stroke: "currentColor",
                "stroke-width": 2,
                "stroke-linecap": "round",
                "stroke-linejoin": "round",
            },
            reactModule.createElement("rect", {
                x: 3,
                y: 3,
                width: 18,
                height: 18,
                rx: 2,
                ry: 2,
            }),
            reactModule.createElement("line", { x1: 12, y1: 7, x2: 12, y2: 17 }),
            reactModule.createElement("line", { x1: 7, y1: 12, x2: 17, y2: 12 }),
        );

        children.push(
            reactModule.createElement(
                mainMenuComponent,
                { key: "arthas-menu-root" },
                reactModule.createElement(
                    mainMenuComponent.Item,
                    {
                        key: "arthas-new-whiteboard",
                        onSelect: handleCreate,
                        icon: newIcon,
                    },
                    newWhiteboardLabel,
                ),
                isCanvasActionEnabled("loadScene")
                    ? reactModule.createElement(DefaultItems.LoadScene, { key: "load-scene" })
                    : null,
                isCanvasActionEnabled("saveToActiveFile")
                    ? reactModule.createElement(DefaultItems.SaveToActiveFile, {
                          key: "save-active",
                      })
                    : null,
                isCanvasActionEnabled("export")
                    ? reactModule.createElement(DefaultItems.Export, { key: "export" })
                    : null,
                isCanvasActionEnabled("saveAsImage")
                    ? reactModule.createElement(DefaultItems.SaveAsImage, { key: "save-image" })
                    : null,
                reactModule.createElement(DefaultItems.SearchMenu, { key: "search" }),
                reactModule.createElement(DefaultItems.Help, { key: "help" }),
                isCanvasActionEnabled("clearCanvas")
                    ? reactModule.createElement(DefaultItems.ClearCanvas, { key: "clear" })
                    : null,
                reactModule.createElement(mainMenuComponent.Separator, { key: "sep-links" }),
                reactModule.createElement(
                    mainMenuComponent.Group,
                    { key: "links", title: "Excalidraw links" },
                    reactModule.createElement(DefaultItems.Socials, { key: "socials" }),
                ),
                reactModule.createElement(mainMenuComponent.Separator, { key: "sep-theme" }),
                isCanvasActionEnabled("toggleTheme")
                    ? reactModule.createElement(DefaultItems.ToggleTheme, { key: "theme" })
                    : null,
                isCanvasActionEnabled("changeViewBackgroundColor")
                    ? reactModule.createElement(DefaultItems.ChangeCanvasBackground, {
                          key: "background",
                      })
                    : null,
            ),
        );
        return children;
    }

    function renderReact() {
        if (!reactInstance || !reactModule || !excalidrawComponent || fatalReported) return;
        const props: Record<string, any> = {
            viewModeEnabled,
        };
        if (initialData) props.initialData = initialData;
        if (typeof onChange === "function") props.onChange = onChange;
        if (typeof onPointerUpdate === "function") props.onPointerUpdate = onPointerUpdate;
        if (UIOptions) props.UIOptions = UIOptions;
        props.renderTopRightUI = undefined;
        if (langCode) props.langCode = langCode;

        const children = buildMenuChildren();

        try {
            reactInstance.render(
                reactModule.createElement(
                    reactModule.StrictMode,
                    {},
                    reactModule.createElement(excalidrawComponent, props, ...children),
                ),
            );
            loading = false;
        } catch (e) {
            console.error("[ExcalidrawCanvas] render failed", e);
            reportFatal(e);
        }
    }

    onMount(async () => {
        if (!host) {
            reportFatal("Whiteboard host not ready");
            return;
        }

        if (isMacPlatform && typeof navigator !== "undefined") {
            const clip: any = (navigator as any).clipboard;
            if (clip && typeof clip.read === "function") {
                const original = clip.read.bind(clip);
                clip.read = undefined;
                restoreClipboardRead = () => {
                    clip.read = original;
                };
            }
        }

        try {
            const [excalidrawModule, React, ReactDOMClient] = await Promise.all([
                import("@excalidraw/excalidraw"),
                import("react"),
                import("react-dom/client"),
            ]);
            const Excalidraw =
                excalidrawModule?.Excalidraw ?? excalidrawModule?.default;
            if (!Excalidraw) {
                throw new Error("Excalidraw component未导出");
            }

            excalidrawComponent = Excalidraw;
            mainMenuComponent = excalidrawModule?.MainMenu ?? null;
            reactModule = React;
            reactInstance = ReactDOMClient.createRoot(host);
            renderReact();

            dispose = () => {
                reactInstance?.unmount();
                reactInstance = null;
            };
        } catch (e) {
            console.error("[ExcalidrawCanvas] failed to load Excalidraw", e);
            reportFatal(e);
        }
    });

    $: if (reactInstance && reactModule && excalidrawComponent) {
        // ensure reactive deps trigger rerender
        newWhiteboardLabel;
        onCreateNewWhiteboard;
        UIOptions;
        renderReact();
    }

    onDestroy(() => {
        if (restoreClipboardRead) {
            try { restoreClipboardRead(); } catch (_) { /* ignore */ }
            restoreClipboardRead = null;
        }
        dispose();
    });
</script>

<div class="excalidraw-container" class:is-hidden={hidden}>
    {#if loading && !error}
        <div class="status">{loadingLabel}</div>
    {:else if error}
        <div class="status error">{errorLabel}: {error}</div>
    {/if}
    <div class="excalidraw-host" bind:this={host} />
</div>

<style>
    .excalidraw-container {
        position: relative;
        width: 100%;
        height: 100%;
        display: flex;
        flex-direction: column;
        align-items: stretch;
        justify-content: stretch;
        flex: 1 1 auto;
        min-width: 0;
        min-height: 0;
    }

    .excalidraw-container.is-hidden {
        display: none;
    }

    .excalidraw-host {
        width: 100%;
        height: 100%;
        flex: 1 1 auto;
        min-width: 0;
        min-height: 0;
    }

    .status {
        position: absolute;
        top: 12px;
        left: 50%;
        transform: translateX(-50%);
        padding: 6px 12px;
        border-radius: 6px;
        background: rgba(0, 0, 0, 0.65);
        color: #fff;
        font-size: 14px;
        z-index: 10;
        pointer-events: none;
        transition: opacity 0.2s ease;
    }

    .status.error {
        background: rgba(200, 30, 30, 0.85);
    }
</style>
