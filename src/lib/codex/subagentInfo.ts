import { get, writable } from "svelte/store";
import type { Thread, ThreadReadResponse, ThreadSettings, ThreadStatus } from "./types";

export const SUBAGENT_INFO = Symbol("subagent-info");

export type SubagentInfo = {
    nickname?: string | null;
    role?: string | null;
    agentPath?: string | null;
    cwd?: string;
    createdAt?: number;
    model?: string;
    effort?: string | null;
    forkTurns?: string;
    status?: string;
};

export function readableSubagentTask(value: string | null | undefined): string {
    const text = value?.trim() ?? "";
    // MultiAgentV2 may put an encrypted payload in the legacy string field.
    return /^gAAAA[A-Za-z0-9_-]+={0,2}$/.test(text) ? "" : text;
}

export function subagentStatusLabel(status: string | null | undefined): string {
    return ({
        pendingInit: "正在创建", running: "执行中", active: "执行中", inProgress: "执行中",
        completed: "已完成", interrupted: "已中断", failed: "失败", errored: "失败",
        systemError: "异常", idle: "空闲", shutdown: "已关闭", notFound: "不可用",
    } as Record<string, string>)[status ?? ""] ?? "";
}

export function createSubagentInfoSource(
    readThread: (threadId: string) => Promise<SubagentMetadataResponse>
) {
    const store = writable<Record<string, SubagentInfo>>({});
    const attempted = new Set<string>();
    const pending = new Map<string, Promise<void>>();
    let generation = 0;

    function patch(threadId: string, info: SubagentInfo) {
        store.update((all) => ({ ...all, [threadId]: { ...all[threadId], ...info } }));
    }

    function fromThread(thread: Thread): SubagentInfo {
        const source = thread.source && typeof thread.source === "object" && "subAgent" in thread.source
            ? thread.source.subAgent : null;
        const spawn = source && typeof source === "object" && "thread_spawn" in source
            ? source.thread_spawn : null;
        const turnStatus = thread.turns?.at(-1)?.status;
        const runtimeStatus = thread.status?.type;
        const status = runtimeStatus === "active" || runtimeStatus === "systemError"
            ? runtimeStatus : turnStatus ?? (runtimeStatus === "idle" ? "idle" : undefined);
        return {
            nickname: thread.agentNickname ?? spawn?.agent_nickname,
            role: thread.agentRole ?? spawn?.agent_role,
            agentPath: spawn?.agent_path,
            cwd: thread.cwd,
            createdAt: thread.createdAt,
            ...(status ? { status } : {}),
        };
    }

    function load(threadId: string): Promise<void> {
        const existing = pending.get(threadId);
        if (existing) return existing;
        if (!threadId || attempted.has(threadId)) return Promise.resolve();
        attempted.add(threadId);
        patch(threadId, {});
        const version = generation;
        const request = (async () => {
            try {
                const result = await readThread(threadId);
                if (version !== generation || result.thread.id !== threadId) return;
                // Notifications may arrive while this initial read is pending.
                store.update((all) => ({
                    ...all,
                    [threadId]: { ...fromThread(result.thread), ...result.metadata, ...all[threadId] },
                }));
            } catch {
                // Creation can precede persistence. A completion event or opening
                // the drawer may retry missing fields without background polling.
            }
        })().finally(() => {
            if (version === generation) pending.delete(threadId);
        });
        pending.set(threadId, request);
        return request;
    }

    return {
        store,
        has: (threadId: string) => Boolean(get(store)[threadId]),
        load,
        async refreshMissing(threadId: string) {
            if (!get(store)[threadId]) return;
            const version = generation;
            // Completion can race the initial read. Wait for it before deciding
            // whether a new snapshot is needed; simultaneous refreshes share load().
            await pending.get(threadId);
            if (version !== generation) return;
            const info = get(store)[threadId];
            if (!info || (info.model && info.effort !== undefined && info.forkTurns)) return;
            attempted.delete(threadId);
            await load(threadId);
        },
        remember(thread: Thread) {
            if (thread?.id) patch(thread.id, fromThread(thread));
        },
        rememberSettings(threadId: string, settings: ThreadSettings) {
            patch(threadId, { model: settings.model, effort: settings.effort, cwd: settings.cwd });
        },
        rememberStatus(threadId: string, status: ThreadStatus["type"] | string) {
            // The runtime becomes idle after a completed/failed/interrupted turn.
            // Keep that outcome visible until another turn actually starts.
            if (status === "idle" && ["completed", "failed", "interrupted"].includes(get(store)[threadId]?.status ?? "")) return;
            if (subagentStatusLabel(status)) patch(threadId, { status });
        },
        reset() {
            generation += 1;
            attempted.clear();
            pending.clear();
            store.set({});
        },
    };
}

export type SubagentInfoSource = ReturnType<typeof createSubagentInfoSource>;

// Codey's read-only local metadata supplement; not an app-server protocol field.
export type SubagentMetadataResponse = ThreadReadResponse & {
    metadata?: Pick<SubagentInfo, "model" | "effort" | "forkTurns">;
};

export function subagentHistoryLabel(forkTurns: string | undefined): string {
    if (forkTurns === "all") return "完整上下文";
    if (forkTurns === "none") return "不继承历史";
    if (forkTurns && /^[1-9]\d*$/.test(forkTurns)) return `最近 ${forkTurns} 轮`;
    return "";
}
