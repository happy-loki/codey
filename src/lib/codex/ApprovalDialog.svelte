<script lang="ts">
    import type {
        ApprovalDecision,
        CommandExecutionRequestApprovalParams,
        FileChangeRequestApprovalParams,
        FileSystemPath,
        PermissionsRequestApprovalParams,
        RequestPermissionProfile,
        ThreadItem,
    } from "./types";
    import FileDiffViewer from "./FileDiffViewer.svelte";

    export let params:
        | CommandExecutionRequestApprovalParams
        | FileChangeRequestApprovalParams
        | PermissionsRequestApprovalParams;
    export let requestId: string;
    export let type: "command" | "fileChange" | "permissions";
    export let item: ThreadItem | null | undefined = null;
    export let onResponse: (decision: ApprovalDecision, forSession: boolean) => void;

    $: isCommand = type === "command";
    $: isPermissions = type === "permissions";
    $: commandParams = isCommand ? (params as CommandExecutionRequestApprovalParams) : null;
    $: fileParams = type === "fileChange" ? (params as FileChangeRequestApprovalParams) : null;
    $: permissionParams = isPermissions ? (params as PermissionsRequestApprovalParams) : null;
    $: fileChangeItem = item && item.type === "fileChange" ? item : null;
    $: commandItem = item && item.type === "commandExecution" ? item : null;
    $: changes = fileChangeItem?.changes || [];
    $: headingText = isCommand
        ? "Run this command?"
        : isPermissions
          ? "Allow additional permissions?"
          : "Apply these changes?";
    $: expandByDefault = changes.length <= 2;

    type PermissionRow = { label: string; values: string[] };

    function formatPermissionPath(path: FileSystemPath): string {
        if (path.type === "path") return path.path;
        if (path.type === "glob_pattern") return path.pattern;

        const special = path.value;
        if (special.kind === "project_roots") {
            return special.subpath ? `project roots/${special.subpath}` : "project roots";
        }
        if (special.kind === "unknown") {
            return special.subpath ? `${special.path}/${special.subpath}` : special.path;
        }
        return special.kind.replace(/_/g, " ");
    }

    function buildPermissionRows(
        permissions: RequestPermissionProfile | null | undefined
    ): PermissionRow[] {
        if (!permissions) return [];
        const rows: PermissionRow[] = [];

        if (permissions.network) {
            rows.push({
                label: "Network",
                values: [permissions.network.enabled === false ? "not enabled" : "enabled"],
            });
        }

        const fileSystem = permissions.fileSystem;
        if (!fileSystem) return rows;

        const entries = Array.isArray(fileSystem.entries) ? fileSystem.entries : [];
        if (entries.length > 0) {
            const grouped = new Map<string, string[]>();
            for (const entry of entries) {
                const label =
                    entry.access === "write"
                        ? "Filesystem write"
                        : entry.access === "deny"
                          ? "Filesystem deny"
                          : "Filesystem read";
                const values = grouped.get(label) ?? [];
                values.push(formatPermissionPath(entry.path));
                grouped.set(label, values);
            }
            for (const [label, values] of grouped) rows.push({ label, values });
        } else {
            if (fileSystem.read?.length) {
                rows.push({ label: "Filesystem read", values: [...fileSystem.read] });
            }
            if (fileSystem.write?.length) {
                rows.push({ label: "Filesystem write", values: [...fileSystem.write] });
            }
        }

        if (fileSystem.globScanMaxDepth != null) {
            rows.push({
                label: "Glob scan depth",
                values: [String(fileSystem.globScanMaxDepth)],
            });
        }
        return rows;
    }

    $: permissionRows = buildPermissionRows(permissionParams?.permissions);

    function getLegacyRisk(value: unknown): { riskLevel?: string; description?: string } | null {
        if (!value || typeof value !== "object") return null;
        const risk = (value as { risk?: unknown }).risk;
        return risk && typeof risk === "object"
            ? (risk as { riskLevel?: string; description?: string })
            : null;
    }

    function handleApprove(forSession: boolean) {
        onResponse("accept", forSession);
    }

    function handleDecline() {
        onResponse("decline", false);
    }
</script>

<div class="approval-sheet" data-request-id={requestId}>
    <div class="sheet-header">
    <div class="sheet-heading">
        <p class="sheet-title">{headingText}</p>
    </div>
        <div class="sheet-actions">
            <button type="button" class="btn primary" on:click={() => handleApprove(false)}>Allow once</button>
            {#if isCommand || isPermissions}
                <button type="button" class="btn outline" on:click={() => handleApprove(true)}>Allow this session</button>
            {/if}
            <button type="button" class="btn ghost" on:click={handleDecline}>Reject</button>
        </div>
    </div>

    <div class="sheet-body">
        {#if isCommand && commandParams}
            <div class="meta-grid">
                {#if commandItem?.command}
                    <div class="meta-card">
                        <span class="meta-label">Command</span>
                        <code class="meta-value">{commandItem.command}</code>
                    </div>
                {/if}
                {#if commandItem?.cwd}
                    <div class="meta-card">
                        <span class="meta-label">Working dir</span>
                        <code class="meta-value">{commandItem.cwd}</code>
                    </div>
                {/if}
            </div>
            <!-- `risk` belonged to an older approval payload. Keep rendering it
                 when an older CLI sends it without requiring it in the new schema. -->
            {@const risk = getLegacyRisk(commandParams)}
            {#if risk}
                <div class={`risk-banner risk-${risk.riskLevel ?? "unknown"}`}>
                    <span class="risk-level">Risk: {risk.riskLevel ?? "unknown"}</span>
                    <span class="risk-copy">{risk.description ?? ""}</span>
                </div>
            {/if}
        {:else if isPermissions && permissionParams}
            <div class="meta-grid">
                {#if permissionParams.reason}
                    <div class="meta-card">
                        <span class="meta-label">Reason</span>
                        <span class="meta-value meta-value-wrap">{permissionParams.reason}</span>
                    </div>
                {/if}
                {#if permissionParams.cwd}
                    <div class="meta-card">
                        <span class="meta-label">Working dir</span>
                        <code class="meta-value">{permissionParams.cwd}</code>
                    </div>
                {/if}
                {#if permissionParams.environmentId}
                    <div class="meta-card">
                        <span class="meta-label">Environment</span>
                        <code class="meta-value">{permissionParams.environmentId}</code>
                    </div>
                {/if}
            </div>
            {#if permissionRows.length > 0}
                <div class="permission-list">
                    {#each permissionRows as row (row.label)}
                        <div class="permission-row">
                            <span class="permission-label">{row.label}</span>
                            <div class="permission-values">
                                {#each row.values as value (value)}
                                    <code class="permission-value">{value}</code>
                                {/each}
                            </div>
                        </div>
                    {/each}
                </div>
            {:else}
                <div class="permission-empty">No additional permissions requested.</div>
            {/if}
        {:else if fileParams}
            {#if fileParams.grantRoot}
                <div class="grant-root">
                    <span class="grant-eyebrow">Needs write access</span>
                    <code>{fileParams.grantRoot}</code>
                </div>
            {/if}

            {#if changes.length > 0}
                {#each changes as change, index (change.path + ":" + index)}
                    <FileDiffViewer
                        {change}
                        defaultExpanded={false}
                        tone="overlay"
                        topGap={index === 0 ? 0 : 12}
                        renderer="pierre"
                    />
                {/each}
            {/if}
        {/if}
    </div>
</div>

<style>
    .approval-sheet {
        --sheet-surface: rgba(16, 18, 22, 0.92);
        --sheet-border: rgba(255, 255, 255, 0.08);
        background: var(--sheet-surface);
        border: 1px solid var(--sheet-border);
        border-radius: 8px;
        padding: 10px 12px;
        box-shadow: 0 12px 30px rgba(0, 0, 0, 0.35);
        animation: sheet-slide-up 0.15s ease;
    }

    :global(html[data-theme="light"]) .approval-sheet {
        --sheet-surface: rgba(251, 252, 255, 0.98);
        --sheet-border: rgba(15, 23, 42, 0.12);
        box-shadow: 0 6px 20px rgba(15, 23, 42, 0.08);
    }

    @keyframes sheet-slide-up {
        from {
            opacity: 0;
            transform: translateY(16px);
        }
        to {
            opacity: 1;
            transform: translateY(0);
        }
    }

    .sheet-header {
        display: flex;
        gap: 4px;
        flex-wrap: wrap;
        justify-content: space-between;
        align-items: center;
        padding-bottom: 6px;
        border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    }

    :global(html[data-theme="light"]) .sheet-header {
        border-bottom-color: rgba(15, 23, 42, 0.08);
    }

    .sheet-heading {
        flex: 1;
        min-width: 240px;
    }

    .sheet-title {
        margin: 0;
        font-size: 13px;
        font-weight: 600;
        color: var(--text-primary, #f5f5f5);
        line-height: 1.2;
    }

    :global(html[data-theme="light"]) .sheet-title {
        color: #0f172a;
    }

    .sheet-actions {
        display: flex;
        gap: 6px;
        flex-wrap: nowrap;
    }

    .btn {
        border-radius: 6px;
        padding: 4px 12px;
        font-size: 11px;
        font-weight: 500;
        border: 1px solid transparent;
        cursor: pointer;
        transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease;
    }

    .btn.primary {
        background: #0ea5e9;
        color: #ffffff;
        border-color: transparent;
    }

    .btn.primary:hover {
        background: #0284c7;
    }

    .btn.outline {
        background: transparent;
        border-color: rgba(14, 165, 233, 0.5);
        color: #7dd3fc;
    }

    :global(html[data-theme="light"]) .btn.outline {
        color: #0c4a6e;
        border-color: rgba(14, 165, 233, 0.5);
    }

    .btn.outline:hover {
        background: rgba(14, 165, 233, 0.12);
    }

    .btn.ghost {
        background: transparent;
        color: var(--text-secondary, rgba(255, 255, 255, 0.72));
        border-color: rgba(255, 255, 255, 0.12);
    }

    .btn.ghost:hover {
        color: var(--text-primary, #ffffff);
        border-color: rgba(255, 255, 255, 0.25);
    }

    :global(html[data-theme="light"]) .btn.ghost {
        color: #475569;
        border-color: rgba(15, 23, 42, 0.15);
    }

    .sheet-body {
        margin-top: 6px;
        display: flex;
        flex-direction: column;
        gap: 6px;
    }

    .meta-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
        gap: 6px;
    }

    .meta-card {
        padding: 5px 8px;
        border-radius: 6px;
        background: rgba(255, 255, 255, 0.02);
        border: 1px solid rgba(255, 255, 255, 0.08);
        display: flex;
        flex-direction: column;
        gap: 3px;
    }

    :global(html[data-theme="light"]) .meta-card {
        background: rgba(15, 23, 42, 0.02);
        border-color: rgba(15, 23, 42, 0.08);
    }

    .meta-label {
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: var(--text-secondary, rgba(255, 255, 255, 0.65));
    }

    .meta-value {
        font-family: var(--font-mono, "IBM Plex Mono", Consolas, monospace);
        font-size: 12px;
        color: var(--text-primary, #f8fafc);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .meta-value-wrap {
        white-space: pre-wrap;
        overflow-wrap: anywhere;
        font-family: inherit;
    }

    :global(html[data-theme="light"]) .meta-value {
        color: #0f172a;
    }

    .risk-banner {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
        padding: 5px 8px;
        border-radius: 6px;
        font-size: 11px;
        border: 1px solid rgba(239, 68, 68, 0.35);
        background: rgba(239, 68, 68, 0.12);
        color: #fecaca;
    }

    .risk-banner.risk-low {
        border-color: rgba(16, 185, 129, 0.4);
        background: rgba(16, 185, 129, 0.12);
        color: #bbf7d0;
    }

    .risk-banner.risk-medium {
        border-color: rgba(251, 146, 60, 0.4);
        background: rgba(251, 146, 60, 0.14);
        color: #fed7aa;
    }

    .risk-level {
        font-weight: 600;
        text-transform: uppercase;
    }

    :global(html[data-theme="light"]) .risk-banner {
        color: #b91c1c;
    }

    .grant-root {
        border-radius: 6px;
        border: 1px dashed rgba(14, 165, 233, 0.5);
        padding: 6px 8px;
        background: rgba(14, 165, 233, 0.08);
        display: flex;
        flex-direction: column;
        gap: 2px;
    }

    .grant-eyebrow {
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: #34d399;
    }

    :global(html[data-theme="light"]) .grant-root {
        background: rgba(14, 165, 233, 0.12);
        border-color: rgba(14, 165, 233, 0.35);
        color: #0c4a6e;
    }

    .permission-list {
        display: flex;
        flex-direction: column;
        gap: 6px;
    }

    .permission-row {
        display: flex;
        align-items: flex-start;
        gap: 10px;
        padding: 6px 8px;
        border: 1px solid rgba(14, 165, 233, 0.18);
        border-radius: 6px;
        background: rgba(14, 165, 233, 0.06);
    }

    .permission-label {
        flex: 0 0 130px;
        color: var(--text-secondary, rgba(255, 255, 255, 0.72));
        font-size: 11px;
        font-weight: 600;
    }

    .permission-values {
        min-width: 0;
        display: flex;
        flex: 1;
        flex-direction: column;
        gap: 3px;
    }

    .permission-value {
        min-width: 0;
        overflow-wrap: anywhere;
        color: var(--text-primary, #f8fafc);
        font-size: 12px;
    }

    .permission-empty {
        color: var(--text-secondary, rgba(255, 255, 255, 0.65));
        font-size: 12px;
    }

    :global(html[data-theme="light"]) .permission-row {
        background: rgba(14, 165, 233, 0.08);
        border-color: rgba(14, 165, 233, 0.2);
    }

    :global(html[data-theme="light"]) .permission-label,
    :global(html[data-theme="light"]) .permission-empty {
        color: #475569;
    }

    :global(html[data-theme="light"]) .permission-value {
        color: #0f172a;
    }

    @media (max-width: 640px) {
        .permission-row {
            flex-direction: column;
            gap: 4px;
        }

        .permission-label {
            flex-basis: auto;
        }
    }

</style>
