<script lang="ts">
    import { createEventDispatcher } from "svelte";
    import { createVirtualizer } from "@tanstack/svelte-virtual";
    import type { VirtualItem } from "@tanstack/svelte-virtual";
    import { t } from "../i18n";
    import { Lock } from "lucide-svelte";

    export let threads: Array<{
        id: string;
        title: string;
        created_at: string;
        updated_at: string;
        cwd: string;
    }> = [];
    export let currentWorkspace: string | null = null;
    export let scope: "project" | "all" = "project";
    export let hasMore: boolean = false;
    export let isLoading: boolean = false;
    export let loadError: string | null = null;

    const dispatch = createEventDispatcher();

    function normalizePath(path: string | null | undefined): string | null {
        if (!path) return null;
        let normalized = path.trim().replace(/[\r\n]+/g, "");
        if (normalized.startsWith("\\\\?\\UNC\\")) {
            normalized = "\\\\" + normalized.slice("\\\\?\\UNC\\".length);
        } else if (normalized.startsWith("\\\\?\\")) {
            normalized = normalized.slice("\\\\?\\".length);
        }
        normalized = normalized.replace(/\\/g, "/").toLowerCase();
        if (/^[a-z]:\/$/i.test(normalized)) return normalized;
        return normalized.replace(/\/+$/g, "");
    }

    function isForeignThread(threadCwd: string): boolean {
        if (!currentWorkspace) return false;
        const normalizedWorkspace = normalizePath(currentWorkspace);
        const normalizedThread = normalizePath(threadCwd);
        if (!normalizedWorkspace || !normalizedThread) return false;
        return normalizedWorkspace !== normalizedThread;
    }

    function selectThread(thread: (typeof threads)[number]) {
        if (!thread) return;
        const isForeign = isForeignThread(thread.cwd);
        dispatch(isForeign ? "foreignSelect" : "select", {
            threadId: thread.id,
            cwd: thread.cwd,
        });
    }

    function archiveThread(event: MouseEvent, thread: (typeof threads)[number]) {
        event.stopPropagation();
        if (!thread) return;
        dispatch("archive", { threadId: thread.id });
    }

    function renameThread(event: MouseEvent, thread: (typeof threads)[number]) {
        event.stopPropagation();
        if (!thread) return;
        dispatch("rename", { threadId: thread.id, title: thread.title || "" });
    }

    function handleThreadKeydown(event: KeyboardEvent, thread: (typeof threads)[number]) {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        selectThread(thread);
    }

    function lockClickNoop(event: MouseEvent) {
        event.stopPropagation();
    }

    function setScope(next: "project" | "all") {
        if (next === scope) return;
        dispatch("scopeChange", { scope: next });
    }

    function formatDate(dateString: string) {
        const date = new Date(dateString);
        const now = new Date();
        const diffMs = now.getTime() - date.getTime();
        const diffMinutes = Math.floor(diffMs / (1000 * 60));
        const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
        const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

        if (diffMinutes < 60) {
            if (diffMinutes < 1) return "刚刚";
            return `${diffMinutes} 分钟前`;
        }

        if (diffHours < 24) {
            return `${diffHours} 小时前`;
        }

        if (diffDays < 7) {
            return `${diffDays} 天前`;
        }

        const currentYear = now.getFullYear();
        const dateYear = date.getFullYear();
        if (currentYear === dateYear) {
            const month = String(date.getMonth() + 1).padStart(2, "0");
            const day = String(date.getDate()).padStart(2, "0");
            const hours = String(date.getHours()).padStart(2, "0");
            const minutes = String(date.getMinutes()).padStart(2, "0");
            return `${month}-${day} ${hours}:${minutes}`;
        }

        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, "0");
        const day = String(date.getDate()).padStart(2, "0");
        return `${year}-${month}-${day}`;
    }

    let parentElement: HTMLDivElement;
    const rowVirtualizer = createVirtualizer<HTMLDivElement, HTMLDivElement>({
        count: 0,
        getScrollElement: () => parentElement,
        estimateSize: () => 88,
        overscan: 5,
    });

    let virtualItems: VirtualItem[] = [];
    let totalSize = 0;
    let lastVirtualIndex = -1;
    let loadMoreRequested = false;
    let lastThreadCount = 0;

    $: {
        $rowVirtualizer.setOptions({
            count: threads.length + (hasMore ? 1 : 0),
        });
        virtualItems = $rowVirtualizer.getVirtualItems();
        totalSize = $rowVirtualizer.getTotalSize();
    }

    $: {
        const items = virtualItems;
        lastVirtualIndex = items.length ? items[items.length - 1].index : -1;
    }

    $: if (threads.length !== lastThreadCount) {
        lastThreadCount = threads.length;
        loadMoreRequested = false;
    }

    $: if (hasMore && !isLoading && !loadMoreRequested && lastVirtualIndex >= threads.length) {
        loadMoreRequested = true;
        dispatch("loadMore");
    }
</script>

<div class="thread-list">
    <div class="thread-list-header">
        <div class="scope-tabs" role="tablist" aria-label="Thread scope">
            <button
                type="button"
                class="scope-tab"
                class:active={scope === "project"}
                role="tab"
                aria-selected={scope === "project"}
                title={$t("codex.threads.scopeProjectTip")}
                on:click={() => setScope("project")}
            >
                <span class="scope-tab-label">{$t("codex.threads.scopeProject")}</span>
            </button>
            <button
                type="button"
                class="scope-tab"
                class:active={scope === "all"}
                role="tab"
                aria-selected={scope === "all"}
                title={$t("codex.threads.scopeAllTip")}
                on:click={() => setScope("all")}
            >
                <span class="scope-tab-label">{$t("codex.threads.scopeAll")}</span>
            </button>
        </div>
    </div>
    <div class="thread-list-scroll" bind:this={parentElement}>
        {#if threads.length === 0}
            <div class="empty">
                {#if loadError}
                    {$t("codex.threads.loadFailed")}
                {:else if isLoading}
                    {#if scope === "project"}
                        {$t("codex.threads.loadingProject")}
                    {:else}
                        {$t("codex.threads.loading")}
                    {/if}
                {:else}
                    {$t("codex.threads.empty")}
                {/if}
            </div>
        {:else}
            <div
                class="virtual-list-outer"
                style={`height: ${totalSize}px; position: relative; width: 100%;`}
            >
                {#each virtualItems as item (item.key)}
                    {#if item.index < threads.length}
                        {@const thread = threads[item.index]}
                        {#key thread.id}
                            <div
                                class="thread-item-wrapper"
                                style={`position: absolute; top: ${item.start}px; height: ${item.size}px; width: 100%;`}
                            >
                                <div
                                    class="thread-item"
                                    class:foreign={isForeignThread(thread.cwd)}
                                    role="button"
                                    tabindex="0"
                                    on:click={() => selectThread(thread)}
                                    on:keydown={(event) => handleThreadKeydown(event, thread)}
                                >
                                    <div class="thread-title" title={thread.title || "Untitled Thread"}>
                                        {thread.title || "Untitled Thread"}
                                    </div>
                                    <div class="thread-meta">
                                        <span class="thread-date">
                                            {formatDate(thread.updated_at)}
                                        </span>
                                    </div>
                                </div>
                                <div class="thread-actions">
                                    {#if isForeignThread(thread.cwd)}
                                        <button
                                            class="lock-btn"
                                            on:click={lockClickNoop}
                                            title={$t("codex.threads.otherWorkspaceTitle")}
                                            aria-label={$t("codex.threads.otherWorkspaceTitle")}
                                        >
                                            <Lock size={16} />
                                        </button>
                                    {/if}
                                    <button
                                        class="thread-action-btn rename-btn"
                                        on:click={(event) => renameThread(event, thread)}
                                        title={$t("codex.threads.renameTitle")}
                                    >
                                        {$t("codex.threads.renameAction")}
                                    </button>
                                    <button
                                        class="thread-action-btn archive-btn"
                                        on:click={(event) => archiveThread(event, thread)}
                                        title={$t("codex.threads.archiveTitle")}
                                    >
                                        {$t("codex.threads.archiveAction")}
                                    </button>
                                </div>
                            </div>
                        {/key}
                    {:else}
                        <div
                            class="thread-item-wrapper loader-wrapper"
                            style={`position: absolute; top: ${item.start}px; height: ${item.size}px; width: 100%;`}
                        >
                            <div class="loader-row">
                                {#if isLoading}
                                    <span>
                                        {#if scope === "project"}
                                            {$t("codex.threads.loadingProject")}
                                        {:else}
                                            {$t("codex.threads.loading")}
                                        {/if}
                                    </span>
                                {:else if hasMore}
                                    <span>Loading more...</span>
                                {/if}
                            </div>
                        </div>
                    {/if}
                {/each}
            </div>
        {/if}
    </div>
</div>

<style>
    .thread-list {
        flex: 1;
        display: flex;
        flex-direction: column;
        overflow: hidden;
        padding: 8px;
    }

    .thread-list-header {
        flex: 0 0 auto;
        padding: 6px 4px 10px;
        background: var(--bg-primary, #1e1e1e);
        border-bottom: 1px solid rgba(255, 255, 255, 0.06);
        margin-bottom: 6px;
    }

    :global(html[data-theme="light"]) .thread-list-header {
        background: #ffffff;
        border-bottom-color: rgba(15, 23, 42, 0.08);
    }

    .scope-tabs {
        width: 100%;
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 4px;
        padding: 4px;
        border-radius: 999px;
        border: 1px solid rgba(255, 255, 255, 0.08);
        background: rgba(255, 255, 255, 0.03);
    }

    :global(html[data-theme="light"]) .scope-tabs {
        border-color: rgba(15, 23, 42, 0.12);
        background: rgba(15, 23, 42, 0.03);
    }

    .scope-tab {
        border: none;
        border-radius: 999px;
        padding: 8px 10px;
        cursor: pointer;
        background: transparent;
        color: var(--text-secondary, rgba(255, 255, 255, 0.7));
        font-size: 12px;
        font-weight: 700;
        letter-spacing: 0.02em;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        white-space: nowrap;
        transition:
            background 0.15s ease,
            color 0.15s ease,
            transform 0.12s ease;
    }

    .scope-tab-label {
        flex: 0 0 auto;
    }

    .scope-tab:hover {
        background: rgba(255, 255, 255, 0.06);
        color: var(--text-primary, rgba(255, 255, 255, 0.92));
    }

    .scope-tab.active {
        background: rgba(14, 165, 233, 0.16);
        color: var(--text-primary, rgba(255, 255, 255, 0.95));
    }

    :global(html[data-theme="light"]) .scope-tab {
        color: rgba(15, 23, 42, 0.68);
    }

    :global(html[data-theme="light"]) .scope-tab:hover {
        background: rgba(15, 23, 42, 0.06);
        color: #0f172a;
    }

    :global(html[data-theme="light"]) .scope-tab.active {
        background: rgba(43, 111, 232, 0.14);
        color: #0f172a;
    }

    .thread-list-scroll {
        flex: 1 1 auto;
        overflow-y: auto;
    }

    .empty {
        display: flex;
        align-items: center;
        justify-content: center;
        height: 100%;
        color: var(--text-secondary, #aaa);
    }

    .thread-item-wrapper {
        position: relative;
        box-sizing: border-box;
        padding-bottom: 8px;
    }

    .thread-item {
        width: 100%;
        min-height: 80px;
        padding: 12px 156px 12px 14px;
        background: var(--bg-secondary, #252525);
        border: 1px solid var(--border-color, #333);
        border-radius: 10px;
        cursor: pointer;
        transition:
            background 0.18s ease,
            border-color 0.18s ease;
        text-align: left;
        color: inherit;
        display: flex;
        flex-direction: column;
        justify-content: center;
        box-sizing: border-box;
    }

    .thread-item:hover {
        background: color-mix(in srgb, var(--bg-secondary, #252525) 86%, white 14%);
        border-color: rgba(59, 130, 246, 0.55);
    }

    .thread-item.foreign {
        background: rgba(255, 255, 255, 0.03);
        border-style: dashed;
        opacity: 0.9;
        cursor: default;
    }

    .thread-item.foreign:hover {
        background: rgba(255, 255, 255, 0.04);
        border-color: var(--border-color, #333);
    }

    .thread-actions {
        position: absolute;
        right: 8px;
        top: 50%;
        transform: translateY(-50%);
        display: flex;
        align-items: center;
        gap: 10px;
    }

    .thread-action-btn {
        min-width: 42px;
        padding: 5px 10px;
        background: transparent;
        border: 1px solid var(--border-color, #333);
        border-radius: 999px;
        color: var(--text-secondary, #aaa);
        cursor: pointer;
        transition: all 0.15s;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        font-size: 12px;
        font-weight: 600;
        line-height: 1;
    }

    .thread-action-btn:hover {
        background: var(--bg-hover, #2a2a2a);
        color: var(--accent-color, #007acc);
        border-color: var(--accent-color, #007acc);
    }

    .rename-btn {
        min-width: 42px;
    }

    .archive-btn {
        min-width: 42px;
    }

    .lock-btn {
        flex: 0 0 auto;
        padding: 6px;
        border: none;
        border-radius: 8px;
        background: rgba(255, 196, 0, 0.12);
        color: #ffc400;
        cursor: default;
        transition: all 0.15s;
        display: flex;
        align-items: center;
        justify-content: center;
    }

    :global(html[data-theme="light"]) .lock-btn {
        background: rgba(255, 196, 0, 0.18);
        color: #b45309;
    }

    .thread-title {
        font-weight: 550;
        color: var(--text-primary, #fff);
        margin-bottom: 6px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        padding-right: 8px;
        font-size: 14px;
        line-height: 1.3;
        max-width: 100%;
    }

    .thread-meta {
        display: flex;
        justify-content: space-between;
        font-size: 12px;
        color: var(--text-secondary, #94a3b8);
        padding-right: 8px;
    }

    .virtual-list-outer {
        position: relative;
        width: 100%;
    }

    .loader-wrapper {
        display: flex;
        align-items: center;
    }

    .loader-row {
        width: 100%;
        text-align: center;
        font-size: 12px;
        color: var(--text-secondary, #aaa);
    }
</style>
