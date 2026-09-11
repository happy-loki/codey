<script lang="ts">
    import { getContext } from "svelte";
    import { readable } from "svelte/store";
    import {
        SUBAGENT_INFO, subagentStatusLabel, subagentHistoryLabel,
        type SubagentInfo, type SubagentInfoSource,
    } from "./subagentInfo";

    export let threadId: string;
    export let agentPath: string | null = null;
    export let model: string | null = null;
    export let effort: string | null = null;
    export let status: string | null = null;

    const source = getContext<SubagentInfoSource | undefined>(SUBAGENT_INFO);
    const infoStore = source?.store ?? readable<Record<string, SubagentInfo>>({});
    $: if (threadId) void source?.load(threadId);
    $: info = $infoStore[threadId] ?? {};
    $: path = agentPath || info.agentPath || "";
    $: parentPath = path.slice(0, path.lastIndexOf("/"));
    $: currentStatus = info.status || status;
    $: statusTone = ["running", "active", "inProgress", "pendingInit"].includes(currentStatus ?? "")
        ? "active" : currentStatus === "completed" ? "complete"
        : ["failed", "errored", "systemError"].includes(currentStatus ?? "") ? "error" : "neutral";
    $: groups = [
        { id: "identity", fields: [
            { label: "名称", value: !agentPath ? info.agentPath?.split("/").filter(Boolean).pop() : null },
            { label: "昵称", value: info.nickname },
            { label: "角色", value: info.role },
            { label: "当前状态", value: subagentStatusLabel(currentStatus), badge: true },
        ] },
        { id: "settings", fields: [
            { label: "模型", value: info.model || model, emphasis: true },
            { label: "思考强度", value: info.effort ?? effort },
            { label: "历史继承", value: subagentHistoryLabel(info.forkTurns) },
        ] },
        { id: "context", fields: [
            { label: "工作目录", value: info.cwd, wide: true },
            { label: "父级", value: parentPath === "/root" ? "主 Agent" : parentPath },
            { label: "创建时间", value: info.createdAt
                ? new Date(info.createdAt * 1000).toLocaleString(undefined, { hour12: false }) : null },
        ] },
    ].map((group) => ({ ...group, fields: group.fields.filter((field) => field.value) }))
        .filter((group) => group.fields.length);
</script>

{#if groups.length}
    <div class="subagent-metadata" role="group" aria-label="子 Agent 信息">
        {#each groups as group (group.id)}
            <dl class="metadata-group {group.id}">
                {#each group.fields as field (field.label)}
                    <div class="metadata-field" class:wide={"wide" in field && field.wide}>
                        <dt>{field.label}</dt>
                        <dd
                            class:emphasis={"emphasis" in field && field.emphasis}
                            class:status-badge={"badge" in field && field.badge}
                            data-tone={"badge" in field && field.badge ? statusTone : undefined}
                            title={field.value}
                        >{field.value}</dd>
                    </div>
                {/each}
            </dl>
        {/each}
    </div>
{/if}

<style>
    .subagent-metadata {
        margin: 3px 10px 8px;
        padding: 9px 11px;
        border: 1px solid var(--border-color, rgba(128, 128, 128, 0.2));
        border-radius: 8px;
        background: var(--background-secondary, rgba(128, 128, 128, 0.05));
        font-size: 12px;
        line-height: 1.5;
        min-width: 0;
    }
    .metadata-group {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 5px 18px;
        margin: 0;
    }
    .metadata-group + .metadata-group { margin-top: 7px; }
    .metadata-group.context {
        padding-top: 7px;
        border-top: 1px solid var(--border-color, rgba(128, 128, 128, 0.15));
        font-size: 11px;
    }
    .metadata-group.context:first-child { padding-top: 0; border-top: 0; }
    .metadata-field { display: flex; align-items: baseline; gap: 6px; min-width: 0; max-width: 100%; }
    .metadata-field.wide { flex-basis: 100%; }
    dt { flex-shrink: 0; color: var(--text-secondary, #888); font-size: 11px; }
    dd { min-width: 0; margin: 0; color: var(--text-primary, inherit); overflow-wrap: anywhere; user-select: text; }
    .emphasis { font-weight: 600; }
    .wide dd { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .context dd { color: var(--text-secondary, #888); }
    .status-badge { display: inline-flex; align-items: center; gap: 5px; font-size: 11px; }
    .status-badge::before { content: ""; width: 5px; height: 5px; border-radius: 50%; background: currentColor; flex-shrink: 0; }
    .status-badge[data-tone="active"] { color: var(--accent-color, #0d9488); }
    .status-badge[data-tone="complete"] { color: var(--success-color, #16a34a); }
    .status-badge[data-tone="error"] { color: var(--error-color, #dc2626); }
</style>
