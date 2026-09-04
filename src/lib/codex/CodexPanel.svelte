<script lang="ts">
    import { onMount, onDestroy, tick } from "svelte";
    import { invoke } from "@tauri-apps/api/core";
    import { listen, type UnlistenFn } from "@tauri-apps/api/event";
    import ChatView from "./ChatView.svelte";
    import ThreadList from "./ThreadList.svelte";
    import ApprovalPolicySelector from "./ApprovalPolicySelector.svelte";
    import SettingsPanel from "./SettingsPanel.svelte";
    import { t } from "../i18n";
    import { get } from "svelte/store";
    import { addNotification, NotifType } from "../Notifications/notifications";
    import Button from "../utility/Button.svelte";
    import {
        approvalsReviewerForAccessMode,
        codexApprovalPolicyForAccessMode,
        sandboxModeForAccessMode,
        type AccessMode,
    } from "./approvalModes";
    import type {
        Account,
        GetAccountResponse,
        ModelListResponse,
        ServerNotification,
        Thread,
        ThreadListResponse,
        ThreadResumeResponse,
        ThreadStartParams,
        ThreadStartResponse,
        ReasoningEffort,
        Turn,
    } from "./types";
    import { is_dark_theme } from "../../config/themehandler";

    type ThreadListItem = {
        id: string;
        title: string;
        created_at: string;
        updated_at: string;
        cwd: string;
        isSubagent: boolean;
        parentThreadId: string | null;
        agentNickname: string | null;
        agentRole: string | null;
    };

    type UIModel = {
        id: string;
        name: string;
        slug: string;
        displayName: string;
        provider: string | null;
        isDefault: boolean;
        supportedEfforts?: ReasoningEffort[];
        effortOptions?: Array<{ value: ReasoningEffort; label: string }>;
        defaultEffort?: ReasoningEffort | null;
    };

    function getResolvedEffortForModel(model: UIModel | null | undefined): ReasoningEffort | "" {
        const options = model?.effortOptions ?? [];
        if (!options.length) return "";
        const supported = new Set(options.map((opt) => opt.value));
        if (selectedEffort && supported.has(selectedEffort as ReasoningEffort)) {
            return selectedEffort as ReasoningEffort;
        }
        if (model?.defaultEffort && supported.has(model.defaultEffort)) {
            return model.defaultEffort;
        }
        return options[0]?.value ?? "";
    }

    type PanelView = "chat" | "threads" | "settings";
    const THREAD_PAGE_SIZE = 15;

    let currentView: PanelView = "chat";
    let hasAppliedInitialView = false;
    let currentThreadId: string | null = null;
    // Incremented for every successful resume so selecting the already-open
    // thread still gives ChatView a clean history hydration lifecycle.
    let chatViewMountKey = 0;
    let threads: ThreadListItem[] = [];
    let models: UIModel[] = [];
    let selectedModel: string | null = null;
    let selectedEffort: ReasoningEffort | "" = "";
    let isInitialized = false;
    let unlistenNotification: UnlistenFn | null = null;
    let unlistenError: UnlistenFn | null = null;
    let unlistenRequest: UnlistenFn | null = null;
    
    // Auth state
    let authMode: Account["type"] | null = null;
    let account: Account | null = null;
    let chatViewRef: InstanceType<typeof ChatView> | null = null;
    let currentWorkingDir: string | null = null;
    let workspaceDirUnlisten: UnlistenFn | null = null;
    let isNewThread: boolean = false;
    let currentThreadModel: string | null = null;
    let currentThreadModelProvider: string | null = null;
    let currentThreadReasoningEffort: ReasoningEffort | null = null;
    let initialResumeTurns: Turn[] | null = null;
    let initialResumeThreadId: string | null = null;
    let accessMode: AccessMode = "workspaceOnRequest";
    let threadCursor: string | null = null;
    let hasMoreThreads = false;
    let isLoadingThreads = false;
    let threadLoadError: string | null = null;
    let hasLoadedInitialThreads = false;
    let threadScope: "project" | "all" = "project";
    let activeThreadLoadToken = 0;
    let queuedThreadLoadReset = false;
    let visibleThreads: ThreadListItem[] = [];
    let currentThreadTitle: string | null = null;
    let isHydratingUiPreferences = false;
    let hasLoadedUiPreferences = false;
    let lastSavedUiPreferencesSignature = "";
    let persistUiPreferencesTimer: number | null = null;
    let authStatusRequestSeq = 0;
    let pendingCodexRequests: any[] = [];
    let pendingCodexNotifications: any[] = [];

    // These events are valid app-server notifications but currently have no
    // dedicated Codey surface. Keep them observable only in opt-in debug logs.
    const DIAGNOSTIC_NOTIFICATION_METHODS = new Set([
        "command/exec/outputDelta",
        "item/commandExecution/terminalInteraction",
        "process/outputDelta",
        "process/exited",
        "rawResponseItem/completed",
        "rawResponse/completed",
        "mcpServer/oauthLogin/completed",
        "mcpServer/startupStatus/updated",
        "mcpServer/event/stream/notification",
        "externalAgentConfig/import/progress",
        "externalAgentConfig/import/completed",
        "fs/changed",
        "deprecationNotice",
        "configWarning",
        "fuzzyFileSearch/sessionUpdated",
        "fuzzyFileSearch/sessionCompleted",
        "thread/realtime/started",
        "thread/realtime/itemAdded",
        "thread/realtime/item/started",
        "thread/realtime/item/transcript/delta",
        "thread/realtime/item/completed",
        "thread/realtime/transcript/delta",
        "thread/realtime/transcript/done",
        "thread/realtime/outputAudio/delta",
        "thread/realtime/sdp",
        "thread/realtime/error",
        "thread/realtime/closed",
        "windows/worldWritableWarning",
        "windowsSandbox/setupCompleted",
        "account/rateLimits/updated",
        "app/list/updated",
        "remoteControl/status/changed",
        "thread/environment/connected",
        "thread/environment/disconnected",
        "thread/queue/changed",
        "autoApprovalReview/strictReviewRequired",
    ]);

    function debugNotification(method: string, params: unknown) {
        try {
            if (typeof window !== "undefined" && window.localStorage?.getItem("codey:debug:codex-protocol") === "1") {
                console.debug("[CodexPanel] protocol notification", method, params);
            }
        } catch {
            // Storage may be unavailable in a restricted WebView context.
        }
    }

    function isKnownModelId(id: string | null | undefined): boolean {
        if (!id) return false;
        return models.some((m) => m.id === id);
    }

    // Keep the stored/persisted selection aligned with what the selector actually shows.
    // ModelSelector will fall back to models[0] for display when selectedModel is null/unknown,
    // but it does not mutate selectedModel automatically.
    $: if (isInitialized && models.length && !isHydratingUiPreferences) {
        const desired =
            (isKnownModelId(selectedModel) && selectedModel) ||
            (isKnownModelId(currentThreadModel) && currentThreadModel) ||
            models[0]?.id ||
            null;
        if (desired && selectedModel !== desired) {
            selectedModel = desired;
        }
    }

    $: if (isInitialized && models.length && selectedModel) {
        const currentModel = models.find((m) => m.id === selectedModel) ?? null;
        const resolvedEffort = getResolvedEffortForModel(currentModel);
        if (resolvedEffort !== selectedEffort) {
            selectedEffort = resolvedEffort;
        }
    }

    function isInteractiveServerRequest(method: string | null | undefined): boolean {
        return (
            method === "item/commandExecution/requestApproval" ||
            method === "item/fileChange/requestApproval" ||
            method === "item/tool/requestUserInput" ||
            method === "mcpServer/elicitation/request" ||
            method === "applyPatchApproval" ||
            method === "execCommandApproval"
        );
    }

    function flushPendingCodexRequests() {
        if (!chatViewRef || pendingCodexRequests.length === 0) {
            return;
        }
        const requests = pendingCodexRequests;
        pendingCodexRequests = [];
        for (const request of requests) {
            chatViewRef.handleRequest(request);
        }
    }

    $: if (chatViewRef && pendingCodexRequests.length > 0) {
        flushPendingCodexRequests();
    }

    function notificationThreadId(notification: any): string | null {
        const value = notification?.params?.threadId ?? notification?.params?.thread_id;
        return typeof value === "string" && value ? value : null;
    }

    function shouldQueueNotification(notification: any): boolean {
        const targetThreadId = notificationThreadId(notification);
        return Boolean(targetThreadId && currentThreadId && targetThreadId === currentThreadId);
    }

    function flushPendingCodexNotifications() {
        if (!chatViewRef || pendingCodexNotifications.length === 0) return;
        const notifications = pendingCodexNotifications;
        const boundThreadId = (chatViewRef as any)?.threadId ?? null;
        const remaining: any[] = [];
        let delivered = false;
        for (const notification of notifications) {
            const targetThreadId = notificationThreadId(notification);
            if (
                shouldQueueNotification(notification) &&
                (!targetThreadId || !boundThreadId || targetThreadId === boundThreadId)
            ) {
                chatViewRef.handleNotification(notification);
                delivered = true;
            } else if (shouldQueueNotification(notification)) {
                // The old ChatView can remain bound for one Svelte flush while a
                // new thread is being mounted. Keep the notification until the
                // replacement instance owns the target thread.
                remaining.push(notification);
            }
        }
        // Also drop notifications that are already stale for the current thread.
        // Keep the array untouched when every entry is merely waiting for the
        // replacement ChatView; that avoids a reactive self-trigger loop.
        if (delivered || remaining.length !== notifications.length) {
            pendingCodexNotifications = remaining;
        }
    }

    $: if (chatViewRef && pendingCodexNotifications.length > 0) {
        flushPendingCodexNotifications();
    }

    function forwardNotificationToChat(notification: any) {
        const targetThreadId = notificationThreadId(notification);
        const boundThreadId = (chatViewRef as any)?.threadId ?? null;
        if (
            chatViewRef &&
            (!targetThreadId || !boundThreadId || targetThreadId === boundThreadId)
        ) {
            chatViewRef.handleNotification(notification);
            return;
        }
        if (shouldQueueNotification(notification)) {
            // Component remounts are brief, but an unbounded queue would make a
            // noisy server stream a memory leak. The newest 200 are sufficient
            // to bridge a remount without retaining stale history.
            pendingCodexNotifications = [...pendingCodexNotifications, notification].slice(-200);
        }
    }

    function normalizePath(path: string | null | undefined): string | null {
        if (!path) return null;
        let normalized = String(path).trim().replace(/[\r\n]+/g, "");
        // Windows may return extended-length paths like `\\?\D:\...` or `\\?\UNC\...`.
        // Strip the prefix so comparisons don't treat everything as "foreign".
        if (normalized.startsWith("\\\\?\\UNC\\")) {
            normalized = "\\\\" + normalized.slice("\\\\?\\UNC\\".length);
        } else if (normalized.startsWith("\\\\?\\")) {
            normalized = normalized.slice("\\\\?\\".length);
        }
        normalized = normalized.replace(/\\/g, "/").toLowerCase();
        // Avoid false mismatches from trailing slashes (except for "c:/").
        if (/^[a-z]:\/$/i.test(normalized)) return normalized;
        return normalized.replace(/\/+$/g, "");
    }

    function getErrorMessage(error: unknown): string {
        if (typeof error === "string") return error;
        if (error instanceof Error) return error.message;
        if (error && typeof error === "object" && "message" in error) {
            const message = (error as { message?: unknown }).message;
            if (typeof message === "string") return message;
        }
        try {
            return JSON.stringify(error);
        } catch {
            return String(error);
        }
    }

    function measureEventLoopLag(label: string) {
        const start = performance.now();
        setTimeout(() => {
            const lagMs = performance.now() - start;
            if (lagMs >= 150) {
                console.log("[UiLag]", {
                    label,
                    lagMs: Math.round(lagMs),
                    view: currentView,
                    loadingThreads: isLoadingThreads,
                });
            }
        }, 0);
    }

    $: {
        visibleThreads = threads;
    }

    $: if (isInitialized && !hasAppliedInitialView) {
        currentView = "threads";
        hasAppliedInitialView = true;
    }
    function queuePersistUiPreferences() {
        if (persistUiPreferencesTimer !== null) {
            clearTimeout(persistUiPreferencesTimer);
        }
        persistUiPreferencesTimer = window.setTimeout(() => {
            persistUiPreferencesTimer = null;
            void persistUiPreferences();
        }, 200);
    }

    $: if (isInitialized && hasLoadedUiPreferences && !isHydratingUiPreferences) {
        // Explicit deps so changes always queue a save.
        accessMode;
        selectedModel;
        selectedEffort;
        queuePersistUiPreferences();
    }

    function setCurrentView(view: PanelView) {
        currentView = view;
        if (view === "threads") {
            // Always reset pagination state when opening the thread list so the initial
            // "Current project" view doesn't depend on stale local state.
            resetThreadListState(true);
            measureEventLoopLag("setCurrentView(threads)");
            loadThreads({ reset: true });
        }
    }

    // Avoid "double fetch" loops: we only fetch when the user explicitly opens the thread list,
    // when scope changes, or when auth notifications explicitly trigger a refresh.

    function resetThreadListState(clearData = false) {
        threadCursor = null;
        hasMoreThreads = false;
        hasLoadedInitialThreads = false;
        threadLoadError = null;
        if (clearData) {
            threads = [];
        }
    }

    function handleLoggedOutState() {
        authMode = null;
        account = null;
    }

    async function handleWorkingDirChange(newDir: string | null) {
        const previousDir = currentWorkingDir;
        const didChange = normalizePath(previousDir) !== normalizePath(newDir);
        console.log("[workspace-sync] handleWorkingDirChange", {
            previousDir,
            newDir,
            didChange,
            currentThreadId,
        });
        console.log(
            `📁 Working directory changed: ${previousDir} -> ${newDir} (changed=${didChange})`
        );

        // Avoid treating path formatting differences (slashes/casing) as a real change.
        if (!didChange) {
            currentWorkingDir = newDir;
            return;
        }

        // If a turn is running, interrupt it before detaching.
        if (currentThreadId && chatViewRef?.hasInProgressTurn()) {
            try {
                await chatViewRef.interruptActiveTurn("workspaceChange");
            } catch (error) {
                console.warn("[CodexPanel] Failed to interrupt active turn on workspace change:", error);
            }
        }

        // Detach from the current thread when switching workspaces, but keep it in history.
        if (currentThreadId) {
            console.log(`🔚 Detaching thread ${currentThreadId} due to workspace change`);
            currentThreadId = null;
            currentThreadModel = null;
            currentThreadModelProvider = null;
            currentThreadReasoningEffort = null;
            addNotification(
                NotifType.Message,
                "工作目录已切换",
                [],
                "已退出当前对话（未归档）。切回原目录后可在线程列表里继续。"
            );
        }

        currentWorkingDir = newDir;
        resetThreadListState(true);

        if (newDir && currentView === "threads") {
            await loadThreads({ reset: true });
        }
    }

    onMount(async () => {
        // Listen for Codex notifications (v2 ServerNotification + codex/event/* stream)
        unlistenNotification = await listen("codex:notification", (event) => {
            handleNotification(event.payload as any);
        });

        unlistenError = await listen("codex:error", (event) => {
            const payload: any = event.payload;
            const message: string | undefined =
                payload?.error?.message ?? payload?.message;

            console.error("Codex error:", payload);
        });

        // Listen for Codex requests (e.g., approval requests)
        unlistenRequest = await listen("codex:request", (event) => {
            handleRequest(event.payload as any);
        });

        // Account status is informational now. The runtime uses the official Codex CLI home.
        await checkAuthStatus();

        // Codex is already initialized at app startup, just load data
        console.log("📋 Loading models and threads...");
        isInitialized = true;
        
        // Get initial working directory from backend
        try {
            currentWorkingDir = await invoke("get_workspace_dir");
            console.log("[workspace-sync] onMount.initial", {
                currentWorkingDir,
            });
            console.log(`📁 Initial working directory: ${currentWorkingDir || "(none)"}`);
        } catch (error) {
            console.error("Failed to get workspace directory:", error);
        }
        
        // Listen for workspace directory changes
        workspaceDirUnlisten = await listen("workspace-dir-changed", (event) => {
            handleWorkingDirChange(event.payload as string | null);
        });
        await loadModels();
        await loadUiPreferences();
        // If the thread list is the initial view, do one best-effort initial load.
        if (currentView === "threads" && !hasLoadedInitialThreads && !isLoadingThreads) {
            measureEventLoopLag("onMount(runtimeReady->threads)");
            await loadThreads({ reset: true });
        }
        
        // Cleanup is handled in onDestroy (this callback is async; returning here is unreliable).
    });

    onDestroy(() => {
        if (unlistenNotification) unlistenNotification();
        if (unlistenError) unlistenError();
        if (unlistenRequest) unlistenRequest();
        if (workspaceDirUnlisten) workspaceDirUnlisten();
    });

    // Note: Codex is initialized at app startup in main.rs
    // We don't need to initialize it again here

    async function loadModels() {
        console.log("📞 Calling codex_model_list...");
        try {
            const result = await invoke<ModelListResponse>("codex_model_list", {
                params: { limit: null, cursor: null },
            });
            console.log("✅ Models loaded:", result);
            // Map API response to expected format
            const rawModels = result.data || [];
            models = rawModels.map((m) => {
                const slug = m.model;
                const displayName = m.displayName || m.model;
                return {
                    id: slug, // Use model name as ID
                    name: displayName,
                    slug,
                    displayName,
                    // Built-in models use the default provider; leave null here.
                    provider: null,
                    isDefault: m.isDefault,
                    supportedEfforts: (m.supportedReasoningEfforts || []).map(
                        (opt) => opt.reasoningEffort
                    ),
                    effortOptions: (m.supportedReasoningEfforts || []).map((opt) => ({
                        value: opt.reasoningEffort,
                        // UI 里显示 raw level（minimal/low/medium/...），不用 description
                        label: opt.reasoningEffort,
                    })),
                    defaultEffort: m.defaultReasoningEffort,
                };
            });

            console.log(`📊 Total models: ${models.length}`);
        } catch (error) {
            console.error("Failed to load models:", error);
        }
    }

    // Refresh models when the picker is opened. Cheap in practice because Codex caches model
    // catalogs with TTL and uses OnlineIfUncached, so this usually hits local cache.
    let modelListRefreshInFlight = false;
    let modelListRefreshLastAt = 0;
    const MODEL_LIST_REFRESH_COOLDOWN_MS = 1500;
    async function refreshModelsOnPickerOpen() {
        const now = Date.now();
        if (modelListRefreshInFlight) return;
        if (now - modelListRefreshLastAt < MODEL_LIST_REFRESH_COOLDOWN_MS) return;
        modelListRefreshInFlight = true;
        try {
            await loadModels();
            modelListRefreshLastAt = Date.now();
        } finally {
            modelListRefreshInFlight = false;
        }
    }

    function refreshModelsInBackground(reason: string) {
        if (modelListRefreshInFlight) return;
        modelListRefreshInFlight = true;
        void loadModels()
            .then(() => {
                modelListRefreshLastAt = Date.now();
            })
            .catch((error) => {
                console.warn(`[CodexPanel] Background model refresh failed (${reason}):`, error);
            })
            .finally(() => {
                modelListRefreshInFlight = false;
            });
    }

    type LoadThreadsOptions = {
        reset?: boolean;
    };

    async function loadThreads(options: LoadThreadsOptions = {}) {
        const { reset = false } = options;

        if (isLoadingThreads) {
            if (reset) {
                queuedThreadLoadReset = true;
            }
            return;
        }

        if (!reset && !threadCursor) {
            // No more pages to load
            return;
        }

        if (reset) {
            threadCursor = null;
            hasMoreThreads = false;
            threadLoadError = null;
        }

        const requestToken = ++activeThreadLoadToken;
        const requestScope = threadScope;
        const requestCwd = currentWorkingDir;
        isLoadingThreads = true;
        queuedThreadLoadReset = false;

        const perfStart = performance.now();
        let perfRpcMs = 0;
        let perfMapMs = 0;
        let perfTickMs = 0;
        let perfRafMs = 0;
        let perfItems = 0;
        let perfMaxPreviewChars = 0;

        try {
            // Guard against races during workspace switching: `workspace-dir-changed` may lag behind
            // the user's "Open Folder" action, so refresh cwd once before issuing server-side
            // filtered queries.
            //
            // IMPORTANT: do this only after `isLoadingThreads = true` so we don't allow concurrent
            // reset fetches while awaiting this IPC call.
            if (requestScope === "project" && reset) {
                try {
                    const backendCwd = await invoke<string | null>("get_workspace_dir");
                    const backendNorm = normalizePath(backendCwd);
                    const localNorm = normalizePath(currentWorkingDir);
                    if (backendNorm && backendNorm !== localNorm) {
                        currentWorkingDir = backendCwd;
                    }
                } catch {}
            }

            const params: any = {
                limit: THREAD_PAGE_SIZE,
                cursor: reset ? null : threadCursor,
                // 底层协议支持按 created_at / updated_at 排序；这里按最近更新时间排在前面。
                // 这样分页 cursor 也与服务端排序一致，避免客户端二次排序导致错乱。
                sortKey: "updated_at",
                // 传空数组表示「所有 provider 的会话」
                modelProviders: [],
                // Only show interactive, user-facing sessions. Including exec/appServer forces
                // Codex to post-filter all sources, which is slow on large histories.
                sourceKinds: ["cli", "vscode"],
            };
            if (requestScope === "project" && currentWorkingDir) {
                // Backend normalizes cwd across platforms (Windows extended-length paths, etc.).
                params.cwd = currentWorkingDir;
            }

            const rpcStart = performance.now();
            const result = await invoke<ThreadListResponse>("codex_thread_list", { params });
            perfRpcMs = performance.now() - rpcStart;

            const rawThreads = result.data || [];
            perfItems = rawThreads.length;
            for (const th of rawThreads) {
                const previewLen = (th.preview || "").length;
                if (previewLen > perfMaxPreviewChars) perfMaxPreviewChars = previewLen;
            }

            const mapStart = performance.now();
            const mappedThreads = rawThreads.map(mapThreadToListItem);
            perfMapMs = performance.now() - mapStart;

            if (
                requestToken !== activeThreadLoadToken ||
                requestScope !== threadScope ||
                normalizePath(requestCwd) !== normalizePath(currentWorkingDir)
            ) {
                return;
            }

            threads = reset ? mappedThreads : [...threads, ...mappedThreads];
            threadCursor = result.nextCursor ?? null;
            hasMoreThreads = Boolean(result.nextCursor);

            if (reset) {
                hasLoadedInitialThreads = true;
            }

            const tickStart = performance.now();
            await tick();
            perfTickMs = performance.now() - tickStart;

            // `tick()` waits for Svelte to flush updates, but not necessarily for a browser paint.
            // A single rAF gives a better signal for "UI felt stuck" reports.
            const rafStart = performance.now();
            await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
            perfRafMs = performance.now() - rafStart;
        } catch (error) {
            console.error("Failed to load threads:", error);
            if (
                requestToken !== activeThreadLoadToken ||
                requestScope !== threadScope ||
                normalizePath(requestCwd) !== normalizePath(currentWorkingDir)
            ) {
                return;
            }
            threadLoadError = "load_failed";
            if (reset) {
                hasLoadedInitialThreads = true;
                threads = [];
                threadCursor = null;
                hasMoreThreads = false;
            }
        } finally {
            if (requestToken === activeThreadLoadToken) {
                isLoadingThreads = false;
            }
            const totalMs = performance.now() - perfStart;
            const isSlow =
                totalMs >= 200 ||
                perfRpcMs >= 150 ||
                perfTickMs >= 100 ||
                perfRafMs >= 50 ||
                perfMaxPreviewChars >= 5000;
            // Only log when it looks slow to avoid spamming.
            if (isSlow) {
                console.log("[ThreadsPerf] loadThreads", {
                    reset,
                    cursor: reset ? null : threadCursor,
                    items: perfItems,
                    rpcMs: Math.round(perfRpcMs),
                    mapMs: Math.round(perfMapMs),
                    tickMs: Math.round(perfTickMs),
                    rafMs: Math.round(perfRafMs),
                    totalMs: Math.round(totalMs),
                    maxPreviewChars: perfMaxPreviewChars,
                });
            }
            if (requestToken === activeThreadLoadToken && queuedThreadLoadReset) {
                queuedThreadLoadReset = false;
                void loadThreads({ reset: true });
            }
        }
    }

    function mapThreadToListItem(thread: Thread): ThreadListItem {
        const createdAtSeconds = Number(thread.createdAt);
        const createdAtIso = new Date(createdAtSeconds * 1000).toISOString();
        const updatedAtSeconds = Number(thread.updatedAt ?? thread.createdAt);
        const updatedAtIso = new Date(updatedAtSeconds * 1000).toISOString();
        const source = thread.source;
        const isSubagent =
            !!source &&
            typeof source === "object" &&
            "subAgent" in source;
        const parentThreadId =
            isSubagent &&
            source &&
            typeof source === "object" &&
            "subAgent" in source &&
            source.subAgent &&
            typeof source.subAgent === "object" &&
            "thread_spawn" in source.subAgent
                ? source.subAgent.thread_spawn.parent_thread_id
                : null;
        const title =
            thread.name ||
            thread.agentNickname ||
            thread.preview ||
            "Untitled Thread";

        return {
            id: thread.id,
            title,
            created_at: createdAtIso,
            updated_at: updatedAtIso,
            cwd: thread.cwd,
            isSubagent,
            parentThreadId,
            agentNickname: thread.agentNickname ?? null,
            agentRole: thread.agentRole ?? null,
        };
    }

    function loadMoreThreads() {
        loadThreads();
    }

    function handleThreadScopeChange(detail: { scope: "project" | "all" }) {
        threadScope = detail.scope;
        // Scope affects the server-side filter (cwd); always refresh the dataset.
        resetThreadListState(true);
        loadThreads({ reset: true });
    }

    let switchThreadConfirmVisible = false;
    let switchThreadConfirmResolver: ((result: boolean) => void) | null = null;
    let switchThreadConfirmTitle = "";
    let switchThreadConfirmMessage = "";
    let switchThreadConfirmCancelLabel = "";
    let switchThreadConfirmConfirmLabel = "";
    let switchThreadConfirmInputVisible = false;
    let switchThreadConfirmInputValue = "";
    let switchThreadConfirmInputResolver: ((value: string | null) => void) | null = null;
    let accessModeConfirmBusy = false;
    type InterruptGuardState = {
        requiresConfirmation?: boolean;
        threadId?: string | null;
        threadName?: string | null;
        turnId?: string | null;
    };

    async function getInterruptGuardState(): Promise<InterruptGuardState | null> {
        try {
            return await invoke<InterruptGuardState>("codex_interrupt_guard_state");
        } catch (error) {
            console.warn("[CodexPanel] Failed to query interrupt guard:", error);
            return null;
        }
    }
    function handleSwitchThreadConfirmInput(event: Event) {
        const target = event.currentTarget as HTMLInputElement | null;
        switchThreadConfirmInputValue = target?.value ?? "";
    }

    function openSwitchThreadConfirm(options: {
        title: string;
        message: string;
        cancelLabel: string;
        confirmLabel: string;
    }): Promise<boolean> {
        if (switchThreadConfirmResolver) {
            const resolver = switchThreadConfirmResolver;
            switchThreadConfirmResolver = null;
            try { resolver(false); } catch {}
        }
        switchThreadConfirmTitle = options.title;
        switchThreadConfirmMessage = options.message;
        switchThreadConfirmCancelLabel = options.cancelLabel;
        switchThreadConfirmConfirmLabel = options.confirmLabel;
        switchThreadConfirmVisible = true;
        return new Promise((resolve) => {
            switchThreadConfirmResolver = resolve;
        });
    }

    function resolveSwitchThreadConfirm(result: boolean) {
        const resolver = switchThreadConfirmResolver;
        switchThreadConfirmResolver = null;
        switchThreadConfirmVisible = false;
        if (resolver) {
            resolver(result);
        }
    }

    function openTextInputPrompt(options: {
        title: string;
        message: string;
        placeholder: string;
        initialValue: string;
        cancelLabel: string;
        confirmLabel: string;
    }): Promise<string | null> {
        if (switchThreadConfirmInputResolver) {
            const resolver = switchThreadConfirmInputResolver;
            switchThreadConfirmInputResolver = null;
            try { resolver(null); } catch {}
        }
        switchThreadConfirmTitle = options.title;
        switchThreadConfirmMessage = options.message;
        switchThreadConfirmCancelLabel = options.cancelLabel;
        switchThreadConfirmConfirmLabel = options.confirmLabel;
        switchThreadConfirmInputValue = options.initialValue ?? "";
        switchThreadConfirmInputVisible = true;
        return new Promise((resolve) => {
            switchThreadConfirmInputResolver = resolve;
        });
    }

    function resolveTextInputPrompt(value: string | null) {
        const resolver = switchThreadConfirmInputResolver;
        switchThreadConfirmInputResolver = null;
        switchThreadConfirmInputVisible = false;
        if (resolver) resolver(value);
    }

    async function handleAccessModeChange(nextMode: AccessMode, options?: { silent?: boolean }) {
        if (nextMode === accessMode || accessModeConfirmBusy) {
            return;
        }
        if (options?.silent) {
            accessMode = nextMode;
            void persistUiPreferences();
            return;
        }
        if (nextMode !== "fullAccess") {
            accessMode = nextMode;
            void persistUiPreferences();
            return;
        }
        accessModeConfirmBusy = true;
        try {
            const $t = get(t);
            const confirmed = await openSwitchThreadConfirm({
                title: $t("codex.approval.fullAccessConfirmTitle"),
                message: $t("codex.approval.fullAccessConfirmMessage"),
                cancelLabel: $t("codex.approval.fullAccessConfirmCancel"),
                confirmLabel: $t("codex.approval.fullAccessConfirmConfirm"),
            });
            if (confirmed) {
                accessMode = nextMode;
                void persistUiPreferences();
            }
        } finally {
            accessModeConfirmBusy = false;
        }
    }

    function buildUiPreferencesSignature() {
        return JSON.stringify({
            accessMode,
            selectedModel: selectedModel ?? null,
            selectedEffort: selectedEffort || null,
        });
    }

    async function persistUiPreferences() {
        if (isHydratingUiPreferences) return;
        const signature = buildUiPreferencesSignature();
        if (signature === lastSavedUiPreferencesSignature) return;
        try {
            console.log("[CodexPanel] Persisting UI preferences:", {
                accessMode,
                selectedModel,
                selectedEffort,
            });
            const settings = await invoke<any>("codex_settings_load");
            await invoke("codex_settings_save", {
                settings: {
                    rules: settings?.rules ?? "",
                    responsesWebsocketEnabled: settings?.responsesWebsocketEnabled ?? false,
                    memoryGenerateEnabled: settings?.memoryGenerateEnabled ?? false,
                    memoryUseEnabled: settings?.memoryUseEnabled ?? false,
                    memoryDisableOnExternalContextEnabled:
                        settings?.memoryDisableOnExternalContextEnabled ?? false,
                    mcpServers: settings?.mcpServers ?? [],
                    accessMode,
                    selectedModel,
                    selectedEffort: selectedEffort || null,
                },
            });
            lastSavedUiPreferencesSignature = signature;
        } catch (error) {
            console.warn("[CodexPanel] Failed to persist UI preferences:", error);
        }
    }

    async function loadUiPreferences() {
        isHydratingUiPreferences = true;
        try {
            const settings = await invoke<any>("codex_settings_load");
            if (
                settings?.accessMode === "workspaceOnRequest" ||
                settings?.accessMode === "workspaceNever" ||
                settings?.accessMode === "workspaceGuardian" ||
                settings?.accessMode === "fullAccess"
            ) {
                accessMode = settings.accessMode;
            }
            if (typeof settings?.selectedModel === "string" && settings.selectedModel.length > 0) {
                selectedModel = settings.selectedModel;
            }
            if (typeof settings?.selectedEffort === "string") {
                selectedEffort = settings.selectedEffort as ReasoningEffort;
            }
            lastSavedUiPreferencesSignature = buildUiPreferencesSignature();
        } catch (error) {
            console.warn("[CodexPanel] Failed to load UI preferences:", error);
        } finally {
            isHydratingUiPreferences = false;
            hasLoadedUiPreferences = true;
        }
    }

    function handleSwitchThreadConfirmKeydown(event: KeyboardEvent) {
        if (!switchThreadConfirmVisible && !switchThreadConfirmInputVisible) return;
        if (event.key === "Escape") {
            event.preventDefault();
            if (switchThreadConfirmInputVisible) {
                resolveTextInputPrompt(null);
            } else {
                resolveSwitchThreadConfirm(false);
            }
            return;
        }
        if (event.key === "Enter") {
            event.preventDefault();
            if (switchThreadConfirmInputVisible) {
                resolveTextInputPrompt(switchThreadConfirmInputValue.trim() || null);
            } else {
                resolveSwitchThreadConfirm(true);
            }
        }
    }

    async function renameThread(detail: { threadId: string; title: string }) {
        const threadId = detail.threadId;
        const $t = get(t);
        const value = await openTextInputPrompt({
            title: $t("codex.threads.renameDialogTitle"),
            message: $t("codex.threads.renameDialogMessage"),
            placeholder: $t("codex.threads.renameDialogPlaceholder"),
            initialValue: detail.title || "",
            cancelLabel: $t("codex.threads.renameDialogCancel"),
            confirmLabel: $t("codex.threads.renameDialogConfirm"),
        });
        if (value === null) return;
        try {
            await invoke("codex_thread_name_set", {
                params: { threadId, name: value },
            });
            await loadThreads({ reset: true });
        } catch (error) {
            console.error("Failed to rename thread:", error);
        }
    }

    async function confirmInterruptActiveTurnBeforeSwitch(reason: string): Promise<boolean> {
        try {
            const guard = await getInterruptGuardState();
            if (!guard?.requiresConfirmation) {
                return true;
            }

            const $t = get(t);
            const ok = await openSwitchThreadConfirm({
                title: $t("codex.header.switchThreadConfirmTitle"),
                message: $t("codex.header.switchThreadConfirmMessage"),
                cancelLabel: $t("codex.header.switchThreadConfirmCancel"),
                confirmLabel: $t("codex.header.switchThreadConfirmConfirm"),
            });
            if (!ok) {
                return false;
            }

            if (chatViewRef?.interruptActiveTurn) {
                const didInterrupt = await chatViewRef.interruptActiveTurn(reason);
                if (didInterrupt) {
                    console.log("[CodexPanel] Interrupted active turn before switch:", reason);
                }
            } else if (guard.threadId && guard.turnId) {
                await invoke("codex_turn_interrupt", {
                    params: {
                        threadId: guard.threadId,
                        turnId: guard.turnId,
                    },
                });
                console.log("[CodexPanel] Interrupted active turn via backend guard:", {
                    reason,
                    threadId: guard.threadId,
                    turnId: guard.turnId,
                });
            }
            return true;
        } catch (error) {
            console.warn("[CodexPanel] Failed to interrupt active turn before switch:", error);
            return true;
        }
    }

    async function startNewThread() {
        if (!isInitialized) return;
        if (!models.length) {
            alert("请先在设置中配置模型");
            return;
        }
        const preferredModel =
            (selectedModel && models.find((m) => m.id === selectedModel)) ??
            models.find((m) => m.isDefault) ??
            models[0];
        if (!preferredModel) {
            alert("没有可用的模型");
            return;
        }
        const canSwitch = await confirmInterruptActiveTurnBeforeSwitch("startNewThread");
        if (!canSwitch) return;
        await createThread(preferredModel.id);
    }

    async function createThread(modelId: string) {
        // Get current working directory
        try {
            const workingDir = await invoke("get_workspace_dir");
            console.log(`📁 Current working directory from backend: ${workingDir}`);
            currentWorkingDir = workingDir as string | null;
        } catch (error) {
            console.error("Failed to get workspace directory:", error);
        }

        if (!currentWorkingDir) {
            console.warn("⚠️ No working directory set, cannot start thread");
            alert("请先打开一个工作目录");
            return;
        }

        const perfStart = performance.now();
        let perfRpcMs = 0;
        let perfTickMs = 0;
        let perfRafMs = 0;
        let startedThreadId: string | null = null;

        try {
            initialResumeTurns = null;
            initialResumeThreadId = null;
            // Find the selected model to get its provider
            const model = models.find((m) => m.id === modelId);
            const modelProvider = null;

            console.log("🔍 Selected model:", modelId);
            console.log("🔍 Found model object:", model);
            console.log("🔍 Model provider:", modelProvider);

            const sandboxMode = sandboxModeForAccessMode(accessMode);
            const approvalPolicyForCodex = codexApprovalPolicyForAccessMode(accessMode);
            const approvalsReviewerForCodex = approvalsReviewerForAccessMode(accessMode);

            let developerInstructions: string | null = null;
            try {
                const settings = await invoke<{ rules?: string }>("codex_settings_load");
                const rules = (settings?.rules ?? "").toString().trim();
                developerInstructions = rules ? rules : null;
            } catch {
                developerInstructions = null;
            }

            const params: ThreadStartParams = {
                model: modelId,
                modelProvider,
                cwd: currentWorkingDir,
                approvalPolicy: approvalPolicyForCodex,
                approvalsReviewer: approvalsReviewerForCodex,
                sandbox: sandboxMode,
                config: null,
                baseInstructions: null,
                developerInstructions,
            };

            console.log("✅ Starting thread with params:", params);
            const rpcStart = performance.now();
            const result = await invoke<ThreadStartResponse>("codex_thread_start", {
                params,
            });
            perfRpcMs = performance.now() - rpcStart;
            console.log("✅ Thread started:", result);
            console.log("✅ Thread using model:", result.model);
            console.log("✅ Thread using provider:", result.modelProvider);

            currentThreadId = result.thread.id;
            currentThreadTitle = result.thread.name || result.thread.preview || null;
            startedThreadId = result.thread.id;
            currentThreadModel = result.model;
            currentThreadModelProvider = result.modelProvider;
            currentThreadReasoningEffort = result.reasoningEffort ?? null;
            selectedModel = result.model;
            selectedEffort = (result.reasoningEffort as ReasoningEffort | null) ?? "";
            isNewThread = true; // Mark as new thread to skip resume
            setCurrentView("chat");
            // Thread list will be refreshed by thread/started notification
        } catch (error) {
            console.error("❌ Failed to start thread:", error);
        } finally {
            const tickStart = performance.now();
            await tick();
            perfTickMs = performance.now() - tickStart;

            const rafStart = performance.now();
            await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
            perfRafMs = performance.now() - rafStart;

            const totalMs = performance.now() - perfStart;
            const isSlow = totalMs >= 200 || perfRpcMs >= 150 || perfRafMs >= 50;
            if (isSlow) {
                console.log("[ThreadStartPerf] createThread", {
                    threadId: startedThreadId,
                    modelId,
                    cwd: currentWorkingDir,
                    rpcMs: Math.round(perfRpcMs),
                    tickMs: Math.round(perfTickMs),
                    rafMs: Math.round(perfRafMs),
                    totalMs: Math.round(totalMs),
                });
            }
        }
    }


    async function resumeThread(detail: { threadId: string; cwd?: string }) {
        const threadId = detail.threadId;
        try {
            const canSwitch = await confirmInterruptActiveTurnBeforeSwitch("resumeThread");
            if (!canSwitch) return;
            const params: any = { threadId };

            const result = await invoke<ThreadResumeResponse>("codex_thread_resume", {
                params,
            });

            console.log("[workspace-sync] resumeThread.before_assign", {
                threadId,
                detailCwd: detail.cwd ?? null,
                resultCwd: result.cwd ?? null,
                currentWorkingDir,
            });

            currentThreadId = result.thread.id;
            currentThreadTitle = result.thread.name || result.thread.preview || null;
            currentWorkingDir = result.cwd || detail.cwd || currentWorkingDir;
            currentThreadModel = result.model;
            currentThreadModelProvider = result.modelProvider;
            currentThreadReasoningEffort = result.reasoningEffort ?? null;
            selectedModel = result.model;
            selectedEffort = (result.reasoningEffort as ReasoningEffort | null) ?? "";
            initialResumeTurns = result.thread?.turns ?? [];
            initialResumeThreadId = result.thread?.id ?? threadId;
            chatViewMountKey += 1;
            isNewThread = false; // This is an existing thread
            console.log("[workspace-sync] resumeThread.after_assign", {
                currentThreadId,
                currentThreadTitle,
                currentWorkingDir,
            });
            setCurrentView("chat");
        } catch (error) {
            const message = getErrorMessage(error);
            console.error("Failed to resume thread:", error);
            if (/already has an active writer/i.test(message)) {
                addNotification(
                    NotifType.Warning,
                    $t("codex.threads.resumeConflictTitle"),
                    [],
                    $t("codex.threads.resumeConflictMessage")
                );
            }
        }
    }

    async function handleOpenThreadFromChat(event: CustomEvent<{ threadId: string }>) {
        const threadId = event.detail?.threadId ?? null;
        if (!threadId) return;
        await resumeThread({ threadId });
    }

    function handleForeignThreadClick(detail: { threadId: string; cwd: string }) {
        const targetCwd = detail.cwd;
        const current = currentWorkingDir || "(none)";
        const $t = get(t);

        // Use global toast notifications instead of native dialogs
        addNotification(
            NotifType.Warning,
            $t("codex.threads.foreignWorkspaceBlockedTitle"),
            [],
            $t("codex.threads.foreignWorkspaceBlockedMessage", {
                threadCwd: targetCwd,
                currentCwd: current,
            })
        );
    }

    async function archiveThread(detail: { threadId: string }) {
        const threadId = detail.threadId;
        try {
            await invoke("codex_thread_archive", {
                params: { threadId },
            });
            console.log("✅ Thread archived:", threadId);
            
            // Refresh thread list
            await loadThreads({ reset: true });
            
            // If the archived thread was the current one, clear it
            if (currentThreadId === threadId) {
                currentThreadId = null;
                currentThreadTitle = null;
            }
        } catch (error) {
            console.error("❌ Failed to archive thread:", error);
        }
    }

    async function checkAuthStatus(options: { retryOnEmpty?: boolean } = {}) {
        const { retryOnEmpty = false } = options;
        const requestSeq = ++authStatusRequestSeq;
        try {
            const result = await invoke<GetAccountResponse>("codex_get_account", {
                params: { refreshToken: true },
            });

            if (requestSeq !== authStatusRequestSeq) {
                console.log("[auth-flow] CodexPanel.checkAuthStatus", {
                    status: "stale_ignored",
                    requestSeq,
                    currentView,
                    isInitialized,
                });
                return;
            }

            if (result.account) {
                account = result.account;
                authMode = result.account.type;
                console.log("[auth-flow] CodexPanel.checkAuthStatus", {
                    status: "logged_in",
                    requestSeq,
                    authMode: result.account.type,
                    currentView,
                    isInitialized,
                });
                console.log("✅ Logged in as:", authMode);
            } else {
                if (retryOnEmpty) {
                    console.log("[auth-flow] CodexPanel.checkAuthStatus", {
                        status: "empty_retry",
                        requestSeq,
                        currentView,
                        isInitialized,
                    });
                    await new Promise((resolve) => setTimeout(resolve, 250));
                    if (requestSeq !== authStatusRequestSeq) {
                        console.log("[auth-flow] CodexPanel.checkAuthStatus", {
                            status: "retry_cancelled",
                            requestSeq,
                            currentView,
                            isInitialized,
                        });
                        return;
                    }
                    await checkAuthStatus({ retryOnEmpty: false });
                    return;
                }
                console.log("[auth-flow] CodexPanel.checkAuthStatus", {
                    status: "logged_out",
                    requestSeq,
                    currentView,
                    isInitialized,
                });
                handleLoggedOutState();
                console.log("⚠️ Not logged in");
            }
        } catch (error) {
            if (requestSeq !== authStatusRequestSeq) {
                console.log("[auth-flow] CodexPanel.checkAuthStatus", {
                    status: "error_stale_ignored",
                    requestSeq,
                    currentView,
                    isInitialized,
                });
                return;
            }
            console.log("[auth-flow] CodexPanel.checkAuthStatus", {
                status: "error",
                requestSeq,
                currentView,
                isInitialized,
                error: String(error),
            });
            console.error("Failed to check auth status:", error);
            handleLoggedOutState();
        }
    }

    function handleNotification(notification: any) {
        const method = notification?.method ?? "";

        switch (method) {
            case "account/updated": {
                const { authMode: mode } = notification.params;
                // Auth status changed
                if (mode) {
                    void checkAuthStatus();
                } else {
                    handleLoggedOutState();
                }
                break;
            }

            case "account/login/completed": {
                const params = notification.params;
                if (params.success) {
                    void checkAuthStatus({ retryOnEmpty: true });
                    refreshModelsInBackground("accountLoginCompleted");
                }
                break;
            }

            case "thread/started":
            case "thread/archived":
            case "thread/unarchived":
            case "thread/deleted":
            case "thread/closed":
            case "thread/name/updated":
            case "skills/changed":
            case "project/changed":
            case "thread/project/updated":
                // A new thread only invalidates the list cache. Loading the list immediately can
                // block local/IM thread creation paths; the list reloads when the user opens it.
                resetThreadListState();
                break;
            case "thread/reverted":
                resetThreadListState();
                forwardNotificationToChat(notification);
                break;
            case "error":
            case "thread/status/changed":
            case "thread/settings/updated":
            case "thread/tokenUsage/updated":
            case "thread/compacted":
            case "thread/goal/updated":
            case "thread/goal/cleared":
            case "turn/started":
            case "turn/interrupted":
            case "turn/failed":
            case "turn/completed":
            case "turn/diff/updated":
            case "turn/plan/updated":
            case "turn/moderationMetadata":
            case "hook/started":
            case "hook/completed":
            case "item/started":
            case "item/autoApprovalReview/started":
            case "item/autoApprovalReview/completed":
            case "autoApprovalReview/strictReviewRequired":
            case "item/completed":
            case "item/updated":
            case "item/agentMessage/delta":
            case "item/plan/delta":
            case "item/commandExecution/outputDelta":
            case "item/fileChange/outputDelta":
            case "item/fileChange/patchUpdated":
            case "item/reasoning/summaryTextDelta":
            case "item/reasoning/summaryPartAdded":
            case "item/reasoning/textDelta":
            case "item/mcpToolCall/progress":
            case "model/rerouted":
            case "model/verification":
            case "model/safetyBuffering/updated":
            case "warning":
            case "guardianWarning":
            case "codex/event/plan_delta":
            case "serverRequest/resolved":
                forwardNotificationToChat(notification);
                break;

            default:
                // Newer app-server versions can add thread-scoped notifications before
                // Codey has a dedicated presentation. Keep them in the existing ChatView
                // filtering path so a valid event is not silently discarded.
                if (shouldQueueNotification(notification)) {
                    forwardNotificationToChat(notification);
                } else if (DIAGNOSTIC_NOTIFICATION_METHODS.has(method)) {
                    debugNotification(method, notification?.params);
                }
                break;
        }
    }

    function handleRequest(request: any) {
        console.log("[CodexPanel] Received request:", request.method);

        if (isInteractiveServerRequest(request?.method) && currentView !== "chat") {
            currentView = "chat";
        }

        // Forward request to ChatView; if it is being remounted, queue and replay it.
        if (chatViewRef) {
            chatViewRef.handleRequest(request);
        } else {
            pendingCodexRequests = [...pendingCodexRequests, request];
            console.warn(
                `[CodexPanel] Queued request until ChatView is ready: method=${request?.method}, currentView=${currentView}`
            );
        }
    }
</script>

<svelte:window on:keydown={handleSwitchThreadConfirmKeydown} />

<div class="codex-panel" class:dark={$is_dark_theme} class:light={!$is_dark_theme}>
    <div class="codex-header">
        <div class="header-actions">
            {#if currentView !== "chat"}
                <button
                    class="toolbar-link action-link"
                    on:click={() => setCurrentView("chat")}
                    title={$t("codex.header.backToChatTooltip")}
                >
                    {$t("codex.header.backToChatTooltip")}
                </button>
                <div class="toolbar-divider" aria-hidden="true"></div>
            {/if}
            <button
                class="toolbar-link action-link"
                on:click={startNewThread}
                disabled={!isInitialized}
                title={$t("codex.header.newConversationTooltip")}
            >
                {$t("codex.header.newConversationTooltip")}
            </button>
            <div class="toolbar-divider" aria-hidden="true"></div>
            <div class="toolbar-nav" role="tablist" aria-label="Codex navigation">
                <button
                    class="toolbar-link nav-link"
                    class:active={currentView === "threads"}
                    on:click={() => setCurrentView("threads")}
                    disabled={!isInitialized}
                    title={$t("codex.header.historyTooltip")}
                >
                    {$t("codex.header.historyTooltip")}
                </button>
                <button
                    class="toolbar-link nav-link"
                    class:active={currentView === "settings"}
                    on:click={() => setCurrentView("settings")}
                    title={$t("codex.header.settingsTooltip")}
                >
                    {$t("codex.header.settingsTooltip")}
                </button>
            </div>
        </div>
    </div>

    <div class="codex-content">
        {#if !isInitialized}
            <div class="loading">正在启动 Agent…</div>
        {:else}
            {#if currentThreadId}
                {#key `${currentThreadId}:${chatViewMountKey}`}
                    <ChatView
                        bind:this={chatViewRef}
                        threadId={currentThreadId}
                        cwd={currentWorkingDir}
                        {isNewThread}
                        approvalPolicy={accessMode}
                        {models}
                        bind:selectedModel
                        bind:selectedEffort
                        threadModel={currentThreadModel}
                        threadModelProvider={currentThreadModelProvider}
                        threadReasoningEffort={currentThreadReasoningEffort}
                        initialTurns={initialResumeTurns}
                        initialTurnsThreadId={initialResumeThreadId}
                        onApprovalPolicyChange={handleAccessModeChange}
                        on:openThread={handleOpenThreadFromChat}
                        on:modelPickerOpen={refreshModelsOnPickerOpen}
                    />
                {/key}
            {:else}
                <div class="empty-state">
                    <p>{$t("codex.chat.emptyHint")}</p>
                    <button on:click={startNewThread} disabled={!isInitialized}>
                        {$t("codex.chat.startButton")}
                    </button>
                </div>
            {/if}

            {#if currentView === "threads"}
                <div class="overlay-panel threads-view">
                    <ThreadList 
                        threads={visibleThreads}
                        currentWorkspace={currentWorkingDir}
                        scope={threadScope}
                        hasMore={hasMoreThreads}
                        isLoading={isLoadingThreads}
                        loadError={threadLoadError}
                        on:select={(e) => resumeThread(e.detail)}
                        on:rename={(e) => renameThread(e.detail)}
                        on:archive={(e) => archiveThread(e.detail)}
                        on:loadMore={loadMoreThreads}
                        on:foreignSelect={(e) => handleForeignThreadClick(e.detail)}
                        on:scopeChange={(e) => handleThreadScopeChange(e.detail)}
                    />
                </div>
            {:else if currentView === "settings"}
                <div class="overlay-panel auth-view">
                    <SettingsPanel
                        approvalPolicy={accessMode}
                        {models}
                        bind:selectedModel
                        bind:selectedEffort
                        onApprovalPolicyChange={handleAccessModeChange}
                    />
                </div>
            {/if}
        {/if}
    </div>

    {#if switchThreadConfirmVisible || switchThreadConfirmInputVisible}
        <!-- svelte-ignore a11y-click-events-have-key-events -->
        <div
            class="codex-modal-backdrop"
            role="presentation"
            on:click={() => {
                if (switchThreadConfirmInputVisible) {
                    resolveTextInputPrompt(null);
                } else {
                    resolveSwitchThreadConfirm(false);
                }
            }}
        >
            <!-- svelte-ignore a11y-no-static-element-interactions -->
            <div class="codex-modal" role="dialog" aria-modal="true" on:click|stopPropagation>
                <div class="codex-modal__title">{switchThreadConfirmTitle}</div>
                <div class="codex-modal__message">{switchThreadConfirmMessage}</div>
                {#if switchThreadConfirmInputVisible}
                    <input
                        class="codex-modal__input"
                        value={switchThreadConfirmInputValue}
                        placeholder={$t("codex.threads.renameDialogPlaceholder")}
                        on:input={handleSwitchThreadConfirmInput}
                        autofocus
                    />
                {/if}
                <div class="codex-modal__actions">
                    <Button
                        style="secondary"
                        label={switchThreadConfirmCancelLabel}
                        on:click={() => {
                            if (switchThreadConfirmInputVisible) {
                                resolveTextInputPrompt(null);
                            } else {
                                resolveSwitchThreadConfirm(false);
                            }
                        }}
                    />
                    <Button
                        style={switchThreadConfirmInputVisible ? "primary" : "danger"}
                        label={switchThreadConfirmConfirmLabel}
                        on:click={() => {
                            if (switchThreadConfirmInputVisible) {
                                resolveTextInputPrompt(switchThreadConfirmInputValue.trim() || null);
                            } else {
                                resolveSwitchThreadConfirm(true);
                            }
                        }}
                    />
                </div>
            </div>
        </div>
    {/if}
</div>

<style>
    .codex-panel {
        display: flex;
        flex-direction: column;
        height: 100%;
        background: var(--bg-primary, #1e1e1e);
        color: var(--text-primary, #ffffff);
    }

    /* Light theme */
    .codex-panel.light {
        --bg-primary: #ffffff;
        --bg-secondary: #f4f6fb;
        --bg-input: #ffffff;
        --bg-hover: #e3e9f7;
        --bg-user-message: #f4f6fb;
        --bg-agent-message: transparent;
        --text-primary: #1f2a37;
        --text-secondary: #5f6b7a;
        --border-color: #c1cbe3;
        --accent-color: #2b6fe8;
        --accent-hover: #1f56c4;
        --error-color: #ef4444;
        --error-hover: #dc2626;
        --agent-card-bg: linear-gradient(135deg, #f5f8ff, #e6f0ff);
        --agent-card-border: rgba(59, 130, 246, 0.35);
        --agent-card-shadow: 0 12px 30px rgba(50, 96, 171, 0.18);
        --agent-card-outline: linear-gradient(120deg, rgba(59, 130, 246, 0.35), rgba(14, 165, 233, 0.35));
        --agent-card-outline-opacity: 0.65;
    }

    /* Dark theme (default) */
    .codex-panel.dark {
        --bg-primary: #1e1e1e;
        --bg-secondary: #252525;
        --bg-input: #1e1e1e;
        --bg-hover: #2a2a2a;
        --bg-user-message: #1a3a52;
        --bg-agent-message: transparent;
        --text-primary: #d4d4d4;
        --text-secondary: #aaa;
        --border-color: #333;
        --accent-color: #007acc;
        --accent-hover: #005a9e;
        --error-color: #f44336;
        --error-hover: #d32f2f;
        --agent-card-bg: linear-gradient(135deg, rgba(43, 38, 62, 0.9), rgba(19, 26, 45, 0.95));
        --agent-card-border: rgba(147, 112, 255, 0.45);
        --agent-card-shadow: 0 15px 35px rgba(10, 5, 25, 0.45);
        --agent-card-outline: linear-gradient(120deg, rgba(255, 196, 120, 0.45), rgba(124, 96, 255, 0.4));
        --agent-card-outline-opacity: 0.75;
    }

    .codex-header {
        display: flex;
        justify-content: flex-end;
        align-items: center;
        height: var(--layout-header-height, 40px);
        padding: 0 var(--header-padding-x, 12px);
        box-sizing: border-box;
        border-bottom: 1px solid var(--border-color, #333);
        background: var(--bg-secondary, #252525);
        font-size: var(--header-compact-font-size, 12px);
    }

    .header-actions {
        display: flex;
        gap: 8px;
        align-items: center;
        flex-wrap: wrap;
        justify-content: flex-end;
    }

    .provider-select select {
        padding: 4px 8px;
        border-radius: 4px;
        border: 1px solid var(--border-color, #333);
        background: var(--bg-input, #1e1e1e);
        color: var(--text-primary, #fff);
        font-size: var(--header-compact-font-size, 12px);
    }

    .codex-title {
        font-size: var(--header-label-font-size, 13px);
        font-weight: 600;
        color: var(--text-primary, #ffffff);
    }

    .toolbar-link {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        position: relative;
        min-height: calc(var(--header-control-height, 32px) - 10px);
        height: calc(var(--header-control-height, 32px) - 10px);
        padding: 0 4px;
        border: none;
        background: transparent;
        appearance: none;
        -webkit-appearance: none;
        box-shadow: none;
        outline: none;
        color: var(--text-secondary, #aaa);
        cursor: pointer;
        white-space: nowrap;
        font-weight: 600;
        transition: color 0.15s, opacity 0.15s;
    }

    .toolbar-link:hover:not(:disabled) {
        color: var(--text-primary, #fff);
    }

    .toolbar-link:focus,
    .toolbar-link:focus-visible,
    .toolbar-link:active {
        outline: none;
        box-shadow: none;
        background: transparent;
    }

    .toolbar-link:disabled {
        opacity: 0.5;
        cursor: not-allowed;
    }

    .action-link {
        color: var(--text-secondary, #aaa);
    }

    .action-link:hover:not(:disabled) {
        color: var(--text-primary, #fff);
    }

    .toolbar-divider {
        width: 1px;
        height: 16px;
        background: var(--border-color, #333);
        opacity: 0.7;
    }

    .toolbar-nav {
        display: inline-flex;
        align-items: center;
        gap: 14px;
    }

    .nav-link {
        padding: 0;
    }

    .nav-link::after {
        content: "";
        position: absolute;
        left: 0;
        right: 0;
        bottom: -3px;
        height: 2px;
        border-radius: 999px;
        background: transparent;
        transition: background 0.15s ease;
    }

    .nav-link.active {
        color: var(--text-primary, #fff);
    }

    .nav-link.active::after {
        background: var(--accent-color, #007acc);
    }

    .codex-content {
        flex: 1;
        overflow: hidden;
        display: flex;
        flex-direction: column;
        position: relative;
    }

    .loading,
    .empty-state {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        height: 100%;
        gap: 16px;
        color: var(--text-secondary, #aaa);
    }

    .empty-state button {
        padding: 10px 20px;
        background: var(--accent-color, #007acc);
        border: none;
        color: white;
        border-radius: 4px;
        cursor: pointer;
        font-size: 14px;
    }

    .empty-state button:hover {
        background: var(--accent-hover, #005a9e);
    }

    .overlay-panel {
        position: absolute;
        inset: 0;
        background: var(--bg-primary, #1e1e1e);
        z-index: 1;
        display: flex;
        flex-direction: column;
    }

    /* Settings overlay should never introduce a horizontal scrollbar. */
    .overlay-panel.auth-view {
        overflow-x: hidden;
        overflow-y: auto;
    }

    .threads-view {
        display: flex;
        flex-direction: column;
        height: 100%;
    }

    .thread-actions {
        display: flex;
        justify-content: center;
        padding: 12px 8px 16px;
    }

    .load-more-btn {
        padding: 6px 14px;
        border: 1px dashed var(--border-color, #333);
        border-radius: 4px;
        background: transparent;
        color: var(--text-secondary, #aaa);
        cursor: pointer;
        transition: border-color 0.2s, color 0.2s;
    }

    .load-more-btn:hover:not(:disabled) {
        border-color: var(--accent-color, #007acc);
        color: var(--accent-color, #007acc);
    }

    .load-more-btn:disabled {
        opacity: 0.6;
        cursor: not-allowed;
    }

    .codex-modal-backdrop {
        position: fixed;
        inset: 0;
        z-index: 1000;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 24px;
        background: rgba(0, 0, 0, 0.35);
    }

    .codex-panel.light .codex-modal-backdrop {
        background: rgba(17, 24, 39, 0.25);
    }

    .codex-modal {
        width: min(520px, calc(100vw - 48px));
        border-radius: 10px;
        padding: 18px 18px 14px;
        background: var(--bg-secondary, #111827);
        color: var(--text-primary, #ffffff);
        border: 1px solid var(--border-color, rgba(255, 255, 255, 0.12));
        box-shadow: 0 20px 60px rgba(0, 0, 0, 0.35);
    }

    .codex-modal__title {
        font-size: 15px;
        font-weight: 600;
        margin-bottom: 8px;
        letter-spacing: 0.2px;
    }

    .codex-modal__message {
        font-size: 13px;
        line-height: 1.5;
        color: var(--text-secondary, rgba(255, 255, 255, 0.72));
        margin-bottom: 16px;
        white-space: pre-wrap;
    }

    .codex-modal__input {
        width: 100%;
        box-sizing: border-box;
        padding: 10px 12px;
        border-radius: 8px;
        border: 1px solid rgba(255, 255, 255, 0.12);
        background: rgba(0, 0, 0, 0.22);
        color: var(--text-primary, #ffffff);
        font-size: 13px;
        outline: none;
        margin-bottom: 16px;
    }

    .codex-modal__input:focus {
        border-color: rgba(14, 165, 233, 0.7);
        box-shadow: 0 0 0 3px rgba(14, 165, 233, 0.14);
    }

    .codex-panel.light .codex-modal__input {
        border-color: rgba(15, 23, 42, 0.18);
        background: rgba(255, 255, 255, 0.7);
        color: #0f172a;
    }

    .codex-modal__actions {
        display: flex;
        justify-content: flex-end;
        gap: 10px;
    }
</style>
