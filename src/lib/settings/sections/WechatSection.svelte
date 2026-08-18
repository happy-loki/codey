<script lang="ts">
    import type { Action } from "svelte/action";
    import Input from "../../utility/Input.svelte";
    import type { WechatConnectionState, WechatSettings } from "../types";

    const noopAction: Action<HTMLElement, unknown> = () => ({ destroy() {} });
    const noopHandler = () => {};

    export let translate: (key: string, params?: Record<string, string | number>) => string = key => key;
    export let wechatSettings: WechatSettings = { appId: "", appSecret: "" };
    export let wechatConnectionState: WechatConnectionState = "idle";
    export let wechatConnectionError = "";
    export let wechatConnecting = false;
    export let wechatConnectionLabel = "";
    export let onAppIdInput: (event: CustomEvent) => void = noopHandler;
    export let onAppSecretInput: (event: CustomEvent) => void = noopHandler;
    export let onConnect: () => void = noopHandler;
    export let categoryAnchor: Action<HTMLElement, unknown> = noopAction;
    export let credentialsAnchor: Action<HTMLElement, unknown> = noopAction;
    export let connectionAnchor: Action<HTMLElement, unknown> = noopAction;
</script>

<div class="settings-category" use:categoryAnchor>
    <div class="heading">{translate("settings.wechat")}</div>
    <div class="content">
        <div class="settings-group" use:credentialsAnchor>
            <div class="group-title group-title-cn">{translate("settings.wechatCredentials")}</div>
            <Input
                _class="settings-input"
                label={translate("settings.wechatAppId")}
                placeholder="wx..."
                value={wechatSettings.appId}
                on:d_input={onAppIdInput}
                trapShortcuts={false}
            />
            <Input
                _class="settings-input"
                label={translate("settings.wechatAppSecret")}
                placeholder="xxxxxxxx"
                value={wechatSettings.appSecret}
                on:d_input={onAppSecretInput}
                trapShortcuts={false}
            />
        </div>

        <div class="settings-group" use:connectionAnchor>
            <div class="group-title group-title-cn">{translate("settings.wechatConnection")}</div>
            <p class="group-hint">{translate("settings.wechatConnectionWhitelistHint")}</p>
            <div class="wechat-connect-row">
                <button
                    type="button"
                    class="connect-button"
                    class:busy={wechatConnecting}
                    on:click={onConnect}
                    disabled={wechatConnecting}
                >
                    {#if wechatConnecting}
                        {translate("settings.wechatConnecting")}
                    {:else}
                        {translate("settings.wechatConnect")}
                    {/if}
                </button>
                <div
                    class="connection-status"
                    class:success={wechatConnectionState === "success"}
                    class:error={wechatConnectionState === "error"}
                >
                    <span class="status-text">{wechatConnectionLabel}</span>
                    {#if wechatConnectionError}
                        <span class="error-text">{wechatConnectionError}</span>
                    {/if}
                </div>
            </div>
        </div>
    </div>
</div>

<style>
    /* 仅在微信分区内修正中文标题的显示，避免全局 uppercase 与过大字距 */
    .group-title-cn {
        text-transform: none;
        letter-spacing: normal;
    }
</style>
