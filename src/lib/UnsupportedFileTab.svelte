<script lang="ts">
    import { AlertTriangle } from "lucide-svelte";
    import { t } from "./i18n";
    import { activeInfo } from "./editorBus";

    export let hidden = false;
    export let path = "";

    type FileInfo = {
        filename: string;
        path: string;
        fileType: string;
        language: string;
        encoding?: string;
        hasBom?: boolean;
        spaces?: number;
        readonly?: boolean;
    };

    let rootEl: HTMLDivElement | null = null;
    let fileInfo: FileInfo = {
        filename: path.split(/[/\\]/).pop() || path || "Untitled",
        path,
        fileType: "",
        language: "binary",
        encoding: "binary",
        hasBom: false,
        spaces: 4,
        readonly: true,
    };

    $: if (path && fileInfo.path !== path) {
        fileInfo = { ...fileInfo, path, filename: path.split(/[/\\]/).pop() || path };
    }

    function publishActiveInfo() {
        try {
            activeInfo.set(fileInfo as any);
        } catch {}
    }

    export function updateFileInfo(next: Partial<FileInfo>) {
        fileInfo = { ...fileInfo, ...(next || {}) };
        publishActiveInfo();
    }

    export function getFileInfo() {
        return fileInfo;
    }

    export function focus() {
        try {
            rootEl?.focus();
        } catch {}
        publishActiveInfo();
    }

    export function hasUnsavedChanges(): boolean {
        return false;
    }

    export function setTheme() {
        // no-op: placeholder view
    }

    export function setScheme(scheme: any) {
        try {
            if (!rootEl) return;
            rootEl.dataset.scheme = scheme ? "dark" : "light";
        } catch {}
    }

    export function getFileContent(): string {
        return "";
    }

    export function getEncoding(): string {
        return String(fileInfo.encoding || "binary");
    }

    export function hasBom(): boolean {
        return Boolean(fileInfo.hasBom);
    }

    export async function getLang(): Promise<string> {
        return "binary";
    }

    export function getSpaces(): number {
        const n = Number(fileInfo.spaces);
        return Number.isFinite(n) && n > 0 ? n : 4;
    }
</script>

<div class="unsupported" class:hidden tabindex="0" bind:this={rootEl}>
    <div class="card" role="status" aria-live="polite">
        <AlertTriangle class="icon" size={44} stroke-width={2.2} />
        <div class="title">{$t("editor.unsupportedFileTitle")}</div>
        <div class="message">{$t("editor.unsupportedFileMessage")}</div>
        {#if path}
            <div class="path">{path}</div>
        {/if}
    </div>
</div>

<style lang="scss">
    .hidden {
        visibility: hidden;
        pointer-events: none;
    }
    .unsupported {
        width: 100%;
        height: 100%;
        position: absolute;
        inset: 0;
        z-index: 0;
        display: grid;
        place-items: center;
        background: var(--preview-surface, var(--editor-background));
        color: var(--preview-text, var(--editor-foreground));
        outline: none;
    }
    .unsupported:not(.hidden) {
        z-index: 1;
    }
    .card {
        max-width: 46rem;
        padding: 2.5rem 2rem;
        display: grid;
        gap: 0.75rem;
        place-items: center;
        text-align: center;
        border-radius: 12px;
    }
    .icon {
        color: var(--warning-foreground, #f4c542);
    }
    .title {
        font-size: 1.1rem;
        font-weight: 600;
        opacity: 0.95;
    }
    .message {
        opacity: 0.8;
        line-height: 1.5;
        max-width: 42rem;
    }
    .path {
        margin-top: 0.5rem;
        opacity: 0.6;
        font-family: var(--editor-font-family, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace);
        font-size: 0.9rem;
        word-break: break-all;
    }
</style>
