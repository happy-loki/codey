<script lang="ts">
    import { invoke } from "@tauri-apps/api/core";
    import { onMount, onDestroy, afterUpdate, tick } from "svelte";
    import { createEventDispatcher } from "svelte";
    import { get } from "svelte/store";
    import { listen } from "@tauri-apps/api/event";
    import InputBox from "./InputBox.svelte";
    import ApprovalDialog from "./ApprovalDialog.svelte";
    import RequestUserInputDialog from "./RequestUserInputDialog.svelte";
    import ElicitationDialog from "./ElicitationDialog.svelte";
    import ProcessingPlaceholder from "./ProcessingPlaceholder.svelte";
    import { parseReasoningSummary } from "./reasoningUtils";
    import ApprovalPolicySelector from "./ApprovalPolicySelector.svelte";
    import CollaborationModeSelector from "./CollaborationModeSelector.svelte";
    import ModelSelector from "./ModelSelector.svelte";
    import EffortSelector from "./EffortSelector.svelte";
    import { codexHasInProgressTurn } from "./runState";
    import { t } from "../i18n";
    import { parseTurnUnifiedDiff } from "./diffUtils";
    import ThreadItemFlatList from "./ThreadItemFlatList.svelte";
    import type { TurnDiffFileSummary } from "./diffUtils";
    import type { ComposerAttachment } from "./composerStore";
    import type {
        ServerNotification,
        ErrorNotification,
        CodexErrorInfo,
        ThreadTokenUsageUpdatedNotification,
        ContextCompactedNotification,
        Turn,
        ThreadItem,
        ThreadResumeResponse,
        TurnInterruptResponse,
        TurnStartResponse,
        UserInput,
        CommandExecutionRequestApprovalParams,
        FileChangeRequestApprovalParams,
        ApprovalDecision,
        ToolRequestUserInputParams,
        ToolRequestUserInputResponse,
        ReasoningEffort,
        TurnPlanUpdatedNotification,
        TurnDiffUpdatedNotification,
        PlanDeltaNotification,
        TodoItem,
        ReviewStartResponse,
        ReviewTarget,
        TokenUsageBreakdown,
        ApplyPatchApprovalParams,
        ExecCommandApprovalParams,
        ReviewDecision,
        FileUpdateChange,
        ItemGuardianApprovalReviewStartedNotification,
        ItemGuardianApprovalReviewCompletedNotification,
        McpServerElicitationRequestParams,
        McpServerElicitationRequestResponse,
        ThreadGoal,
        ThreadGoalClearedNotification,
        ThreadGoalStatus,
        ThreadGoalUpdatedNotification,
        CommandAction,
    } from "./types";
    import type { CollaborationMode } from "./protocol/generated/CollaborationMode";
    import type { ModeKind } from "./protocol/generated/ModeKind";
    import type { ParsedCommand } from "./protocol/generated/ParsedCommand";
    import {
        approvalsReviewerForAccessMode,
        codexApprovalPolicyForAccessMode,
        type AccessMode,
    } from "./approvalModes";
    import { estimateCost, type CostBreakdown } from "./pricing";

    export let threadId: string;
    export let cwd: string | null = null;
    export let isNewThread: boolean = false;
    export let approvalPolicy: AccessMode = "workspaceOnRequest";
    export let onApprovalPolicyChange:
        | ((policy: AccessMode, options?: { silent?: boolean }) => void | Promise<void>)
        | null = null;
    export let models:
        | Array<{
              id: string;
              name: string;
              provider: string | null;
          }>
        | null = null;
    export let selectedModel: string | null = null;
    export let selectedEffort: ReasoningEffort | "" = "";
    export let threadModel: string | null = null;
    export let threadModelProvider: string | null = null;
    export let threadReasoningEffort: ReasoningEffort | null = null;
    export let initialTurns: Turn[] | null = null;
    export let initialTurnsThreadId: string | null = null;
    export let onInProgressTurnChange: ((value: boolean) => void) | null = null;

    const dispatch = createEventDispatcher<{
        modelPickerOpen: void;
    }>();

    const DEBUG_CHAT_VIEW = (() => {
        try {
            return typeof window !== "undefined" &&
                window.localStorage?.getItem("codey:debug:chatview") === "1";
        } catch {
            return false;
        }
    })();

    function debugLog(...args: unknown[]) {
        if (DEBUG_CHAT_VIEW) console.log(...args);
    }

    function debugWarn(...args: unknown[]) {
        if (DEBUG_CHAT_VIEW) console.warn(...args);
    }

    let turns: Turn[] = [];
    type TurnDiffInfo = {
        unifiedDiff: string;
        files: TurnDiffFileSummary[];
    };
    let turnDiffs: Record<string, TurnDiffInfo> = {};
    const pendingAgentMessageDeltas = new Map<string, string>();
    const pendingPlanDeltas = new Map<string, string>();
    let isProcessing = false;
    let unlistenRequest: any = null;
    let itemsContainer: HTMLDivElement;
    let itemsContent: HTMLDivElement | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let observedResizeTarget: HTMLElement | null = null;
    let resizeObserverRaf: number | null = null;
    let drawerEl: HTMLDivElement | null = null;
    let drawerResizeObserver: ResizeObserver | null = null;
    let observedDrawerTarget: HTMLElement | null = null;
    let drawerResizeObserverRaf: number | null = null;
    let providerScopedModels:
        | Array<{
              id: string;
              name: string;
              provider: string | null;
              effortOptions?: Array<{ value: ReasoningEffort; label: string }>;
              defaultEffort?: ReasoningEffort | null;
          }>
        | null = null;
    // Model list refresh is owned by the parent (CodexPanel), since it owns the `models` state.
    let effortOptionsForModel: Array<{ value: ReasoningEffort; label: string }> = [];
    let defaultEffortForModel: ReasoningEffort | null = null;
    let selectedCollaborationMode: ModeKind = "default";
    let pendingModeForNextTurn: ModeKind | null = null;
    let forcedModeForNextTurn: ModeKind | null = null;
    let errorBanner: string | null = null;
    let stickyErrorBanner = false;
    let contextBanner: string | null = null;
    let contextBannerTimer: number | null = null;
    let sessionTrusted = false;
    let trackedThreadId: string | null = null;
    let activeReviewThreadId: string | null = null;
    let pendingReviewThread = false;
    let reviewInProgress = false;
    let pendingModelForNextTurn: string | null = null;
    let turnModelById: Record<string, string | null> = {};
    let turnModeById: Record<string, ModeKind> = {};
    let sawPlanItemByTurnId: Record<string, boolean> = {};
    let planImplementPromptedTurnIds: Record<string, boolean> = {};
    // Latest thread-cumulative totals we have seen from `thread/tokenUsage/updated`.
    let latestThreadTotals: TokenUsageBreakdown | null = null;
    // Latest totals observed per turnId (still thread-cumulative; used to fetch the last snapshot for a given turn).
    let latestTotalsByTurn: Record<string, TokenUsageBreakdown> = {};
    // Snapshot of thread totals at the end of the previously-finished turn (for per-turn diffing).
    let lastCompletedTotals: TokenUsageBreakdown | null = null;
    // When resuming an existing thread, we need a baseline snapshot so per-turn deltas don't
    // accidentally include the entire historical thread usage.
    let resumeBaselineTotals: TokenUsageBreakdown | null = null;
    // Snapshot of thread totals at the moment a given turn started (thread-cumulative).
    // Used to compute per-turn deltas robustly even after a resume.
    let turnStartTotalsById: Record<string, TokenUsageBreakdown | null> = {};
    let turnTokenStats: Record<
        string,
        { usage: TokenUsageBreakdown; cost: CostBreakdown | null; model: string | null }
    > = {};
    // ThreadItem 分组折叠状态：key 为 groupId，value 为是否展开（未定义视为展开）
    let itemGroupExpanded: Record<string, boolean> = {};
    let lastDrawerActive = false;
    let drawerActive = false;
    let activeGoal: ThreadGoal | null = null;
    let goalObservedAtMs: number | null = null;
    let activeTurnStartedAtMs: number | null = null;
    let activeItemStartedAtMs: number | null = null;
    let goalLocalElapsedFloorSeconds = 0;
    let uiClockMs = Date.now();
    let uiClockTimer: number | null = null;
    let goalBusy = false;

    // Context window / token usage state (for "context used" indicator)
    // 与 codex-cli 对齐：基于当前活跃上下文大小（usage.last.totalTokens）计算，
    // 并预留固定基线（protocol TokenUsage::BASELINE_TOKENS = 12000）。
    const CONTEXT_BASELINE_TOKENS = 12000;
    let contextPercentUsed: number | null = null;
    let contextTooltip: string | null = null;
    let lastReportedInProgressTurn = false;

    function zeroUsage(): TokenUsageBreakdown {
        return {
            totalTokens: 0,
            inputTokens: 0,
            cachedInputTokens: 0,
            outputTokens: 0,
            reasoningOutputTokens: 0,
        };
    }

    function subtractUsage(end: TokenUsageBreakdown, baseline: TokenUsageBreakdown): TokenUsageBreakdown {
        const clamp0 = (n: number) => Math.max(0, n);
        return {
            totalTokens: clamp0((end.totalTokens ?? 0) - (baseline.totalTokens ?? 0)),
            inputTokens: clamp0((end.inputTokens ?? 0) - (baseline.inputTokens ?? 0)),
            cachedInputTokens:
                clamp0((end.cachedInputTokens ?? 0) - (baseline.cachedInputTokens ?? 0)),
            outputTokens: clamp0((end.outputTokens ?? 0) - (baseline.outputTokens ?? 0)),
            reasoningOutputTokens:
                clamp0(
                    (end.reasoningOutputTokens ?? 0) -
                        (baseline.reasoningOutputTokens ?? 0)
                ),
        };
    }

    function isTurnFinished(status: Turn["status"] | null | undefined): boolean {
        return status === "completed" || status === "failed" || status === "interrupted";
    }

    function finalizeTurnTokenStats(turnId: string, endTotals: TokenUsageBreakdown) {
        if (!turnId) return;
        const baseline =
            turnStartTotalsById[turnId] ??
            lastCompletedTotals ??
            (isNewThread ? zeroUsage() : resumeBaselineTotals);
        if (!baseline) {
            // If we don't have a reliable baseline for an existing (resumed) thread,
            // skip showing usage/cost rather than wildly over-counting the whole history.
            return;
        }
        const usage = subtractUsage(endTotals, baseline);

        // Cost must be computed against the model used to start THIS turn.
        // Thread-level model may differ from per-turn model.
        const modelId = turnModelById[turnId] ?? null;

        const cost = estimateCost(modelId, {
            inputTokens: usage.inputTokens,
            cachedInputTokens: usage.cachedInputTokens,
            outputTokens: usage.outputTokens,
            reasoningOutputTokens: usage.reasoningOutputTokens,
        });

        turnTokenStats = {
            ...turnTokenStats,
            [turnId]: { usage, cost, model: modelId },
        };
        // Clear the per-turn baseline once finalized (keeps memory bounded).
        if (turnId in turnStartTotalsById) {
            const { [turnId]: _, ...rest } = turnStartTotalsById;
            turnStartTotalsById = rest;
        }
        lastCompletedTotals = endTotals;
    }

    // Approval request state
    let pendingApproval: {
        requestId: string;
        params: CommandExecutionRequestApprovalParams | FileChangeRequestApprovalParams;
        type: "command" | "fileChange";
        responseKind: "standard" | "review";
        item?: ThreadItem | null;
        previewDiffIds?: string[];
    } | null = null;
    let pendingUserInput: {
        requestId: string;
        params: ToolRequestUserInputParams;
    } | null = null;
    let pendingElicitation: {
        requestId: string;
        params: McpServerElicitationRequestParams;
    } | null = null;
    $: pendingFileChangeItemId =
        pendingApproval?.type === "fileChange"
            ? (pendingApproval.params as FileChangeRequestApprovalParams).itemId
            : null;

    $: if (threadId && threadId !== trackedThreadId) {
        sessionTrusted = false;
        trackedThreadId = threadId;
        // Switching threads should never carry over "in progress" state from the previous thread,
        // otherwise the UI will incorrectly prompt to interrupt execution when nothing is running.
        clearProcessingState();
        errorBanner = null;
        stickyErrorBanner = false;
        pendingApproval = null;
        pendingUserInput = null;
        pendingElicitation = null;
        pendingReviewThread = false;
        reviewInProgress = false;
        activeReviewThreadId = null;
        // Reset per-thread token tracking so stats never leak across threads.
        latestThreadTotals = null;
        latestTotalsByTurn = {};
        lastCompletedTotals = null;
        resumeBaselineTotals = null;
        turnStartTotalsById = {};
        turnTokenStats = {};
        turnModelById = {};
        turnModeById = {};
        sawPlanItemByTurnId = {};
        planImplementPromptedTurnIds = {};
        pendingModelForNextTurn = null;
        pendingModeForNextTurn = null;
        forcedModeForNextTurn = null;
        activeGoal = null;
        goalObservedAtMs = null;
        activeTurnStartedAtMs = null;
        activeItemStartedAtMs = null;
        goalLocalElapsedFloorSeconds = 0;
        void loadThreadGoal(threadId);
    }

    $: {
        if (!models) {
            providerScopedModels = null;
        } else {
            providerScopedModels = models;
        }

        // Update effort options whenever models / provider / selection change
        const scoped = providerScopedModels ?? [];
        const currentModelId = selectedModel || threadModel || null;
        const currentModel =
            (currentModelId && scoped.find((m) => m.id === currentModelId)) || scoped[0];

        if (currentModel && currentModel.effortOptions && currentModel.effortOptions.length) {
            effortOptionsForModel = currentModel.effortOptions;
            defaultEffortForModel = (currentModel.defaultEffort as ReasoningEffort | null) ?? null;

            const firstEffort = effortOptionsForModel[0]?.value ?? null;
            const isSupported =
                selectedEffort && effortOptionsForModel.some((opt) => opt.value === selectedEffort);

            if (!isSupported) {
                if (defaultEffortForModel) {
                    selectedEffort = defaultEffortForModel;
                } else if (firstEffort) {
                    selectedEffort = firstEffort;
                } else {
                    selectedEffort = "";
                }
            }
        } else {
            effortOptionsForModel = [];
            defaultEffortForModel = null;
            selectedEffort = "";
        }
    }

    let scrollToBottomRaf: number | null = null;
    function scrollToBottom(force: boolean = false) {
        if (!itemsContainer) return;
        if (!force && userInteracting) return;
        if (scrollToBottomRaf !== null) return;

        // Coalesce rapid updates (streaming tokens / diff cards) into one scroll per frame.
        scrollToBottomRaf = requestAnimationFrame(() => {
            scrollToBottomRaf = null;
            if (!itemsContainer) return;
            if (!userInteracting || force) {
                const maxScrollTop = Math.max(
                    0,
                    itemsContainer.scrollHeight - itemsContainer.clientHeight
                );
                itemsContainer.scrollTop = maxScrollTop;
                updateNearBottomState();
            }
        });
    }

    function updateNearBottomState() {
        if (!itemsContainer) {
            isUserNearBottom = true;
            return;
        }

        const nearBottom = isScrolledNearBottom();
        if (nearBottom !== isUserNearBottom) {
            isUserNearBottom = nearBottom;
        }
    }

    function attachResizeObserver(target: HTMLElement | null) {
        if (observedResizeTarget === target) {
            return;
        }

        if (resizeObserver) {
            resizeObserver.disconnect();
            resizeObserver = null;
            observedResizeTarget = null;
        }

        if (!target || typeof ResizeObserver === "undefined") {
            return;
        }

        resizeObserver = new ResizeObserver(() => {
            // ResizeObserver can fire extremely frequently when streaming content updates.
            // Throttle to one state update per frame to avoid layout thrash / flicker.
            if (resizeObserverRaf !== null) return;
            resizeObserverRaf = requestAnimationFrame(() => {
                resizeObserverRaf = null;
                updateNearBottomState();
            });
        });
        resizeObserver.observe(target);
        observedResizeTarget = target;
    }

    function attachDrawerResizeObserver(target: HTMLElement | null) {
        if (observedDrawerTarget === target) {
            return;
        }

        if (drawerResizeObserver) {
            drawerResizeObserver.disconnect();
            drawerResizeObserver = null;
            observedDrawerTarget = null;
        }

        if (!target || typeof ResizeObserver === "undefined") {
            return;
        }

        drawerResizeObserver = new ResizeObserver(() => {
            if (drawerResizeObserverRaf !== null) return;
            drawerResizeObserverRaf = requestAnimationFrame(() => {
                drawerResizeObserverRaf = null;
                // Keep the viewport pinned to bottom while the drawer expands/collapses.
                if (isUserNearBottom) {
                    scrollToBottom(true);
                } else {
                    updateNearBottomState();
                }
            });
        });
        drawerResizeObserver.observe(target);
        observedDrawerTarget = target;
    }

    async function anchorToBottomAfterTick() {
        await tick();
        if (isUserNearBottom) {
            scrollToBottom(true);
        } else {
            updateNearBottomState();
        }
    }

    async function forceScrollToBottomAfterHistoryLoad() {
        // History rendering goes through a virtualized list, so wait until the DOM has
        // been committed and at least one paint has happened before forcing the scroll.
        await tick();
        requestAnimationFrame(() => {
            scrollToBottom(true);
        });
    }

    $: drawerActive =
        !!pendingApproval || !!pendingUserInput || !!pendingElicitation;

    $: {
        if (drawerActive && !lastDrawerActive) {
            void anchorToBottomAfterTick();
        }
        lastDrawerActive = drawerActive;
    }

    function handleScroll() {
        updateNearBottomState();
    }

    function handleItemGroupToggle(event: CustomEvent<{ groupId: string }>) {
        const { groupId } = event.detail;
        const current = itemGroupExpanded[groupId];
        itemGroupExpanded = {
            ...itemGroupExpanded,
            [groupId]: current === undefined ? false : !current,
        };
    }

    onMount(async () => {
        debugLog(`[ChatView] onMount - threadId: ${threadId}, isNewThread: ${isNewThread}`);
        attachResizeObserver(itemsContent);

        // 新建线程：在第一次 tokenUsage 事件到来前，先乐观显示 0%；
        // 旧线程 resume：等待服务端推一次 thread/tokenUsage/updated 再显示，避免误导。
        if (isNewThread) {
            contextPercentUsed = 0;
            contextTooltip = "上下文已使用：0%";
        } else {
            contextPercentUsed = null;
            contextTooltip = null;
        }
        
        // Only load history for existing threads, not newly created ones.
        // If CodexPanel already fetched a thread/resume response, reuse it to avoid
        // a second resume call (large payloads can block the UI).
        if (!isNewThread) {
            if (initialTurns && initialTurnsThreadId === threadId) {
                debugLog("[ChatView] Using initialTurns provided by CodexPanel");
                setTurnsFromHistory(initialTurns);
            } else {
                debugLog("[ChatView] Loading history for existing thread");
                loadThreadHistory();
            }
        } else {
            debugLog("[ChatView] Skipping history load for new thread");
        }
    });

    onDestroy(() => {
        if (resizeObserver) {
            resizeObserver.disconnect();
            resizeObserver = null;
            observedResizeTarget = null;
        }
        if (resizeObserverRaf !== null) {
            cancelAnimationFrame(resizeObserverRaf);
            resizeObserverRaf = null;
        }
        if (drawerResizeObserver) {
            drawerResizeObserver.disconnect();
            drawerResizeObserver = null;
            observedDrawerTarget = null;
        }
        if (drawerResizeObserverRaf !== null) {
            cancelAnimationFrame(drawerResizeObserverRaf);
            drawerResizeObserverRaf = null;
        }
        if (scrollToBottomRaf !== null) {
            cancelAnimationFrame(scrollToBottomRaf);
            scrollToBottomRaf = null;
        }
        if (uiClockTimer !== null) {
            clearInterval(uiClockTimer);
            uiClockTimer = null;
        }
        // Cleanup is handled by CodexPanel
        if (contextBannerTimer !== null) {
            clearTimeout(contextBannerTimer);
            contextBannerTimer = null;
        }
        try { codexHasInProgressTurn.set(false); } catch {}
    });

    function findItemLocation(itemId: string): { turnIndex: number; itemIndex: number } | null {
        for (let ti = turns.length - 1; ti >= 0; ti--) {
            const items = turns[ti].items;
            if (!items || items.length === 0) continue;
            const idx = items.findIndex((item) => item.id === itemId);
            if (idx >= 0) {
                return { turnIndex: ti, itemIndex: idx };
            }
        }
        return null;
    }

    function bufferAgentMessageDelta(itemId: string, delta: string) {
        const current = pendingAgentMessageDeltas.get(itemId) ?? "";
        pendingAgentMessageDeltas.set(itemId, current + delta);
    }

    function applyBufferedAgentMessageDelta(itemId: string) {
        const pending = pendingAgentMessageDeltas.get(itemId);
        if (!pending) return;
        const location = findItemLocation(itemId);
        if (!location) return;

        const targetTurn = turns[location.turnIndex];
        const target = targetTurn.items?.[location.itemIndex];
        if (!target || target.type !== "agentMessage") return;

        target.text = (target.text || "") + pending;
        pendingAgentMessageDeltas.delete(itemId);
        turns = [...turns];
        // Only auto-scroll while the active turn is processing
        if (isProcessing && currentTurnId === targetTurn.id) {
            scrollToBottom();
        }
    }

    function bufferPlanDelta(itemId: string, delta: string) {
        const current = pendingPlanDeltas.get(itemId) ?? "";
        pendingPlanDeltas.set(itemId, current + delta);
    }

    function applyBufferedPlanDelta(itemId: string) {
        const pending = pendingPlanDeltas.get(itemId);
        if (!pending) return;
        const location = findItemLocation(itemId);
        if (!location) return;

        const targetTurn = turns[location.turnIndex];
        const target = targetTurn.items?.[location.itemIndex];
        if (!target || target.type !== "plan") return;

        target.text = (target.text || "") + pending;
        pendingPlanDeltas.delete(itemId);
        turns = [...turns];
        if (isProcessing && currentTurnId === targetTurn.id) {
            scrollToBottom();
        }
    }

    function updateContextUsage(notif: ThreadTokenUsageUpdatedNotification) {
        if (!notif || !matchesThread(notif.threadId)) {
            return;
        }
        const usage = notif.tokenUsage;
        if (usage?.total) {
            latestThreadTotals = usage.total;
            latestTotalsByTurn = {
                ...latestTotalsByTurn,
                [notif.turnId]: usage.total,
            };
        }

        // Resume baseline: capture the first cumulative total we see after mounting into an
        // existing thread, so the next per-turn delta doesn't include historical usage.
        if (!isNewThread && !resumeBaselineTotals && usage?.total) {
            resumeBaselineTotals = usage.total;
            if (!lastCompletedTotals) {
                lastCompletedTotals = usage.total;
            }
            // If a turn already started before baseline arrived, prefer at least
            // using the first observed total rather than "0" (which would overcount hugely).
            if (currentTurnId && turnStartTotalsById[currentTurnId] == null) {
                turnStartTotalsById = {
                    ...turnStartTotalsById,
                    [currentTurnId]: usage.total,
                };
            }
            debugLog("[ChatView] Initialized resumeBaselineTotals for per-turn cost calc", {
                threadId,
                totalTokens: usage.total.totalTokens,
            });
        }

        // Debug hooks for verification in DevTools.
        if (typeof window !== "undefined") {
            (window as any).__codeyCodexLatestThreadTotals = latestThreadTotals;
            (window as any).__codeyCodexLatestTotalsByTurn = latestTotalsByTurn;
            (window as any).__codeyCodexLastCompletedTotals = lastCompletedTotals;
            (window as any).__codeyCodexResumeBaselineTotals = resumeBaselineTotals;
            (window as any).__codeyCodexTurnStartTotalsById = turnStartTotalsById;
            (window as any).__codeyCodexTurnTokenStats = turnTokenStats;
            (window as any).__codeyCodexTurnModels = turnModelById;
        }

        const contextWindow = usage?.modelContextWindow ?? null;
        const tokensInContextWindow = usage?.last?.totalTokens ?? null;

        if (!contextWindow || contextWindow <= CONTEXT_BASELINE_TOKENS || tokensInContextWindow == null) {
            contextPercentUsed = null;
            contextTooltip = null;
            return;
        }

        const effectiveWindow = contextWindow - CONTEXT_BASELINE_TOKENS;
        const used = Math.max(tokensInContextWindow - CONTEXT_BASELINE_TOKENS, 0);
        const percent = Math.round((used / effectiveWindow) * 100);

        contextPercentUsed = Math.max(0, Math.min(100, percent));

        contextTooltip = `上下文已使用：${contextPercentUsed}%（扣除 ${CONTEXT_BASELINE_TOKENS.toLocaleString()} tokens 基线后，已用 ${used.toLocaleString()} / ${effectiveWindow.toLocaleString()} tokens）`;
    }

    function getCodexErrorCode(info: CodexErrorInfo | null): string | null {
        if (!info) return null;
        if (typeof info === "string") {
            return info;
        }
        if ("httpConnectionFailed" in info) {
            return "httpConnectionFailed";
        }
        if ("responseStreamConnectionFailed" in info) {
            return "responseStreamConnectionFailed";
        }
        if ("responseStreamDisconnected" in info) {
            return "responseStreamDisconnected";
        }
        if ("responseTooManyFailedAttempts" in info) {
            return "responseTooManyFailedAttempts";
        }
        return "other";
    }

    function formatErrorBanner(notification: ErrorNotification): string {
        const { error } = notification;
        return formatErrorBannerFromError(error);
    }

    function extractBackendErrorCode(message: string): string | null {
        const text = (message ?? "").trim();
        if (!text) return null;

        const jsonStart = text.indexOf("{");
        if (jsonStart >= 0) {
            let depth = 0;
            let inString = false;
            let escaped = false;
            let jsonEnd = -1;
            for (let i = jsonStart; i < text.length; i++) {
                const ch = text[i];
                if (inString) {
                    if (escaped) {
                        escaped = false;
                    } else if (ch === "\\") {
                        escaped = true;
                    } else if (ch === "\"") {
                        inString = false;
                    }
                    continue;
                }
                if (ch === "\"") {
                    inString = true;
                    continue;
                }
                if (ch === "{") {
                    depth += 1;
                    continue;
                }
                if (ch === "}") {
                    depth -= 1;
                    if (depth === 0) {
                        jsonEnd = i;
                        break;
                    }
                }
            }
            if (jsonEnd > jsonStart) {
                const candidate = text.slice(jsonStart, jsonEnd + 1);
                try {
                    const parsed = JSON.parse(candidate);
                    const code = typeof parsed?.error === "string" ? parsed.error.trim() : "";
                    if (code) return code;
                } catch {}
            }
        }
        return null;
    }

    function localizeBackendErrorCode(code: string | null, details?: string | null): string | null {
        const normalized = (code ?? "").trim();
        const tfn = get(t);
        let key: string | null = null;

        switch (normalized) {
            case "missing_authorization":
                key = "codex.thread.errors.authMissing";
                break;
            case "invalid_authorization":
                key = "codex.thread.errors.authInvalid";
                break;
            case "invalid_api_key":
                key = "codex.thread.errors.apiKeyInvalid";
                break;
            case "invalid_access_token":
                key = "codex.thread.errors.accessTokenInvalid";
                break;
            case "rate_limited":
                key = "codex.thread.errors.rateLimited";
                break;
            case "daily_cap_reached":
                key = "codex.thread.errors.dailyCapReached";
                break;
            case "subscription_quota_exhausted":
                key = "codex.thread.errors.subscriptionQuotaExhausted";
                break;
            case "insufficient_balance":
                key = "codex.thread.errors.insufficientBalance";
                break;
            case "bad_gateway":
                key = "codex.thread.errors.providerUnavailable";
                break;
            case "axonhub_not_configured":
                key = "codex.thread.errors.providerNotConfigured";
                break;
        }

        if (!key) return null;
        const base = tfn(key);
        return base;
    }

    function formatErrorBannerFromError(
        error: { message: string; codexErrorInfo: CodexErrorInfo | null; additionalDetails: string | null } | null | undefined
    ): string {
        if (!error) {
            return get(t)("codex.thread.errors.generic");
        }
        const code = getCodexErrorCode(error.codexErrorInfo);
        const message = (error.message ?? "").trim();
        const details = (error.additionalDetails ?? "").trim();
        const backendCode = extractBackendErrorCode(message);
        const localizedBackendMessage = localizeBackendErrorCode(backendCode, details || message);
        if (localizedBackendMessage) {
            return localizedBackendMessage;
        }

        // Special‑case network / streaming failures so users know it's transient.
        if (
            code === "httpConnectionFailed" ||
            code === "responseStreamConnectionFailed" ||
            code === "responseStreamDisconnected" ||
            code === "responseTooManyFailedAttempts"
        ) {
            if (code === "responseTooManyFailedAttempts") {
                return get(t)("codex.thread.errors.reconnectFailed");
            }

            const base = get(t)("codex.thread.errors.providerInterrupted");
            if (message) {
                return `${base} ${get(t)("codex.thread.errors.detailsPrefix", { details: message })}`;
            }
            return base;
        }

        if (message && details) {
            return `${message} ${get(t)("codex.thread.errors.detailsPrefix", { details })}`;
        }

        if (message) {
            return message;
        }

        if (details) {
            return details;
        }
        return get(t)("codex.thread.errors.generic");
    }

    function clearErrorBannerOnRecovery(activityThreadId?: string | null) {
        if (!errorBanner) return;
        if (activityThreadId && activityThreadId !== threadId) return;
        if (stickyErrorBanner) return;
        errorBanner = null;
    }

    function clearProcessingState() {
        isProcessing = false;
        currentItemId = null;
        currentTurnId = null;
        activeTurnStartedAtMs = null;
        activeItemStartedAtMs = null;
        activeReasoningItemId = null;
        setProcessingSummaryFromItemId(null);
    }

    function releaseProcessingUiPreservingTurnContext() {
        isProcessing = false;
        currentItemId = null;
        activeItemStartedAtMs = null;
        activeReasoningItemId = null;
        setProcessingSummaryFromItemId(null);
    }

    function goalDisplaySecondsSnapshot(nowMs = Date.now()): number {
        if (!activeGoal) return 0;
        let seconds = Math.max(
            goalLocalElapsedFloorSeconds,
            Math.floor(activeGoal.timeUsedSeconds || 0)
        );
        if (activeGoal.status !== "active" || activeTurnStartedAtMs === null) {
            return seconds;
        }

        const observedAt = goalObservedAtMs ?? activeTurnStartedAtMs;
        const baseline = Math.max(observedAt, activeTurnStartedAtMs);
        const liveSeconds = Math.max(0, Math.floor((nowMs - baseline) / 1000));
        return seconds + liveSeconds;
    }

    function freezeGoalElapsedSnapshot(nowMs = Date.now()) {
        if (!activeGoal) return;
        const next = goalDisplaySecondsSnapshot(nowMs);
        if (next > goalLocalElapsedFloorSeconds) {
            goalLocalElapsedFloorSeconds = next;
        }
    }

    function applyGoalSnapshot(goal: ThreadGoal | null) {
        const previous = activeGoal;
        activeGoal = goal;
        if (!goal) {
            goalObservedAtMs = null;
            goalLocalElapsedFloorSeconds = 0;
            return;
        }

        goalLocalElapsedFloorSeconds = Math.max(
            goalLocalElapsedFloorSeconds,
            Math.floor(goal.timeUsedSeconds || 0)
        );

        const shouldResetObservedAt =
            !previous ||
            previous.objective !== goal.objective ||
            previous.status !== goal.status ||
            previous.tokenBudget !== goal.tokenBudget ||
            previous.timeUsedSeconds !== goal.timeUsedSeconds;

        if (shouldResetObservedAt || goalObservedAtMs === null) {
            goalObservedAtMs = Date.now();
        }
    }

    function matchesThread(notifThreadId?: string | null): boolean {
        // 只有带 threadId 的通知才应用到当前视图。
        // 没有 threadId 的通知（全局 usage / 其它后台事件）在这里一律忽略，
        // 防止把无关线程的错误 / diff 等渲染到当前聊天或当前 review 线程里。
        if (!notifThreadId) return false;
        return notifThreadId === threadId || notifThreadId === activeReviewThreadId;
    }

    function matchesThreadOrActiveTurn(
        notifThreadId?: string | null,
        notifTurnId?: string | null
    ): boolean {
        if (notifThreadId) {
            if (matchesThread(notifThreadId)) {
                return true;
            }
            // Detached/review turn can still belong to this view even if thread id no longer
            // matches local routing state (e.g. after user interruption cleanup).
            if (notifTurnId && turns.some((t) => t.id === notifTurnId)) {
                debugWarn(
                    "[ChatView] Notification thread mismatch; accepted via known turn id",
                    { notifThreadId, localThreadId: threadId, notifTurnId }
                );
                return true;
            }
            return false;
        }
        if (notifTurnId && currentTurnId && notifTurnId === currentTurnId) {
            debugWarn("[ChatView] Notification missing threadId; accepted via active turn match", {
                notifTurnId
            });
            return true;
        }
        if (notifTurnId && turns.some((t) => t.id === notifTurnId)) {
            debugWarn("[ChatView] Notification missing threadId; accepted via known turn id", {
                notifTurnId
            });
            return true;
        }
        return false;
    }

    function setContextBanner(message: string | null, timeoutMs: number | null = 4000) {
        if (contextBannerTimer !== null) {
            clearTimeout(contextBannerTimer);
            contextBannerTimer = null;
        }
        contextBanner = message;
        if (message && timeoutMs && timeoutMs > 0 && typeof window !== "undefined") {
            contextBannerTimer = window.setTimeout(() => {
                contextBanner = null;
                contextBannerTimer = null;
            }, timeoutMs);
        }
    }

    async function loadThreadHistory() {
        if (!threadId) return;

        try {
            debugLog(`Loading history for thread: ${threadId}`);
            const result = await invoke<ThreadResumeResponse>("codex_thread_resume", {
                params: { threadId },
            });

            debugLog("Thread resume result:", result);
            setTurnsFromHistory(result.thread?.turns ?? []);
            debugLog(`Loaded ${turns.length} turns from history`);
            
            // Debug: log each turn
            turns.forEach((turn, index) => {
                debugLog(`Turn ${index}:`, {
                    id: turn.id,
                    status: turn.status,
                    itemsCount: turn.items?.length || 0,
                    items: turn.items?.map(i => i.type)
                });
            });
        } catch (error) {
            console.error("Failed to load thread history:", error);
        }
    }

    async function loadThreadGoal(targetThreadId = threadId) {
        if (!targetThreadId) return;
        try {
            const result = await invoke<{ goal: ThreadGoal | null }>("codex_thread_goal_get", {
                params: { threadId: targetThreadId },
            });
            if (targetThreadId !== threadId) return;
            applyGoalSnapshot(result?.goal ?? null);
        } catch (error) {
            console.warn("[ChatView] Failed to load thread goal", error);
            if (targetThreadId !== threadId) return;
            applyGoalSnapshot(null);
        }
    }

    async function setThreadGoal(
        event: CustomEvent<{
            objective: string;
            tokenBudget: number | null;
            status?: ThreadGoalStatus;
        }>
    ) {
        if (!threadId || goalBusy) return;
        goalBusy = true;
        try {
            const { objective, tokenBudget, status } = event.detail;
            const result = await invoke<{ goal: ThreadGoal }>("codex_thread_goal_set", {
                params: {
                    threadId,
                    objective,
                    tokenBudget,
                    ...(status ? { status } : {}),
                },
            });
            applyGoalSnapshot(result.goal);
        } catch (error: any) {
            console.error("[ChatView] Failed to set thread goal", error);
            setContextBanner(`Goal 设置失败：${error?.toString?.() ?? String(error)}`, 5000);
        } finally {
            goalBusy = false;
        }
    }

    async function updateThreadGoalStatus(event: CustomEvent<{ status: ThreadGoalStatus }>) {
        if (!threadId || goalBusy) return;
        goalBusy = true;
        try {
            const result = await invoke<{ goal: ThreadGoal }>("codex_thread_goal_set", {
                params: {
                    threadId,
                    status: event.detail.status,
                },
            });
            applyGoalSnapshot(result.goal);
        } catch (error: any) {
            console.error("[ChatView] Failed to update thread goal status", error);
            setContextBanner(`Goal 状态更新失败：${error?.toString?.() ?? String(error)}`, 5000);
        } finally {
            goalBusy = false;
        }
    }

    async function clearThreadGoal() {
        if (!threadId || goalBusy) return;
        goalBusy = true;
        try {
            await invoke("codex_thread_goal_clear", {
                params: { threadId },
            });
            applyGoalSnapshot(null);
        } catch (error: any) {
            console.error("[ChatView] Failed to clear thread goal", error);
            setContextBanner(`Goal 清除失败：${error?.toString?.() ?? String(error)}`, 5000);
        } finally {
            goalBusy = false;
        }
    }

    function setTurnsFromHistory(nextTurns: Turn[]) {
        pendingAgentMessageDeltas.clear();
        turns = nextTurns;
        hydrateReasoningSummaryFromTurns(turns);
        resumeAutoScrollImmediately();
        void forceScrollToBottomAfterHistoryLoad();
    }

    async function sendMessage(
        content: string,
        autoContext: boolean = false,
        attachments: ComposerAttachment[] = []
    ) {
        if (!content.trim() || isProcessing) return;
        if (!cwd) {
            stickyErrorBanner = true;
            errorBanner = "当前未绑定工作区，无法开始新对话。请先打开或切回一个工作区。";
            return;
        }

        resumeAutoScrollImmediately();
        errorBanner = null;
        stickyErrorBanner = false;
        // If the user sends a message manually, dismiss any local confirmation prompt.
        isProcessing = true;

        try {
            // 主问题始终只使用用户键盘输入的内容
            const mainInput: UserInput = { type: "text", text: content };
            const extraInputs: UserInput[] = [];

            // If auto context is enabled, prepend editor context
            if (autoContext) {
                try {
                    const context = await invoke<any>("get_editor_context", {
                        contextLines: 50,
                        maxChars: 10000,
                    });

                    if (context.activeEditor) {
                        let contextText = `[Editor Context]\n`;
                        contextText += `Active File: ${context.activeEditor.path}\n`;
                        contextText += `Cursor Position: Line ${context.activeEditor.cursor.line + 1}, Column ${context.activeEditor.cursor.column + 1}\n`;

                        if (context.openTabs && context.openTabs.length > 0) {
                            contextText += `\nOpen Files (${context.openTabs.length}):\n`;
                            context.openTabs.forEach((tab: any) => {
                                const lines = tab.lines > 0 ? `${tab.lines} lines` : '';
                                const chars = tab.chars > 0 ? `${tab.chars} chars` : '';
                                const size = tab.size > 0 ? `${(tab.size / 1024).toFixed(1)}KB` : '';
                                const info = [lines, chars, size].filter(Boolean).join(', ');
                                contextText += `  - ${tab.path}${info ? ` (${info})` : ''}\n`;
                            });
                        }

                        if (context.activeContent) {
                            const totalInfo = `${context.activeContent.totalLines} lines, ${context.activeContent.totalChars} chars`;
                            if (context.activeContent.truncated) {
                                contextText += `\nCode Context (truncated, showing chars around cursor):\n`;
                                contextText += `File: ${totalInfo}\n`;
                            } else {
                                contextText += `\nCode Context (lines ${context.activeContent.startLine + 1}-${context.activeContent.endLine}):\n`;
                                contextText += `File: ${totalInfo}\n`;
                            }
                            contextText += "```\n";
                            contextText += context.activeContent.content;
                            contextText += "\n```\n";
                        }

                        extraInputs.push({
                            type: "text",
                            text: contextText,
                        } as UserInput);
                    }
                } catch (error) {
                    console.warn("Failed to get editor context:", error);
                    // Continue without context
                }
            }

            // 来自编辑器 / 输入框的附件（代码片段、图片等）
            const attachmentInputs: UserInput[] = attachments.map((att) => att.input);

            const inputs: UserInput[] = [mainInput, ...extraInputs, ...attachmentInputs];

            const effectiveModel = selectedModel || null;
            pendingModelForNextTurn = effectiveModel;
            const effortForTurn: ReasoningEffort | null = selectedEffort
                ? (selectedEffort as ReasoningEffort)
                : null;
            // Codex protocol only distinguishes `plan` vs `default`.
            // Default mode is usually sent as `null` to avoid forcing a template,
            // but when we explicitly need to exit Plan (e.g. after confirming),
            // we send an explicit `{ mode: "default", ... }` once.
            const modeForTurn: ModeKind = forcedModeForNextTurn ?? selectedCollaborationMode;
            pendingModeForNextTurn = modeForTurn;
            const shouldSendExplicitMode = forcedModeForNextTurn !== null || modeForTurn === "plan";
            const collaborationModeForTurn: CollaborationMode | null =
                shouldSendExplicitMode
                    ? {
                          mode: modeForTurn,
                          settings: {
                              model: effectiveModel || "gpt-5.2-codex",
                              reasoning_effort: effortForTurn,
                              developer_instructions: null,
                          },
                      }
                    : null;

            // Always keep the agent sandboxed to the current workspace.
            const sandboxPolicy =
                approvalPolicy === "fullAccess"
                    ? { type: "dangerFullAccess" }
                    : {
                          type: "workspaceWrite",
                          writableRoots: [cwd],
                          readOnlyAccess: { type: "fullAccess" },
                          networkAccess: true,
                          excludeTmpdirEnvVar: false,
                          excludeSlashTmp: false,
                      };

            const approvalPolicyForCodex = codexApprovalPolicyForAccessMode(approvalPolicy);
            const approvalsReviewerForCodex = approvalsReviewerForAccessMode(approvalPolicy);

            const startResp = await invoke<TurnStartResponse>("codex_turn_start", {
                params: {
                    threadId,
                    input: inputs,
                    cwd: cwd,
                    approvalPolicy: approvalPolicyForCodex,
                    approvalsReviewer: approvalsReviewerForCodex,
                    sandboxPolicy: sandboxPolicy,
                    model: effectiveModel,
                    effort: effortForTurn,
                    summary: null,
                    personality: null,
                    outputSchema: null,
                    collaborationMode: collaborationModeForTurn,
                    metadata: {
                        codeyOrigin: "desktop",
                    },
                },
            });
            forcedModeForNextTurn = null;

            // Record the per-turn model deterministically from the start response.
            const startedTurnId = startResp?.turn?.id ?? null;
            if (startedTurnId) {
                turnModelById = { ...turnModelById, [startedTurnId]: effectiveModel };
                if (typeof window !== "undefined") {
                    (window as any).__codeyCodexTurnModels = turnModelById;
                    (window as any).__codeyCodexLatestThreadTotals = latestThreadTotals;
                }
            }

            // User message and assistant response will come through notifications
        } catch (error) {
            console.error("Failed to send message:", error);
            isProcessing = false;
        }
    }

    async function startCodeReview(event?: CustomEvent<{ target: ReviewTarget }>) {
        if (!threadId || isProcessing) return;

        const target: ReviewTarget = event?.detail?.target ?? { type: "uncommittedChanges" };

        resumeAutoScrollImmediately();
        isProcessing = true;
        pendingReviewThread = true;
        reviewInProgress = true;

        try {
            const result = await invoke<ReviewStartResponse>("codex_review_start", {
                params: {
                    threadId,
                    target,
                    // Match Codex webview behavior: run inline on this thread
                    delivery: "inline",
                },
            });

            const turnFromResult = result?.turn ?? null;
            const reviewThreadFromResult = result?.reviewThreadId ?? null;

            // 如果后端明确返回了 reviewThreadId / turn，我们记录下来，
            // 但仍然依赖后续的 turn/started & turn/completed 通知来驱动 UI。
            if (reviewThreadFromResult) {
                activeReviewThreadId = reviewThreadFromResult;
            }
            if (turnFromResult && !currentTurnId) {
                currentTurnId = turnFromResult.id;
            }

            // 防御性处理：如果 review/start 成功返回但没有创建 turn，
            // 就立即结束 processing 状态，避免 UI 卡在“Working…”。
            if (!turnFromResult) {
                console.warn("[ChatView] codex_review_start returned without a turn; clearing processing state", {
                    threadId,
                    target,
                });
                isProcessing = false;
                pendingReviewThread = false;
                reviewInProgress = false;
                activeReviewThreadId = null;
                currentTurnId = null;
            } else {
                pendingReviewThread = false;
                debugLog("Code review started", {
                    reviewThreadId: activeReviewThreadId,
                    currentTurnId,
                });
            }
        } catch (error) {
            console.error("Failed to start code review:", error);
            isProcessing = false;
            pendingReviewThread = false;
            reviewInProgress = false;
        }
    }

    async function interruptTurn() {
        const pendingDecline = autoDeclinePendingApproval("turn interrupt");

        const targetThreadId = activeReviewThreadId ?? threadId;
        const targetTurnId =
            currentTurnId ??
            [...turns]
                .reverse()
                .find((t) => t.status === "inProgress")
                ?.id ??
            null;

        // Always unblock the UI immediately. Even if we fail to reach the backend
        // (or we don't know the turnId), users must be able to recover from a
        // "stuck processing" state.
        console.warn("[ChatView] Force-stopping processing state due to user interrupt", {
            targetThreadId,
            targetTurnId,
            currentTurnId,
            activeReviewThreadId
        });
        // Unblock the local UI immediately, but keep the active turn/thread routing
        // until the backend sends the terminal notification. Otherwise late
        // `turn/completed(status=interrupted)` can miss attribution and the turn
        // row stays visually stuck at "Working".
        releaseProcessingUiPreservingTurnContext();
        pendingReviewThread = false;
        reviewInProgress = false;
        setContextBanner("已中断本次执行（如仍在后台运行，请稍后刷新线程）", 5000);

        if (!targetTurnId || !targetThreadId) {
            console.warn("[ChatView] interruptTurn could not find an active turn or thread to interrupt", {
                targetTurnId,
                targetThreadId,
                threadId
            });
            if (pendingDecline) {
                await pendingDecline;
            }
            return;
        }

        debugLog("[ChatView] Interrupting turn (async):", targetThreadId, targetTurnId);
        // Fire-and-forget: don't block UI flows (e.g. switching/resuming a different thread)
        // on the backend interrupt RPC, which can take noticeable time.
        void invoke<TurnInterruptResponse>("codex_turn_interrupt", {
            params: { threadId: targetThreadId, turnId: targetTurnId },
        })
            .then(() => {
                debugLog("[ChatView] Turn interrupt request sent");
            })
            .catch((error) => {
                console.error("[ChatView] Failed to interrupt turn:", error);
            });
        if (pendingDecline) {
            void pendingDecline;
        }
    }

    export function hasInProgressTurn(): boolean {
        const localInProgress = Boolean(pendingReviewThread || isProcessing || reviewInProgress);
        if (localInProgress) return true;

        // IMPORTANT:
        // We intentionally do NOT treat "history contains an inProgress turn" as a reason to block
        // thread switching. On resume, older sessions may contain stale `inProgress` statuses
        // (or background activity we didn't start from this UI session), which would cause
        // confusing "Interrupt current execution?" popups.
        return false;
    }

    $: {
        const current = hasInProgressTurn();
        if (current !== lastReportedInProgressTurn) {
            lastReportedInProgressTurn = current;
            onInProgressTurnChange?.(current);
        }
    }

    export async function interruptActiveTurn(reason = "external"): Promise<boolean> {
        if (!hasInProgressTurn()) return false;
        debugLog("[ChatView] interruptActiveTurn requested:", { reason, threadId });
        // Don't await; interruption is best-effort and should not block other UI actions.
        void interruptTurn();
        return true;
    }

    // Keep a global "in progress" flag for other UI entrypoints (e.g. open folder).
    // Note: Svelte reactivity does not track dependencies through function calls,
    // so we must reference the reactive variables directly here.
    $: codexHasInProgressTurn.set(hasInProgressTurn());

let currentItemId: string | null = null;
let currentTurnId: string | null = null;
let activeReasoningItemId: string | null = null;
let processingSummaryHeader: string | null = null;
let isUserNearBottom = true;
const reasoningSummaryState = new Map<string, string[]>();

// Smart auto-scroll state
let userInteracting = false;
    let interactionTimer: number | null = null;
    const INTERACTION_TIMEOUT = 5000; // 5 seconds of inactivity before resuming auto-scroll

    function isScrolledNearBottom(): boolean {
        if (!itemsContainer) return true;
        const threshold = 100; // pixels from bottom
        const scrollBottom = itemsContainer.scrollHeight - itemsContainer.scrollTop - itemsContainer.clientHeight;
        return scrollBottom < threshold;
    }

    function handleUserInteraction() {
        userInteracting = true;
        
        // Clear existing timer
        if (interactionTimer !== null) {
            clearTimeout(interactionTimer);
        }
        
        // Set new timer to resume auto-scroll after inactivity
        interactionTimer = window.setTimeout(() => {
            userInteracting = false;
            interactionTimer = null;
            // Only auto-scroll when a turn is actively processing
            if (isProcessing && currentTurnId && isScrolledNearBottom()) {
                scrollToBottom();
            }
        }, INTERACTION_TIMEOUT);
    }

    function resumeAutoScrollImmediately() {
        userInteracting = false;
        if (interactionTimer !== null) {
            clearTimeout(interactionTimer);
            interactionTimer = null;
        }
    }

    $: shouldAutoScroll = Boolean(isProcessing && currentTurnId && !userInteracting && isUserNearBottom);
    $: shouldRunUiClock = Boolean(
        isProcessing ||
            activeGoal?.status === "active"
    );
    $: processingElapsedSeconds =
        isProcessing && activeItemStartedAtMs !== null
            ? Math.max(0, Math.floor((uiClockMs - activeItemStartedAtMs) / 1000))
            : null;

    $: {
        if (shouldRunUiClock && uiClockTimer === null && typeof window !== "undefined") {
            uiClockMs = Date.now();
            uiClockTimer = window.setInterval(() => {
                uiClockMs = Date.now();
            }, 1000);
        } else if (!shouldRunUiClock && uiClockTimer !== null) {
            clearInterval(uiClockTimer);
            uiClockTimer = null;
        }
    }

    let lastAutoScrollHeight = 0;

    afterUpdate(() => {
        attachResizeObserver(itemsContent);
        attachDrawerResizeObserver(drawerEl);
        updateNearBottomState();
        if (shouldAutoScroll) {
            // Only scroll when content height actually changes; avoids redundant scroll loops
            // when items update without affecting layout.
            const currentHeight = itemsContainer?.scrollHeight ?? 0;
            if (currentHeight !== lastAutoScrollHeight) {
                lastAutoScrollHeight = currentHeight;
                scrollToBottom();
            }
        }
    });

    async function handleApprovalResponse(decision: ApprovalDecision, forSession: boolean) {
        if (!pendingApproval) return;
        const localPending = pendingApproval;

        try {
            // IMPORTANT: Don't apply changes here!
            // Let Codex apply them via apply_patch to maintain security and consistency
            if (localPending.responseKind === "review") {
                await sendReviewApprovalDecision(localPending.requestId, decision, forSession);
            } else {
                await sendApprovalDecision(localPending.requestId, decision, forSession);
            }
            if (decision === "accept" && forSession) {
                sessionTrusted = true;
            }
            debugLog(`[ChatView] Approval response sent: ${decision}`);
        } catch (error) {
            console.error("[ChatView] Failed to send approval response:", error);
        } finally {
            await closePreviewDiffs(localPending.previewDiffIds);
            pendingApproval = null;
        }
    }

    function autoDeclinePendingApproval(reason: string): Promise<void> | null {
        if (!pendingApproval) {
            return null;
        }

        const { requestId, type } = pendingApproval;
        debugLog("[ChatView] Auto-declining pending approval due to", reason, {
            requestId,
            type,
        });

        return handleApprovalResponse("decline", false);
    }

    let undoSnapshotId: string | null = null;
    let undoInProgress = false;
    $: undoTurnId = undoSnapshotId?.startsWith("turn:")
        ? undoSnapshotId.slice("turn:".length)
        : null;

    async function applyPendingFileChanges(): Promise<boolean> {
        if (!pendingApproval || pendingApproval.type !== "fileChange") {
            return true;
        }

        const fileParams = pendingApproval.params as FileChangeRequestApprovalParams;
        const fileItem =
            pendingApproval.item && pendingApproval.item.type === "fileChange"
                ? pendingApproval.item
                : null;

        if (!fileItem) {
            console.warn("[ChatView] Pending file change item missing");
            return true;
        }

        const changes = fileItem.changes || [];
        if (!changes.length) {
            console.warn("[ChatView] No file changes attached to pending approval");
            return true;
        }

        // 将 undo 快照按 turn 维度分组，便于实现“撤销上一轮变更”的能力
        let snapshotId: string | null = null;
        const location = findItemLocation(fileItem.id);
        if (location) {
            const turn = turns[location.turnIndex];
            if (turn && turn.id) {
                snapshotId = `turn:${turn.id}`;
            }
        }

        try {
            await invoke("codex_apply_file_changes", {
                payload: {
                    grantRoot: fileParams.grantRoot ?? cwd ?? null,
                    changes,
                    snapshotId,
                },
            });
            if (snapshotId) {
                undoSnapshotId = snapshotId;
            }
            return true;
        } catch (error) {
            console.error("[ChatView] Failed to apply file changes:", error);
            return false;
        }
    }

    async function handleUndoTurn(turnId: string) {
        // 目前只支持撤销“最近一次”已记录快照的轮次，避免误操作。
        if (!undoSnapshotId || !turnId || undoInProgress) {
            return;
        }
        const expectedId = `turn:${turnId}`;
        if (undoSnapshotId !== expectedId) {
            console.warn("[ChatView] Undo requested for non-latest turn", {
                requested: expectedId,
                current: undoSnapshotId,
            });
            return;
        }

        try {
            undoInProgress = true;
            await invoke("codex_apply_undo_snapshot", {
                payload: {
                    snapshotId: undoSnapshotId,
                },
            });
            // 撤销成功后，本轮快照作废，不支持再次撤销。
            undoSnapshotId = null;
        } catch (error) {
            console.error("[ChatView] Failed to apply undo snapshot:", error);
        } finally {
            undoInProgress = false;
        }
    }

    function getSummaryTextForItem(itemId: string | null): string {
        if (!itemId) return "";
        const sections = reasoningSummaryState.get(itemId);
        if (!sections) return "";
        return sections.join("");
    }

    function setReasoningSummaryBody(
        target: Extract<ThreadItem, { type: "reasoning" }>,
        body: string | null
    ) {
        const trimmed = body?.trim() ?? "";
        if (!trimmed) {
            return;
        }

        const current = (target as any).reasoningSummaryBody || "";
        if (current !== trimmed) {
            (target as any).reasoningSummaryBody = trimmed;
            turns = [...turns];
        }
    }

    function markReasoningReady(
        target: Extract<ThreadItem, { type: "reasoning" }>,
        ready: boolean
    ) {
        if ((target as any).reasoningReady === ready) {
            return;
        }
        (target as any).reasoningReady = ready;
        turns = [...turns];
    }

    function updateReasoningBodyFromSummary(target: Extract<ThreadItem, { type: "reasoning" }>) {
        const summaryText = getSummaryTextForItem(target.id);
        if (!summaryText.trim()) {
            return;
        }
        const parsed = parseReasoningSummary([summaryText]);
        const body = parsed.body ?? "";
        // Only create/update the reasoning card once we have a real
        // body (header suffix) with non-empty content. This avoids
        // flicker when only the **header** has streamed in.
        if (!body.trim()) {
            return;
        }
        setReasoningSummaryBody(target, body);
    }

    function hydrateReasoningSummaryFromItem(item?: ThreadItem | null, ready: boolean = true) {
        if (!item || item.type !== "reasoning") {
            return;
        }
        const snapshot = [...(item.summary ?? [])];
        reasoningSummaryState.set(item.id, snapshot);
        updateReasoningBodyFromSummary(item);
        markReasoningReady(item, ready);
    }

    function hydrateReasoningSummaryFromTurns(turnList: Turn[]) {
        reasoningSummaryState.clear();
        for (const turn of turnList) {
            for (const item of turn.items ?? []) {
                hydrateReasoningSummaryFromItem(item);
            }
        }
    }

    function cleanupReasoningSummaryForTurn(turn?: Turn | null) {
        if (!turn?.items) {
            return;
        }
        for (const item of turn.items) {
            if (item.type === "reasoning") {
                reasoningSummaryState.delete(item.id);
            }
        }
    }

    function setProcessingSummaryFromItemId(itemId: string | null) {
        if (!itemId) {
            processingSummaryHeader = null;
            return;
        }
        const summaryText = getSummaryTextForItem(itemId);
        if (!summaryText.trim()) {
            processingSummaryHeader = null;
            return;
        }
        const parsed = parseReasoningSummary([summaryText]);
        processingSummaryHeader = parsed.header ?? null;
    }

    function refreshProcessingSummaryFromActiveTurn() {
        if (!currentTurnId || !activeReasoningItemId) {
            processingSummaryHeader = null;
            return;
        }
        setProcessingSummaryFromItemId(activeReasoningItemId);
    }

    function applyReasoningSummaryDelta(itemId: string, summaryIndex: number, delta: string) {
        const existing = reasoningSummaryState.get(itemId) ?? [];
        const next = [...existing];
        while (next.length <= summaryIndex) {
            next.push("");
        }
        next[summaryIndex] = `${next[summaryIndex] || ""}${delta}`;
        reasoningSummaryState.set(itemId, next);
        if (activeReasoningItemId === itemId) {
            setProcessingSummaryFromItemId(itemId);
        }
    }


    async function prepareFileChangePreview(
        requestId: string,
        params: FileChangeRequestApprovalParams,
        fileItem: ThreadItem | null
    ): Promise<string[]> {
        if (!fileItem || fileItem.type !== "fileChange" || !fileItem.changes?.length) {
            return [];
        }

        // 为当前 fileChange 所在的 turn 生成一个 snapshotId，用于后续 Undo。
        let snapshotId: string | null = null;
        const location = findItemLocation(fileItem.id);
        if (location) {
            const turn = turns[location.turnIndex];
            if (turn && turn.id) {
                snapshotId = `turn:${turn.id}`;
                undoSnapshotId = snapshotId;
            }
        }

        try {
            const diffIds = await invoke<string[]>("codex_preview_file_changes", {
                payload: {
                    requestId,
                    grantRoot: params.grantRoot ?? cwd ?? null,
                    changes: fileItem.changes,
                    snapshotId,
                },
            });
            return diffIds || [];
        } catch (error) {
            console.warn("[ChatView] Failed to prepare diff preview:", error);
            return [];
        }
    }

    async function closePreviewDiffs(diffIds?: string[]) {
        if (!diffIds || diffIds.length === 0) return;
        try {
            await invoke("codex_close_file_change_previews", { diffIds });
        } catch (error) {
            console.warn("[ChatView] Failed to close diff previews:", error);
        }
    }

    function mapReviewDecisionFromApprovalDecision(
        decision: ApprovalDecision,
        forSession: boolean
    ): ReviewDecision {
        // Minimal mapping: UI currently offers allow/reject. ReviewDecision supports more.
        if (decision === "accept") {
            return forSession ? "approved_for_session" : "approved";
        }
        if (decision === "decline") return "denied";
        return "abort";
    }

    function getApprovalBypassMode(): { skip: boolean; forSession: boolean } {
        if (approvalPolicy !== "workspaceOnRequest") {
            return { skip: true, forSession: false };
        }
        return { skip: false, forSession: false };
    }

    function refreshModelsOnPickerOpen() {
        dispatch("modelPickerOpen");
    }

    function handleApprovalPolicySelected(event: CustomEvent<AccessMode>) {
        onApprovalPolicyChange?.(event.detail);
    }

    async function sendApprovalDecision(
        requestId: string,
        decision: ApprovalDecision,
        forSession: boolean
    ) {
        const response: any = { decision };
        if (decision === "accept" && forSession) {
            response.acceptSettings = { forSession: true };
        }

        await invoke("codex_respond_to_request", {
            requestId,
            response,
        });
    }

    async function sendReviewApprovalDecision(
        requestId: string,
        decision: ApprovalDecision,
        forSession: boolean
    ) {
        const response = {
            decision: mapReviewDecisionFromApprovalDecision(decision, forSession),
        };

        await invoke("codex_respond_to_request", {
            requestId,
            response,
        });
    }

    async function sendUserInputResponse(
        requestId: string,
        response: ToolRequestUserInputResponse
    ) {
        await invoke("codex_respond_to_request", {
            requestId,
            response,
        });
    }

    async function sendElicitationResponse(
        requestId: string,
        response: McpServerElicitationRequestResponse
    ) {
        await invoke("codex_respond_to_request", {
            requestId,
            response,
        });
    }

    function buildUserInputCancelResponse(
        params: ToolRequestUserInputParams
    ): ToolRequestUserInputResponse {
        const cancelText =
            get(t)("codex.requestUserInput.cancelledAnswer") || "skipped";
        const answers: ToolRequestUserInputResponse["answers"] = {};
        const questions = params?.questions ?? [];
        for (const q of questions) {
            answers[q.id] = { answers: [cancelText] };
        }
        return { answers };
    }

    function autoApproveRequest(
        requestId: string,
        type: "command" | "fileChange",
        forSession: boolean
    ) {
        sendApprovalDecision(requestId, "accept", forSession)
            .then(() => {
                debugLog("[ChatView] Auto-approved request", { type, requestId, forSession });
            })
            .catch((error) => {
                console.error("[ChatView] Failed to auto-approve request", {
                    type,
                    requestId,
                    error,
                });
            });
    }

    function maybeUpdatePendingFileChange(item?: ThreadItem | null) {
        if (
            !pendingApproval ||
            pendingApproval.type !== "fileChange" ||
            !item ||
            item.type !== "fileChange"
        ) {
            return;
        }

        const fileParams = pendingApproval.params as FileChangeRequestApprovalParams;
        if (item.id !== fileParams.itemId) {
            return;
        }

        const next = {
            ...pendingApproval,
            item,
        };
        pendingApproval = next;

        if (!next.previewDiffIds || next.previewDiffIds.length === 0) {
            attachPreviewDiffs(next.requestId, fileParams, item);
        }
    }

    function attachPreviewDiffs(
        requestId: string,
        params: FileChangeRequestApprovalParams,
        fileItem: ThreadItem
    ) {
        prepareFileChangePreview(requestId, params, fileItem).then((diffIds) => {
            if (!diffIds.length) return;
            if (pendingApproval && pendingApproval.requestId === requestId) {
                pendingApproval = {
                    ...pendingApproval,
                    previewDiffIds: diffIds,
                };
            } else {
                closePreviewDiffs(diffIds);
            }
        });
    }

    function asFileChangeItemFromApplyPatchApprovalParams(
        params: ApplyPatchApprovalParams
    ): ThreadItem {
        const changes: FileUpdateChange[] = Object.entries(params.fileChanges ?? {})
            .map(([path, fc]) => {
                if (!fc) return null;
                const kind =
                    fc.type === "add"
                        ? { type: "add" as const }
                        : fc.type === "delete"
                            ? { type: "delete" as const }
                            : { type: "update" as const, move_path: fc.move_path ?? null };

                // For add/delete the preview pipeline expects `diff` to be content (optionally with '+' prefixes).
                // For update it expects unified diff.
                const diff = fc.type === "update" ? fc.unified_diff ?? "" : fc.content ?? "";
                return { path, kind, diff };
            })
            .filter(Boolean) as FileUpdateChange[];

        return {
            type: "fileChange",
            id: params.callId,
            changes,
            status: "inProgress",
        };
    }

    function parsedCommandsToCommandActions(
        parsedCmd: ParsedCommand[] | null | undefined
    ): CommandAction[] {
        return (parsedCmd ?? []).map((parsed): CommandAction => {
            switch (parsed.type) {
                case "read":
                    return {
                        type: "read",
                        command: parsed.cmd,
                        name: parsed.name,
                        path: parsed.path,
                    };
                case "list_files":
                    return {
                        type: "listFiles",
                        command: parsed.cmd,
                        path: parsed.path,
                    };
                case "search":
                    return {
                        type: "search",
                        command: parsed.cmd,
                        query: parsed.query,
                        path: parsed.path,
                    };
                default:
                    return {
                        type: "unknown",
                        command: parsed.cmd,
                    };
            }
        });
    }

    // Handle incoming requests from Codex
    export function handleRequest(request: any) {
        debugLog("[ChatView] Request:", request.method, request.params);

        if (request.method === "item/commandExecution/requestApproval") {
            const params = request.params as CommandExecutionRequestApprovalParams;
            const requestId = typeof request.id === "string" ? request.id : String(request.id);

            const bypass = getApprovalBypassMode();
            if (bypass.skip) {
                autoApproveRequest(requestId, "command", bypass.forSession);
                return;
            }

            if (pendingApproval?.previewDiffIds?.length) {
                closePreviewDiffs(pendingApproval.previewDiffIds);
            }
            pendingApproval = null;
            
            pendingApproval = {
                requestId,
                params,
                type: "command",
                responseKind: "standard",
                previewDiffIds: [],
            };
            
            debugLog("[ChatView] Showing command approval dialog for request:", requestId);
            scrollToBottom();
        } else if (request.method === "item/fileChange/requestApproval") {
            const params = request.params as FileChangeRequestApprovalParams;
            const requestId = typeof request.id === "string" ? request.id : String(request.id);

            const bypass = getApprovalBypassMode();
            if (bypass.skip) {
                autoApproveRequest(requestId, "fileChange", bypass.forSession);
                return;
            }

            if (pendingApproval?.previewDiffIds?.length) {
                closePreviewDiffs(pendingApproval.previewDiffIds);
            }
            pendingApproval = null;
            
            // Find the corresponding item to get diff data
            let fileChangeItem = null;
            for (const turn of turns) {
                const item = turn.items?.find(i => i.id === params.itemId);
                if (item && item.type === "fileChange") {
                    fileChangeItem = item;
                    break;
                }
            }
            
            pendingApproval = {
                requestId,
                params,
                type: "fileChange",
                responseKind: "standard",
                item: fileChangeItem,
                previewDiffIds: [],
            };
            
            debugLog("[ChatView] Showing file change approval dialog for request:", requestId, "item:", fileChangeItem);

            if (fileChangeItem) {
                attachPreviewDiffs(requestId, params, fileChangeItem);
            }
            
            scrollToBottom();
        } else if (request.method === "item/tool/requestUserInput") {
            const params = request.params as ToolRequestUserInputParams;
            const requestId = typeof request.id === "string" ? request.id : String(request.id);

            pendingUserInput = null;
            pendingUserInput = { requestId, params };
            debugLog("[ChatView] Showing request_user_input dialog for request:", requestId);
            scrollToBottom();
        } else if (request.method === "mcpServer/elicitation/request") {
            const params = request.params as McpServerElicitationRequestParams;
            const requestId = typeof request.id === "string" ? request.id : String(request.id);

            pendingElicitation = null;
            pendingElicitation = { requestId, params };
            debugLog("[ChatView] Showing MCP elicitation dialog for request:", requestId);
            scrollToBottom();
        } else if (request.method === "applyPatchApproval") {
            const params = request.params as ApplyPatchApprovalParams;
            const requestId = typeof request.id === "string" ? request.id : String(request.id);

            const bypass = getApprovalBypassMode();
            if (bypass.skip) {
                sendReviewApprovalDecision(requestId, "accept", bypass.forSession).catch((error) => {
                    console.error("[ChatView] Failed to auto-approve applyPatchApproval", {
                        requestId,
                        error,
                    });
                });
                return;
            }

            if (pendingApproval?.previewDiffIds?.length) {
                closePreviewDiffs(pendingApproval.previewDiffIds);
            }
            pendingApproval = null;

            const fileItem = asFileChangeItemFromApplyPatchApprovalParams(params);
            const uiParams: FileChangeRequestApprovalParams = {
                threadId: params.conversationId,
                turnId: "",
                itemId: params.callId,
                reason: params.reason,
                grantRoot: params.grantRoot,
            };

            pendingApproval = {
                requestId,
                params: uiParams,
                type: "fileChange",
                responseKind: "review",
                item: fileItem,
                previewDiffIds: [],
            };

            // Reuse existing preview UI plumbing.
            attachPreviewDiffs(requestId, uiParams, fileItem);
            scrollToBottom();
        } else if (request.method === "execCommandApproval") {
            const params = request.params as ExecCommandApprovalParams;
            const requestId = typeof request.id === "string" ? request.id : String(request.id);

            const bypass = getApprovalBypassMode();
            if (bypass.skip) {
                sendReviewApprovalDecision(requestId, "accept", bypass.forSession).catch((error) => {
                    console.error("[ChatView] Failed to auto-approve execCommandApproval", {
                        requestId,
                        error,
                    });
                });
                return;
            }

            if (pendingApproval?.previewDiffIds?.length) {
                closePreviewDiffs(pendingApproval.previewDiffIds);
            }
            pendingApproval = null;

            // CommandExecutionRequestApprovalParams are optional-heavy; provide enough for ApprovalDialog display.
            const commandActions = parsedCommandsToCommandActions(params.parsedCmd);
            const uiParams: CommandExecutionRequestApprovalParams = {
                threadId: params.conversationId,
                turnId: "",
                itemId: params.callId,
                reason: params.reason,
                command: params.command.join(" "),
                cwd: params.cwd,
                commandActions,
            };

            pendingApproval = {
                requestId,
                params: uiParams,
                type: "command",
                responseKind: "review",
                item: {
                    type: "commandExecution",
                    id: params.callId,
                    command: params.command.join(" "),
                    cwd: params.cwd,
                    processId: null,
                    status: "inProgress",
                    commandActions,
                    aggregatedOutput: null,
                    exitCode: null,
                    durationMs: null,
                },
                previewDiffIds: [],
            };

            scrollToBottom();
        }
    }

    // Handle incoming notifications and requests
    export function handleNotification(notification: any) {
        const method = notification?.method ?? "";
        switch (method) {
            case "error": {
                const notif = notification.params as ErrorNotification;
                const { threadId: notifThreadId, turnId, error } = notif;

                // Only react to errors for this thread.
                if (!matchesThread(notifThreadId)) {
                    debugLog("[ChatView] Ignoring error for different thread", {
                        notifThreadId,
                        localThreadId: threadId,
                    });
                    break;
                }

                const message = (error?.message ?? "").trim();
                const code = getCodexErrorCode(error?.codexErrorInfo ?? null);

                const isReconnectProgress =
                    !!message &&
                    message.toLowerCase().startsWith("reconnecting") &&
                    (code === "httpConnectionFailed" ||
                        code === "responseStreamConnectionFailed" ||
                        code === "responseStreamDisconnected" ||
                        code === "responseTooManyFailedAttempts");

                if (isReconnectProgress) {
                    // 重连进度：只在底部显示一行提示，不改 turn 状态，
                    // 也不把 UI 从“处理中”切到完成/失败。
                    stickyErrorBanner = false;
                    errorBanner = message;
                    console.warn("[ChatView] Stream reconnect progress:", notif);
                    break;
                }

                // 终止性的错误：统一在现有 banner 中展示。
                stickyErrorBanner = true;
                errorBanner = formatErrorBanner(notif);

                // Make sure UI is no longer "stuck" in processing state.
                if (!turnId || turnId === currentTurnId) {
                    clearProcessingState();
                }

                console.warn("[ChatView] Turn error received:", notif);
                break;
            }

            case "thread/tokenUsage/updated": {
                const notif = notification.params as ThreadTokenUsageUpdatedNotification;
                clearErrorBannerOnRecovery(notif.threadId ?? null);
                updateContextUsage(notif);
                break;
            }

            case "thread/goal/updated": {
                const notif = notification.params as ThreadGoalUpdatedNotification;
                if (notif.threadId !== threadId) {
                    break;
                }
                applyGoalSnapshot(notif.goal);
                break;
            }

            case "thread/goal/cleared": {
                const notif = notification.params as ThreadGoalClearedNotification;
                if (notif.threadId !== threadId) {
                    break;
                }
                applyGoalSnapshot(null);
                break;
            }

            case "thread/compacted": {
                const notif = notification.params as ContextCompactedNotification;
                if (!matchesThread(notif.threadId)) {
                    break;
                }
                clearErrorBannerOnRecovery(notif.threadId ?? null);
                contextPercentUsed = null;
                contextTooltip = null;
                setContextBanner($t("codex.thread.compactedBanner"), 5000);
                // Context compaction is an internal server-side optimization. We only
                // show a banner and keep the current UI state. Reloading history here
                // can interrupt rendering (e.g. if the active in-progress turn isn't
                // present in the resume snapshot yet).
                break;
            }

            case "turn/diff/updated": {
                const { threadId: notifThreadId, turnId, diff } =
                    notification.params as TurnDiffUpdatedNotification;

                debugLog("[ChatView] Turn diff updated:", {
                    notifThreadId,
                    localThreadId: threadId,
                    turnId,
                    diffLength: diff?.length ?? 0,
                });

                // Ignore diffs for other threads
                if (!matchesThread(notifThreadId)) {
                    debugLog("[ChatView] Ignoring diff for different thread", {
                        notifThreadId,
                        localThreadId: threadId,
                    });
                    break;
                }

                clearErrorBannerOnRecovery(notifThreadId ?? null);

                if (!turnId || !diff) {
                    console.warn("[ChatView] turn/diff/updated with missing data", {
                        turnId,
                        hasDiff: !!diff,
                    });
                    break;
                }

                const files = parseTurnUnifiedDiff(diff) ?? [];
                turnDiffs = {
                    ...turnDiffs,
                    [turnId]: {
                        unifiedDiff: diff,
                        files,
                    },
                };
                debugLog(
                    "[ChatView] Stored turn diff for turn",
                    turnId,
                    "files:",
                    files.length
                );
                break;
            }

            case "turn/plan/updated": {
                const { turnId, explanation, plan } = notification
                    .params as TurnPlanUpdatedNotification;

                debugLog("[ChatView] Turn plan updated:", {
                    turnId,
                    explanation,
                    steps: plan?.length ?? 0,
                });

                if (!turnId || !Array.isArray(plan)) {
                    break;
                }

                let turnIndex = turns.findIndex((t) => t.id === turnId);
                if (turnIndex < 0) {
                    // Fallback: if we don't have this turn yet, attach to the
                    // current active turn when possible, otherwise to the last
                    // known turn. This mirrors how we handle some other
                    // streaming events and avoids silently dropping plans.
                    if (currentTurnId) {
                        const idx = turns.findIndex((t) => t.id === currentTurnId);
                        if (idx >= 0) {
                            console.warn(
                                "[ChatView] turn/plan/updated for unknown turn id; falling back to currentTurnId",
                                { turnId, currentTurnId }
                            );
                            turnIndex = idx;
                        }
                    }
                    if (turnIndex < 0 && turns.length > 0) {
                        console.warn(
                            "[ChatView] turn/plan/updated for unknown turn id; falling back to last turn",
                            { turnId, lastTurnId: turns[turns.length - 1].id }
                        );
                        turnIndex = turns.length - 1;
                    }
                }

                if (turnIndex < 0) {
                    console.warn("[ChatView] turn/plan/updated but no turns are available");
                    break;
                }

                clearErrorBannerOnRecovery(threadId);

                const targetTurn = turns[turnIndex];
                const existingItems = targetTurn.items ?? [];

                const todoItems: TodoItem[] = plan.map((step, index) => ({
                    id: `plan-${turnId}-${index}`,
                    text: step.step,
                    completed: step.status === "completed",
                }));

                const existingTodoIndex = existingItems.findIndex(
                    (item) => item.type === "todoList"
                );

                let nextItems: ThreadItem[];

                if (existingTodoIndex >= 0) {
                    const existingTodo = existingItems[existingTodoIndex] as Extract<
                        ThreadItem,
                        { type: "todoList" }
                    >;
                    nextItems = [...existingItems];
                    nextItems[existingTodoIndex] = {
                        ...existingTodo,
                        items: todoItems,
                    };
                } else {
                    const todoListItem: ThreadItem = {
                        type: "todoList",
                        id: `plan-${turnId}`,
                        items: todoItems,
                    } as ThreadItem;
                    nextItems = [...existingItems, todoListItem];
                }

                turns[turnIndex] = {
                    ...targetTurn,
                    items: nextItems,
                };
                turns = [...turns];

                break;
            }

            case "turn/started": {
                const { turn, threadId: notifThreadId } = notification.params;
                const notifTurnId = turn?.id ?? null;
                if (!matchesThread(notifThreadId)) {
                    if (pendingReviewThread && notifThreadId) {
                        // Late notification for a detached review thread before the review/start response arrived.
                        activeReviewThreadId = notifThreadId;
                        console.warn("[ChatView] Adopted detached review thread from turn/started", {
                            notifThreadId,
                        });
                    } else {
                        debugLog("[ChatView] Ignoring turn/started for different thread", {
                            notifThreadId,
                            localThreadId: threadId,
                        });
                        break;
                    }
                }

                clearErrorBannerOnRecovery(notifThreadId ?? null);
                isProcessing = true;
                errorBanner = null;
                currentItemId = null;
                currentTurnId = notifTurnId;
                activeTurnStartedAtMs = Date.now();
                activeReasoningItemId = null;
                setProcessingSummaryFromItemId(null);
                
                // Add new turn to the list
                if (turn) {
                    // Initialize per-turn token accumulation and capture model for later cost calc.
                    const inferredModel =
                        pendingModelForNextTurn || selectedModel || threadModel || models?.[0]?.id || null;
                    pendingModelForNextTurn = null;
                    if (!(turn.id in turnModelById)) {
                        turnModelById = { ...turnModelById, [turn.id]: inferredModel };
                    }
                    // Capture thread-cumulative totals at turn start, so usage/cost is per-turn even
                    // after resuming a historical thread.
                    const startTotals =
                        latestThreadTotals ??
                        lastCompletedTotals ??
                        resumeBaselineTotals ??
                        (isNewThread ? zeroUsage() : null);
                    turnStartTotalsById = { ...turnStartTotalsById, [turn.id]: startTotals };
                    const inferredMode: ModeKind = pendingModeForNextTurn ?? selectedCollaborationMode;
                    pendingModeForNextTurn = null;
                    if (!(turn.id in turnModeById)) {
                        turnModeById = { ...turnModeById, [turn.id]: inferredMode };
                    }
                    const existingTurnIndex = turns.findIndex((t) => t.id === turn.id);
                    if (existingTurnIndex >= 0) {
                        turns[existingTurnIndex] = {
                            ...turns[existingTurnIndex],
                            ...turn,
                            // Keep locally streamed items if server turn payload is still empty here.
                            items:
                                (turn.items && turn.items.length > 0)
                                    ? turn.items
                                    : (turns[existingTurnIndex].items ?? []),
                        };
                        turns = [...turns];
                    } else {
                        turns = [...turns, turn];
                    }
                    scrollToBottom(true);
                }
                
                break;
            }

            case "turn/interrupted":
            case "turn/failed": {
                const { turn, threadId: notifThreadId } = notification.params;
                const notifTurnId = turn?.id ?? null;
                if (!matchesThreadOrActiveTurn(notifThreadId ?? null, notifTurnId)) {
                    break;
                }

                clearErrorBannerOnRecovery(notifThreadId ?? null);
                freezeGoalElapsedSnapshot();
                clearProcessingState();
                if (notifThreadId && notifThreadId === activeReviewThreadId) {
                    activeReviewThreadId = null;
                    pendingReviewThread = false;
                }
                if (reviewInProgress) {
                    reviewInProgress = false;
                }

                if (turn?.status === "failed") {
                    stickyErrorBanner = true;
                    errorBanner = formatErrorBannerFromError(turn.error);
                }

                if (turn) {
                    const turnIndex = turns.findIndex((t) => t.id === turn.id);
                    if (turnIndex >= 0) {
                        turns[turnIndex] = {
                            ...turns[turnIndex],
                            ...turn,
                        };
                        turns = [...turns];
                    } else {
                        turns = [...turns, turn];
                    }
                }
                break;
            }

            case "turn/completed": {
                const { turn, threadId: notifThreadId } = notification.params;
                const notifTurnId = turn?.id ?? null;
                if (!matchesThreadOrActiveTurn(notifThreadId ?? null, notifTurnId)) {
                    debugLog("[ChatView] Ignoring turn/completed for different thread", {
                        notifThreadId,
                        localThreadId: threadId,
                    });
                    break;
                }

                clearErrorBannerOnRecovery(notifThreadId ?? null);
                freezeGoalElapsedSnapshot();
                clearProcessingState();
                if (notifThreadId && notifThreadId === activeReviewThreadId) {
                    activeReviewThreadId = null;
                    pendingReviewThread = false;
                }
                if (reviewInProgress) {
                    reviewInProgress = false;
                }
                
                // Update turn metadata and items, but preserve existing visual
                // item order as much as possible to avoid reordering cards in
                // the UI. We treat existing items as the source of truth for
                // ordering and overlay any updated copies from the completed
                // turn payload, appending only truly new items at the end.
                if (turn) {
                    // Compute token totals + cost for this turn once it's done.
                    const endTotals =
                        latestTotalsByTurn[turn.id] || latestThreadTotals || null;
                    if (endTotals) {
                        finalizeTurnTokenStats(turn.id, endTotals);
                    }
                    // Debug hook: snapshot the summed usage so it's easy to compare in DevTools.
                    if (typeof window !== "undefined") {
                        (window as any).__codeyCodexTurnTokenStats = turnTokenStats;
                        (window as any).__codeyCodexTurnModels = turnModelById;
                        (window as any).__codeyCodexLatestTotalsByTurn = latestTotalsByTurn;
                        (window as any).__codeyCodexLastCompletedTotals = lastCompletedTotals;
                        (window as any).__codeyCodexLatestThreadTotals = latestThreadTotals;
                    }
                    const turnIndex = turns.findIndex(t => t.id === turn.id);
                    if (turnIndex >= 0) {
                        const existingTurn = turns[turnIndex];
                        const existingItems = existingTurn.items || [];
                        const newItems = turn.items || [];

                        // Map new items by id for fast lookup.
                        const newById = new Map<string, ThreadItem>();
                        for (const item of newItems) {
                            if (item && item.id) {
                                newById.set(item.id, item);
                            }
                        }

                        // Start from existing items to preserve their visual order,
                        // updating any that also appear in the completed turn.
                        const mergedItems: ThreadItem[] = existingItems.map((existing) => {
                            const replacement = existing.id ? newById.get(existing.id) : undefined;
                            return replacement ?? existing;
                        });

                        // Append any brand‑new items from the completed turn that
                        // were never seen during streaming.
                        for (const item of newItems) {
                            if (!item || !item.id) continue;
                            if (!mergedItems.some((existing) => existing.id === item.id)) {
                                mergedItems.push(item);
                            }
                        }

                        turns[turnIndex] = {
                            // Preserve local fields (like expanded state) but
                            // prefer the latest turn status / metadata.
                            ...existingTurn,
                            ...turn,
                            items: mergedItems,
                        };
                        turns = [...turns];

                        // 当 turn 进入终止状态（completed / failed / interrupted）时，自动折叠该 turn 的 steps 组，
                        // 只保留用户消息 +最终回复+文件更改摘要，避免长步骤列表占据视野。
                        // 例外：如果步骤里包含 imageGeneration，则保持默认展开，避免图片结果被收进步骤折叠区。
                        if (turn.status && turn.status !== "inProgress") {
                            // Scheme A: if this turn produced a plan item, keep steps visible by default.
                            const hasPlanItem = mergedItems.some((i) => i.type === "plan");
                            const hasImageGeneration = mergedItems.some(
                                (i) => i.type === "imageGeneration"
                            );
                            if (!hasPlanItem && !hasImageGeneration) {
                                const stepsGroupId = `${turn.id}:steps`;
                                const currentExpanded = itemGroupExpanded[stepsGroupId];
                                if (currentExpanded === undefined || currentExpanded) {
                                    itemGroupExpanded = {
                                        ...itemGroupExpanded,
                                        [stepsGroupId]: false,
                                    };
                                }
                            }
                        }

                    }
                } else if (notifTurnId) {
                    // Fallback: if we somehow missed turn/started (e.g., detached review thread)
                    // ensure the completed turn is appended so its items render.
                    console.warn("[ChatView] turn/completed missing turn payload; nothing to merge", {
                        turnId: notifTurnId,
                        threadId: notifThreadId,
                    });
                }
                
                cleanupReasoningSummaryForTurn(turn ?? null);
                break;
            }

            case "item/started": {
                const { item, threadId: notifThreadId, turnId, startedAtMs } = notification.params;
                if (!matchesThread(notifThreadId)) {
                    break;
                }

                clearErrorBannerOnRecovery(notifThreadId ?? null);
                if (!item) break;

                // Prefer the explicit turnId from the notification; fall back to
                // the currentTurnId only when turnId is missing (for legacy cases).
                const targetTurnId = turnId || currentTurnId;
                if (!targetTurnId) break;


                // Add item to current turn
                const turnIndex = turns.findIndex(t => t.id === targetTurnId);
                if (turnIndex >= 0) {
                    if (!turns[turnIndex].items) {
                        turns[turnIndex].items = [];
                    }
                    turns[turnIndex].items.push(item);
                    turns = [...turns];
                    scrollToBottom();
                    if (item.type === "agentMessage") {
                        applyBufferedAgentMessageDelta(item.id);
                    } else if (item.type === "plan") {
                        applyBufferedPlanDelta(item.id);
                        sawPlanItemByTurnId = { ...sawPlanItemByTurnId, [targetTurnId]: true };
                    }
                }

                maybeUpdatePendingFileChange(item);

                currentItemId = item.id;
                activeItemStartedAtMs =
                    typeof startedAtMs === "number" && Number.isFinite(startedAtMs)
                        ? startedAtMs
                        : Date.now();
                if (item.type === "reasoning") {
                    (item as any).reasoningSummaryBody = "";
                    hydrateReasoningSummaryFromItem(item, false);
                    activeReasoningItemId = item.id;
                    setProcessingSummaryFromItemId(item.id);
                }
                break;
            }

            case "item/autoApprovalReview/started": {
                const {
                    threadId: notifThreadId,
                    turnId,
                    targetItemId,
                    review,
                } = notification.params as ItemGuardianApprovalReviewStartedNotification;
                if (!matchesThread(notifThreadId)) {
                    break;
                }

                clearErrorBannerOnRecovery(notifThreadId ?? null);
                reviewInProgress = true;
                isProcessing = true;

                const riskLabel =
                    review?.riskLevel && review?.riskScore != null
                        ? `Guardian review (${review.riskLevel}, ${review.riskScore})`
                        : review?.riskLevel
                          ? `Guardian review (${review.riskLevel})`
                          : "Guardian review";
                contextBanner = `${riskLabel} in progress`;

                if (turnId) {
                    currentTurnId = turnId;
                }
                if (targetItemId) {
                    currentItemId = targetItemId;
                }
                break;
            }

            case "item/autoApprovalReview/completed": {
                const {
                    threadId: notifThreadId,
                    turnId,
                    targetItemId,
                    review,
                } = notification.params as ItemGuardianApprovalReviewCompletedNotification;
                if (!matchesThread(notifThreadId)) {
                    break;
                }

                clearErrorBannerOnRecovery(notifThreadId ?? null);
                reviewInProgress = false;

                if (turnId) {
                    currentTurnId = turnId;
                }
                if (targetItemId) {
                    currentItemId = targetItemId;
                }

                if (review?.status === "approved") {
                    setContextBanner("自动审批已通过，继续执行中", 4000);
                } else if (review?.status === "denied") {
                    stickyErrorBanner = true;
                    errorBanner = review?.rationale?.trim() || "自动审批未通过";
                    clearProcessingState();
                } else if (review?.status === "aborted") {
                    stickyErrorBanner = true;
                    errorBanner = review?.rationale?.trim() || "自动审批已中止";
                    clearProcessingState();
                } else {
                    setContextBanner("自动审批已完成", 3000);
                }
                break;
            }

            case "item/completed": {
                const { item: completedItem, threadId: notifThreadId, turnId } = notification.params;
                if (!matchesThread(notifThreadId)) {
                    debugLog("[ChatView] Ignoring item/completed for different thread", {
                        notifThreadId,
                        localThreadId: threadId,
                    });
                    break;
                }

                clearErrorBannerOnRecovery(notifThreadId ?? null);
                if (!completedItem) {
                    console.warn("[ChatView] item/completed with no item");
                    break;
                }


                // Prefer the explicit turnId from the notification to locate the
                // owning turn. This avoids accidentally merging items that happen
                // to reuse the same id across different turns.
                const owningTurnId = turnId || currentTurnId;
                const turnIndex = owningTurnId
                    ? turns.findIndex((t) => t.id === owningTurnId)
                    : -1;

                if (turnIndex >= 0) {
                    if (!turns[turnIndex].items) {
                        turns[turnIndex].items = [];
                    }

                    const itemsForTurn = turns[turnIndex].items;
                    // Prefer to match both id and type so that items which share
                    // the same id across different types (e.g. userMessage and
                    // enteredReviewMode with id "0") don't stomp each other.
                    let itemIndex = itemsForTurn.findIndex(
                        (i) => i.id === completedItem.id && i.type === completedItem.type
                    );
                    if (itemIndex < 0) {
                        // Fallback: if we can't find a type‑specific match, fall back
                        // to id‑only *only* when there's a single candidate.
                        const firstById = itemsForTurn.findIndex((i) => i.id === completedItem.id);
                        const secondById =
                            firstById >= 0
                                ? itemsForTurn.findIndex(
                                      (i, idx) => idx > firstById && i.id === completedItem.id
                                  )
                                : -1;
                        if (firstById >= 0 && secondById === -1) {
                            itemIndex = firstById;
                        }
                    }

                    if (itemIndex >= 0) {
                        itemsForTurn[itemIndex] = completedItem;
                    } else {
                        itemsForTurn.push(completedItem);
                    }
                    turns = [...turns];
                    if (completedItem.type === "agentMessage") {
                        applyBufferedAgentMessageDelta(completedItem.id);
                    } else if (completedItem.type === "plan" && owningTurnId) {
                        sawPlanItemByTurnId = { ...sawPlanItemByTurnId, [owningTurnId]: true };
                    }
                }

                maybeUpdatePendingFileChange(completedItem);

                if (completedItem.type === "reasoning") {
                    hydrateReasoningSummaryFromItem(completedItem);
                    activeReasoningItemId = completedItem.id;
                    setProcessingSummaryFromItemId(completedItem.id);
                }
                if (completedItem.id === currentItemId) {
                    currentItemId = null;
                    activeItemStartedAtMs = null;
                }
                break;
            }

            case "serverRequest/resolved": {
                const payload = notification.params as { requestId?: string | number | null };
                const resolvedRequestId =
                    typeof payload?.requestId === "string"
                        ? payload.requestId
                        : payload?.requestId != null
                          ? String(payload.requestId)
                          : "";
                if (!resolvedRequestId) {
                    break;
                }
                if (pendingApproval?.requestId === resolvedRequestId) {
                    if (pendingApproval.previewDiffIds?.length) {
                        void closePreviewDiffs(pendingApproval.previewDiffIds);
                    }
                    pendingApproval = null;
                }
                if (pendingUserInput?.requestId === resolvedRequestId) {
                    pendingUserInput = null;
                }
                if (pendingElicitation?.requestId === resolvedRequestId) {
                    pendingElicitation = null;
                }
                break;
            }

            case "item/updated": {
                const { item: updatedItem } = notification.params as { item: ThreadItem | null };
                if (!updatedItem) {
                    console.warn("[ChatView] item/updated with no item");
                    break;
                }

                debugLog("[ChatView] Item updated:", updatedItem.type, updatedItem.id);

                const location = findItemLocation(updatedItem.id);

                if (!location) {
                    console.warn("[ChatView] item/updated for unknown item id:", updatedItem.id);
                    break;
                }

                clearErrorBannerOnRecovery(threadId);

                const targetTurn = turns[location.turnIndex];

                if (!targetTurn.items) {
                    console.warn("[ChatView] item/updated but turn has no items:", targetTurn.id);
                    break;
                }

                const itemsForTurn = targetTurn.items;
                // Same logic as item/completed: prefer id+type match to avoid
                // stomping items that share an id across types.
                let itemIndex = itemsForTurn.findIndex(
                    (i) => i.id === updatedItem.id && i.type === updatedItem.type
                );
                if (itemIndex < 0) {
                    const firstById = itemsForTurn.findIndex((i) => i.id === updatedItem.id);
                    const secondById =
                        firstById >= 0
                            ? itemsForTurn.findIndex(
                                  (i, idx) => idx > firstById && i.id === updatedItem.id
                              )
                            : -1;
                    if (firstById >= 0 && secondById === -1) {
                        itemIndex = firstById;
                    } else {
                        itemIndex = location.itemIndex;
                    }
                }

                itemsForTurn[itemIndex] = updatedItem;
                turns = [...turns];

                if (updatedItem.type === "reasoning") {
                    hydrateReasoningSummaryFromItem(updatedItem);
                    if (activeReasoningItemId === updatedItem.id) {
                        setProcessingSummaryFromItemId(updatedItem.id);
                    }
                }

                maybeUpdatePendingFileChange(updatedItem);

                break;
            }

            case "item/agentMessage/delta": {
                const { itemId, delta, turnId: deltaTurnId } = notification.params;
                clearErrorBannerOnRecovery(threadId);
                if (!itemId || !delta) {
                    console.warn("[ChatView] Missing data for delta:", { itemId: !!itemId, delta: !!delta });
                    break;
                }
                currentItemId = itemId;
                if (deltaTurnId) {
                    currentTurnId = deltaTurnId;
                }

                const location = findItemLocation(itemId);
                if (location) {
                    const targetTurn = turns[location.turnIndex];
                    const target = targetTurn.items?.[location.itemIndex];
                    if (target && target.type === "agentMessage") {
                        target.text = (target.text || "") + delta;
                        turns = [...turns];
                        // Only auto-scroll while the active turn is processing
                        if (isProcessing && currentTurnId === targetTurn.id) {
                            scrollToBottom();
                        }
                    }
                } else {
                    bufferAgentMessageDelta(itemId, delta);
                }
                break;
            }

            case "item/plan/delta": {
                const { itemId, delta } = notification.params as PlanDeltaNotification;
                clearErrorBannerOnRecovery(threadId);
                if (!itemId || !delta) {
                    break;
                }

                const location = findItemLocation(itemId);
                if (location) {
                    const targetTurn = turns[location.turnIndex];
                    const target = targetTurn.items?.[location.itemIndex];
                    if (target && target.type === "plan") {
                        target.text = (target.text || "") + delta;
                        turns = [...turns];
                        if (isProcessing && currentTurnId === targetTurn.id) {
                            scrollToBottom();
                        }
                    } else {
                        bufferPlanDelta(itemId, delta);
                    }
                } else {
                    bufferPlanDelta(itemId, delta);
                }
                break;
            }

            case "codex/event/plan_delta": {
                clearErrorBannerOnRecovery(threadId);
                const params = notification?.params ?? {};
                const itemId: string | null = params.itemId ?? params.item_id ?? null;
                const delta: string | null = params.delta ?? null;
                if (!itemId || !delta) break;

                const location = findItemLocation(itemId);
                if (location) {
                    const targetTurn = turns[location.turnIndex];
                    const target = targetTurn.items?.[location.itemIndex];
                    if (target && target.type === "plan") {
                        target.text = (target.text || "") + delta;
                        turns = [...turns];
                        if (isProcessing && currentTurnId === targetTurn.id) {
                            scrollToBottom();
                        }
                    } else {
                        bufferPlanDelta(itemId, delta);
                    }
                } else {
                    bufferPlanDelta(itemId, delta);
                }
                break;
            }

            case "item/commandExecution/outputDelta": {
                const { itemId, delta } = notification.params;
                clearErrorBannerOnRecovery(threadId);
                if (itemId && delta && currentTurnId) {
                    const turnIndex = turns.findIndex(t => t.id === currentTurnId);
                    if (turnIndex >= 0 && turns[turnIndex].items) {
                        const itemIndex = turns[turnIndex].items.findIndex(i => i.id === itemId);
                        if (itemIndex >= 0) {
                            const target = turns[turnIndex].items[itemIndex];
                            if (target.type === "commandExecution") {
                                const current = target.aggregatedOutput ?? "";
                                target.aggregatedOutput = `${current}${delta}`;
                                turns = [...turns];
                                scrollToBottom();
                            }
                        }
                    }
                }
                break;
            }

            case "item/reasoning/summaryTextDelta": {
                const { itemId, delta, summaryIndex } = notification.params;
                clearErrorBannerOnRecovery(threadId);
                if (itemId && delta != null && currentTurnId) {
                    const turnIndex = turns.findIndex(t => t.id === currentTurnId);
                    if (turnIndex >= 0 && turns[turnIndex].items) {
                        const turn = turns[turnIndex];
                        const itemIndex = turn.items.findIndex(i => i.id === itemId);
                        if (itemIndex >= 0) {
                            const target = turn.items[itemIndex];
                            if (target.type === "reasoning") {
                                const idx = Number(summaryIndex);
                                applyReasoningSummaryDelta(target.id, idx, delta);
                                target.summary = [...(reasoningSummaryState.get(target.id) ?? [])];
                                activeReasoningItemId = target.id;
                                updateReasoningBodyFromSummary(target);
                                turns = [...turns];
                            }
                        }
                    }
                }
                break;
            }

            case "item/reasoning/summaryPartAdded": {
                const { itemId, summaryIndex } = notification.params;
                clearErrorBannerOnRecovery(threadId);
                refreshProcessingSummaryFromActiveTurn();
                // Summary part completed, no action needed
                break;
            }

            case "item/reasoning/textDelta": {
                const { itemId, delta, contentIndex } = notification.params;
                clearErrorBannerOnRecovery(threadId);
                if (itemId && delta != null && currentTurnId) {
                    const turnIndex = turns.findIndex(t => t.id === currentTurnId);
                    if (turnIndex >= 0 && turns[turnIndex].items) {
                        const turn = turns[turnIndex];
                        const itemIndex = turn.items.findIndex(i => i.id === itemId);
                        if (itemIndex >= 0) {
                            const target = turn.items[itemIndex];
                            if (target.type === "reasoning") {
                                if (!Array.isArray(target.content)) {
                                    target.content = [];
                                }
                                const idx = Number(contentIndex);
                                while (target.content.length <= idx) {
                                    target.content.push("");
                                }
                                target.content[idx] = `${target.content[idx] || ""}${delta}`;
                                turns = [...turns];
                            }
                        }
                    }
                }
                break;
            }

            case "item/mcpToolCall/progress":
                debugLog("[ChatView] MCP tool progress:", notification.params.message);
                break;

            case "account/updated":
            case "account/rateLimits/updated":
            case "account/login/completed":
                // These are handled at the app level
                break;

            default:
                console.warn("[ChatView] Unhandled notification:", notification);
        }
    }
</script>

<div class="chat-view">
    <div 
        class="items-container" 
        bind:this={itemsContainer}
        on:scroll={handleScroll}
        on:wheel={handleUserInteraction}
        on:mousedown={handleUserInteraction}
        on:touchstart={handleUserInteraction}
    >
        <div class="chat-column items-column">
            <div class="items-content" bind:this={itemsContent}>
                {#if turns.length === 0}
                    <div class="empty-state">
                        <p>Start the conversation by sending a message</p>
                    </div>
                {:else}
                    <!-- 以 ThreadItem 为粒度的虚拟列表渲染，支持组折叠 + 底部 ProcessingPlaceholder footer。 -->
                    <ThreadItemFlatList
                        {turns}
                        scrollElement={itemsContainer}
                        groupExpanded={itemGroupExpanded}
                        {currentItemId}
                        streamingItemId={isProcessing ? currentItemId : null}
                        turnDiffs={turnDiffs}
                        turnTokenStats={turnTokenStats}
                        hasProcessingFooter={isProcessing && currentTurnId}
                        processingHeader={processingSummaryHeader}
                        processingElapsedSeconds={processingElapsedSeconds}
                        processingPinned={isUserNearBottom}
                        undoTurnId={undoTurnId}
                        on:toggleGroup={handleItemGroupToggle}
                        on:undoTurn={(e) => void handleUndoTurn(e.detail.turnId)}
                    />
                {/if}
            </div>
        </div>
    </div>
    <div class="composer-region">
        <div class="chat-column composer-column">
            <div
                class="composer-drawer"
                class:active={drawerActive}
                aria-hidden={!drawerActive}
                bind:this={drawerEl}
            >
                <div class="composer-drawer-inner">
                    {#if pendingApproval}
                        <ApprovalDialog
                            params={pendingApproval.params}
                            requestId={pendingApproval.requestId}
                            type={pendingApproval.type}
                            item={pendingApproval.item}
                            onResponse={handleApprovalResponse}
                        />
                    {:else if pendingUserInput}
                        <RequestUserInputDialog
                            requestId={pendingUserInput.requestId}
                            params={pendingUserInput.params}
                            onCancel={() => {
                                const local = pendingUserInput;
                                pendingUserInput = null;
                                if (!local) return;
                                const response = buildUserInputCancelResponse(local.params);
                                sendUserInputResponse(local.requestId, response).catch((error) => {
                                    console.error(
                                        "[ChatView] Failed to send request_user_input cancel response:",
                                        error
                                    );
                                });
                            }}
                            onSubmit={async (response) => {
                                const local = pendingUserInput;
                                pendingUserInput = null;
                                if (!local) return;
                                try {
                                    await sendUserInputResponse(local.requestId, response);
                                    debugLog("[ChatView] Sent request_user_input response", {
                                        requestId: local.requestId,
                                    });
                                } catch (error) {
                                    console.error(
                                        "[ChatView] Failed to send request_user_input response:",
                                        error
                                    );
                                }
                            }}
                        />
                    {:else if pendingElicitation}
                        <ElicitationDialog
                            requestId={pendingElicitation.requestId}
                            params={pendingElicitation.params}
                            onCancel={() => {
                                const local = pendingElicitation;
                                pendingElicitation = null;
                                if (!local) return;
                                sendElicitationResponse(local.requestId, {
                                    action: "cancel",
                                    content: null,
                                    _meta: local.params._meta ?? null,
                                }).catch((error) => {
                                    console.error(
                                        "[ChatView] Failed to send elicitation cancel response:",
                                        error
                                    );
                                });
                            }}
                            onDecline={() => {
                                const local = pendingElicitation;
                                pendingElicitation = null;
                                if (!local) return;
                                sendElicitationResponse(local.requestId, {
                                    action: "decline",
                                    content: null,
                                    _meta: local.params._meta ?? null,
                                }).catch((error) => {
                                    console.error(
                                        "[ChatView] Failed to send elicitation decline response:",
                                        error
                                    );
                                });
                            }}
                            onSubmit={async (response) => {
                                const local = pendingElicitation;
                                pendingElicitation = null;
                                if (!local) return;
                                try {
                                    await sendElicitationResponse(local.requestId, response);
                                    debugLog("[ChatView] Sent elicitation response", {
                                        requestId: local.requestId,
                                    });
                                } catch (error) {
                                    console.error(
                                        "[ChatView] Failed to send elicitation response:",
                                        error
                                    );
                                }
                            }}
                        />
                    {/if}
                </div>
            </div>

            {#if errorBanner}
                <div class="error-banner">
                    {errorBanner}
                </div>
            {/if}

            {#if contextBanner}
                <div class="context-banner">
                    {contextBanner}
                </div>
            {/if}

            <InputBox
                on:send={(e) => sendMessage(e.detail.message, e.detail.autoContext, e.detail.attachments)}
                on:interrupt={interruptTurn}
                on:requestCodeReview={startCodeReview}
                on:goalSet={setThreadGoal}
                on:goalStatus={updateThreadGoalStatus}
                on:goalClear={clearThreadGoal}
                {isProcessing}
                actionsDisabled={
                    !!pendingUserInput || !!pendingElicitation || reviewInProgress
                }
                {cwd}
                contextPercentUsed={contextPercentUsed}
                contextTooltip={contextTooltip}
                {activeGoal}
                {goalObservedAtMs}
                {activeTurnStartedAtMs}
                {goalLocalElapsedFloorSeconds}
                {uiClockMs}
                {goalBusy}
            />

            {#if models && models.length}
                <div class="composer-controls">
                    <div class="composer-control">
                        <CollaborationModeSelector bind:selectedMode={selectedCollaborationMode} />
                    </div>
                    <div class="composer-control">
                        <ApprovalPolicySelector
                            selectedPolicy={approvalPolicy}
                            on:selectedPolicyChange={handleApprovalPolicySelected}
                        />
                    </div>
                    <div class="composer-control">
                        <ModelSelector
                            models={providerScopedModels ?? []}
                            bind:selectedModel
                            disabled={!providerScopedModels || providerScopedModels.length === 0}
                            on:open={refreshModelsOnPickerOpen}
                        />
                    </div>
                    {#if effortOptionsForModel.length}
                        <div class="composer-control">
                            <EffortSelector
                                options={effortOptionsForModel}
                                bind:selectedEffort
                                disabled={!effortOptionsForModel.length}
                            />
                        </div>
                    {/if}
                </div>
            {/if}
        </div>
    </div>


</div>

<style>
    .chat-view {
        display: flex;
        flex-direction: column;
        height: 100%;
        overflow: hidden;
    }

    .items-container {
        flex: 1;
        overflow-y: auto;
        padding: 0;
        font-family: var(--ai-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
        font-size: var(--ai-font-size, 14px);
    }

    .chat-column {
        width: 100%;
        max-width: var(--chat-column-max-width, 960px);
        margin-inline: auto;
        box-sizing: border-box;
    }

    /* Local column padding so messages + composer align perfectly when ChatView is wide. */
    .items-column {
        padding: 8px 16px 4px;
        min-height: 100%;
        display: flex;
        flex-direction: column;
    }

    .items-content {
        display: flex;
        flex-direction: column;
        flex: 1 1 auto;
        min-height: 100%;
        /* 确保只有 items-container 参与滚动，内部不再单独产生微小滚动条 */
        overflow: visible !important;
    }

    .empty-state {
        display: flex;
        align-items: center;
        justify-content: center;
        height: 100%;
        color: var(--text-secondary, #aaa);
    }

    .composer-region {
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 6px;
        background: transparent;
        position: relative;
    }

    .composer-column {
        padding: 8px 16px 10px;
        position: relative;
    }

    .composer-drawer {
        /* In-flow drawer: expands to push chat view up instead of overlaying it. */
        width: 100%;
        overflow: hidden;
        max-height: 0;
        opacity: 0;
        margin: 0;
        transition:
            max-height 0.18s ease,
            opacity 0.18s ease,
            margin 0.18s ease;
    }

    .composer-drawer.active {
        max-height: min(60vh, 560px);
        opacity: 1;
        margin: 0 0 10px;
    }

    .composer-drawer-inner {
        max-height: min(60vh, 560px);
        overflow: auto;
    }

    .error-banner {
        margin: 0 4px 4px;
        padding: 6px 10px;
        border-radius: 8px;
        border: 1px solid rgba(255, 99, 71, 0.7);
        background: rgba(255, 99, 71, 0.12);
        color: var(--error-text, #ffb3b3);
        font-size: 12px;
    }

    .context-banner {
        margin: 0 4px 4px;
        padding: 6px 10px;
        border-radius: 8px;
        border: 1px solid rgba(59, 130, 246, 0.45);
        background: rgba(59, 130, 246, 0.12);
        color: var(--text-primary, #cfe0ff);
        font-size: 12px;
    }

    :global(html[data-theme="light"]) .error-banner {
        background: rgba(255, 99, 71, 0.06);
        color: #b00020;
        border-color: rgba(176, 0, 32, 0.65);
    }

    :global(html[data-theme="light"]) .context-banner {
        background: rgba(59, 130, 246, 0.08);
        color: #1d4ed8;
        border-color: rgba(59, 130, 246, 0.4);
    }

    /* Drawer keeps dialog components' own styling; avoid extra surfaces here. */

    .composer-controls {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        align-items: center;
        /* Align with the InputBox inner container which has horizontal padding. */
        padding: 0 8px;
        font-size: var(--header-compact-font-size, 12px);
        color: var(--text-secondary, #aaa);
    }

    .composer-control {
        display: flex;
        align-items: center;
        gap: 8px;
    }

    .control-label {
        white-space: nowrap;
    }

    .composer-control select {
        padding: 4px 10px;
        background: var(--bg-secondary, #252525);
        border: 1px solid var(--border-color, #333);
        border-radius: 4px;
        color: var(--text-primary, #fff);
        font-size: var(--header-compact-font-size, 12px);
        cursor: pointer;
    }

    .composer-control select:hover:not(:disabled) {
        background: var(--bg-hover, #2a2a2a);
        border-color: var(--accent-color, #007acc);
    }

    .composer-control select:focus {
        outline: none;
        border-color: var(--accent-color, #007acc);
    }

    .composer-control select:disabled {
        opacity: 0.5;
        cursor: not-allowed;
    }

</style>
