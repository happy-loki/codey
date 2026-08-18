<script lang="ts">
import { onMount } from "svelte";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import {
        FolderGit2,
        Plug,
        RefreshCw,
        ShieldCheck,
        UserRound,
    } from "lucide-svelte";

import type { SkillMetadata, SkillsListEntry, SkillsListResponse } from "../types";

    export let workspaceDir: string | null = null;
    export let workspaceName = "";

    type SkillGroup = {
        id: "system" | "personal" | "project";
        title: string;
        subtitle: string;
        empty: string;
        skills: SkillMetadata[];
    };

    let didMount = false;
    let lastWorkspaceDir: string | null = null;
    let skills: SkillsListEntry[] = [];
    let loading = false;
    let message = "";
    let messageKind: "" | "success" | "error" = "";
    let iconFailures: Record<string, boolean> = {};

    $: if (didMount && workspaceDir !== lastWorkspaceDir) {
        lastWorkspaceDir = workspaceDir;
        void loadSkills(true, false);
    }

    $: flattenedSkills = (skills ?? []).flatMap((entry) => entry.skills ?? []);
    $: skillLoadErrors = (skills ?? []).flatMap((entry) => entry.errors ?? []);
    $: systemSkills = flattenedSkills.filter((skill) => isBuiltInSkill(skill));
    $: personalSkills = flattenedSkills.filter(
        (skill) => skill.scope === "user" && !isBuiltInSkill(skill)
    );
    $: projectSkills = flattenedSkills.filter((skill) => skill.scope === "repo");
    $: groups = buildGroups(systemSkills, personalSkills, projectSkills);

    onMount(() => {
        didMount = true;
        lastWorkspaceDir = workspaceDir;
        void loadSkills(false, false);
    });

    function buildListParams(forceReload: boolean) {
        const params: { forceReload: boolean; cwds: string[] } = {
            forceReload,
            cwds: workspaceDir ? [workspaceDir] : [],
        };
        return params;
    }

    async function loadSkills(forceReload: boolean, showSuccess: boolean = true) {
        if (loading) return;
        loading = true;
        message = "";
        messageKind = "";
        try {
            const result = await invoke<SkillsListResponse>("codex_skills_list", {
                params: buildListParams(forceReload),
            });
            skills = result?.data ?? [];
            if (showSuccess) {
                message = "Skills 已刷新。";
                messageKind = "success";
            }
        } catch (err: any) {
            message = err?.toString?.() ?? String(err);
            messageKind = "error";
        } finally {
            loading = false;
        }
    }

    function buildGroups(
        system: SkillMetadata[],
        personal: SkillMetadata[],
        project: SkillMetadata[]
    ): SkillGroup[] {
        return [
            {
                id: "system",
                title: "系统",
                subtitle: "Arthas/Codex 内置能力，仅显示全局环境中的当前状态。",
                empty: "暂无系统 Skills。",
                skills: sortSkills(system),
            },
            {
                id: "personal",
                title: "个人",
                subtitle: "安装在当前用户下的 Skills，包括个人导入和插件提供的能力。",
                empty: "暂无个人 Skills。",
                skills: sortSkills(personal),
            },
            {
                id: "project",
                title: workspaceName ? `${workspaceName}` : "项目",
                subtitle: workspaceDir
                    ? "仅对当前工作区生效的 Skills。"
                    : "打开工作区后可查看项目级 Skills。",
                empty: workspaceDir ? "暂无项目 Skills。" : "未打开工作区。",
                skills: sortSkills(project),
            },
        ];
    }

    function sortSkills(list: SkillMetadata[]): SkillMetadata[] {
        return [...list].sort((a, b) => skillDisplayName(a).localeCompare(skillDisplayName(b)));
    }

    function normalizedPath(path: string): string {
        return path.replaceAll("\\", "/").toLowerCase();
    }

    function isBuiltInSkillPath(path: string): boolean {
        const normalized = normalizedPath(path);
        return normalized.includes("/.system/") || normalized.includes("/.internal/");
    }

    function isBuiltInSkill(meta: SkillMetadata): boolean {
        return meta.scope === "system" || meta.scope === "admin" || isBuiltInSkillPath(meta.path);
    }

    function isPluginSkill(meta: SkillMetadata): boolean {
        const normalized = normalizedPath(meta.path);
        return normalized.includes("/plugins/cache/") || meta.name.includes(":");
    }

    function skillKey(meta: SkillMetadata): string {
        return `${meta.scope}:${meta.name}:${meta.path}`;
    }

    function skillDisplayName(meta: SkillMetadata): string {
        return meta.interface?.displayName || meta.name;
    }

    function skillSummary(meta: SkillMetadata): string {
        return (
            meta.interface?.shortDescription ||
            meta.shortDescription ||
            meta.description ||
            "没有描述。"
        ).trim();
    }

    function skillInitial(meta: SkillMetadata): string {
        return skillDisplayName(meta).trim().slice(0, 1).toUpperCase() || "S";
    }

    function skillIconSrc(meta: SkillMetadata): string {
        const icon = meta.interface?.iconSmall || meta.interface?.iconLarge;
        return icon ? convertFileSrc(icon) : "";
    }

    function markIconFailed(meta: SkillMetadata) {
        iconFailures = { ...iconFailures, [skillKey(meta)]: true };
    }

    function skillBrandColor(meta: SkillMetadata): string {
        return meta.interface?.brandColor || (isPluginSkill(meta) ? "#10A37F" : "#3f7cff");
    }

    function skillBadge(meta: SkillMetadata): string {
        if (isPluginSkill(meta)) return "Plugin";
        if (meta.scope === "repo") return "项目";
        if (isBuiltInSkill(meta)) return "内置";
        return "个人";
    }

    function groupIcon(group: SkillGroup) {
        if (group.id === "system") return ShieldCheck;
        if (group.id === "project") return FolderGit2;
        return UserRound;
    }

</script>

<div class="skills-panel">
    <div class="skills-header">
        <div>
            <h3>Skills</h3>
            <p class="hint">
                查看全局 Codex 环境和当前工作区可发现的 Skills。Arthas 不导入、编辑、删除或启停 Skill。
            </p>
        </div>
        <button class="secondary" on:click={() => loadSkills(true)} disabled={loading}>
            <RefreshCw size={14} />
            {loading ? "刷新中..." : "刷新"}
        </button>
    </div>

    {#if message}
        <div class="notice" class:error={messageKind === "error"} class:success={messageKind === "success"}>
            {message}
        </div>
    {/if}

    {#if skillLoadErrors.length}
        <div class="notice error">
            {skillLoadErrors.map((error) => error.message ?? String(error)).join("\n")}
        </div>
    {/if}

    {#if loading && flattenedSkills.length === 0}
        <div class="empty">正在加载 Skills...</div>
    {:else}
        <div class="skill-groups">
            {#each groups as group (group.id)}
                {@const Icon = groupIcon(group)}
                <section class="skill-group">
                    <div class="group-head">
                        <div class="group-title-block">
                            <div class="group-icon">
                                <svelte:component this={Icon} size={17} />
                            </div>
                            <div>
                                <div class="group-title">{group.title}</div>
                                <div class="group-subtitle">{group.subtitle}</div>
                            </div>
                        </div>
                    </div>

                    {#if group.skills.length === 0}
                        <div class="empty inline">{group.empty}</div>
                    {:else}
                        <div class="skill-list">
                            {#each group.skills as meta (skillKey(meta))}
                                {@const key = skillKey(meta)}
                                {@const iconSrc = skillIconSrc(meta)}
                                {@const builtIn = isBuiltInSkill(meta)}
                                <article class="skill-card" class:disabled={!meta.enabled}>
                                    <div class="skill-main">
                                        <div
                                            class="skill-icon"
                                            style={`--skill-color: ${skillBrandColor(meta)}`}
                                        >
                                            {#if iconSrc && !iconFailures[key]}
                                                <img src={iconSrc} alt="" on:error={() => markIconFailed(meta)} />
                                            {:else if isPluginSkill(meta)}
                                                <Plug size={18} />
                                            {:else}
                                                <span>{skillInitial(meta)}</span>
                                            {/if}
                                        </div>
                                        <div class="skill-copy">
                                            <div class="skill-title-row">
                                                <span class="skill-title">{skillDisplayName(meta)}</span>
                                                <span class="badge">{skillBadge(meta)}</span>
                                                {#if !meta.enabled}
                                                    <span class="badge muted">已停用</span>
                                                {/if}
                                            </div>
                                            <p class="skill-desc" title={skillSummary(meta)}>{skillSummary(meta)}</p>
                                        </div>
                                    </div>

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
    .skills-panel {
        display: flex;
        flex-direction: column;
        gap: 14px;
    }

    .skills-header,
    .group-head,
    .group-title-block,
    .skill-main,
    .skill-title-row,
    .skill-actions,
    .group-actions {
        display: flex;
        align-items: center;
        gap: 10px;
    }

    .skills-header,
    .group-head {
        justify-content: space-between;
    }

    h3 {
        margin: 0 0 4px;
        font-size: 16px;
        color: var(--text-primary, #fff);
    }

    .hint,
    .skill-desc {
        margin: 0;
        color: var(--text-secondary, #aaa);
        font-size: 12px;
        line-height: 1.45;
    }

    .skills-header button {
        display: inline-flex;
        align-items: center;
        gap: 6px;
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
        margin-top: 10px;
        padding: 8px 10px;
        font-size: 12px;
    }

    .skill-groups {
        display: flex;
        flex-direction: column;
        gap: 12px;
    }

    .skill-group {
        padding: 12px;
        border-radius: 12px;
        border: 1px solid var(--border-color, #333);
        background: color-mix(in srgb, var(--bg-primary, #1e1e1e) 65%, transparent);
    }

    .group-title-block {
        align-items: flex-start;
        min-width: 0;
    }

    .group-icon {
        width: 30px;
        height: 30px;
        border-radius: 10px;
        display: grid;
        place-items: center;
        color: var(--text-primary, #fff);
        background: rgba(255, 255, 255, 0.06);
        border: 1px solid var(--border-color, #333);
        flex: 0 0 auto;
    }

    .group-title {
        color: var(--text-primary, #fff);
        font-size: 14px;
        font-weight: 700;
    }

    .group-subtitle {
        margin-top: 3px;
        color: var(--text-secondary, #aaa);
        font-size: 12px;
        line-height: 1.4;
    }

    .group-actions {
        flex-shrink: 0;
        flex-wrap: wrap;
        justify-content: flex-end;
    }

    .skill-list {
        display: flex;
        flex-direction: column;
        gap: 10px;
        margin-top: 12px;
    }

    .skill-card {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        gap: 12px;
        align-items: center;
        padding: 12px;
        border-radius: 10px;
        border: 1px solid var(--border-color, #333);
        background: var(--bg-secondary, #252525);
    }

    .skill-card.disabled {
        opacity: 0.75;
    }

    .skill-main {
        min-width: 0;
    }

    .skill-icon {
        width: 38px;
        height: 38px;
        border-radius: 12px;
        display: grid;
        place-items: center;
        flex: 0 0 auto;
        overflow: hidden;
        background: color-mix(in srgb, var(--skill-color) 78%, #000);
        border: 1px solid var(--border-color, #333);
        color: #fff;
        font-weight: 700;
    }

    .skill-icon img {
        width: 100%;
        height: 100%;
        object-fit: contain;
        background: #fff;
    }

    .skill-icon span {
        display: grid;
        place-items: center;
        width: 100%;
        height: 100%;
    }

    .skill-copy {
        min-width: 0;
    }

    .skill-title-row {
        min-width: 0;
        flex-wrap: wrap;
    }

    .skill-title {
        color: var(--text-primary, #fff);
        font-size: 14px;
        font-weight: 700;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .skill-desc {
        margin-top: 5px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .badge {
        display: inline-flex;
        align-items: center;
        border-radius: 999px;
        border: 1px solid var(--border-color, #333);
        padding: 2px 7px;
        color: var(--text-secondary, #aaa);
        font-size: 11px;
        line-height: 1.4;
    }

    .badge.muted {
        color: var(--text-secondary, #888);
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

    .icon-button {
        width: 30px;
        height: 30px;
        padding: 0;
        border-radius: 8px;
        border: 1px solid var(--border-color, #333);
        background: rgba(255, 255, 255, 0.03);
        color: var(--text-secondary, #aaa);
        display: inline-flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
    }

    .icon-button:hover {
        background: rgba(255, 255, 255, 0.08);
    }

    .icon-button.danger {
        border-color: rgba(239, 68, 68, 0.45);
        color: rgba(239, 68, 68, 0.9);
    }

    @media (max-width: 720px) {
        .skills-header,
        .group-head {
            align-items: stretch;
            flex-direction: column;
        }

        .skill-card {
            grid-template-columns: 1fr;
        }

        .skill-actions,
        .group-actions {
            justify-content: flex-start;
        }
    }
</style>
