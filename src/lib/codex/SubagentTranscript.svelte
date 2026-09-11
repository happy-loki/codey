<script lang="ts">
    import MarkdownRenderer from "./MarkdownRenderer.svelte";
    import type { Turn, ThreadItem } from "./types";

    export let turns: Turn[] = [];

    type Row = { role: "user" | "assistant" | "tool"; text: string; label?: string };
    $: rows = turns.flatMap((turn) => turn.items ?? []).flatMap((item: ThreadItem): Row[] => {
        if (item.type === "userMessage") {
            const text = (item.content ?? []).map((part: any) => part.text ?? "").join("\n").trim();
            return text ? [{ role: "user", text }] : [];
        }
        if (item.type === "agentMessage") return item.text?.trim() ? [{ role: "assistant", text: item.text }] : [];
        if (item.type === "commandExecution") return [{ role: "tool", label: "Run command", text: item.command ?? "" }];
        if (item.type === "fileChange") return [{ role: "tool", label: "File change", text: "Changes applied" }];
        if (item.type === "mcpToolCall") return [{ role: "tool", label: item.tool ?? "Tool call", text: "" }];
        if (item.type === "collabAgentToolCall") return [{ role: "tool", label: item.tool, text: item.prompt ?? "" }];
        return [];
    });
</script>

<div class="subagent-transcript">
    {#if rows.length === 0}
        <p class="empty">子 Agent 暂时还没有可展示的消息喵～</p>
    {:else}
        {#each rows as row, index (index)}
            <article class:tool-row={row.role === "tool"} class="transcript-row">
                <div class="row-role">{row.role === "user" ? "你" : row.role === "assistant" ? "子 Agent" : row.label}</div>
                {#if row.role === "tool"}
                    <details>
                        <summary>{row.label}</summary>
                        {#if row.text}<pre>{row.text}</pre>{/if}
                    </details>
                {:else}
                    <MarkdownRenderer content={row.text} />
                {/if}
            </article>
        {/each}
    {/if}
</div>

<style>
    .subagent-transcript {
        display: grid;
        gap: 14px;
        min-width: 0;
        max-width: 100%;
        overflow-x: hidden;
        padding: 16px 18px 28px;
        box-sizing: border-box;
    }
    .transcript-row {
        min-width: 0;
        max-width: 100%;
        overflow-wrap: anywhere;
        word-break: break-word;
        color: var(--text-primary, #0f172a);
        font-size: 13px;
        line-height: 1.55;
    }
    .row-role { margin-bottom: 4px; color: var(--text-secondary, #64748b); font-size: 11px; font-weight: 600; }
    .tool-row { padding: 8px 10px; border: 1px solid var(--border-color, #e5e7eb); border-radius: 8px; background: var(--background-secondary, #f8fafc); }
    summary { cursor: pointer; color: var(--text-secondary, #475569); }
    pre {
        max-width: 100%;
        max-height: 180px;
        overflow-x: hidden;
        overflow-y: auto;
        margin: 8px 0 0;
        white-space: pre-wrap;
        overflow-wrap: anywhere;
        word-break: break-word;
        font-size: 11px;
    }
    :global(.subagent-transcript .markdown-content) {
        min-width: 0;
        max-width: 100%;
        overflow-wrap: anywhere;
        word-break: break-word;
    }
    :global(.subagent-transcript .markdown-content p),
    :global(.subagent-transcript .markdown-content li),
    :global(.subagent-transcript .markdown-content blockquote),
    :global(.subagent-transcript .markdown-content h1),
    :global(.subagent-transcript .markdown-content h2),
    :global(.subagent-transcript .markdown-content h3),
    :global(.subagent-transcript .markdown-content h4),
    :global(.subagent-transcript .markdown-content h5),
    :global(.subagent-transcript .markdown-content h6) {
        max-width: 100%;
        overflow-wrap: anywhere;
        word-break: break-word;
    }
    :global(.subagent-transcript .markdown-content pre),
    :global(.subagent-transcript .markdown-content table) {
        max-width: 100%;
        overflow-x: hidden;
        white-space: pre-wrap;
        table-layout: fixed;
        width: 100%;
        word-break: break-word;
    }
    :global(.subagent-transcript .markdown-content img),
    :global(.subagent-transcript .markdown-content video),
    :global(.subagent-transcript .markdown-content audio) {
        max-width: 100%;
    }
    .empty { margin: 0; color: var(--text-secondary, #64748b); font-size: 13px; }
</style>
