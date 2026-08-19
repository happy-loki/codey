<script lang="ts">
    import { onMount } from "svelte";
    import { convertFileSrc, invoke } from "@tauri-apps/api/core";

    import type {
        PluginDetail,
        PluginListParams,
        PluginListResponse,
        PluginMarketplaceEntry,
        PluginReadParams,
        PluginReadResponse,
        PluginSummary,
    } from "../types";

    export let workspaceDir: string | null = null;
    export let workspaceName = "";

    let didMount = false;
    let lastWorkspaceDir: string | null = null;
    let pluginsResponse: PluginListResponse | null = null;
    let loading = false;
    let message = "";
    let messageKind: "" | "success" | "error" = "";
    let selectedPluginKey = "";
    let loadingDetailsKey = "";
    let detailErrors: Record<string, string> = {};
    let detailsByKey: Record<string, PluginDetail> = {};
    let iconFailures: Record<string, boolean> = {};

    $: marketplaces = pluginsResponse?.marketplaces ?? [];
    $: marketplaceLoadErrors = pluginsResponse?.marketplaceLoadErrors ?? [];
    $: featuredPluginIds = new Set(pluginsResponse?.featuredPluginIds ?? []);
    $: if (didMount && workspaceDir !== lastWorkspaceDir) {
        lastWorkspaceDir = workspaceDir;
        void loadPlugins(false);
    }

    onMount(() => {
        didMount = true;
        lastWorkspaceDir = workspaceDir;
        void loadPlugins(false);
    });

    function buildListParams(): PluginListParams {
        const params: PluginListParams = {};
        if (workspaceDir) {
            params.cwds = [workspaceDir];
        }
        return params;
    }

    async function loadPlugins(showSuccess: boolean) {
        loading = true;
        message = "";
        messageKind = "";
        try {
            pluginsResponse = await invoke<PluginListResponse>("codex_plugin_list", {
                params: buildListParams(),
            });
            if (showSuccess) {
                message = "插件列表已刷新。";
                messageKind = "success";
            }
        } catch (err: any) {
            message = err?.toString?.() ?? String(err);
            messageKind = "error";
        } finally {
            loading = false;
        }
    }

    function pluginKey(marketplace: PluginMarketplaceEntry, plugin: PluginSummary): string {
        return `${marketplace.path ?? marketplace.name}::${plugin.name}`;
    }

    function pluginDisplayName(plugin: PluginSummary): string {
        return plugin.interface?.displayName || plugin.name;
    }

    function pluginIconSrc(plugin: PluginSummary): string {
        const icon = plugin.interface;
        if (!icon) return "";
        if (icon.logoUrl) return icon.logoUrl;
        if (icon.composerIconUrl) return icon.composerIconUrl;
        if (icon.logo) return convertFileSrc(icon.logo);
        if (icon.composerIcon) return convertFileSrc(icon.composerIcon);
        return "";
    }

    function markIconFailed(key: string) {
        iconFailures = { ...iconFailures, [key]: true };
    }

    function marketplaceDisplayName(marketplace: PluginMarketplaceEntry): string {
        return marketplace.interface?.displayName || marketplace.name;
    }

    function pluginSelector(
        marketplace: PluginMarketplaceEntry,
        plugin: PluginSummary
    ): PluginReadParams {
        return {
            marketplacePath: marketplace.path,
            remoteMarketplaceName: marketplace.path ? null : marketplace.name,
            pluginName: plugin.name,
        };
    }

    async function toggleDetails(marketplace: PluginMarketplaceEntry, plugin: PluginSummary) {
        const key = pluginKey(marketplace, plugin);
        if (selectedPluginKey === key) {
            selectedPluginKey = "";
            return;
        }
        selectedPluginKey = key;
        if (detailsByKey[key]) return;

        loadingDetailsKey = key;
        detailErrors = { ...detailErrors, [key]: "" };
        try {
            const result = await invoke<PluginReadResponse>("codex_plugin_read", {
                params: pluginSelector(marketplace, plugin),
            });
            detailsByKey = { ...detailsByKey, [key]: result.plugin };
        } catch (err: any) {
            detailErrors = { ...detailErrors, [key]: err?.toString?.() ?? String(err) };
        } finally {
            if (loadingDetailsKey === key) {
                loadingDetailsKey = "";
            }
        }
    }

    function isFeatured(plugin: PluginSummary): boolean {
        return (
            featuredPluginIds.has(plugin.id) ||
            Boolean(plugin.remotePluginId && featuredPluginIds.has(plugin.remotePluginId))
        );
    }

    function sourceLabel(plugin: PluginSummary): string {
        const source = plugin.source;
        if (source.type === "local") {
            return source.path;
        }
        if (source.type === "git") {
            const refName = source.refName ? ` @ ${source.refName}` : "";
            const subdir = source.path ? ` / ${source.path}` : "";
            return `${source.url}${subdir}${refName}`;
        }
        return "remote catalog";
    }

    function sourceSummaryLabel(plugin: PluginSummary): string {
        const source = plugin.source;
        if (source.type === "local") return "本地来源";
        if (source.type === "git") return "Git 来源";
        return "远程 catalog";
    }

    function installPolicyLabel(policy: PluginSummary["installPolicy"]): string {
        switch (policy) {
            case "AVAILABLE":
                return "可安装";
            case "INSTALLED_BY_DEFAULT":
                return "默认安装";
            case "NOT_AVAILABLE":
                return "不可安装";
            default:
                return policy;
        }
    }

    function authPolicyLabel(policy: PluginSummary["authPolicy"]): string {
        return policy === "ON_INSTALL" ? "安装时授权" : "使用时授权";
    }
</script>

<div class="plugins-panel">
    <div class="plugins-header">
        <div>
            <h3>Plugins</h3>
            <p class="hint">
                Plugins 和 marketplace 由全局 Codex 环境管理，Codey 仅显示现有内容，不执行安装、卸载或启停操作。
                {#if workspaceDir}
                    当前项目：{workspaceName || workspaceDir}
                {/if}
            </p>
        </div>
        <button class="secondary" on:click={() => loadPlugins(true)} disabled={loading}>
            {loading ? "刷新中..." : "刷新"}
        </button>
    </div>

    {#if message}
        <div class="notice" class:error={messageKind === "error"} class:success={messageKind === "success"}>
            {message}
        </div>
    {/if}

    {#if marketplaceLoadErrors.length}
        <div class="notice error">
            {marketplaceLoadErrors.map((e) => `${e.marketplacePath}: ${e.message}`).join("\n")}
        </div>
    {/if}

    {#if loading && !pluginsResponse}
        <div class="empty">正在加载插件...</div>
    {:else if marketplaces.length === 0}
        <div class="empty">当前没有可用 marketplace。请在全局 Codex 环境中配置。</div>
    {:else}
        <div class="marketplace-list">
            {#each marketplaces as marketplace (marketplace.path ?? marketplace.name)}
                <section class="marketplace">
                    <div class="marketplace-head">
                        <div>
                            <div class="marketplace-title">{marketplaceDisplayName(marketplace)}</div>
                            <div class="marketplace-meta">
                                <span>{marketplace.name}</span>
                                {#if marketplace.path}
                                    <span title={marketplace.path}>本地 marketplace</span>
                                {:else}
                                    <span>remote</span>
                                {/if}
                            </div>
                        </div>
                        <span class="readonly-label">只读</span>
                    </div>

                    {#if marketplace.plugins.length === 0}
                        <div class="empty inline">这个 marketplace 没有插件。</div>
                    {:else}
                        <div class="plugin-list">
                            {#each marketplace.plugins as plugin (plugin.id)}
                                {@const key = pluginKey(marketplace, plugin)}
                                {@const iconSrc = pluginIconSrc(plugin)}
                                <article class="plugin-card" class:disabled={!plugin.enabled}>
                                    <div class="plugin-main">
                                        <div
                                            class="plugin-icon"
                                            style={`--plugin-color: ${plugin.interface?.brandColor || "#3f7cff"}`}
                                        >
                                            {#if iconSrc && !iconFailures[key]}
                                                <img src={iconSrc} alt="" on:error={() => markIconFailed(key)} />
                                            {:else}
                                                <span>{pluginDisplayName(plugin).slice(0, 1).toUpperCase()}</span>
                                            {/if}
                                        </div>
                                        <div class="plugin-copy">
                                            <div class="plugin-title-row">
                                                <span class="plugin-title">{pluginDisplayName(plugin)}</span>
                                                {#if isFeatured(plugin)}
                                                    <span class="badge featured">Featured</span>
                                                {/if}
                                                {#if plugin.installed}
                                                    <span class="badge ok">已安装</span>
                                                {/if}
                                                {#if !plugin.enabled}
                                                    <span class="badge muted">已停用</span>
                                                {/if}
                                            </div>
                                            <p class="plugin-desc">
                                                {plugin.interface?.shortDescription ||
                                                    plugin.interface?.longDescription ||
                                                    "没有描述。"}
                                            </p>
                                            <div class="plugin-meta">
                                                <span>{installPolicyLabel(plugin.installPolicy)}</span>
                                                <span>{authPolicyLabel(plugin.authPolicy)}</span>
                                                <span>{plugin.availability}</span>
                                                {#if plugin.localVersion}
                                                    <span>v{plugin.localVersion}</span>
                                                {/if}
                                            </div>
                                            <div class="plugin-source" title={sourceLabel(plugin)}>
                                                {sourceSummaryLabel(plugin)}
                                            </div>
                                        </div>
                                    </div>

                                    <div class="plugin-actions">
                                        <button class="secondary" on:click={() => toggleDetails(marketplace, plugin)}>
                                            {selectedPluginKey === key ? "收起" : "详情"}
                                        </button>
                                    </div>

                                    {#if selectedPluginKey === key}
                                        <div class="plugin-detail">
                                            {#if loadingDetailsKey === key}
                                                <div class="empty inline">正在读取详情...</div>
                                            {:else if detailErrors[key]}
                                                <div class="notice error">{detailErrors[key]}</div>
                                            {:else if detailsByKey[key]}
                                                {@const detail = detailsByKey[key]}
                                                {#if detail.description}
                                                    <p>{detail.description}</p>
                                                {/if}
                                                <div class="detail-grid">
                                                    <div>
                                                        <div class="detail-label">Skills</div>
                                                        <div class="chips">
                                                            {#if detail.skills.length}
                                                                {#each detail.skills as skill (skill.name)}
                                                                    <span class="chip" class:disabled={!skill.enabled}>{skill.name}</span>
                                                                {/each}
                                                            {:else}
                                                                <span class="muted-text">无</span>
                                                            {/if}
                                                        </div>
                                                    </div>
                                                    <div>
                                                        <div class="detail-label">Hooks</div>
                                                        <div class="chips">
                                                            {#if detail.hooks.length}
                                                                {#each detail.hooks as hook (hook.key)}
                                                                    <span class="chip">{hook.eventName}</span>
                                                                {/each}
                                                            {:else}
                                                                <span class="muted-text">无</span>
                                                            {/if}
                                                        </div>
                                                    </div>
                                                    <div>
                                                        <div class="detail-label">Apps</div>
                                                        <div class="chips">
                                                            {#if detail.apps.length}
                                                                {#each detail.apps as app (app.id)}
                                                                    <span class="chip" class:needs-auth={app.needsAuth}>{app.name}</span>
                                                                {/each}
                                                            {:else}
                                                                <span class="muted-text">无</span>
                                                            {/if}
                                                        </div>
                                                    </div>
                                                    <div>
                                                        <div class="detail-label">MCP Servers</div>
                                                        <div class="chips">
                                                            {#if detail.mcpServers.length}
                                                                {#each detail.mcpServers as server (server)}
                                                                    <span class="chip">{server}</span>
                                                                {/each}
                                                            {:else}
                                                                <span class="muted-text">无</span>
                                                            {/if}
                                                        </div>
                                                    </div>
                                                </div>
                                                {#if detail.summary.interface?.websiteUrl}
                                                    <a
                                                        class="plugin-link"
                                                        href={detail.summary.interface.websiteUrl}
                                                        target="_blank"
                                                        rel="noreferrer"
                                                    >
                                                        {detail.summary.interface.websiteUrl}
                                                    </a>
                                                {/if}
                                            {/if}
                                        </div>
                                    {/if}
                                </article>
                            {/each}
                        </div>
                    {/if}
                </section>
            {/each}
        </div>
    {/if}
</div>

<style>
    .plugins-panel {
        display: flex;
        flex-direction: column;
        gap: 14px;
    }

    .plugins-header,
    .marketplace-head,
    .plugin-main,
    .plugin-title-row,
    .plugin-actions {
        display: flex;
        align-items: center;
        gap: 10px;
    }

    .plugins-header,
    .marketplace-head {
        justify-content: space-between;
    }

    h3 {
        margin: 0 0 4px;
        font-size: 16px;
        color: var(--text-primary, #fff);
    }

    .hint,
    .plugin-desc {
        margin: 0;
        color: var(--text-secondary, #aaa);
        font-size: 12px;
        line-height: 1.45;
    }

    .notice,
    .empty {
        padding: 10px 12px;
        border-radius: 8px;
        background: var(--bg-primary, #1e1e1e);
        border: 1px solid var(--border-color, #333);
        color: var(--text-secondary, #aaa);
        font-size: 13px;
        white-space: pre-wrap;
    }

    .notice.error {
        border-color: var(--error-color, #ef4444);
        color: var(--error-color, #ef4444);
    }

    .notice.success {
        border-color: rgba(34, 197, 94, 0.45);
        color: #4ade80;
    }

    .empty.inline {
        margin-top: 8px;
        padding: 8px 10px;
        font-size: 12px;
    }

    button {
        padding: 6px 10px;
        border-radius: 8px;
        border: 1px solid var(--border-color, #333);
        font-size: 12px;
        cursor: pointer;
    }

    button:disabled {
        cursor: not-allowed;
        opacity: 0.55;
    }

    button.secondary {
        background: var(--bg-primary, #1e1e1e);
        color: var(--text-primary, #fff);
    }

    .readonly-label {
        border: 1px solid var(--border-color, #333);
        border-radius: 999px;
        padding: 2px 7px;
        color: var(--text-secondary, #888);
        font-size: 11px;
    }

    .marketplace-list {
        display: flex;
        flex-direction: column;
        gap: 12px;
    }

    .marketplace {
        padding: 12px;
        border-radius: 10px;
        border: 1px solid var(--border-color, #333);
        background: color-mix(in srgb, var(--bg-primary, #1e1e1e) 65%, transparent);
    }

    .marketplace-title {
        color: var(--text-primary, #fff);
        font-weight: 600;
        font-size: 14px;
    }

    .marketplace-meta,
    .plugin-meta {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        color: var(--text-secondary, #aaa);
        font-size: 11px;
        margin-top: 3px;
    }

    .marketplace-meta span,
    .plugin-meta span {
        max-width: 280px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .plugin-list {
        display: flex;
        flex-direction: column;
        gap: 10px;
        margin-top: 12px;
    }

    .plugin-card {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        gap: 12px;
        padding: 12px;
        border-radius: 10px;
        border: 1px solid var(--border-color, #333);
        background: var(--bg-secondary, #252525);
    }

    .plugin-card.disabled {
        opacity: 0.82;
    }

    .plugin-actions {
        flex-shrink: 0;
        align-items: flex-start;
        justify-content: flex-end;
    }

    .plugin-icon {
        width: 38px;
        height: 38px;
        border-radius: 12px;
        display: grid;
        place-items: center;
        flex: 0 0 auto;
        overflow: hidden;
        background: #fff;
        border: 1px solid var(--border-color, #333);
        color: #fff;
        font-weight: 700;
    }

    .plugin-icon img {
        width: 100%;
        height: 100%;
        object-fit: contain;
    }

    .plugin-icon span {
        width: 100%;
        height: 100%;
        display: grid;
        place-items: center;
        background: color-mix(in srgb, var(--plugin-color) 78%, #000);
    }

    .plugin-copy {
        min-width: 0;
    }

    .plugin-title {
        color: var(--text-primary, #fff);
        font-weight: 600;
        font-size: 14px;
    }

    .badge,
    .chip {
        display: inline-flex;
        align-items: center;
        border-radius: 999px;
        border: 1px solid var(--border-color, #333);
        padding: 2px 7px;
        color: var(--text-secondary, #aaa);
        font-size: 11px;
        line-height: 1.4;
    }

    .badge.ok {
        border-color: rgba(34, 197, 94, 0.35);
        color: #4ade80;
    }

    .badge.featured {
        border-color: rgba(59, 130, 246, 0.45);
        color: #93c5fd;
    }

    .badge.muted,
    .muted-text {
        color: var(--text-secondary, #888);
    }

    .plugin-source {
        margin-top: 6px;
        color: var(--text-secondary, #888);
        font-size: 11px;
    }

    .plugin-detail {
        grid-column: 1 / -1;
        padding-top: 10px;
        border-top: 1px solid var(--border-color, #333);
        color: var(--text-secondary, #aaa);
        font-size: 12px;
    }

    .plugin-detail p {
        margin: 0 0 10px;
        line-height: 1.5;
    }

    .detail-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 10px;
    }

    .detail-label {
        margin-bottom: 5px;
        color: var(--text-primary, #fff);
        font-size: 11px;
        font-weight: 600;
    }

    .chips {
        display: flex;
        flex-wrap: wrap;
        gap: 5px;
    }

    .chip.disabled {
        opacity: 0.62;
    }

    .chip.needs-auth {
        border-color: rgba(251, 191, 36, 0.4);
        color: #fbbf24;
    }

    .plugin-link {
        display: inline-block;
        margin-top: 10px;
        color: var(--accent-color, #3f7cff);
        word-break: break-all;
    }

    @media (max-width: 720px) {
        .plugins-header,
        .marketplace-head,
        .plugin-card {
            grid-template-columns: 1fr;
            flex-direction: column;
            align-items: stretch;
        }

        .plugin-actions {
            align-items: stretch;
        }

        .detail-grid {
            grid-template-columns: 1fr;
        }
    }
</style>
