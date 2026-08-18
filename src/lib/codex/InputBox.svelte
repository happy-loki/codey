<script lang="ts">
    import { createEventDispatcher, onMount } from "svelte";
    import { convertFileSrc, invoke } from "@tauri-apps/api/core";
    import { join, tempDir } from "@tauri-apps/api/path";
    import { writeFile } from "@tauri-apps/plugin-fs";
    import { createClipboardController } from "../utility/textClipboard";
    import { shouldBlockImeEnter } from "../utility/imeGuard";
    import { t } from "../i18n";
    import {
        composerAttachments,
        removeAttachment,
        clearAttachments,
        addAttachment,
        type ComposerAttachment
    } from "./composerStore";
    import type { ThreadGoal, ThreadGoalStatus } from "./types";
    import {
        Folder as FolderIcon,
        FileText,
        GitCommit,
        GitBranch,
        Sparkles,
        ArrowUp,
        XCircle,
        Mic,
        Square,
        Panda,
        Pause,
        RotateCcw,
        Check
    } from "lucide-svelte";
    import FileTypeIcon from "../Icons/FileTypeIcon.svelte";
    import { dismissSystemDictation, isSystemDictationSupported, triggerSystemDictation } from "../system_dictation/tauri";
    import { systemDictationSettings } from "../system_dictation/settings";

    export let isProcessing = false;
    export let actionsDisabled = false;
    export let cwd: string | null = null;
    // Context used percentage (0-100). Null means "unknown / hide gauge".
    export let contextPercentUsed: number | null = null;
    // Tooltip text shown on hover over the context gauge.
    export let contextTooltip: string | null = null;
    export let activeGoal: ThreadGoal | null = null;
    export let goalObservedAtMs: number | null = null;
    export let activeTurnStartedAtMs: number | null = null;
    export let goalLocalElapsedFloorSeconds = 0;
    export let uiClockMs: number = Date.now();
    export let goalBusy = false;

    const dispatch = createEventDispatcher();
    const isMacPlatform = typeof navigator !== "undefined" && /mac/i.test(navigator?.platform || "");

    let input = "";
    let textarea: HTMLTextAreaElement;
    let autoContext = false;
    let slashMenuOpen = false;
    let slashMenuWrapper: HTMLDivElement | null = null;
    let branchPickerOpen = false;
    let branchPickerWrapper: HTMLDivElement | null = null;
    let branchSearchInput: HTMLInputElement | null = null;
    let goalPanelOpen = false;
    let goalPanelWrapper: HTMLDivElement | null = null;
    let goalDraft = "";
    let goalTokenBudgetDraft = "";
    type BranchOverview = {
        default_branch: string | null;
        recent_branches: string[];
    };

    let branchOptions: string[] = [];
    let filteredBranches: string[] = [];
    let branchFilter = "";
    let branchLoading = false;
    let branchError: string | null = null;
    let selectedBranchIndex = 0;
    let contextMenuOpen = false;
    let contextCircleWrapper: HTMLDivElement | null = null;

    // System dictation (OS voice typing). We only trigger the OS UI; text is inserted by the OS.
    let systemDictationSupported = true;
    let systemDictationError: string | null = null;
    let lastSystemDictationTriggerAt = 0;



const allowedImageMimeTypes = new Set([
    "image/png",
    "image/jpeg",
    "image/jpg",
    "image/webp",
    "image/gif"
]);

type DirEntrySummary = {
    name: string;
    isDirectory: boolean;
    fingerprint?: string | null;
};

    async function handleClipboardPaste(): Promise<boolean> {
        // 在 macOS 上不要主动调用 navigator.clipboard.read 以避免 WKWebView 弹出系统粘贴小浮窗，改用 paste 事件的 clipboardData
        if (isMacPlatform) return false;
        // 仅在安全上下文且明确授权时尝试读取图像，避免 macOS/WebView 权限报错
        if (typeof window === "undefined" || !window.isSecureContext) return false;
        const anyNavigator = navigator as any;
        const clipboard = anyNavigator?.clipboard;
        if (!clipboard || typeof clipboard.read !== "function") return false;

        // 尝试检查剪贴板读取权限；若未授权则直接回退为文本粘贴
        try {
            if (anyNavigator?.permissions?.query) {
                const status = await anyNavigator.permissions.query({ name: "clipboard-read" as PermissionName });
                if (status.state !== "granted") {
                    return false;
                }
            }
        } catch (_) {
            // 权限查询不可用，避免强行调用导致 NotAllowedError
            return false;
        }

        try {
            const items = await clipboard.read();
            const imageFiles: File[] = [];
            for (const item of items as any[]) {
                const types: string[] = item.types || [];
                for (const type of types) {
                    if (typeof type === "string" && allowedImageMimeTypes.has(type.toLowerCase())) {
                        const blob = await item.getType(type);
                        const file = new File([blob], "image.png", { type });
                        imageFiles.push(file);
                        break;
                    }
                }
            }
            if (imageFiles.length > 0) {
                await addFilesAsImageAttachments(imageFiles);
                return true;
            }
        } catch (error: any) {
            // 仅在非权限类错误时提示，权限被拒绝则静默回退到纯文本粘贴
            if (!(error && typeof error === "object" && "name" in error && (error as any).name === "NotAllowedError")) {
                console.warn("Clipboard read for images failed", error);
            }
        }
        return false;
    }

    const clipboardController = createClipboardController({
        getValue: () => input,
        setValue: (value: string) => {
            input = value;
        },
        getElement: () => textarea,
        afterValueUpdate: () => autoResize(),
        enableUndoRedo: true,
        onPaste: handleClipboardPaste,
        allowNativePasteFallback: true
    });

    function handlePasteEvent(event: ClipboardEvent) {
        const data = event.clipboardData;
        if (!data) return;
        const imageFiles: File[] = [];
        for (const item of Array.from(data.items || [])) {
            if (item.type && item.type.toLowerCase().startsWith("image/")) {
                const file = item.getAsFile();
                if (file) {
                    imageFiles.push(file);
                }
            }
        }
        if (imageFiles.length > 0) {
            event.preventDefault();
            void addFilesAsImageAttachments(imageFiles);
        }
    }

    function handleKeyDown(e: KeyboardEvent) {
        clipboardController.handleKeyDown(e);
        if (e.defaultPrevented) {
            return;
        }
        if (e.key === "Enter" && !e.shiftKey) {
            if (shouldBlockImeEnter(e)) {
                return;
            }
            e.preventDefault();
            send();
        }
    }

    function send() {
        const trimmed = input.trim();
        if (!trimmed || isProcessing) return;
        let attachments: ComposerAttachment[] = [];
        composerAttachments.subscribe((value) => {
            attachments = value;
        })();
        dispatch("send", {
            message: trimmed,
            autoContext: autoContext,
            attachments
        });
        input = "";
        clearAttachments();
        if (textarea) {
            textarea.style.height = "auto";
        }

        // Best-effort: close the Windows voice typing floating UI after send, but only if we
        // triggered it recently to avoid stealing Esc from other UI.
        if (Date.now() - lastSystemDictationTriggerAt < 30_000) {
            void (async () => {
                try {
                    await dismissSystemDictation();
                } catch {
                    // Ignore dismissal failures.
                }
            })();
        }
    }

    async function handleMicClick() {
        try {
            systemDictationError = null;
            if (textarea) {
                try {
                    textarea.focus();
                    const end = textarea.value?.length ?? 0;
                    textarea.setSelectionRange(end, end);
                } catch {
                    // Ignore focus/selection errors.
                }
            }
            // Give the browser a tick to apply focus before triggering the OS shortcut.
            await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
            await triggerSystemDictation(isMacPlatform ? $systemDictationSettings?.macosShortcut ?? null : null);
            lastSystemDictationTriggerAt = Date.now();
        } catch (err) {
            systemDictationError = err instanceof Error ? err.message : String(err);
            window.setTimeout(() => (systemDictationError = null), 2500);
        }
    }

    function interrupt() {
        dispatch("interrupt");
    }

    function autoResize() {
        if (!textarea) return;
        textarea.style.height = "auto";
        const newHeight = Math.min(textarea.scrollHeight, 200);
        textarea.style.height = newHeight + "px";
    }

    function toggleSlashMenu() {
        if (actionsDisabled) return;
        slashMenuOpen = !slashMenuOpen;
        if (slashMenuOpen) {
            branchPickerOpen = false;
            goalPanelOpen = false;
        }
    }

    function closeSlashMenu() {
        slashMenuOpen = false;
    }

    function closeBranchPicker() {
        branchPickerOpen = false;
        branchFilter = "";
        filteredBranches = branchOptions;
        selectedBranchIndex = 0;
    }

    function toggleGoalPanel() {
        if (actionsDisabled) return;
        goalPanelOpen = !goalPanelOpen;
        if (goalPanelOpen) {
            slashMenuOpen = false;
            branchPickerOpen = false;
            goalDraft = activeGoal?.objective || input.trim();
            goalTokenBudgetDraft = activeGoal?.tokenBudget ? String(activeGoal.tokenBudget) : "";
        }
    }

    function closeGoalPanel() {
        goalPanelOpen = false;
    }

    function submitGoalDraft() {
        const objective = goalDraft.trim();
        if (!objective || goalBusy) return;
        const budgetRaw = goalTokenBudgetDraft.trim();
        const parsedBudget = budgetRaw ? Number(budgetRaw) : null;
        const tokenBudget =
            parsedBudget && Number.isFinite(parsedBudget) && parsedBudget > 0
                ? Math.floor(parsedBudget)
                : null;
        const status =
            activeGoal?.status === "budgetLimited" || activeGoal?.status === "complete"
                ? "active"
                : undefined;
        dispatch("goalSet", { objective, tokenBudget, status });
        closeGoalPanel();
    }

    function updateGoalStatus(status: ThreadGoalStatus) {
        if (!activeGoal || goalBusy) return;
        dispatch("goalStatus", { status });
    }

    function clearGoal() {
        if (!activeGoal || goalBusy) return;
        dispatch("goalClear");
    }

    $: if (actionsDisabled && (slashMenuOpen || branchPickerOpen || goalPanelOpen)) {
        slashMenuOpen = false;
        branchPickerOpen = false;
        goalPanelOpen = false;
    }

    $: if (!goalPanelOpen && !activeGoal) {
        goalTokenBudgetDraft = "";
    }

    type ReviewAction = "codeReviewUncommitted" | "codeReviewBaseBranch";

    function handleSlashMenuAction(action: ReviewAction | "toggleAutoContext") {
        if (action === "toggleAutoContext") {
            autoContext = !autoContext;
            closeSlashMenu();
            return;
        }

        if (action === "codeReviewUncommitted") {
            if (isProcessing) {
                closeSlashMenu();
                return;
            }
            dispatch("requestCodeReview", { target: { type: "uncommittedChanges" } });
            closeSlashMenu();
        }

        if (action === "codeReviewBaseBranch") {
            if (isProcessing) {
                closeSlashMenu();
                return;
            }
            closeSlashMenu();
            openBranchPicker();
        }
    }

    function openBranchPicker() {
        branchPickerOpen = true;
        branchError = null;
        if (branchOptions.length === 0) {
            void fetchBranchOverview();
        } else {
            filteredBranches = applyBranchFilter(branchFilter);
            selectedBranchIndex = 0;
        }
        setTimeout(() => {
            branchSearchInput?.focus();
            branchSearchInput?.select();
        }, 0);
    }

    function applyBranchFilter(value: string): string[] {
        const term = value.trim().toLowerCase();
        if (!term) return branchOptions;
        return branchOptions.filter((b) => b.toLowerCase().includes(term));
    }

    async function fetchBranchOverview() {
        branchLoading = true;
        branchError = null;
        try {
            const result = await invoke<BranchOverview>("git_branch_overview", {
                path: cwd || undefined,
                // Tauri command 参数是 snake_case：recent_limit
                recent_limit: 10
            });

            const seen = new Set<string>();
            const list: string[] = [];

            const pushBranch = (name: string | null | undefined) => {
                const trimmed = (name || "").trim();
                if (!trimmed || seen.has(trimmed)) return;
                seen.add(trimmed);
                list.push(trimmed);
            };

            pushBranch(result?.default_branch ?? null);
            (result?.recent_branches ?? []).forEach((b) => pushBranch(b));

            branchOptions = list;
            filteredBranches = applyBranchFilter(branchFilter);
            selectedBranchIndex = 0;
        } catch (error: any) {
            console.error("Failed to list git branches", error);
            branchError = $t("codex.composer.slashMenu.branchLoadFailed");
        } finally {
            branchLoading = false;
        }
    }

    function handleBranchFilterInput(event: Event) {
        const value = (event.target as HTMLInputElement).value || "";
        branchFilter = value;
        filteredBranches = applyBranchFilter(branchFilter);
        selectedBranchIndex = 0;
    }

    function handleBranchKeydown(event: KeyboardEvent) {
        if (!branchPickerOpen) return;
        if (event.key === "Escape") {
            event.preventDefault();
            closeBranchPicker();
            return;
        }
        if (event.key === "ArrowDown") {
            event.preventDefault();
            selectedBranchIndex = Math.min(filteredBranches.length - 1, selectedBranchIndex + 1);
        } else if (event.key === "ArrowUp") {
            event.preventDefault();
            selectedBranchIndex = Math.max(0, selectedBranchIndex - 1);
        } else if (event.key === "Enter") {
            event.preventDefault();
            const branch = filteredBranches[selectedBranchIndex];
            if (branch) {
                chooseBranch(branch);
            }
        }
    }

    function chooseBranch(branch: string) {
        dispatch("requestCodeReview", { target: { type: "baseBranch", branch } });
        closeBranchPicker();
    }

    function parseFileUrisFromDataTransfer(data: DataTransfer): string[] {
        const uris: string[] = [];

        const uriListRaw = data.getData("application/vnd.code.uri-list");
        if (uriListRaw && typeof uriListRaw === "string") {
            const lines = uriListRaw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
            for (const line of lines) {
                if (line.startsWith("file:")) {
                    uris.push(line);
                }
            }
        }

        const resourceJson = data.getData("resourceurls");
        if (resourceJson && typeof resourceJson === "string") {
            try {
                const parsed = JSON.parse(resourceJson);
                if (Array.isArray(parsed)) {
                    for (const entry of parsed) {
                        const decoded = typeof entry === "string" ? decodeURIComponent(entry) : "";
                        if (decoded && decoded.startsWith("file:")) {
                            uris.push(decoded);
                        }
                    }
                }
            } catch {
                // ignore malformed payloads
            }
        }

        return Array.from(new Set(uris));
    }

    function fileUriToLocalPath(uri: string): string | null {
        if (!uri || typeof uri !== "string") return null;
        const trimmed = uri.trim();
        if (!trimmed.toLowerCase().startsWith("file:")) return null;
        const withoutScheme = trimmed.replace(/^file:\/*/i, "");
        const decoded = decodeURI(withoutScheme);
        if (!decoded) return null;
        if (/^[A-Za-z]:/.test(decoded)) {
            return decoded;
        }
        return decoded.startsWith("/") ? decoded : `/${decoded}`;
    }

    const imageExtensions = new Set(["png", "jpg", "jpeg", "gif", "webp"]);

    async function isDirectoryPath(path: string): Promise<boolean> {
        if (!path) {
            return false;
        }
        try {
            const result = await invoke<boolean>("is_folder", { path });
            return !!result;
        } catch (error) {
            console.warn("is_folder failed for path", path, error);
            return false;
        }
    }

    function formatCount(count: number, noun: string): string | null {
        if (count <= 0) return null;
        const suffix = count === 1 ? "" : "s";
        return `${count} ${noun}${suffix}`;
    }

    async function summarizeDirectory(path: string): Promise<string> {
        try {
            const entries = await invoke<DirEntrySummary[]>("list_children", {
                parentPath: path
            });
            if (!Array.isArray(entries)) {
                return "";
            }
            if (entries.length === 0) {
                return "empty";
            }
            const directories = entries.filter((entry) => entry?.isDirectory).length;
            const files = entries.length - directories;
            const parts = [
                formatCount(directories, "folder"),
                formatCount(files, "file")
            ].filter((part): part is string => !!part);
            return parts.join(", ");
        } catch (error) {
            console.warn("Failed to summarize directory", path, error);
            return "";
        }
    }

    function formatDirectoryLabel(raw: string): string {
        const trimmed = (raw || "").trim();
        const label = trimmed || "/";
        return label.endsWith("/") ? label : `${label}/`;
    }

    async function addDirectoryAttachment(path: string, displayName: string) {
        const summary = await summarizeDirectory(path);
        const label = formatDirectoryLabel(displayName || path);
        const meta = summary ? ` (${summary})` : "";
        const attachment: ComposerAttachment = {
            id:
                globalThis.crypto?.randomUUID?.() ??
                `${Date.now()}-${Math.random().toString(16).slice(2)}`,
            kind: "snippet",
            label,
            input: {
                type: "text",
                text: `Directory: ${path}${meta}`
            } as any,
            iconKind: "folder"
        };
        addAttachment(attachment);
    }

    async function addFileAttachmentsFromPaths(paths: string[]) {
        const MAX_TEXT_META_BYTES = 512 * 1024;
        for (const rawPath of paths) {
            const path = (rawPath || "").trim();
            if (!path) continue;
            const filename =
                path.split(/[\\/]/).filter(Boolean).pop() || path;
            const ext = (filename.split(".").pop() || "").toLowerCase();

            const isFolder = await isDirectoryPath(path);
            if (isFolder) {
                await addDirectoryAttachment(path, filename);
                continue;
            }

            // 如果是图片文件扩展名，则作为图片附件处理
            if (ext && imageExtensions.has(ext)) {
                try {
                    const attachment: ComposerAttachment = {
                        id:
                            globalThis.crypto?.randomUUID?.() ??
                            `${Date.now()}-${Math.random().toString(16).slice(2)}`,
                        kind: "image",
                        label: filename,
                        localPath: path,
                        input: {
                            type: "localImage",
                            path
                        } as any,
                        previewUrl: convertFileSrc(path)
                    };
                    addAttachment(attachment);
                } catch (error) {
                    console.error("Failed to attach image file from path", path, error);
                }
                continue;
            }

            // 其他文件：尝试检测是否为文本文件，文本文件附带行数/字符数/大小；非文本只附带大小
            try {
                const sizeBytes = await invoke<number>("file_size", { path });
                const isTextual: boolean = await invoke("is_supported", { path });

                let lineInfo = "";
                let charInfo = "";

                if (isTextual && sizeBytes > 0 && sizeBytes <= MAX_TEXT_META_BYTES) {
                    const fileData: any = await invoke("read_file", { path });
                    const text = typeof fileData?.text === "string" ? fileData.text : "";
                    const lines = text ? text.split(/\r\n|\r|\n/).length : 0;
                    const chars = text.length;
                    lineInfo = `${lines} lines`;
                    charInfo = `${chars} chars`;
                }

                const sizeInfo =
                    sizeBytes > 0
                        ? `${(sizeBytes / 1024).toFixed(1)}KB`
                        : "";

                const parts = [lineInfo, charInfo, sizeInfo].filter(
                    (part) => part && part.trim().length > 0
                );
                const meta = parts.length ? ` (${parts.join(", ")})` : "";

                const attachment: ComposerAttachment = {
                    id:
                        globalThis.crypto?.randomUUID?.() ??
                        `${Date.now()}-${Math.random().toString(16).slice(2)}`,
                    kind: "snippet",
                    label: filename,
                    localPath: path,
                    input: {
                        type: "text",
                        text: `File: ${path}${meta}`
                    } as any,
                    iconKind: "file",
                    iconFilename: filename
                };
                addAttachment(attachment);
            } catch (error) {
                console.error("Failed to attach file from path", path, error);
            }
        }
    }

    async function handleDrop(event: DragEvent) {
        const data = event.dataTransfer;
        if (!data) return;

        const files = Array.from(data.files || []);

        const imageFiles = files.filter((file) => isSupportedImageFile(file));

        if (imageFiles.length > 0) {
            event.preventDefault();
            await addFilesAsImageAttachments(imageFiles);
            return;
        }

        const uris = parseFileUrisFromDataTransfer(data);
        const paths = uris
            .map((uri) => fileUriToLocalPath(uri))
            .filter((p): p is string => !!p);

        if (paths.length > 0) {
            event.preventDefault();
            await addFileAttachmentsFromPaths(paths);
        }
    }

    function isSupportedImageFile(file: File): boolean {
        const type = (file.type || "").toLowerCase();
        if (type && allowedImageMimeTypes.has(type)) {
            return true;
        }
        const name = (file.name || "").toLowerCase();
        const ext = name.split(".").pop() || "";
        return !!ext && imageExtensions.has(ext);
    }

    function imageExtensionFromFile(file: File): string {
        const name = (file.name || "").toLowerCase();
        const ext = name.split(".").pop() || "";
        if (imageExtensions.has(ext)) {
            return ext === "jpeg" ? "jpg" : ext;
        }

        switch ((file.type || "").toLowerCase()) {
            case "image/jpeg":
            case "image/jpg":
                return "jpg";
            case "image/webp":
                return "webp";
            case "image/gif":
                return "gif";
            case "image/png":
            default:
                return "png";
        }
    }

    async function persistComposerImageFile(file: File): Promise<string> {
        const filename = `composer-image-${globalThis.crypto?.randomUUID?.() ?? Date.now()}.${imageExtensionFromFile(file)}`;
        const path = await join(await tempDir(), filename);
        const bytes = new Uint8Array(await file.arrayBuffer());
        await writeFile(path, bytes);
        return path;
    }

    async function addFilesAsImageAttachments(files: File[]) {
        const supported = files.filter((file) => isSupportedImageFile(file));
        if (!supported.length) return;
        for (const file of supported) {
            try {
                const path = await persistComposerImageFile(file);
                const attachment: ComposerAttachment = {
                    id:
                        globalThis.crypto?.randomUUID?.() ??
                        `${Date.now()}-${Math.random().toString(16).slice(2)}`,
                    kind: "image",
                    label: file.name || "image",
                    localPath: path,
                    input: {
                        type: "localImage",
                        path
                    } as any,
                    previewUrl: convertFileSrc(path)
                };
                addAttachment(attachment);
            } catch (error) {
                console.error("Failed to read image file", error);
            }
        }
    }

    $: clampedContextPercent =
        contextPercentUsed == null
            ? null
            : Math.max(0, Math.min(100, contextPercentUsed));

    const CONTEXT_CIRCLE_RADIUS = 9;
    const CONTEXT_CIRCLE_CIRC = 2 * Math.PI * CONTEXT_CIRCLE_RADIUS;

    $: contextStrokeDashoffset =
        clampedContextPercent == null
            ? CONTEXT_CIRCLE_CIRC
            : CONTEXT_CIRCLE_CIRC * (1 - clampedContextPercent / 100);

    $: if (clampedContextPercent === null && contextMenuOpen) {
        contextMenuOpen = false;
    }

    // Resolve system-dictation capability once so we can hide/show the mic affordance.
    onMount(() => {
        void (async () => {
            try {
                systemDictationSupported = await isSystemDictationSupported();
            } catch {
                systemDictationSupported = true;
            }
        })();

        const handleClick = (event: MouseEvent) => {
            if (contextMenuOpen) {
                if (!contextCircleWrapper || !contextCircleWrapper.contains(event.target as Node)) {
                    contextMenuOpen = false;
                }
            }
            if (slashMenuOpen) {
                if (!slashMenuWrapper || !slashMenuWrapper.contains(event.target as Node)) {
                    slashMenuOpen = false;
                }
            }
            if (goalPanelOpen) {
                if (!goalPanelWrapper || !goalPanelWrapper.contains(event.target as Node)) {
                    closeGoalPanel();
                }
            }
            if (branchPickerOpen) {
                if (!branchPickerWrapper || !branchPickerWrapper.contains(event.target as Node)) {
                    closeBranchPicker();
                }
            }
        };
        document.addEventListener("click", handleClick);
        return () => {
            document.removeEventListener("click", handleClick);
        };
    });

    function toggleContextMenu() {
        if (clampedContextPercent === null) {
            return;
        }
        contextMenuOpen = !contextMenuOpen;
    }

    function goalStatusLabel(status: ThreadGoal["status"]): string {
        switch (status) {
            case "active":
                return "active";
            case "paused":
                return "paused";
            case "budgetLimited":
                return "limited by budget";
            case "complete":
                return "complete";
            default:
                return status;
        }
    }

    function goalStatusSummary(status: ThreadGoal["status"]): string {
        switch (status) {
            case "active":
                return "Goal active";
            case "paused":
                return "Goal paused";
            case "budgetLimited":
                return "Goal limited by budget";
            case "complete":
                return "Goal achieved";
            default:
                return "Goal";
        }
    }

    function formatGoalElapsed(seconds: number | null | undefined): string {
        const value = Math.max(0, Math.floor(seconds || 0));
        if (value < 60) return `${value}s`;

        const minutes = Math.floor(value / 60);
        if (minutes < 60) return `${minutes}m`;

        const hours = Math.floor(minutes / 60);
        const remainingMinutes = minutes % 60;
        if (hours >= 24) {
            const days = Math.floor(hours / 24);
            const remainingHours = hours % 24;
            return `${days}d ${remainingHours}h ${remainingMinutes}m`;
        }
        return remainingMinutes === 0 ? `${hours}h` : `${hours}h ${remainingMinutes}m`;
    }

    function goalDisplaySeconds(
        goal: ThreadGoal,
        observedAtMs: number | null,
        turnStartedAtMs: number | null,
        floorSeconds: number,
        clockMs: number
    ): number {
        let seconds = Math.max(
            0,
            Math.floor(goal.timeUsedSeconds || 0),
            Math.floor(floorSeconds || 0)
        );
        if (goal.status !== "active") {
            return seconds;
        }
        if (turnStartedAtMs === null) {
            return seconds;
        }

        const observedAt = observedAtMs ?? turnStartedAtMs;
        const baseline = Math.max(observedAt, turnStartedAtMs);
        const liveSeconds = Math.max(0, Math.floor((clockMs - baseline) / 1000));
        return seconds + liveSeconds;
    }

    function formatGoalMeta(
        goal: ThreadGoal,
        observedAtMs: number | null,
        turnStartedAtMs: number | null,
        floorSeconds: number,
        clockMs: number
    ): string | null {
        const parts: string[] = [];
        const elapsed = formatGoalElapsed(
            goalDisplaySeconds(goal, observedAtMs, turnStartedAtMs, floorSeconds, clockMs)
        );
        parts.push(`${goalStatusSummary(goal.status)} (${elapsed})`);

        // Match Codex TUI: token usage is only meaningful in the Goal card when a
        // token budget exists. Some providers do not report usage, which otherwise
        // makes an unbudgeted goal look like it used "0 tokens".
        if (goal.tokenBudget) {
            const used = goal.tokensUsed || 0;
            parts.push(`${used.toLocaleString()} / ${goal.tokenBudget.toLocaleString()} tokens`);
        }

        return parts.length > 0 ? parts.join(" · ") : null;
    }

    $: goalMeta = activeGoal
        ? formatGoalMeta(
              activeGoal,
              goalObservedAtMs,
              activeTurnStartedAtMs,
              goalLocalElapsedFloorSeconds,
              uiClockMs
          )
        : null;

</script>

<div class="input-box">
    {#if branchPickerOpen}
        <div class="branch-picker" bind:this={branchPickerWrapper}>
            <div class="branch-search">
                <input
                    bind:this={branchSearchInput}
                    type="text"
                    placeholder={$t("codex.composer.slashMenu.searchBranches")}
                    bind:value={branchFilter}
                    on:input={handleBranchFilterInput}
                    on:keydown={handleBranchKeydown}
                />
                {#if branchLoading}
                    <span class="branch-status">{$t("codex.composer.slashMenu.loading")}</span>
                {:else if branchError}
                    <span class="branch-error">{branchError}</span>
                {/if}
            </div>
            <div class="branch-list" role="listbox">
                {#if filteredBranches.length === 0 && !branchLoading}
                    <div class="branch-empty">{$t("codex.composer.slashMenu.noBranch")}</div>
                {/if}
                {#each filteredBranches as branch, idx}
                    <button
                        type="button"
                        class:selected={idx === selectedBranchIndex}
                        class="branch-item"
                        on:click={() => chooseBranch(branch)}
                        role="option"
                        aria-selected={idx === selectedBranchIndex}
                    >
                        {branch}
                    </button>
                {/each}
            </div>
        </div>
    {/if}
    {#if slashMenuOpen}
        <div class="slash-menu" bind:this={slashMenuWrapper} role="menu">
            <div class="slash-menu-header">{$t("codex.composer.slashMenu.title")}</div>
            <button
                type="button"
                class="slash-menu-item"
                on:click|stopPropagation={() => handleSlashMenuAction("codeReviewUncommitted")}
            >
                <span class="slash-menu-icon slash-icon-review">
                    <GitCommit size={16} stroke-width={2} />
                </span>
                <span>{$t("codex.composer.slashMenu.codeReviewUncommitted")}</span>
            </button>
            <button
                type="button"
                class="slash-menu-item"
                on:click|stopPropagation={() => handleSlashMenuAction("codeReviewBaseBranch")}
            >
                <span class="slash-menu-icon slash-icon-branch">
                    <GitBranch size={16} stroke-width={2} />
                </span>
                <span>{$t("codex.composer.slashMenu.codeReviewBaseBranch")}</span>
            </button>
            <button
                type="button"
                class="slash-menu-item"
                class:auto-disabled={!autoContext}
                on:click|stopPropagation={() => handleSlashMenuAction("toggleAutoContext")}
            >
                <span class="slash-menu-icon slash-icon-auto-context">
                    <Sparkles size={16} stroke-width={2} />
                </span>
                <span class="slash-menu-auto-text">
                    <span class="auto-label">
                        {$t("codex.composer.autoContextLabel")}
                    </span>
                </span>
                <span class={`slash-toggle ${autoContext ? "on" : "off"}`}>
                    <span class="slash-toggle-thumb" />
                </span>
            </button>
        </div>
    {/if}
    {#if goalPanelOpen}
        <div class="goal-panel" bind:this={goalPanelWrapper}>
            <div class="goal-panel-title">{activeGoal ? "编辑 Goal" : "设为 Goal"}</div>
            <textarea
                class="goal-panel-textarea"
                bind:value={goalDraft}
                rows="3"
                placeholder="例如：持续修复测试直到全部通过，并提交代码"
            />
            <div class="goal-panel-row">
                <input
                    class="goal-panel-budget"
                    bind:value={goalTokenBudgetDraft}
                    inputmode="numeric"
                    placeholder="Token 预算（可选）"
                />
                <button
                    type="button"
                    class="goal-panel-submit"
                    on:click={submitGoalDraft}
                    disabled={!goalDraft.trim() || goalBusy}
                >
                    {activeGoal ? "更新 Goal" : "开始 Goal"}
                </button>
            </div>
            <p class="goal-panel-hint">
                适合“持续做，直到某个结果达成”的任务；普通问答不需要开启 Goal。
            </p>
        </div>
    {/if}
    <div class="input-wrapper">
        <div
            class="input-container"
            on:drop|preventDefault={handleDrop}
            on:dragover|preventDefault
        >
            {#if activeGoal}
                <div
                    class="goal-status-bar"
                    class:paused={activeGoal.status === "paused"}
                    class:complete={activeGoal.status === "complete"}
                    class:limited={activeGoal.status === "budgetLimited"}
                >
                    <div class="goal-status-main">
                        <Panda size={15} aria-hidden="true" />
                        <div class="goal-status-copy">
                            <div class="goal-status-title">
                                <span class="goal-status-pill">{goalStatusLabel(activeGoal.status)}</span>
                                <span class="goal-status-objective">{activeGoal.objective}</span>
                            </div>
                            {#if goalMeta}
                                <div class="goal-status-meta">{goalMeta}</div>
                            {/if}
                        </div>
                    </div>
                    <div class="goal-status-actions">
                        {#if activeGoal.status === "active"}
                            <button type="button" on:click={() => updateGoalStatus("paused")} disabled={goalBusy} title="暂停 Goal">
                                <Pause size={14} aria-hidden="true" />
                            </button>
                        {:else if activeGoal.status === "paused"}
                            <button type="button" on:click={() => updateGoalStatus("active")} disabled={goalBusy} title="继续 Goal">
                                <RotateCcw size={14} aria-hidden="true" />
                            </button>
                        {/if}
                        {#if activeGoal.status !== "complete"}
                            <button type="button" on:click={() => updateGoalStatus("complete")} disabled={goalBusy} title="标记 Goal 完成">
                                <Check size={14} aria-hidden="true" />
                            </button>
                        {/if}
                        <button type="button" on:click|stopPropagation={toggleGoalPanel} disabled={goalBusy}>编辑</button>
                        <button type="button" on:click={clearGoal} disabled={goalBusy}>清除</button>
                    </div>
                </div>
            {/if}
            {#if $composerAttachments.length}
                <div class="attachment-row">
                    {#each $composerAttachments as att}
                        <div class="attachment-chip">
                            {#if att.kind === "image" && att.previewUrl}
                                <div class="attachment-thumb">
                                    <!-- svelte-ignore a11y-img-redundant-alt -->
                                    <img src={att.previewUrl} alt={att.label} />
                                </div>
                            {:else if att.iconKind === "folder"}
                                <span class="attachment-icon folder">
                                    <FolderIcon size={14} stroke-width={2} />
                                </span>
                            {:else if att.iconKind === "file"}
                                <span class="attachment-icon file filetype">
                                    <FileTypeIcon filename={att.iconFilename || att.label} />
                                </span>
                            {:else}
                                <span class="attachment-icon file">
                                    <FileText size={14} stroke-width={2} />
                                </span>
                            {/if}
                            <span class="attachment-label">{att.label}</span>
                            <button
                                type="button"
                                class="attachment-remove"
                                on:click={() => removeAttachment(att.id)}
                                aria-label="Remove attachment"
                            >
                                ×
                            </button>
                        </div>
                    {/each}
                </div>
            {/if}
            <div class="input-main">
                <textarea
                    bind:this={textarea}
                    bind:value={input}
                    on:keydown={handleKeyDown}
                    on:paste={handlePasteEvent}
                    on:input={autoResize}
                    on:contextmenu|preventDefault={clipboardController.handleContextMenu}
                    placeholder={$t("codex.composer.placeholder")}
                    disabled={isProcessing}
                    rows="2"
                    data-allow-browser-shortcuts="true"
                />
                {#if clampedContextPercent !== null}
                    <div class="context-circle-wrapper" bind:this={contextCircleWrapper}>
                        <button
                            type="button"
                            class="context-circle"
                            title={contextTooltip || ""}
                            aria-label={contextTooltip || ""}
                            aria-expanded={contextMenuOpen}
                            on:click|stopPropagation={toggleContextMenu}
                        >
                            <svg viewBox="0 0 24 24">
                                <circle
                                    class="context-circle-track"
                                    cx="12"
                                    cy="12"
                                    r={CONTEXT_CIRCLE_RADIUS}
                                />
                                <circle
                                    class="context-circle-progress"
                                    cx="12"
                                    cy="12"
                                    r={CONTEXT_CIRCLE_RADIUS}
                                    stroke-dasharray={CONTEXT_CIRCLE_CIRC}
                                    stroke-dashoffset={contextStrokeDashoffset}
                                />
                            </svg>
                            <span class="context-circle-label">
                                {clampedContextPercent}%
                            </span>
                        </button>
                        {#if contextMenuOpen}
                            <div class="context-menu" role="menu">
                                <div class="context-menu-title">上下文已使用</div>
                                <p class="context-menu-desc">基于 Codex 上报的当前上下文窗口估算，接近上限时会自动压缩。</p>
                            </div>
                        {/if}
                    </div>
                {/if}
            </div>
            {#if systemDictationError}
                <div class="composer-dictation-error" role="status">
                    <span>{systemDictationError}</span>
                    <button
                        type="button"
                        class="ghost composer-dictation-error-dismiss"
                        on:click={() => (systemDictationError = null)}
                    >
                        Dismiss
                    </button>
                </div>
            {/if}
            <div class="input-bottom-row">
                <div class="input-footer">
                    <button
                        class="goal-btn"
                        class:active={Boolean(activeGoal)}
                        on:click|stopPropagation={toggleGoalPanel}
                        type="button"
                        title={activeGoal ? "查看/编辑 Goal" : "设为 Goal"}
                        disabled={actionsDisabled}
                    >
                        <Panda size={16} aria-hidden="true" />
                        <span>Goal</span>
                    </button>
                    <div class="slash-menu-wrapper">
                        <button
                            class="slash-btn"
                            type="button"
                            aria-expanded={slashMenuOpen}
                            on:click|stopPropagation={toggleSlashMenu}
                            title={$t("codex.composer.slashMenu.openTooltip")}
                            disabled={actionsDisabled}
                        >
                            /
                        </button>
                    </div>
                </div>
                <div class="input-actions">
                    {#if systemDictationSupported && !isMacPlatform}
                        <button
                            class="mic-btn"
                            on:click={handleMicClick}
                            on:mousedown|preventDefault
                            type="button"
                            title="System dictation"
                            aria-label="System dictation"
                            disabled={actionsDisabled || isProcessing}
                        >
                            <Mic size={18} aria-hidden="true" />
                        </button>
                    {/if}
                    {#if isProcessing}
                        <button
                            class="send-btn interrupt"
                            type="button"
                            on:click={interrupt}
                            title="Stop"
                        >
                            <Square size={20} aria-hidden="true" />
                        </button>
                    {:else}
                        <button
                            class="send-btn"
                            on:click={send}
                            disabled={!input.trim()}
                            title="Send message"
                        >
                            <ArrowUp size={20} aria-hidden="true" />
                        </button>
                    {/if}
                </div>
            </div>
        </div>
    </div>
</div>

<style>
    .input-box {
        padding: 6px 8px 8px;
        border-top: none;
        background: var(--bg-primary, #1e1e1e);
        font-size: var(--ai-font-size, 14px);
        font-family: var(--ai-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
        position: relative;
    }

    .input-wrapper {
        display: flex;
        flex-direction: column;
        gap: 6px;
    }

    .input-container {
        position: relative;
        display: flex;
        flex-direction: column;
        background: var(--bg-secondary, #252525);
        border: 1px solid var(--border-color, #333);
        border-radius: 6px;
        padding: 8px;
        gap: 6px;
        transition: border-color 0.15s;
    }

    .input-container:focus-within {
        border-color: var(--accent-color, #007acc);
    }

    .input-main {
        flex: 1;
        display: flex;
        align-items: flex-start;
        gap: 6px;
    }

    .attachment-row {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        margin-bottom: 4px;
    }

    .attachment-chip {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 2px 8px;
        border-radius: 999px;
        background: var(--bg-hover, #333);
        color: var(--text-secondary, #ccc);
        font-size: 12px;
    }

    .attachment-thumb {
        width: 20px;
        height: 20px;
        border-radius: 4px;
        overflow: hidden;
        flex-shrink: 0;
        background: #111;
    }

    .attachment-thumb img {
        width: 100%;
        height: 100%;
        object-fit: cover;
        display: block;
    }
    .attachment-icon {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 18px;
        height: 18px;
        border-radius: 4px;
        background: rgba(255, 255, 255, 0.05);
        color: var(--text-secondary, #ccc);
        flex-shrink: 0;
    }
    .attachment-icon.folder {
        color: #fcd34d;
    }
    .attachment-icon.file {
        color: var(--text-secondary, #ccc);
    }
    .attachment-icon.filetype :global(img) {
        margin: 0;
        width: 16px;
        height: 16px;
    }

    .attachment-label {
        max-width: 160px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .attachment-remove {
        border: none;
        background: transparent;
        color: inherit;
        cursor: pointer;
        padding: 0;
        font-size: 12px;
        line-height: 1;
    }

    textarea {
        flex: 1;
        width: auto;
        background: transparent;
        border: none;
        color: var(--text-primary, #fff);
        font-size: calc(var(--ai-font-size, 14px) * 0.9);
        font-family: inherit;
        resize: none;
        min-height: 2.6em;
        max-height: 8.5em;
        overflow-y: auto;
        line-height: 1.5;
        padding: 0;
    }

    textarea:focus {
        outline: none;
    }

    textarea:disabled {
        opacity: 0.5;
        cursor: not-allowed;
    }

    textarea::placeholder {
        color: var(--text-secondary, #777);
        opacity: 0.5;
    }

    /* Custom scrollbar for textarea */
    textarea::-webkit-scrollbar {
        width: 6px;
    }

    textarea::-webkit-scrollbar-track {
        background: transparent;
    }

    textarea::-webkit-scrollbar-thumb {
        background: var(--border-color, #444);
        border-radius: 3px;
    }

    textarea::-webkit-scrollbar-thumb:hover {
        background: var(--text-secondary, #666);
    }

    .input-bottom-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        margin-top: 2px;
    }

    .context-circle-wrapper {
        position: relative;
        display: flex;
        align-items: flex-start;
    }

    .context-circle {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 30px;
        height: 30px;
        border-radius: 50%;
        position: relative;
        font-size: 10px;
        color: var(--text-secondary, #aaa);
        flex-shrink: 0;
        border: none;
        background: transparent;
        cursor: pointer;
    }

    .context-circle svg {
        position: absolute;
        inset: 0;
        transform: rotate(-90deg);
    }

    .context-circle-track,
    .context-circle-progress {
        fill: none;
        stroke-width: 1;
        stroke-linecap: round;
    }

    .context-circle-track {
        stroke: rgba(255, 255, 255, 0.04);
    }

    :global(html[data-theme="light"]) .context-circle-track {
        stroke: rgba(15, 23, 42, 0.03);
    }

    .context-circle-progress {
        stroke: rgba(255, 255, 255, 0.25);
        transition: stroke-dashoffset 0.2s ease-out;
    }

    :global(html[data-theme="light"]) .context-circle-progress {
        stroke: rgba(15, 23, 42, 0.2);
    }

    .context-circle-label {
        position: absolute;
        inset: 0;
        z-index: 1;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 8px;
        line-height: 1;
        font-variant-numeric: tabular-nums;
        color: rgba(148, 163, 184, 0.7);
        pointer-events: none;
    }

    .context-menu {
        position: absolute;
        top: calc(100% + 6px);
        right: 0;
        width: 220px;
        padding: 10px;
        border-radius: 10px;
        background: rgba(17, 24, 39, 0.95);
        border: 1px solid rgba(59, 130, 246, 0.2);
        box-shadow: 0 8px 20px rgba(0, 0, 0, 0.45);
        color: var(--text-primary, #fff);
        font-size: 12px;
        z-index: 10;
    }

    :global(html[data-theme="light"]) .context-menu {
        background: rgba(255, 255, 255, 0.96);
        border-color: rgba(37, 99, 235, 0.2);
        color: var(--text-primary, #111);
        box-shadow: 0 8px 20px rgba(15, 23, 42, 0.12);
    }

    .context-menu-title {
        font-weight: 600;
        margin-bottom: 4px;
    }

    .context-menu-desc {
        margin: 0 0 8px;
        color: var(--text-secondary, #9ba5b4);
        line-height: 1.4;
    }

    :global(html[data-theme="light"]) .context-menu-desc {
        color: #6b7280;
    }

    .context-menu-action {
        width: 100%;
        padding: 6px 10px;
        border-radius: 6px;
        border: none;
        background: var(--accent-color, #007acc);
        color: #fff;
        cursor: pointer;
        font-size: 12px;
        font-weight: 600;
        transition: filter 0.15s;
    }

    .context-menu-action:hover {
        filter: brightness(1.1);
    }

    .send-btn {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 2.2em;
        height: 2.2em;
        padding: 0;
        background: var(--bg-hover, #3a3a3a);
        border: 1px solid transparent;
        border-radius: 50%;
        color: var(--text-primary, #fff);
        cursor: pointer;
        transition: all 0.15s;
        flex-shrink: 0;
    }

    .send-btn:hover:not(:disabled) {
        background: var(--accent-color, #007acc);
    }

    .send-btn:disabled {
        opacity: 0.3;
        cursor: not-allowed;
    }

    .send-btn.interrupt {
        background: rgba(239, 68, 68, 0.14);
        border-color: rgba(239, 68, 68, 0.35);
        color: rgba(248, 113, 113, 0.98);
    }

    .send-btn.interrupt:hover:not(:disabled) {
        background: rgba(239, 68, 68, 0.20);
        border-color: rgba(239, 68, 68, 0.50);
        color: rgba(252, 165, 165, 0.98);
    }

    :global(html[data-theme="light"]) .send-btn.interrupt {
        background: rgba(239, 68, 68, 0.10);
        border-color: rgba(239, 68, 68, 0.25);
        color: rgba(185, 28, 28, 0.95);
    }

    :global(html[data-theme="light"]) .send-btn.interrupt:hover:not(:disabled) {
        background: rgba(239, 68, 68, 0.14);
        border-color: rgba(239, 68, 68, 0.35);
        color: rgba(153, 27, 27, 0.98);
    }

    .input-footer {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 0 4px;
    }

    .input-actions {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 0 4px;
        flex-shrink: 0;
    }

    .goal-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 5px;
        height: 1.9em;
        padding: 0 10px;
        background: var(--bg-secondary, #252525);
        border: 1px solid var(--border-color, #333);
        border-radius: 999px;
        color: var(--text-secondary, #aaa);
        cursor: pointer;
        transition: all 0.15s;
        flex-shrink: 0;
        font-size: 12px;
        font-weight: 650;
    }

    .goal-btn:hover,
    .goal-btn.active {
        background: var(--bg-hover, #2a2a2a);
        color: var(--text-primary, #fff);
        border-color: rgba(20, 184, 166, 0.32);
    }

    .goal-btn.active {
        background: rgba(20, 184, 166, 0.10);
        color: #5eead4;
        border-color: rgba(20, 184, 166, 0.28);
    }

    :global(html[data-theme="light"]) .goal-btn.active {
        background: rgba(15, 118, 110, 0.07);
        color: #0f766e;
        border-color: rgba(15, 118, 110, 0.22);
    }

    .goal-btn:disabled {
        opacity: 0.45;
        cursor: not-allowed;
        background: var(--bg-secondary, #252525);
    }

    .goal-panel {
        position: absolute;
        bottom: calc(100% + 10px);
        left: 0;
        right: 0;
        padding: 12px;
        border-radius: 14px;
        background:
            linear-gradient(135deg, rgba(20, 184, 166, 0.10), rgba(59, 130, 246, 0.06)),
            rgba(17, 24, 39, 0.98);
        border: 1px solid rgba(20, 184, 166, 0.22);
        box-shadow: 0 12px 30px rgba(0, 0, 0, 0.45);
        z-index: 22;
        display: flex;
        flex-direction: column;
        gap: 10px;
        color: var(--text-primary, #fff);
    }

    :global(html[data-theme="light"]) .goal-panel {
        background:
            linear-gradient(135deg, rgba(15, 118, 110, 0.05), rgba(37, 99, 235, 0.035)),
            rgba(255, 255, 255, 0.98);
        border-color: rgba(15, 118, 110, 0.16);
        box-shadow: 0 12px 30px rgba(15, 23, 42, 0.12);
        color: var(--text-primary, #111);
    }

    .goal-panel-title {
        font-size: 13px;
        font-weight: 700;
    }

    .goal-panel-textarea {
        width: 100%;
        min-height: 72px;
        padding: 9px 10px;
        border-radius: 10px;
        border: 1px solid rgba(148, 163, 184, 0.24);
        background: rgba(15, 23, 42, 0.5);
        color: var(--text-primary, #fff);
        line-height: 1.45;
        box-sizing: border-box;
    }

    :global(html[data-theme="light"]) .goal-panel-textarea {
        background: rgba(255, 255, 255, 0.84);
        color: var(--text-primary, #111);
    }

    .goal-panel-row {
        display: flex;
        align-items: center;
        gap: 8px;
    }

    .goal-panel-budget {
        min-width: 0;
        flex: 1;
        padding: 8px 10px;
        border-radius: 10px;
        border: 1px solid rgba(148, 163, 184, 0.24);
        background: rgba(15, 23, 42, 0.45);
        color: var(--text-primary, #fff);
        font-size: 12px;
    }

    :global(html[data-theme="light"]) .goal-panel-budget {
        background: rgba(255, 255, 255, 0.84);
        color: var(--text-primary, #111);
    }

    .goal-panel-submit {
        padding: 8px 12px;
        border-radius: 999px;
        border: 1px solid rgba(20, 184, 166, 0.30);
        background: rgba(20, 184, 166, 0.14);
        color: #99f6e4;
        cursor: pointer;
        font-size: 12px;
        font-weight: 700;
        white-space: nowrap;
    }

    .goal-panel-submit:disabled {
        opacity: 0.45;
        cursor: not-allowed;
    }

    :global(html[data-theme="light"]) .goal-panel-submit {
        color: #0f766e;
        background: rgba(15, 118, 110, 0.08);
    }

    .goal-panel-hint {
        margin: 0;
        color: var(--text-secondary, #9ca3af);
        font-size: 12px;
        line-height: 1.45;
    }

    .goal-status-bar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        flex-wrap: wrap;
        gap: 10px;
        padding: 8px 10px;
        border-radius: 10px;
        border: 1px solid rgba(20, 184, 166, 0.18);
        background: rgba(20, 184, 166, 0.07);
    }

    .goal-status-bar.paused {
        border-color: rgba(217, 119, 6, 0.18);
        background: rgba(217, 119, 6, 0.07);
    }

    .goal-status-bar.limited {
        border-color: rgba(217, 119, 6, 0.20);
        background: rgba(217, 119, 6, 0.08);
    }

    .goal-status-bar.complete {
        border-color: rgba(71, 85, 105, 0.20);
        background: rgba(71, 85, 105, 0.08);
    }

    :global(html[data-theme="light"]) .goal-status-bar {
        border-color: rgba(15, 118, 110, 0.16);
        background: rgba(15, 118, 110, 0.055);
    }

    :global(html[data-theme="light"]) .goal-status-bar.paused {
        border-color: rgba(180, 83, 9, 0.18);
        background: rgba(180, 83, 9, 0.055);
    }

    :global(html[data-theme="light"]) .goal-status-bar.limited {
        border-color: rgba(180, 83, 9, 0.20);
        background: rgba(180, 83, 9, 0.065);
    }

    :global(html[data-theme="light"]) .goal-status-bar.complete {
        border-color: rgba(71, 85, 105, 0.16);
        background: rgba(71, 85, 105, 0.045);
    }

    .goal-status-main {
        display: flex;
        align-items: flex-start;
        gap: 8px;
        flex: 1 1 240px;
        min-width: 0;
        color: #5eead4;
    }

    :global(html[data-theme="light"]) .goal-status-main {
        color: #0f766e;
    }

    .goal-status-copy {
        min-width: 0;
    }

    .goal-status-title {
        display: flex;
        align-items: center;
        gap: 7px;
        min-width: 0;
        color: var(--text-primary, #fff);
        font-size: 12px;
        line-height: 1.35;
    }

    .goal-status-pill {
        flex-shrink: 0;
        padding: 2px 6px;
        border-radius: 999px;
        background: rgba(20, 184, 166, 0.12);
        color: #5eead4;
        font-size: 11px;
        font-weight: 700;
    }

    .goal-status-bar.paused .goal-status-pill,
    .goal-status-bar.limited .goal-status-pill {
        background: rgba(217, 119, 6, 0.12);
        color: #fbbf24;
    }

    .goal-status-bar.complete .goal-status-pill {
        background: rgba(148, 163, 184, 0.12);
        color: #cbd5e1;
    }

    :global(html[data-theme="light"]) .goal-status-pill {
        background: rgba(15, 118, 110, 0.09);
        color: #0f766e;
    }

    :global(html[data-theme="light"]) .goal-status-bar.paused .goal-status-pill,
    :global(html[data-theme="light"]) .goal-status-bar.limited .goal-status-pill {
        background: rgba(180, 83, 9, 0.09);
        color: #92400e;
    }

    :global(html[data-theme="light"]) .goal-status-bar.complete .goal-status-pill {
        background: rgba(71, 85, 105, 0.08);
        color: #475569;
    }

    .goal-status-objective {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .goal-status-meta {
        margin-top: 2px;
        color: var(--text-secondary, #94a3b8);
        font-size: 11px;
        font-variant-numeric: tabular-nums;
    }

    .goal-status-actions {
        display: flex;
        align-items: center;
        gap: 5px;
        flex-shrink: 0;
    }

    .goal-status-actions button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 26px;
        height: 24px;
        padding: 0 7px;
        border-radius: 999px;
        border: 1px solid rgba(148, 163, 184, 0.18);
        background: rgba(255, 255, 255, 0.04);
        color: var(--text-secondary, #cbd5e1);
        cursor: pointer;
        font-size: 11px;
    }

    .goal-status-actions button:hover:not(:disabled) {
        background: rgba(255, 255, 255, 0.08);
        color: var(--text-primary, #fff);
    }

    .goal-status-actions button:disabled {
        opacity: 0.45;
        cursor: not-allowed;
    }

    .branch-picker {
        position: absolute;
        bottom: calc(100% + 10px);
        left: 0;
        right: 0;
        max-height: 320px;
        padding: 12px;
        border-radius: 14px;
        background: rgba(17, 24, 39, 0.95);
        border: 1px solid rgba(59, 130, 246, 0.25);
        box-shadow: 0 12px 30px rgba(0, 0, 0, 0.45);
        z-index: 20;
        display: flex;
        flex-direction: column;
        gap: 10px;
    }

    :global(html[data-theme="light"]) .branch-picker {
        background: rgba(255, 255, 255, 0.98);
        border-color: rgba(37, 99, 235, 0.2);
        box-shadow: 0 12px 30px rgba(15, 23, 42, 0.12);
    }

    .branch-search {
        display: flex;
        align-items: center;
        gap: 8px;
    }

    .branch-search input {
        flex: 1;
        padding: 8px 10px;
        border-radius: 10px;
        border: 1px solid var(--border-color, #334155);
        background: rgba(15, 23, 42, 0.6);
        color: var(--text-primary, #fff);
        font-size: 14px;
    }

    :global(html[data-theme="light"]) .branch-search input {
        background: rgba(255, 255, 255, 0.9);
        color: var(--text-primary, #111);
    }

    .branch-status {
        font-size: 12px;
        color: var(--text-secondary, #9ca3af);
    }

    .branch-error {
        font-size: 12px;
        color: #f87171;
    }

    .branch-list {
        overflow: auto;
        max-height: 240px;
        display: flex;
        flex-direction: column;
        gap: 6px;
    }

    .branch-item {
        width: 100%;
        text-align: left;
        padding: 10px 12px;
        border-radius: 10px;
        border: 1px solid transparent;
        background: rgba(255, 255, 255, 0.02);
        color: var(--text-primary, #e5e7eb);
        cursor: pointer;
        transition: background 0.12s, border-color 0.12s;
        font-size: 14px;
    }

    .branch-item:hover,
    .branch-item.selected {
        background: rgba(59, 130, 246, 0.12);
        border-color: rgba(59, 130, 246, 0.25);
    }

    .branch-empty {
        padding: 8px 4px;
        color: var(--text-secondary, #9ca3af);
        font-size: 13px;
    }

    .slash-menu-wrapper {
        display: flex;
        align-items: center;
    }

    .slash-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 1.9em;
        height: 1.9em;
        margin-left: 4px;
        padding: 0;
        border-radius: 50%;
        border: 1px solid var(--border-color, #333);
        background: var(--bg-secondary, #252525);
        color: var(--text-primary, #fff);
        cursor: pointer;
        transition: all 0.15s;
        font-weight: 700;
        font-size: 14px;
        line-height: 1;
        flex-shrink: 0;
    }

    .slash-btn:hover {
        background: var(--bg-hover, #2f2f2f);
    }

    .slash-btn:disabled {
        opacity: 0.45;
        cursor: not-allowed;
        background: var(--bg-secondary, #252525);
    }

    .slash-menu {
        position: absolute;
        bottom: calc(100% + 10px);
        left: 0;
        right: 0;
        max-height: 260px;
        padding: 10px 12px;
        border-radius: 14px;
        background: rgba(17, 24, 39, 0.96);
        border: 1px solid rgba(59, 130, 246, 0.25);
        box-shadow: 0 10px 30px rgba(0, 0, 0, 0.35);
        z-index: 15;
        color: var(--text-primary, #fff);
        display: flex;
        flex-direction: column;
        gap: 4px;
    }

    :global(html[data-theme="light"]) .slash-menu {
        background: rgba(255, 255, 255, 0.98);
        border-color: rgba(37, 99, 235, 0.2);
        box-shadow: 0 10px 30px rgba(15, 23, 42, 0.15);
        color: var(--text-primary, #111);
    }

    .slash-menu-header {
        font-weight: 600;
        font-size: 12px;
        margin-bottom: 8px;
        opacity: 0.9;
    }

    .slash-menu-item {
        display: flex;
        align-items: center;
        gap: 8px;
        width: 100%;
        padding: 8px 10px;
        border: none;
        background: transparent;
        color: inherit;
        border-radius: 8px;
        cursor: pointer;
        transition: background 0.12s;
        font-size: 13px;
        text-align: left;
    }

    .slash-menu-item:hover {
        background: rgba(59, 130, 246, 0.1);
    }

    :global(html[data-theme="light"]) .slash-menu-item:hover {
        background: rgba(59, 130, 246, 0.12);
    }

    .slash-menu-icon {
        width: 18px;
        text-align: center;
        display: inline-flex;
        align-items: center;
        justify-content: center;
    }

    .slash-icon-review {
        color: #38bdf8;
    }

    :global(html[data-theme="light"]) .slash-icon-review {
        color: #0369a1;
    }

    .slash-icon-branch {
        color: #22c55e;
    }

    :global(html[data-theme="light"]) .slash-icon-branch {
        color: #15803d;
    }

    .slash-icon-auto-context {
        color: #facc15;
    }

    :global(html[data-theme="light"]) .slash-icon-auto-context {
        color: #ca8a04;
    }
    .slash-menu-auto-text {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 2px;
    }

    .auto-label {
        font-weight: 500;
    }

    .slash-toggle {
        width: 34px;
        height: 18px;
        border-radius: 999px;
        background: rgba(148, 163, 184, 0.4);
        position: relative;
        flex-shrink: 0;
        transition: background 0.15s ease;
    }

    .slash-toggle-thumb {
        position: absolute;
        top: 2px;
        left: 2px;
        width: 14px;
        height: 14px;
        border-radius: 50%;
        background: #0f172a;
        transition: transform 0.15s ease, background 0.15s ease;
    }

    .slash-toggle.on {
        background: #22c55e;
    }

    .slash-toggle.on .slash-toggle-thumb {
        transform: translateX(16px);
        background: #dcfce7;
    }

    :global(html[data-theme="light"]) .slash-toggle-thumb {
        background: #f9fafb;
    }

    :global(html[data-theme="light"]) .slash-toggle.on .slash-toggle-thumb {
        background: #bbf7d0;
    }

    :global(html[data-theme="light"]) .goal-status-bar {
        background: rgba(34, 197, 94, 0.07);
        border-color: rgba(22, 163, 74, 0.18);
    }

    :global(html[data-theme="light"]) .goal-status-title {
        color: var(--text-primary, #111);
    }

    :global(html[data-theme="light"]) .goal-status-meta {
        color: #64748b;
    }

    :global(html[data-theme="light"]) .goal-status-actions button {
        background: rgba(15, 23, 42, 0.03);
        border-color: rgba(15, 23, 42, 0.12);
        color: #475569;
    }

    :global(html[data-theme="light"]) .goal-status-actions button:hover:not(:disabled) {
        background: rgba(15, 23, 42, 0.06);
        color: #0f172a;
    }

    .slash-menu-item.auto-disabled .auto-label {
        color: #6b7280;
        opacity: 0.7;
    }

    :global(html[data-theme="light"]) .slash-menu-item.auto-disabled .auto-label {
        color: #d1d5db;
        opacity: 0.9;
    }

    .mic-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 1.9em;
        height: 1.9em;
        margin-left: 4px;
        padding: 0;
        border-radius: 50%;
        border: 1px solid var(--border-color, #333);
        background: var(--bg-secondary, #252525);
        color: var(--text-primary, #fff);
        cursor: pointer;
        transition: all 0.15s;
        flex-shrink: 0;
    }

    .mic-btn:hover:not(:disabled) {
        background: var(--bg-hover, #2f2f2f);
    }

    .mic-btn:disabled {
        opacity: 0.45;
        cursor: not-allowed;
        background: var(--bg-secondary, #252525);
    }

    .composer-dictation-error {
        margin-top: 8px;
        padding: 8px 10px;
        border-radius: 10px;
        border: 1px solid rgba(255, 120, 120, 0.4);
        background: rgba(255, 120, 120, 0.08);
        color: var(--text-primary, #fff);
        font-size: 12px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
    }

    .composer-dictation-error-dismiss {
        font-size: 11px;
        padding: 4px 8px;
        border-radius: 999px;
        border: 1px solid rgba(255, 255, 255, 0.12);
        background: rgba(255, 255, 255, 0.04);
        color: var(--text-primary, #fff);
        cursor: pointer;
    }

    .composer-dictation-error-dismiss:hover {
        background: rgba(255, 255, 255, 0.08);
    }

</style>
