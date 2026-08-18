<script lang="ts">
    import type { Turn, ThreadItem, FileUpdateChange, TokenUsageBreakdown } from "./types";
    import ThreadItemCard from "./ThreadItemCard.svelte";
    import TurnStatusIndicator from "./TurnStatusIndicator.svelte";
    import { createVirtualizer } from "@tanstack/svelte-virtual";
    import { get } from "svelte/store";
	    import MultiFileDiffView from "./MultiFileDiffView.svelte";
	    import {
	        Bot,
	        Brain,
	        ClipboardList,
	        ExternalLink,
	        FileEdit,
	        FileSearch,
	        FileText,
	        FoldVertical,
	        FolderTree,
	        GitBranch,
	        Globe2,
	        Image,
	        ListTodo,
	        MessageSquare,
	        Search,
	        SquareTerminal,
	        Wrench,
	    } from "lucide-svelte";
	    import type { TurnDiffFileSummary } from "./diffUtils";
	    import {
	        buildFileChangeSummaryFromTurnDiff,
	        type FileChangeSummaryEntry,
	    } from "./fileChangeSummaryUtils";
	    import { openViewAllChangesTab } from "./viewAllChangesHost";
    import ProcessingPlaceholder from "./ProcessingPlaceholder.svelte";
    import type { CostBreakdown } from "./pricing";

    /**
     * 以 ThreadItem 为粒度的扁平化 + 虚拟列表组件。
     * 这里只关心“按顺序把所有行展示出来”，不做折叠。
     * 每个 turn 展开为：
     *   - 一行简单的 Turn 头部（status 行）
     *   - 若干 ThreadItem 行（userMessage、process items、final agent、todoList）
     */

    import { createEventDispatcher } from "svelte";

    export let turns: Turn[] = [];
    export let scrollElement: HTMLDivElement | null = null;
    // 折叠状态：key 为 groupId，value 为是否展开（默认展开）
    export let groupExpanded: Record<string, boolean> = {};
    // 当前正在执行的步骤 itemId（用于高亮对应菱形）
    export let currentItemId: string | null = null;
    // 每个 turn 的 diff 摘要（来自 ChatView 的 turnDiffs）
    export let turnDiffs: Record<
        string,
        {
            unifiedDiff: string;
            files: TurnDiffFileSummary[];
        }
    > = {};
    // 是否在列表底部附加一个 processing footer（ProcessingPlaceholder）
    export let hasProcessingFooter: boolean = false;
    export let processingHeader: string | null = null;
    export let processingPinned: boolean = false;
    export let processingElapsedSeconds: number | null = null;
    // Latest turn id that has an undo snapshot available (may be null).
    export let undoTurnId: string | null = null;
    export let turnTokenStats: Record<
        string,
        { usage: TokenUsageBreakdown; cost: CostBreakdown | null; model: string | null }
    > = {};
    // If set, we treat the matching item card as "streaming" to avoid heavy rendering work.
    // (The parent ChatView owns the streaming state; we only decorate the card.)
    export let streamingItemId: string | null = null;

    type StatusRow = {
        kind: "status";
        key: string;
        turnId: string;
        turnIndex: number;
        status: Turn["status"] | null | undefined;
        isFinished: boolean;
        stepsGroupId: string | null;
        stepsCount: number;
    };

    type ItemRow = {
        kind: "item";
        key: string;
        turnId: string;
        turnIndex: number;
        itemIndex: number;
        item: ThreadItem;
        groupId: string | null;
        isGroupHeader: boolean;
        groupSize: number;
        isGroupTail: boolean;
        isReviewPrompt: boolean;
    };

    type FileSummaryRow = {
        kind: "fileSummary";
        key: string;
        turnId: string;
        turnIndex: number;
        summary: FileChangeSummaryEntry[];
        totals: { added: number; deleted: number };
        changes: FileUpdateChange[];
    };

    type UsageRow = {
        kind: "usage";
        key: string;
        turnId: string;
        usage: TokenUsageBreakdown;
        cost: CostBreakdown | null;
        model: string | null;
        durationMs: number | null;
    };

    type FlatRow = StatusRow | ItemRow | FileSummaryRow | UsageRow;

    let allRows: FlatRow[] = [];
    let flatRows: FlatRow[] = [];
    const fileSummaryRowCache = new Map<string, { unifiedDiff: string; row: FileSummaryRow | null }>();

    function hasReasoningContent(item: Extract<ThreadItem, { type: "reasoning" }>) {
        const hasContent = item.content?.some((text) => text?.trim().length > 0);
        const summaryBody = (item as any).reasoningSummaryBody;
        const hasSummaryBody = typeof summaryBody === "string" && summaryBody.trim().length > 0;
        return Boolean(hasContent || hasSummaryBody);
    }

    function shouldHideItem(item: ThreadItem) {
        if (item.type === "reasoning") {
            return !hasReasoningContent(item as any);
        }
        return false;
    }

    const dispatch = createEventDispatcher<{
        toggleGroup: { groupId: string };
        undoTurn: { turnId: string };
        openThread: { threadId: string };
    }>();

    function emitToggleGroup(groupId: string | null) {
        if (!groupId) return;
        dispatch("toggleGroup", { groupId });
    }

    function emitUndoTurn(turnId: string) {
        if (!turnId) return;
        dispatch("undoTurn", { turnId });
    }

    function emitOpenThread(threadId: string) {
        if (!threadId) return;
        dispatch("openThread", { threadId });
    }

    function getTimelineIcon(item: ThreadItem) {
        switch (item.type) {
            case "agentMessage":
                return Bot;
            case "reasoning":
                return Brain;
            case "plan":
                return ClipboardList;
            case "contextCompaction":
                return FoldVertical;
            case "commandExecution":
                return SquareTerminal;
            case "fileChange":
                return FileEdit;
            case "mcpToolCall":
                return Wrench;
            case "collabAgentToolCall":
                return GitBranch;
            case "webSearch":
                return Globe2;
            case "todoList":
                return ListTodo;
            case "imageView":
            case "imageGeneration":
                return Image;
            case "codeReview":
            case "enteredReviewMode":
            case "exitedReviewMode":
                return FileSearch;
            case "functionToolCall":
                switch ((item as any).toolName) {
                    case "grep_files":
                        return Search;
                    case "read_file":
                        return FileText;
                    case "list_dir":
                        return FolderTree;
                    case "request_user_input":
                        return MessageSquare;
                    default:
                        return Wrench;
                }
            default:
                return Bot;
        }
    }

    function getTimelineColor(item: ThreadItem): string {
        switch (item.type) {
            case "agentMessage":
                return "#8b5cf6";
            case "reasoning":
            case "plan":
                return "#f59e0b";
            case "contextCompaction":
                return "#64748b";
            case "commandExecution":
                return "#10b981";
            case "fileChange":
                return "#06b6d4";
            case "mcpToolCall":
                return "#6366f1";
            case "collabAgentToolCall":
                return "#0f766e";
            case "webSearch":
                return "#ec4899";
            case "todoList":
                return "#14b8a6";
            case "imageView":
                return "#a855f7";
            case "imageGeneration":
            case "codeReview":
            case "enteredReviewMode":
            case "exitedReviewMode":
                return "#f97316";
            case "functionToolCall":
                switch ((item as any).toolName) {
                    case "read_file":
                        return "#06b6d4";
                    case "list_dir":
                        return "#14b8a6";
                    case "grep_files":
                        return "#3b82f6";
                    default:
                        return "#8b5cf6";
                }
            default:
                return "#8b5cf6";
        }
    }

    function findTimelineAnchor(rowEl: HTMLElement): HTMLElement | null {
        const selectors = [
            ".item-row-body .item-header",
            ".item-row-body .read-file-row",
            ".item-row-body .collab-row",
            ".item-row-body .tool-header",
            ".item-row-body .markdown-content > :first-child",
            ".item-row-body .simple-content p",
            ".item-row-body .review-mode-card",
            ".item-row-body .context-compaction-card",
            ".item-row-body .image-generation-header",
            ".item-row-body .thread-item-card",
        ];

        for (const selector of selectors) {
            const target = rowEl.querySelector<HTMLElement>(selector);
            if (target && target.getClientRects().length > 0) return target;
        }
        return null;
    }

    function getFirstTextLineRect(anchor: HTMLElement): DOMRect | null {
        const walker = document.createTreeWalker(anchor, NodeFilter.SHOW_TEXT);

        while (walker.nextNode()) {
            const textNode = walker.currentNode as Text;
            const text = textNode.textContent ?? "";
            const firstVisibleChar = text.search(/\S/);
            if (firstVisibleChar < 0) continue;

            const range = document.createRange();
            range.setStart(textNode, firstVisibleChar);
            range.setEnd(textNode, text.length);

            const rect = Array.from(range.getClientRects()).find(
                (candidate) => candidate.width > 0 && candidate.height > 0
            );
            range.detach();

            if (rect) return rect;
        }

        return null;
    }

    function getTimelineAnchorRect(anchor: HTMLElement): DOMRect {
        return getFirstTextLineRect(anchor) ?? anchor.getBoundingClientRect();
    }

    function alignTimelineNode(node: HTMLElement) {
        let frame: number | null = null;
        let resizeObserver: ResizeObserver | null = null;

        const update = () => {
            frame = null;
            const rowEl = node.closest<HTMLElement>(".item-row-group");
            if (!rowEl) return;

            const anchor = findTimelineAnchor(rowEl);
            if (!anchor) return;

            const rowRect = rowEl.getBoundingClientRect();
            const anchorRect = getTimelineAnchorRect(anchor);
            const top = anchorRect.top - rowRect.top + anchorRect.height / 2;
            if (Number.isFinite(top)) {
                node.style.setProperty("--fold-node-top", `${top}px`);
            }
        };

        const scheduleUpdate = () => {
            if (frame !== null) return;
            frame = requestAnimationFrame(update);
        };

        scheduleUpdate();

        if (typeof ResizeObserver !== "undefined") {
            const rowEl = node.closest<HTMLElement>(".item-row-group");
            resizeObserver = new ResizeObserver(scheduleUpdate);
            resizeObserver.observe(node);
            if (rowEl) resizeObserver.observe(rowEl);
            const bodyEl = rowEl?.querySelector<HTMLElement>(".item-row-body");
            if (bodyEl) resizeObserver.observe(bodyEl);
        }

        return {
            update: scheduleUpdate,
            destroy() {
                if (frame !== null) {
                    cancelAnimationFrame(frame);
                    frame = null;
                }
                resizeObserver?.disconnect();
            },
        };
    }

    function computeTotals(summary: FileChangeSummaryEntry[]) {
        return summary.reduce(
            (acc, entry) => ({
                added: acc.added + (entry.additions || 0),
                deleted: acc.deleted + (entry.deletions || 0),
            }),
            { added: 0, deleted: 0 }
        );
    }

    function getCachedFileSummaryRow(
        turn: Turn,
        turnIndex: number,
        turnDiff: { unifiedDiff: string; files: TurnDiffFileSummary[] } | null | undefined
    ): FileSummaryRow | null {
        if (!turnDiff || !Array.isArray(turnDiff.files) || turnDiff.files.length === 0) {
            return null;
        }

        const cached = fileSummaryRowCache.get(turn.id);
        if (cached?.unifiedDiff === turnDiff.unifiedDiff) {
            return cached.row ? { ...cached.row, turnIndex } : null;
        }

        const summary = buildFileChangeSummaryFromTurnDiff(turnDiff.files);
        if (summary.length === 0) {
            fileSummaryRowCache.set(turn.id, { unifiedDiff: turnDiff.unifiedDiff, row: null });
            return null;
        }

        const row: FileSummaryRow = {
            kind: "fileSummary",
            key: `${turn.id}:file-summary`,
            turnId: turn.id,
            turnIndex,
            summary,
            totals: computeTotals(summary),
            changes: summary.flatMap((entry) => entry.changes || []),
        };
        fileSummaryRowCache.set(turn.id, { unifiedDiff: turnDiff.unifiedDiff, row });
        return row;
    }

    const numberFmt = new Intl.NumberFormat("en-US");
    const formatTokens = (value: number) => {
        if (value == null || Number.isNaN(value)) return "0";
        const abs = Math.abs(value);
        if (abs >= 1000) {
            const v = value / 1000;
            // 保留 0-2 位小数，避免超长；去掉尾随 0
            const decimals = v >= 100 ? 0 : v >= 10 ? 1 : 2;
            return `${v.toFixed(decimals).replace(/\\.0+$/, "")}k`;
        }
        return numberFmt.format(value);
    };

    function formatDurationMs(durationMs: number | null | undefined): string | null {
        if (typeof durationMs !== "number" || !Number.isFinite(durationMs) || durationMs < 0) {
            return null;
        }
        const totalSeconds = Math.max(0, Math.round(durationMs / 1000));
        if (totalSeconds < 60) return `${totalSeconds}s`;
        if (totalSeconds < 3600) {
            const minutes = Math.floor(totalSeconds / 60);
            const seconds = totalSeconds % 60;
            return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
        }
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
    }

    function turnDurationMs(turn: Turn): number | null {
        if (typeof turn.durationMs === "number" && Number.isFinite(turn.durationMs)) {
            return turn.durationMs;
        }
        if (typeof turn.startedAt === "number" && typeof turn.completedAt === "number") {
            return Math.max(0, (turn.completedAt - turn.startedAt) * 1000);
        }
        return null;
    }

    // 扁平化：按 turn 顺序、再按 TurnView 的过滤规则展开（不做折叠，只控制“有哪些行”）
    $: allRows = (() => {
        const rows: FlatRow[] = [];

        turns.forEach((turn, tIndex) => {
            const items = turn.items ?? [];
            if (!items.length) return;

            const status: Turn["status"] | null | undefined = turn.status || "inProgress";
            const isFinished =
                status === "completed" || status === "failed" || status === "interrupted";

            // 1) userMessage：每个 turn 最多一个，始终在该 turn 的第一行
            //    对于 review turn（带有 enteredReviewMode / exitedReviewMode）：
            //    - Codex 会发两个 userMessage：
            //      a) 短的 label（例如 "current changes"，id 与 enteredReviewMode 相同）
            //      b) 真正的自然语言提示（例如 “Review the current code changes ...”，id 不同）
            //    VSCode 的做法是：
            //      - 不把 (a) 当作聊天气泡显示，只通过 enteredReviewMode 卡片 + header 呈现
            //      - 只把 (b) 渲染成蓝色的 review header。
            //    这里复刻同样的规则。
            const allUserMessages = items.filter((it) => it.type === "userMessage");
            const reviewModeItem = items.find(
                (it) => it.type === "enteredReviewMode" || it.type === "exitedReviewMode"
            );

            let userMessage: ThreadItem | undefined;
            let isReviewPrompt = false;

            if (reviewModeItem && allUserMessages.length > 0) {
                // 优先选择 id 与 reviewModeItem 不同的那条，作为真正的 review 提示
                userMessage =
                    allUserMessages.find((um) => um.id !== reviewModeItem.id) ??
                    allUserMessages[0];
                isReviewPrompt = true;
            } else {
                // 普通 turn：取第一条 userMessage，当作正常用户输入
                userMessage = allUserMessages[0];
                isReviewPrompt = false;
            }

            // 2) agentMessage：与 TurnView 相同的规则
            const agentMessages =
                items.filter(
                    (item) =>
                        item.type === "agentMessage" &&
                        item.text &&
                        item.text.trim().length > 0
                ) ?? [];

            const lastAgentMessage =
                isFinished && agentMessages.length > 0
                    ? agentMessages[agentMessages.length - 1]
                    : null;

            const todoItem = items.find((it) => it.type === "todoList") ?? null;

            const processRows: ItemRow[] = [];
            let fileSummaryRow: FileSummaryRow | null = null;

            // 3) process 区域：除了 userMessage / todoList / 不合规的 fileChange / 最终 agentMessage 之外的所有 item
            items.forEach((item, iIndex) => {
                // 所有 userMessage 都只在顶部渲染，不参与 process 区域，
                // 这样 review 场景下的“短 label”和“长提示”都不会再变成额外的用户气泡。
                if (item.type === "userMessage") return;

                if (item.type === "agentMessage") {
                    if (
                        lastAgentMessage &&
                        item.id === lastAgentMessage.id &&
                        isFinished
                    ) {
                        // 最终 agentMessage 在 turn 尾部单独渲染
                        return;
                    }
                    if (!item.text || !item.text.trim().length) {
                        return;
                    }
                }

                if (shouldHideItem(item)) {
                    return;
                }

                // fileChange：只保留 completed 的
                if (item.type === "fileChange" && item.status !== "completed") {
                    return;
                }

                // todoList：不在普通流程里渲染，由单独区域处理
                if (item.type === "todoList") {
                    return;
                }

                const baseId = item.id ?? `${tIndex}-${iIndex}`;
                const needsTypeSuffix =
                    item.type === "enteredReviewMode" || item.type === "exitedReviewMode";
                const key = needsTypeSuffix
                    ? `${turn.id}:${baseId}:${item.type}`
                    : `${turn.id}:${baseId}`;
                const baseRow: ItemRow = {
                    kind: "item",
                    key,
                    turnId: turn.id,
                    turnIndex: tIndex,
                    itemIndex: iIndex,
                    item,
                    groupId: null,
                    isGroupHeader: false,
                    groupSize: 1,
                    isGroupTail: false,
                    isReviewPrompt: false,
                };

                processRows.push(baseRow);
            });

            const stepsGroupId = processRows.length > 0 ? `${turn.id}:steps` : null;
            const processEntries = processRows;

            // userMessage 先渲染
            if (userMessage) {
                rows.push({
                    kind: "item",
                    key: `${turn.id}:${userMessage.id ?? `user-${tIndex}`}`,
                    turnId: turn.id,
                    turnIndex: tIndex,
                    itemIndex: items.indexOf(userMessage),
                    item: userMessage,
                    groupId: null,
                    isGroupHeader: false,
                    groupSize: 1,
                    isReviewPrompt,
                });
            }

            // 4) Turn 状态 + 折叠按钮（在用户气泡下方）
            rows.push({
                kind: "status",
                key: `${turn.id}:status`,
                turnId: turn.id,
                turnIndex: tIndex,
                status,
                isFinished,
                stepsGroupId,
                stepsCount: processRows.length,
            });

            // 将整个 process 区域视为一个组（与 TurnView 的“Hide steps”语义一致）
            if (processEntries.length > 0 && stepsGroupId) {
                let itemIdx = 0;
                const itemCount = processEntries.filter((entry) => entry.kind === "item").length;
                processEntries.forEach((entry) => {
                    if (entry.kind === "item") {
                        entry.groupId = stepsGroupId;
                        entry.isGroupHeader = itemIdx === 0;
                        entry.isGroupTail = itemIdx === itemCount - 1;
                        entry.groupSize = itemCount;
                        itemIdx += 1;
                    }
                    rows.push(entry);
                });
            }

            // 5) turn 末尾：最终 agentMessage（如果有）
            if (lastAgentMessage) {
                rows.push({
                    kind: "item",
                    key: `${turn.id}:final-${lastAgentMessage.id ?? `agent-${tIndex}`}`,
                    turnId: turn.id,
                    turnIndex: tIndex,
                    itemIndex: items.indexOf(lastAgentMessage),
                    item: lastAgentMessage,
                    groupId: null,
                    isGroupHeader: false,
                    groupSize: 1,
                });
            }

            // 5.5) fileChange summary：turn 已结束时，在末尾展示聚合的文件更改摘要。
            if (isFinished) {
                const turnDiff = turnDiffs[turn.id] ?? null;
                fileSummaryRow = getCachedFileSummaryRow(turn, tIndex, turnDiff);
            }

            if (fileSummaryRow) {
                rows.push(fileSummaryRow);
            }

            // 6) todoList：单独一行 Tasks 区
            if (todoItem) {
                rows.push({
                    kind: "item",
                    key: `${turn.id}:todo-${todoItem.id}`,
                    turnId: turn.id,
                    turnIndex: tIndex,
                    itemIndex: items.indexOf(todoItem),
                    item: todoItem,
                    groupId: null,
                    isGroupHeader: false,
                    groupSize: 1,
                });
            }

            // 7) token usage + cost (only show once the turn is finished)
            const tokenStats = turnTokenStats[turn.id] ?? null;
            const durationMs = turnDurationMs(turn);
            if (isFinished && tokenStats?.usage) {
                rows.push({
                    kind: "usage",
                    key: `${turn.id}:usage`,
                    turnId: turn.id,
                    usage: tokenStats.usage,
                    cost: tokenStats.cost,
                    model: tokenStats.model,
                    durationMs,
                });
            }
        });

        return rows;
    })();

    // 不再根据折叠状态过滤 rows，避免虚拟项数量和索引在折叠/展开时大幅变化。
    // 统一由渲染分支决定每一行实际是否显示和占高。
    $: flatRows = allRows;

    // 基于扁平化后的 rows 构建虚拟器
    const rowVirtualizer = createVirtualizer<HTMLDivElement, HTMLDivElement>({
        count: 0,
        getScrollElement: () => scrollElement,
        estimateSize: () => 220, // 估计一个 ThreadItemCard 大致高度
        overscan: 8,
        indexAttribute: "data-index",
    });

    // 每当 flatRows 变化时，同步虚拟器配置（数量 + key）
    $: {
        const instance = get(rowVirtualizer);
        const footerCount = hasProcessingFooter ? 1 : 0;
        instance.setOptions({
            count: flatRows.length + footerCount,
            getItemKey: (index) =>
                index < flatRows.length ? flatRows[index]?.key ?? index : "processing-footer",
        });
    }

    // 行测量 action：
    // - 挂载时测量一次
    // - 使用 ResizeObserver 在高度变化时重新测量
    //   这样折叠/展开组或内容变更时，virtualizer 能拿到最新尺寸，
    //   无需整列表重挂载，也不会出现空白/重叠。
    function measureRow(node: HTMLDivElement) {
        const instance = get(rowVirtualizer);
        instance.measureElement(node);

        let resizeObserver: ResizeObserver | null = null;

        if (typeof ResizeObserver !== "undefined") {
            resizeObserver = new ResizeObserver(() => {
                const inst = get(rowVirtualizer);
                inst.measureElement(node);
            });
            resizeObserver.observe(node);
        }

        return {
            destroy() {
                if (resizeObserver) {
                    resizeObserver.disconnect();
                    resizeObserver = null;
                }
            },
        };
    }

</script>

<div class="thread-item-flat-root">
    {#if flatRows.length === 0}
        <div class="empty-state">
            <p>No items to display</p>
        </div>
    {:else}
        <div
            class="virtual-canvas"
            style={`height: ${Math.round($rowVirtualizer.getTotalSize())}px;`}
        >
            {#each $rowVirtualizer.getVirtualItems() as virtualRow (virtualRow.key)}
                <div
                    class="virtual-row"
                    class:collapsed-group-row={virtualRow.index < flatRows.length &&
                        flatRows[virtualRow.index]?.kind === "item" &&
                        flatRows[virtualRow.index].groupId &&
                        !(groupExpanded[flatRows[virtualRow.index].groupId] ?? true)}
                    data-index={virtualRow.index}
                    style={`transform: translateY(${virtualRow.start}px);`}
                    use:measureRow
                >
                    {#if virtualRow.index < flatRows.length}
                        {@const row = flatRows[virtualRow.index]}
                        {#if row.kind === "status"}
                            <div class="status-row">
                                <TurnStatusIndicator
                                    status={row.status || "inProgress"}
                                    currentItem={null}
                                />
                                {#if row.isFinished && row.stepsGroupId && row.stepsCount > 0}
                                    <button
                                        class="expand-toggle"
                                        class:expanded={(groupExpanded[row.stepsGroupId] ?? true)}
                                        type="button"
                                        on:click={() => emitToggleGroup(row.stepsGroupId)}
                                    >
                                        <svg
                                            width="16"
                                            height="16"
                                            viewBox="0 0 24 24"
                                            fill="none"
                                            stroke="currentColor"
                                            stroke-width="2"
                                        >
                                            {#if groupExpanded[row.stepsGroupId] ?? true}
                                                <path d="M18 15l-6-6-6 6" />
                                            {:else}
                                                <path d="M9 18l6-6-6-6" />
                                            {/if}
                                        </svg>
                                        <span>
                                            {(groupExpanded[row.stepsGroupId] ?? true)
                                                ? `Hide ${row.stepsCount} step${row.stepsCount > 1 ? "s" : ""}`
                                                : `Show ${row.stepsCount} step${row.stepsCount > 1 ? "s" : ""}`}
                                        </span>
                                    </button>
                                {/if}
                            </div>
                            {:else if row.kind === "fileSummary"}
                            {@const totals = row.totals}
                            <div class="file-change-summary">
                                <div class="summary-header">
                                    <div class="summary-title">
                                        {row.summary.length === 1
                                            ? "1 file changed"
                                            : `${row.summary.length} files changed`}
                                        <span class="summary-counts">
                                            <span class="summary-add">+{totals.added}</span>
                                            <span class="summary-del">-{totals.deleted}</span>
                                        </span>
                                    </div>
                                    <div class="summary-actions">
                                        <button
                                            class="summary-diff-button"
                                            type="button"
                                            on:click={() =>
                                                openViewAllChangesTab({
                                                    turnId: row.turnId,
                                                    title: "View all changes",
                                                    changes: row.changes,
                                                })}
                                            title="在 tab 中查看所有变更"
                                        >
                                            <ExternalLink size="14" />
                                            <span class="summary-diff-label">View all changes</span>
                                        </button>
                                        {#if undoTurnId === row.turnId}
                                            <button
                                                class="summary-diff-button"
                                                type="button"
                                                on:click={() => emitUndoTurn(row.turnId)}
                                                title="Undo this turn's changes"
                                            >
                                                <span class="summary-diff-label">Undo</span>
                                            </button>
                                        {/if}
                                    </div>
                                </div>
                                <MultiFileDiffView
                                    changes={row.summary.flatMap((entry) => entry.changes || [])}
                                    tone="default"
                                    defaultExpanded={false}
                                    showStatusLabel={false}
                                />
                            </div>
                            {:else}
                            {#if row.kind === "usage"}
                                <div class="usage-row">
                                    <div class="turn-usage-chips">
                                        <span class="chip">
                                            in {formatTokens(row.usage.inputTokens)}
                                        </span>
                                        {#if row.usage.cachedInputTokens > 0}
                                            <span class="chip muted">
                                                cache {formatTokens(row.usage.cachedInputTokens)}
                                            </span>
                                        {/if}
                                        <span class="chip">
                                            out {formatTokens(row.usage.outputTokens + row.usage.reasoningOutputTokens)}
                                        </span>
                                        <span class="turn-total">
                                            turn total {formatTokens(row.usage.totalTokens)}
                                        </span>
                                        {#if formatDurationMs(row.durationMs)}
                                            <span class="chip muted">
                                                worked {formatDurationMs(row.durationMs)}
                                            </span>
                                        {/if}
                                    </div>
                                </div>
                            {:else if row.item.type === "todoList"}
                                <!-- TodoList 保持与旧 TurnView 相同的样式，始终展开 -->
                                <div class="todo-list">
                                    <div class="todo-header">
                                        <svg
                                            width="18"
                                            height="18"
                                            viewBox="0 0 24 24"
                                            fill="none"
                                            stroke="currentColor"
                                            stroke-width="2"
                                        >
                                            <path d="M9 11l3 3L22 4" />
                                            <path
                                                d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"
                                            />
                                        </svg>
                                        <span>Tasks</span>
                                    </div>
                                    <ul class="todo-items">
                                        {#each row.item.items || [] as task}
                                            <li class:completed={task.completed}>
                                                <input
                                                    type="checkbox"
                                                    checked={task.completed}
                                                    disabled
                                                />
                                                <span>{task.text}</span>
                                            </li>
                                        {/each}
                                    </ul>
                                </div>
                            {:else}
                                {#if row.groupId}
                                    {#if groupExpanded[row.groupId] ?? true}
                                        <!-- 展开状态：显示折叠线 + 菱形 + 内容 -->
                                        <div
                                            class="item-row item-row-group"
                                            class:group-first={row.isGroupHeader}
                                            class:group-last={row.isGroupTail}
                                            class:group-single={row.groupSize === 1}
                                        >
                                            <button
                                                type="button"
                                                class="fold-node"
                                                class:fold-node-active={currentItemId === row.item.id}
                                                style={`--fold-node-color: ${getTimelineColor(row.item)}`}
                                                use:alignTimelineNode
                                            >
                                                <svelte:component
                                                    this={getTimelineIcon(row.item)}
                                                    size="1em"
                                                    class="fold-node-icon"
                                                />
                                            </button>
                                            <div class="item-row-body">
                                                <ThreadItemCard
                                                    item={row.item}
                                                    isStreaming={!!streamingItemId && streamingItemId === row.item.id}
                                                    isReviewPrompt={row.isReviewPrompt}
                                                    hideLeadingIcon
                                                    on:openThread={(e) => emitOpenThread(e.detail.threadId)}
                                                />
                                            </div>
                                        </div>
                                    {:else}
                                        <!-- 折叠状态：完全隐藏整个 steps 组的实际内容，
                                             保留哪些行属于该组的知识留给 flatRows/allRows，
                                             由虚拟列表 + measureRow 处理高度收缩。 -->
                                    {/if}
                                {:else}
                                    <!-- 普通非分组行 -->
                                    <div class="item-row">
                                        <div class="item-row-body">
                                            <ThreadItemCard
                                                item={row.item}
                                                isStreaming={!!streamingItemId && streamingItemId === row.item.id}
                                                isReviewPrompt={row.isReviewPrompt}
                                                on:openThread={(e) => emitOpenThread(e.detail.threadId)}
                                            />
                                        </div>
                                    </div>
                                {/if}
                            {/if}
                        {/if}
                    {:else if hasProcessingFooter}
                        <ProcessingPlaceholder
                            header={processingHeader}
                            pinned={processingPinned}
                            elapsedSeconds={processingElapsedSeconds}
                        />
                    {/if}
                </div>
            {/each}
        </div>
    {/if}
</div>

<style>
    .thread-item-flat-root {
        display: flex;
        flex-direction: column;
        /* 由父级（ChatView.items-container）负责滚动与 padding */
        width: 100%;
        box-sizing: border-box;
    }

    .virtual-canvas {
        position: relative;
        width: 100%;
    }

    .virtual-row {
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        width: 100%;
        box-sizing: border-box;
        padding: 4px 0;
    }

    /* 折叠 steps 时，对应虚拟行保持在列表中，但高度收缩为 0，避免产生大块空白。
       通过 ResizeObserver + measureRow，virtualizer 会在样式变化后重新计算总高度。 */
    .virtual-row.collapsed-group-row {
        padding-top: 0;
        padding-bottom: 0;
        height: 0;
    }

    .item-row {
        display: flex;
        align-items: center;
        width: 100%;
        box-sizing: border-box;
        gap: 6px;
    }

    .item-row-body {
        flex: 1 1 auto;
        min-width: 0;
    }

    .item-row-group {
        position: relative;
        padding-left: 24px; /* 给折叠线和节点预留空间 */
    }

    .fold-node {
        position: absolute;
        /* 折叠节点和垂线共用同一条 x 轴 */
        --fold-x: 12px;
        --fold-node-size: calc(var(--ai-font-size, 14px) + 6px);
        left: var(--fold-x);
        top: var(--fold-node-top, calc(var(--row-height, 32px) / 2));
        transform: translate(-50%, -50%);
        width: var(--fold-node-size);
        height: var(--fold-node-size);
        padding: 0;
        border: none;
        background: transparent;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 1;
    }

    .fold-node::before {
        content: "";
        position: absolute;
        inset: 0;
        border-radius: 999px;
        background: var(--bg-primary, #020617);
    }

    :global(.fold-node-icon) {
        display: block;
        width: calc(var(--ai-font-size, 14px) + 2px);
        height: calc(var(--ai-font-size, 14px) + 2px);
        color: var(--fold-node-color, rgba(56, 189, 248, 0.9));
        stroke-width: 2;
        position: relative;
        z-index: 1;
    }

    .fold-node.collapsed :global(.fold-node-icon) {
        color: var(--fold-node-color, rgba(56, 189, 248, 0.9));
        opacity: 0.9;
    }

    .fold-node-active :global(.fold-node-icon) {
        color: #22c55e;
    }

    .item-row-group::before {
        /* 垂直折叠线，略微向上下溢出，避免行与行之间出现断点 */
        content: "";
        position: absolute;
        left: var(--fold-x, 12px);
        top: -6px;
        bottom: -6px;
        width: 2px;
        border-radius: 1px;
        background: rgba(56, 189, 248, 0.25);
    }

    .item-row-group.group-first::before {
        /* 从第一个节点中心开始向下连接，始终延伸到本行底部（兼容内容较高的卡片） */
        top: 16px;
        bottom: -6px;
        height: auto;
    }

    .item-row-group.group-last::before {
        /* 从上一行延伸到最后一个节点中心，下面不要再多出“尾巴” */
        top: -6px;
        height: calc(var(--row-height, 32px) / 2 + 6px);
        bottom: auto;
    }

    .item-row-group.group-single::before {
        /* 只有一个 step 时，不画竖线，只保留一个菱形 */
        display: none;
    }

    .status-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        margin: 8px 0 6px;
        max-width: 100%;
        width: 100%;
    }

    .usage-row {
        margin: 10px 0 6px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        flex-wrap: wrap;
    }

    .turn-usage-chips {
        display: inline-flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 10px;
        font-size: 12px;
        font-family: var(--font-mono, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace);
        font-weight: 600;
        color: var(--text-secondary, #bbb);
        letter-spacing: 0.2px;
    }

    .chip {
        padding: 2px 0;
        border: none;
        background: transparent;
        color: inherit;
        font: inherit;
        line-height: 1.25;
    }

    .chip.muted {
        opacity: 0.9;
    }

    .turn-total {
        display: inline-flex;
        align-items: center;
        font-weight: 600;
        color: var(--text-secondary, #bbb);
        line-height: 1.25;
        font-family: var(--font-mono, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace);
    }

    .expand-toggle {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 4px 10px;
        background: transparent;
        border: 1px solid var(--border-color, #444);
        border-radius: 6px;
        color: var(--text-secondary, #aaa);
        font-size: 12px;
        cursor: pointer;
        transition: all 0.15s;
        flex-shrink: 0;
    }

    .expand-toggle:hover {
        background: var(--bg-hover, #2a2a2a);
        border-color: var(--accent-color, #007acc);
        color: var(--text-primary, #fff);
    }

    .expand-toggle svg {
        transition: transform 0.15s;
    }

    .expand-toggle.expanded svg {
        transform: rotate(180deg);
    }

    .todo-list {
        margin-top: 16px;
        padding: 12px;
        background: var(--bg-secondary, #252525);
        border: 1px solid var(--border-color, #444);
        border-radius: 6px;
    }

    .todo-header {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 12px;
        color: var(--text-primary, #fff);
        font-weight: 500;
        font-size: 14px;
    }

    .todo-header svg {
        color: var(--accent-color, #007acc);
    }

    .todo-items {
        list-style: none;
        padding: 0;
        margin: 0;
    }

    .todo-items li {
        display: flex;
        align-items: flex-start;
        gap: 8px;
        padding: 6px 0;
        color: var(--text-primary, #fff);
        font-size: 13px;
        line-height: 1.5;
    }

    .todo-items li.completed {
        opacity: 0.6;
    }

    .todo-items li.completed span {
        text-decoration: line-through;
    }

    .todo-items input[type="checkbox"] {
        margin-top: 2px;
        cursor: default;
    }

    .empty-state {
        padding: 12px 4px;
        font-size: 13px;
        color: var(--text-secondary, #aaa);
    }

    .file-change-summary {
        margin-top: 12px;
        padding: 10px 12px;
        border-radius: 8px;
        border: 1px solid var(--border-color, #444);
        background: var(--bg-secondary, #111827);
    }

    .summary-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        margin-bottom: 6px;
    }

    .summary-title {
        font-size: 13px;
        font-weight: 500;
        color: var(--text-primary, #e5e7eb);
        display: flex;
        align-items: center;
        gap: 8px;
    }

    .summary-counts {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        font-size: 12px;
    }

    .summary-add {
        color: #22c55e;
    }

    .summary-del {
        color: #f97373;
    }

    .summary-actions {
        display: flex;
        align-items: center;
        gap: 6px;
        flex-shrink: 0;
    }

    .summary-diff-button {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 4px 8px;
        border-radius: 6px;
        border: 1px solid var(--border-color, #444);
        background: transparent;
        color: var(--text-secondary, #9ca3af);
        font-size: 11px;
        cursor: pointer;
        transition: all 0.15s ease;
    }

    .summary-diff-button:hover {
        background: var(--bg-hover, #1f2937);
        border-color: var(--accent-color, #38bdf8);
        color: var(--text-primary, #e5e7eb);
    }

    .summary-diff-label {
        white-space: nowrap;
    }
</style>
