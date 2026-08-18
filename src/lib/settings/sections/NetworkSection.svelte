<script lang="ts">
    import type { Action } from "svelte/action";
    import Select from "../../utility/Select.svelte";

    const noopAction: Action<HTMLElement, unknown> = () => ({ destroy() {} });
    const noopHandler = () => {};

    type ProxyField = "http" | "https" | "noProxy";

    export let translate: (key: string, params?: Record<string, string | number>) => string = key => key;
    export let categoryAnchor: Action<HTMLElement, unknown> = noopAction;
    export let proxyMode: string = "auto";
    export let proxyHttp = "";
    export let proxyHttps = "";
    export let proxyNoProxy = "";
    export let onProxyModeChange: (value: string) => void = noopHandler;
    export let onProxyFieldInput: (field: ProxyField, value: string) => void = noopHandler;
    export let onProxyFieldCommit: (field: ProxyField) => void = noopHandler;

    $: proxyModeItems = [
        { id: "auto", value: "auto", name: translate("settings.proxyModeAuto") },
        { id: "manual", value: "manual", name: translate("settings.proxyModeManual") },
        { id: "direct", value: "direct", name: translate("settings.proxyModeDirect") }
    ];

    $: manualDisabled = proxyMode !== "manual";

    function handleProxyModeSelect(event: CustomEvent<{ value: string }>) {
        onProxyModeChange(event?.detail?.value ?? "");
    }

    function handleProxyInput(field: ProxyField, event: Event) {
        const input = event.target as HTMLInputElement | null;
        onProxyFieldInput(field, input?.value ?? "");
    }

    function handleProxyBlur(field: ProxyField) {
        onProxyFieldCommit(field);
    }
</script>

<div class="settings-category" use:categoryAnchor>
    <div class="heading">{translate("settings.network")}</div>
    <div class="content">
        <Select
            label={translate("settings.proxyMode")}
            items={proxyModeItems}
            selected={proxyMode}
            on:select={handleProxyModeSelect}
        />
        <div class="proxy-fields">
            <div class="settings-input">
                <label for="proxy-http">{translate("settings.httpProxy")}:</label>
                <input
                    id="proxy-http"
                    type="text"
                    value={proxyHttp}
                    disabled={manualDisabled}
                    on:input={(event) => handleProxyInput("http", event)}
                    on:blur={() => handleProxyBlur("http")}
                />
            </div>
            <div class="settings-input">
                <label for="proxy-https">{translate("settings.httpsProxy")}:</label>
                <input
                    id="proxy-https"
                    type="text"
                    value={proxyHttps}
                    disabled={manualDisabled}
                    on:input={(event) => handleProxyInput("https", event)}
                    on:blur={() => handleProxyBlur("https")}
                />
            </div>
            <div class="settings-input">
                <label for="proxy-noproxy">{translate("settings.noProxy")}:</label>
                <input
                    id="proxy-noproxy"
                    type="text"
                    value={proxyNoProxy}
                    disabled={manualDisabled}
                    on:input={(event) => handleProxyInput("noProxy", event)}
                    on:blur={() => handleProxyBlur("noProxy")}
                />
            </div>
        </div>
        {#if proxyMode === "manual"}
            <div class="hint-text">{translate("settings.proxyManualHint")}</div>
        {/if}
        <div class="hint-text restart">{translate("settings.proxyRestartHint")}</div>
    </div>
</div>

<style>
    .proxy-fields {
        display: flex;
        flex-direction: column;
        gap: 12px;
        margin-top: 12px;
    }

    .settings-input label {
        display: block;
        font-size: 0.9rem;
        margin-bottom: 4px;
        color: var(--window-inputLabelForeground);
    }

    .settings-input input {
        width: 100%;
        padding: 0.6em 0.8em;
        border: none;
        border-radius: 6px;
        background: var(--window-inputBackground);
        color: var(--window-inputForeground);
    }

    .settings-input input:disabled {
        background: var(--window-inputDisabledBackground, rgba(148, 163, 184, 0.1));
        color: var(--window-inputDisabledForeground, rgba(148, 163, 184, 0.7));
        cursor: not-allowed;
    }

    .hint-text {
        margin-top: 8px;
        font-size: 12px;
        color: var(--text-muted, #9ca3af);
    }

    .hint-text.restart {
        color: var(--warning-color, #f59e0b);
    }
</style>
