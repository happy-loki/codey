<script lang="ts">
    import type { Action } from "svelte/action";
    import Select from "../../utility/Select.svelte";
    import type { UpdateState } from "../../updater";

    const noopAction: Action<HTMLElement, unknown> = () => ({ destroy() {} });
    const noopHandler = () => {};

    export let translate: (key: string, params?: Record<string, string | number>) => string = key => key;
    export let appVersion = "";
    export let autoCheckUpdates = true;
    export let updateStatus = "";
    export let lastCheckedLabel = "";
    export let updateState: UpdateState = { phase: "idle" };
    export let onAutoCheckSelect: (event: CustomEvent) => void = noopHandler;
    export let onCheckUpdates: () => void = noopHandler;
    export let onInstallUpdate: () => void = noopHandler;
    export let onRestartUpdate: () => void = noopHandler;
    export let onRetryUpdate: () => void = noopHandler;
    export let categoryAnchor: Action<HTMLElement, unknown> = noopAction;
    export let overviewAnchor: Action<HTMLElement, unknown> = noopAction;
    export let updatesDisabled = false;

    $: onLabel = translate("settings.on");
    $: offLabel = translate("settings.off");
    $: autoCheckSelected = autoCheckUpdates ? onLabel : offLabel;
    $: isChecking = updateState?.phase === "checking" || updateState?.phase === "downloading";
    $: updatePhase = updateState?.phase ?? "idle";
</script>

<div class="settings-category" use:categoryAnchor>
    <div class="heading">{translate("settings.about")}</div>
    <div class="content updates-content" use:overviewAnchor>
        <p class="about-version">
            {translate("settings.aboutCurrentVersion", {
                version: appVersion ? appVersion : translate("settings.appVersionLoading")
            })}
        </p>
        {#if !updatesDisabled}
            <Select
                label={translate("settings.autoUpdate")}
                items={[
                    { id: "on", name: onLabel },
                    { id: "off", name: offLabel }
                ]}
                selected={autoCheckSelected}
                defaultValue={onLabel}
                on:select={onAutoCheckSelect}
            />
            <p class="hint-text updates-hint">{translate("settings.autoUpdateHint")}</p>
        {:else}
            <p class="hint-text updates-hint">
                {translate("settings.updatesDisabledHint")}
            </p>
        {/if}
        <div class="updates-status-block">
            <div class="updates-status-line">
                <span class="status-label">{translate("settings.updateStatusLabel")}</span>
                <span class="status-value">{updateStatus}</span>
            </div>
            {#if lastCheckedLabel}
                <div class="updates-status-line muted">
                    {translate("settings.lastCheckedAt", { time: lastCheckedLabel })}
                </div>
            {/if}
            {#if updateState?.version && updatePhase !== "idle"}
                <div class="updates-status-line muted">
                    {translate("settings.updateVersionLabel", { version: updateState.version })}
                </div>
            {/if}
            {#if updateState?.notes}
                <details class="update-notes">
                    <summary>{translate("settings.updateReleaseNotes")}</summary>
                    <p>{updateState.notes}</p>
                </details>
            {/if}
        </div>
        <div class="thanks-block">
            <div class="thanks-heading">{translate("settings.aboutThanksHeading")}</div>
            <p class="thanks-description">{translate("settings.aboutThanksDescription")}</p>
            <ul>
                <li><a href="https://github.com/excalidraw/excalidraw" target="_blank" rel="noreferrer">Excalidraw</a></li>
                <li><a href="https://github.com/jgraph/drawio" target="_blank" rel="noreferrer">draw.io</a></li>
                <li><a href="https://github.com/lucide-icons/lucide" target="_blank" rel="noreferrer">Lucide Icons</a></li>
                <li><a href="https://github.com/doocs/md" target="_blank" rel="noreferrer">doocs.md</a></li>
                <li><a href="https://github.com/catppuccin/catppuccin" target="_blank" rel="noreferrer">Catppuccin</a></li>
            </ul>
        </div>
        {#if !updatesDisabled}
            <div class="updates-actions">
                <button type="button" class="primary" on:click={onCheckUpdates} disabled={isChecking}>
                    {translate("settings.checkForUpdates")}
                </button>
                {#if updatePhase === "available"}
                    <button type="button" class="primary" on:click={onInstallUpdate}>
                        {translate("settings.downloadUpdate")}
                    </button>
                {:else if updatePhase === "downloading"}
                    <button type="button" class="secondary" disabled>
                        {translate("settings.downloading")}
                        {#if typeof updateState?.progress === "number"}
                            &nbsp;{Math.round(updateState.progress)}%
                        {/if}
                    </button>
                {:else if updatePhase === "ready"}
                    <button type="button" class="primary" on:click={onRestartUpdate}>
                        {translate("settings.restartToUpdate")}
                    </button>
                {/if}
            </div>
        {/if}
</div>
</div>

<style>
    .thanks-block {
        margin-top: 24px;
        padding: 16px;
        border-radius: 12px;
        border: 1px solid rgba(15, 23, 42, 0.12);
        background: rgba(241, 245, 249, 0.4);
    }

    .thanks-heading {
        font-weight: 600;
        margin-bottom: 8px;
    }

    .thanks-description {
        margin: 0 0 8px;
        color: rgba(15, 23, 42, 0.72);
    }

    .thanks-block ul {
        margin: 0;
        padding-left: 16px;
        color: rgba(15, 23, 42, 0.86);
    }

    .thanks-block a {
        color: inherit;
        text-decoration: underline;
    }
</style>
