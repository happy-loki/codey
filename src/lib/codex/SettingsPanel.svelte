<script lang="ts">
    import { onMount } from "svelte";
    import { get } from "svelte/store";
    import { invoke } from "@tauri-apps/api/core";
    import { ChevronDown, ChevronRight } from "lucide-svelte";
    import PluginsSettingsPanel from "./settings/PluginsSettingsPanel.svelte";
    import SkillsSettingsPanel from "./settings/SkillsSettingsPanel.svelte";
    import { t } from "../i18n";
    import type { AccessMode } from "./approvalModes";
    import type { ListMcpServerStatusResponse, McpServerStatus, ReasoningEffort, Tool } from "./types";

    export let approvalPolicy: AccessMode = "workspaceOnRequest";
    export let models:
        | Array<{
              id: string;
              name: string;
              provider: string | null;
              supportedEfforts?: ReasoningEffort[];
              effortOptions?: Array<{ value: ReasoningEffort; label: string }>;
              defaultEffort?: ReasoningEffort | null;
          }>
        | null = null;
    export let selectedModel: string | null = null;
    export let selectedEffort: ReasoningEffort | "" = "";
    export let onApprovalPolicyChange:
        | ((policy: AccessMode, options?: { silent?: boolean }) => void | Promise<void>)
        | null = null;

    type McpServerUi = {
        name: string;
        transport: "stdio" | "http";
        enabled?: boolean;
        command?: string;
        args?: string[];
        cwd?: string;
        env?: Record<string, string>;
        envVars?: string[];
        url?: string;
        bearerTokenEnvVar?: string;
        httpHeaders?: Record<string, string>;
        envHttpHeaders?: Record<string, string>;
        startupTimeoutSec?: number;
        toolTimeoutSec?: number;
        enabledTools?: string[];
        disabledTools?: string[];
    };

    type CodexGuiSettings = {
        rules: string;
        responsesWebsocketEnabled?: boolean;
        memoryGenerateEnabled?: boolean;
        memoryUseEnabled?: boolean;
        memoryDisableOnExternalContextEnabled?: boolean;
        mcpServers: McpServerUi[];
        accessMode?: AccessMode | null;
        selectedModel?: string | null;
        selectedEffort?: string | null;
    };

    let activeTab: "rule" | "mcp" | "skills" | "plugins" = "rule";
    let rules = "";
    let responsesWebsocketEnabled = false;
    let memoryGenerateEnabled = false;
    let memoryUseEnabled = false;
    let memoryDisableOnExternalContextEnabled = false;
    let mcpServers: McpServerUi[] = [];
    let mcpStatusByName: Record<string, McpServerStatus> = {};
    let workspaceDir: string | null = null;
    let workspaceName = "";
    let isLoading = false;
    let isSavingRules = false;
    let isRefreshingMcp = false;
    let loadError = "";
    let saveMessage = "";
    let mcpMessage = "";
    let mcpMessageKind: "" | "success" | "error" = "";
    let expandedMcpServer: string | null = null;
    let expandedMcpToolIds = new Set<string>();
    let mcpToolListByServer: Record<string, Tool[]> = {};

    function getServerConfig(name: string): McpServerUi | undefined {
        return mcpServers.find((server) => server.name === name);
    }

    function toolsFromStatus(status: McpServerStatus | undefined): Tool[] {
        const toolsObj = status?.tools ?? {};
        const list = Object.values(toolsObj).filter(Boolean) as Tool[];
        list.sort((a, b) => a.name.localeCompare(b.name));
        return list;
    }

    $: mcpToolListByServer = Object.fromEntries(
        Object.entries(mcpStatusByName).map(([name, status]) => [name, toolsFromStatus(status)])
    );

    async function refreshWorkspaceDir() {
        try {
            const cwd = await invoke<string | null>("get_workspace_dir");
            workspaceDir = cwd;
            workspaceName = cwd ? cwd.replaceAll("\\", "/").split("/").filter(Boolean).at(-1) ?? "" : "";
        } catch {
            workspaceDir = null;
            workspaceName = "";
        }
    }

    async function refreshMcpStatus() {
        isRefreshingMcp = true;
        mcpMessage = "";
        mcpMessageKind = "";
        try {
            const result = await invoke<ListMcpServerStatusResponse>("codex_mcp_server_status_list", {
                params: { cursor: null, limit: 50 },
            });
            const next: Record<string, McpServerStatus> = {};
            (result?.data ?? []).forEach((server) => {
                next[server.name] = server;
            });
            mcpStatusByName = next;
            if (expandedMcpServer && !next[expandedMcpServer]) {
                expandedMcpServer = null;
                expandedMcpToolIds = new Set<string>();
            }
        } catch (err: any) {
            mcpMessage = err?.toString?.() ?? String(err);
            mcpMessageKind = "error";
        } finally {
            isRefreshingMcp = false;
        }
    }

    async function loadSettings() {
        isLoading = true;
        loadError = "";
        try {
            const result = await invoke<CodexGuiSettings>("codex_settings_load");
            rules = result?.rules ?? "";
            responsesWebsocketEnabled = result?.responsesWebsocketEnabled ?? false;
            memoryGenerateEnabled = result?.memoryGenerateEnabled ?? false;
            memoryUseEnabled = result?.memoryUseEnabled ?? false;
            memoryDisableOnExternalContextEnabled =
                result?.memoryDisableOnExternalContextEnabled ?? false;
            mcpServers = result?.mcpServers ?? [];
            if (result?.accessMode) {
                onApprovalPolicyChange?.(result.accessMode, { silent: true });
            }
            if (result?.selectedModel) {
                selectedModel = result.selectedModel;
            }
            if (result?.selectedEffort !== undefined && result?.selectedEffort !== null) {
                selectedEffort = result.selectedEffort as ReasoningEffort;
            }
            await refreshMcpStatus();
        } catch (err: any) {
            loadError = err?.toString?.() ?? String(err);
        } finally {
            isLoading = false;
        }
    }

    async function saveRules() {
        isSavingRules = true;
        saveMessage = "";
        try {
            await invoke("codex_settings_save", {
                settings: {
                    rules,
                    responsesWebsocketEnabled,
                    memoryGenerateEnabled,
                    memoryUseEnabled,
                    memoryDisableOnExternalContextEnabled,
                    mcpServers,
                    accessMode: approvalPolicy,
                    selectedModel,
                    selectedEffort: selectedEffort || null,
                } satisfies CodexGuiSettings,
            });
            saveMessage = get(t)("codex.settingsPanel.common.savedRestart");
            window.setTimeout(() => {
                saveMessage = "";
            }, 4000);
        } catch (err: any) {
            saveMessage = err?.toString?.() ?? String(err);
        } finally {
            isSavingRules = false;
        }
    }

    function toggleMcpServerExpanded(name: string) {
        expandedMcpServer = expandedMcpServer === name ? null : name;
        expandedMcpToolIds = new Set<string>();
    }

    function toggleMcpToolExpanded(serverName: string, toolName: string) {
        const id = `${serverName}::${toolName}`;
        const next = new Set(expandedMcpToolIds);
        if (next.has(id)) {
            next.delete(id);
        } else {
            next.add(id);
        }
        expandedMcpToolIds = next;
    }

    function isMcpToolExpanded(serverName: string, toolName: string): boolean {
        return expandedMcpToolIds.has(`${serverName}::${toolName}`);
    }

    function statusLabelForServer(name: string): string {
        const status = mcpStatusByName[name];
        return status?.authStatus ?? "";
    }

    function isToolEnabled(serverName: string, toolName: string): boolean {
        const cfg = getServerConfig(serverName);
        if (!cfg) return true;
        if (cfg.enabledTools != null) {
            return (cfg.enabledTools ?? []).includes(toolName);
        }
        if (cfg.disabledTools != null) {
            return !(cfg.disabledTools ?? []).includes(toolName);
        }
        return true;
    }

    function prettyJson(value: any): string {
        try {
            return JSON.stringify(value ?? null, null, 2);
        } catch {
            return String(value);
        }
    }

    onMount(() => {
        void loadSettings();
        void refreshWorkspaceDir();
    });

    $: if (activeTab === "skills" || activeTab === "plugins") {
        void refreshWorkspaceDir();
    }

    $: if (activeTab === "mcp") {
        void refreshMcpStatus();
    }
</script>

<div class="settings-panel">
    <div class="tabs">
        <button class="tab" class:active={activeTab === "rule"} on:click={() => (activeTab = "rule")}>
            {$t("codex.settingsPanel.tabs.rule")}
        </button>
        <button class="tab" class:active={activeTab === "mcp"} on:click={() => (activeTab = "mcp")}>
            {$t("codex.settingsPanel.tabs.mcp")}
        </button>
        <button class="tab" class:active={activeTab === "skills"} on:click={() => (activeTab = "skills")}>
            {$t("codex.settingsPanel.tabs.skills")}
        </button>
        <button class="tab" class:active={activeTab === "plugins"} on:click={() => (activeTab = "plugins")}>
            {$t("codex.settingsPanel.tabs.plugins")}
        </button>
    </div>

    {#if isLoading}
        <div class="notice">{$t("codex.settingsPanel.common.loading")}</div>
    {:else if loadError}
        <div class="notice error">{loadError}</div>
    {/if}

    {#if activeTab === "rule"}
        <div class="card">
            <h3>{$t("codex.settingsPanel.rule.title")}</h3>
            <p class="hint">{$t("codex.settingsPanel.rule.hint")}</p>
            <div class="feature-list">
                <div class="feature-row">
                    <div class="feature-copy">
                        <div class="feature-title">{$t("codex.settingsPanel.rule.websocketTitle")}</div>
                        <div class="feature-hint">{$t("codex.settingsPanel.rule.websocketHint")}</div>
                    </div>
                    <label class="switch" aria-label={$t("codex.settingsPanel.rule.websocketTitle")}>
                        <input type="checkbox" bind:checked={responsesWebsocketEnabled} disabled />
                        <span class="slider" />
                    </label>
                </div>
                <div class="feature-row">
                    <div class="feature-copy">
                        <div class="feature-title">{$t("codex.settingsPanel.rule.memoryGenerateTitle")}</div>
                        <div class="feature-hint">{$t("codex.settingsPanel.rule.memoryGenerateHint")}</div>
                    </div>
                    <label class="switch" aria-label={$t("codex.settingsPanel.rule.memoryGenerateTitle")}>
                        <input type="checkbox" bind:checked={memoryGenerateEnabled} disabled />
                        <span class="slider" />
                    </label>
                </div>
                <div class="feature-row">
                    <div class="feature-copy">
                        <div class="feature-title">{$t("codex.settingsPanel.rule.memoryUseTitle")}</div>
                        <div class="feature-hint">{$t("codex.settingsPanel.rule.memoryUseHint")}</div>
                    </div>
                    <label class="switch" aria-label={$t("codex.settingsPanel.rule.memoryUseTitle")}>
                        <input type="checkbox" bind:checked={memoryUseEnabled} disabled />
                        <span class="slider" />
                    </label>
                </div>
                <div class="feature-row">
                    <div class="feature-copy">
                        <div class="feature-title">{$t("codex.settingsPanel.rule.memoryDisableExternalTitle")}</div>
                        <div class="feature-hint">{$t("codex.settingsPanel.rule.memoryDisableExternalHint")}</div>
                    </div>
                    <label class="switch" aria-label={$t("codex.settingsPanel.rule.memoryDisableExternalTitle")}>
                        <input type="checkbox" bind:checked={memoryDisableOnExternalContextEnabled} disabled />
                        <span class="slider" />
                    </label>
                </div>
            </div>
            <div class="section-divider" />
            <div class="section-title">{$t("codex.settingsPanel.rule.rulesTitle")}</div>
            <p class="hint rules-hint">{$t("codex.settingsPanel.rule.rulesHint")}</p>
            <textarea
                class="rules"
                bind:value={rules}
                placeholder={$t("codex.settingsPanel.rule.placeholder")}
                rows="10"
                readonly
            />
            <div class="readonly-note">{$t("codex.settingsPanel.common.globalManagedHint")}</div>
        </div>
    {:else if activeTab === "mcp"}
        <div class="card">
            <div class="section-head">
                <div class="section-left">
                    <div class="section-title">{$t("codex.settingsPanel.mcp.myTitle")}</div>
                    <div class="section-subtitle">{$t("codex.settingsPanel.common.globalManagedHint")}</div>
                </div>
                <div class="section-right">
                    <button class="secondary" on:click={refreshMcpStatus} disabled={isRefreshingMcp}>
                        {isRefreshingMcp ? $t("codex.settingsPanel.common.refreshing") : $t("codex.settingsPanel.common.refresh")}
                    </button>
                </div>
            </div>

            <div class="mcp-hint">
                <div class="mcp-hint-line">{$t("codex.settingsPanel.mcp.readOnlyHint")}</div>
            </div>

            {#if mcpMessage}
                <div class="notice" class:error={mcpMessageKind === "error"}>{mcpMessage}</div>
            {/if}

            {#if mcpServers.length}
                <div class="mcp-status">
                    {#each mcpServers as server (server.name)}
                        {@const status = mcpStatusByName[server.name]}
                        {@const tools = mcpToolListByServer[server.name] ?? []}
                        <div class="mcp-status-row" on:click={() => toggleMcpServerExpanded(server.name)}>
                            <span
                                class="mcp-dot"
                                class:ok={Boolean(status) && Boolean(server.enabled ?? true)}
                                class:bad={!Boolean(status) && Boolean(server.enabled ?? true)}
                                class:disabled={!Boolean(server.enabled ?? true)}
                                class:loading={isRefreshingMcp && Boolean(server.enabled ?? true)}
                            />
                            <span class="mcp-status-name">{server.name}</span>
                            <span class="mcp-status-meta">
                                {$t("codex.settingsPanel.mcp.authLabel")}: {statusLabelForServer(server.name) || $t("codex.settingsPanel.mcp.statusUnavailable")}
                            </span>
                            {#if status}
                                <span class="mcp-status-meta">
                                    {$t("codex.settingsPanel.mcp.toolsLabel")}: {tools.length}
                                </span>
                            {:else}
                                <span class="mcp-status-meta">{$t("codex.settingsPanel.mcp.toolsUnavailable")}</span>
                            {/if}
                            <button
                                type="button"
                                class="mcp-expand"
                                aria-label={$t("codex.settingsPanel.mcp.toggleAria", { name: server.name })}
                                on:click|stopPropagation={() => toggleMcpServerExpanded(server.name)}
                            >
                                {#if expandedMcpServer === server.name}
                                    <ChevronDown size={16} strokeWidth={2} />
                                {:else}
                                    <ChevronRight size={16} strokeWidth={2} />
                                {/if}
                            </button>
                            <span class="spacer" />
                            <span
                                class="mcp-toggle read-only"
                                class:on={Boolean(server.enabled ?? true)}
                                aria-label={$t("codex.settingsPanel.mcp.readOnlyStatusAria", { name: server.name })}
                            >
                                {#if Boolean(server.enabled ?? true)}
                                    <span class="mcp-toggle-label on">{$t("codex.settingsPanel.mcp.enabled")}</span>
                                {:else}
                                    <span class="mcp-toggle-label off">{$t("codex.settingsPanel.mcp.disabled")}</span>
                                {/if}
                                <span class="mcp-toggle-knob" />
                            </span>
                        </div>
                        {#if expandedMcpServer === server.name}
                            <div class="mcp-tool-panel">
                                {#if !status}
                                    <div class="mcp-tool-empty">{$t("codex.settingsPanel.mcp.noStatusYet")}</div>
                                {:else if tools.length === 0}
                                    <div class="mcp-tool-empty">{$t("codex.settingsPanel.mcp.noTools")}</div>
                                    <div class="mcp-tool-subhint">{$t("codex.settingsPanel.mcp.zeroToolsHint")}</div>
                                {:else}
                                    {#each tools as tool (tool.name)}
                                        <div
                                            class="mcp-tool-row"
                                            class:expanded={isMcpToolExpanded(server.name, tool.name)}
                                            on:dblclick|stopPropagation={() => toggleMcpToolExpanded(server.name, tool.name)}
                                        >
                                            <div class="mcp-tool-head">
                                                <div class="mcp-tool-name">{tool.name}</div>
                                                {#if tool.title}
                                                    <div class="mcp-tool-title">{tool.title}</div>
                                                {/if}
                                            </div>
                                            {#if isMcpToolExpanded(server.name, tool.name)}
                                                <div class="mcp-tool-detail">
                                                    {#if tool.description}
                                                        <div class="mcp-tool-desc">{tool.description}</div>
                                                    {/if}
                                                    <div class="mcp-tool-schema">
                                                        <div class="mcp-tool-schema-title">inputSchema</div>
                                                        <pre>{prettyJson(tool.inputSchema)}</pre>
                                                    </div>
                                                    {#if tool.outputSchema}
                                                        <div class="mcp-tool-schema">
                                                            <div class="mcp-tool-schema-title">outputSchema</div>
                                                            <pre>{prettyJson(tool.outputSchema)}</pre>
                                                        </div>
                                                    {/if}
                                                    {#if tool.annotations}
                                                        <div class="mcp-tool-schema">
                                                            <div class="mcp-tool-schema-title">annotations</div>
                                                            <pre>{prettyJson(tool.annotations)}</pre>
                                                        </div>
                                                    {/if}
                                                </div>
                                            {/if}
                                        </div>
                                    {/each}
                                {/if}
                            </div>
                        {/if}
                    {/each}
                </div>
            {:else}
                <div class="notice">{$t("codex.settingsPanel.mcp.noServers")}</div>
            {/if}
        </div>
    {:else if activeTab === "skills"}
        <div class="card">
            <SkillsSettingsPanel {workspaceDir} {workspaceName} />
        </div>
    {:else if activeTab === "plugins"}
        <div class="card">
            <PluginsSettingsPanel {workspaceDir} {workspaceName} />
        </div>
    {/if}

    <div class="footer-actions">
        {#if activeTab === "rule"}
            <button class="primary" on:click={saveRules} disabled={isSavingRules}>
                {isSavingRules ? $t("codex.settingsPanel.common.saving") : $t("codex.settingsPanel.common.save")}
            </button>
            {#if saveMessage}
                <span class="save-message">{saveMessage}</span>
            {/if}
        {/if}
    </div>
</div>

<style>
    .settings-panel {
        width: 100%;
        max-width: 760px;
        margin: 0 auto;
        padding: 16px;
        box-sizing: border-box;
        overflow-x: hidden;
    }
    .tabs {
        display: flex;
        gap: 8px;
        padding: 8px;
        background: var(--bg-secondary, #252525);
        border: 1px solid var(--border-color, #333);
        border-radius: 10px;
        margin-bottom: 12px;
        flex-wrap: wrap;
    }
    .tab {
        padding: 6px 10px;
        border-radius: 8px;
        border: 1px solid transparent;
        background: transparent;
        color: var(--text-secondary, #aaa);
        cursor: pointer;
        font-size: 12px;
    }
    .tab.active {
        background: var(--bg-primary, #1e1e1e);
        color: var(--text-primary, #fff);
        border-color: var(--border-color, #333);
    }
    .notice {
        padding: 10px 12px;
        border-radius: 8px;
        background: var(--bg-secondary, #252525);
        border: 1px solid var(--border-color, #333);
        color: var(--text-secondary, #aaa);
        margin-bottom: 12px;
        font-size: 13px;
        white-space: pre-wrap;
    }
    .notice.error {
        border-color: var(--error-color, #ef4444);
        color: var(--error-color, #ef4444);
    }
    .card {
        padding: 16px;
        border-radius: 10px;
        background: var(--bg-secondary, #252525);
        border: 1px solid var(--border-color, #333);
    }
    .card :global(button.primary),
    .card :global(button.secondary) {
        padding: 6px 10px;
        font-size: 12px;
        line-height: 1;
        min-height: 28px;
        border-radius: 8px;
    }
    .card h3 {
        margin: 0 0 8px 0;
        font-size: 16px;
        color: var(--text-primary, #fff);
    }
    .hint {
        margin: 0 0 12px 0;
        color: var(--text-secondary, #aaa);
        font-size: 13px;
    }
    .feature-list {
        display: flex;
        flex-direction: column;
        gap: 10px;
        margin-top: 12px;
    }
    .feature-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
        padding: 10px 12px;
        border-radius: 8px;
        border: 1px solid var(--border-color, #333);
        background: var(--bg-primary, #1e1e1e);
    }
    .feature-copy {
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 4px;
    }
    .feature-title {
        color: var(--text-primary, #fff);
        font-size: 13px;
        font-weight: 700;
    }
    .section-title {
        font-size: 15px;
        font-weight: 600;
        color: var(--text-primary, #fff);
    }
    .feature-hint,
    .section-subtitle,
    .readonly-note {
        color: var(--text-secondary, #aaa);
        font-size: 12px;
    }
    .section-divider {
        height: 1px;
        background: var(--border-color, #333);
        margin: 14px 0;
        opacity: 0.9;
    }
    .rules {
        width: 100%;
        box-sizing: border-box;
        padding: 10px 12px;
        border-radius: 8px;
        min-height: 120px;
        resize: vertical;
        border: 1px solid var(--border-color, #333);
        background: var(--bg-primary, #1e1e1e);
        color: var(--text-primary, #fff);
        font-size: 13px;
        line-height: 1.4;
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New",
            monospace;
    }
    .footer-actions {
        display: flex;
        justify-content: flex-end;
        align-items: center;
        gap: 12px;
        margin-top: 12px;
    }
    .save-message {
        color: var(--text-secondary, #aaa);
        font-size: 13px;
        white-space: pre-wrap;
    }
    .section-head {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        flex-wrap: wrap;
        gap: 12px;
        margin-bottom: 10px;
    }
    .section-left {
        display: flex;
        flex-direction: column;
        gap: 4px;
        min-width: 0;
    }
    .section-right {
        display: flex;
        gap: 8px;
        align-items: center;
        flex: 0 1 auto;
        flex-wrap: wrap;
        justify-content: flex-end;
        margin-left: auto;
        max-width: 100%;
    }
    .primary {
        padding: 7px 10px;
        border-radius: 8px;
        border: none;
        background: var(--accent-color, #007acc);
        color: #fff;
        cursor: pointer;
        font-weight: 600;
        font-size: 12px;
        line-height: 1.1;
    }
    .primary:disabled,
    .secondary:disabled {
        opacity: 0.6;
        cursor: not-allowed;
    }
    .secondary {
        padding: 7px 10px;
        border-radius: 8px;
        border: 1px solid var(--border-color, #333);
        background: var(--bg-primary, #1e1e1e);
        color: var(--text-primary, #fff);
        cursor: pointer;
        font-size: 12px;
        line-height: 1.1;
    }
    .mcp-status,
    .mcp-tool-panel {
        display: flex;
        flex-direction: column;
        gap: 8px;
    }
    .mcp-status-row,
    .mcp-tool-row {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 8px 10px;
        border-radius: 10px;
        border: 1px solid var(--border-color, #333);
        background: var(--bg-primary, #1e1e1e);
    }
    .mcp-status-row {
        flex-wrap: wrap;
        user-select: none;
        cursor: pointer;
    }
    .mcp-status-row:hover {
        background: rgba(255, 255, 255, 0.03);
    }
    .mcp-hint {
        margin-top: 10px;
        padding: 10px 12px;
        border-radius: 10px;
        border: 1px solid var(--border-color, #333);
        background: rgba(255, 255, 255, 0.02);
        color: var(--text-secondary, rgba(255, 255, 255, 0.75));
        font-size: 12px;
        line-height: 1.4;
    }
    .mcp-dot {
        width: 10px;
        height: 10px;
        border-radius: 50%;
        background: rgba(148, 163, 184, 0.45);
        flex: 0 0 auto;
    }
    .mcp-dot.ok {
        background: rgba(34, 197, 94, 0.85);
    }
    .mcp-dot.bad {
        background: rgba(239, 68, 68, 0.8);
    }
    .mcp-dot.disabled,
    .mcp-dot.loading {
        background: rgba(148, 163, 184, 0.45);
    }
    .mcp-status-name,
    .mcp-tool-name {
        font-weight: 600;
        color: var(--text-primary, #fff);
    }
    .mcp-status-meta,
    .mcp-tool-title,
    .mcp-tool-desc,
    .mcp-tool-subhint {
        font-size: 12px;
        color: var(--text-secondary, #aaa);
    }
    .mcp-expand {
        border: none;
        background: transparent;
        color: var(--text-primary, #fff);
        cursor: pointer;
        padding: 2px 4px;
        border-radius: 6px;
        line-height: 0;
        display: inline-flex;
        align-items: center;
        justify-content: center;
    }
    .mcp-expand:hover {
        background: rgba(255, 255, 255, 0.06);
    }
    .spacer {
        flex: 1 1 auto;
    }
    .mcp-toggle {
        width: 42px;
        height: 22px;
        border-radius: 9999px;
        border: 1px solid var(--border-color, #333);
        background: rgba(148, 163, 184, 0.45);
        padding: 0;
        position: relative;
        flex: 0 0 auto;
    }
    .mcp-toggle.on {
        background: var(--accent-color, #4f46e5);
        border-color: transparent;
    }
    .mcp-toggle-label {
        position: absolute;
        top: 50%;
        transform: translateY(-50%);
        font-size: 10px;
        font-weight: 600;
        letter-spacing: 0.3px;
        user-select: none;
        pointer-events: none;
        text-transform: uppercase;
        white-space: nowrap;
    }
    .mcp-toggle-label.on {
        left: 6px;
        color: rgba(255, 255, 255, 0.9);
    }
    .mcp-toggle-label.off {
        right: 6px;
        color: rgba(15, 23, 42, 0.75);
    }
    .mcp-toggle-knob {
        position: absolute;
        top: 2px;
        left: 2px;
        width: 18px;
        height: 18px;
        border-radius: 9999px;
        background: #ffffff;
    }
    .mcp-toggle.on .mcp-toggle-knob {
        transform: translateX(20px);
    }
    .mcp-tool-panel {
        margin: 6px 0 12px;
        padding-left: 28px;
    }
    .mcp-tool-empty {
        color: var(--text-secondary, rgba(255, 255, 255, 0.75));
        font-size: 13px;
        padding-top: 2px;
    }
    .mcp-tool-row {
        margin: 6px 0;
        padding: 8px 12px;
        border-left: 2px solid rgba(255, 255, 255, 0.12);
    }
    .mcp-tool-row.expanded {
        border-left-color: rgba(99, 102, 241, 0.9);
        background: rgba(99, 102, 241, 0.08);
    }
    .mcp-tool-head {
        display: flex;
        align-items: center;
        gap: 10px;
    }
    .mcp-tool-detail {
        margin-top: 8px;
        width: 100%;
        color: rgba(255, 255, 255, 0.85);
        font-size: 12px;
        line-height: 1.5;
    }
    .mcp-tool-schema pre {
        margin: 6px 0 0;
        padding: 10px 12px;
        overflow: auto;
        max-height: 260px;
        border-radius: 10px;
        border: 1px solid var(--border-color, #333);
        background: rgba(0, 0, 0, 0.28);
        color: rgba(255, 255, 255, 0.85);
        font-size: 11px;
        line-height: 1.5;
    }
</style>
