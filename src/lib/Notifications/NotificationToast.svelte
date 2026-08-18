<script lang="ts">
    import { onMount } from "svelte";
    import { closeToast } from "./notifications";
    import { t } from "../i18n";
    import { fade } from "svelte/transition";
    import { Info, AlertTriangle, CircleX, X } from "lucide-svelte";

    export let id: number;
    export let type = "";
    export let title = "";
    export let message = "";
    export let actions = [];

    let notification: HTMLElement | null;

    onMount(() => {
        let timer = setTimeout(() => {
            notification.remove();
            closeToast(id)
            clearTimeout(timer);
        }, 100000)
        return () => {
            clearTimeout(timer)
        }
    })

    $: typeDisplay = (() => {
        const raw = typeof type === "number"
            ? ["Message", "Warning", "Error", "Success"][type] ?? ""
            : String(type ?? "");
        if (!raw) {
            return "";
        }
        const key = `notifications.types.${raw.toLowerCase()}`;
        const translated = $t(key);
        return translated === key ? raw : translated;
    })();

    $: titlePrefix = typeDisplay ? `${typeDisplay}: ` : "";
</script>

<div bind:this={notification} class="notification-toast" class:error={type === "Error"} class:warning={type === "Warning"} transition:fade={{ duration: 150 }}>
    <div class="notification-info">
        <div class="details">
            <div class="icon">
                {#if type === "Error"}
                    <CircleX />
                {:else if type === "Warning"}
                    <AlertTriangle />
                {:else}
                    <Info />
                {/if}
            </div>
            <div class="title">{titlePrefix}{title}</div>
        </div>
        <!-- svelte-ignore a11y-click-events-have-key-events -->
        <span class="close-button" on:click={() => {closeToast(id)}}>
            <X size={14} />
        </span>
    </div>

    <div class="message">{message}</div>

    {#if actions.length > 0}
    <div class="actions">
        {#each actions as action}
        <!-- svelte-ignore a11y-click-events-have-key-events -->
        <div class="action-button" on:click={action.action}>{action.label}</div>
        {/each}
    </div>
    {/if}
</div>

<style lang="scss">
    $notification-height: 3rem;
    $notification-border-width: 1px;
    $error-color: #c02b2b;
    $warning-color: #ffeb10;
    .notification-toast {
        display: flex;
        min-height: $notification-height;
        margin-bottom: 0.8rem;
        position: relative;
        flex-direction: column;
        justify-content: center;
        z-index: 100061;
        width: min(32rem, calc(100vw - 2rem));
        max-width: 520px; /* 放大提示框宽度 */
        pointer-events: auto;
        .icon {
            display: flex;
            align-items: center;
            justify-content: center;
            :global(svg) {
                height: 22px;
                width: 22px;
            }
        }
        &.warning {
            border-top: 3px solid $warning-color;
            .icon {
                color: $warning-color !important;
            }
        }
        &.error {
            border-top: 3px solid $error-color;
            .icon {
                color: $error-color !important;
            }
        }
        &::before {
            position: absolute;
            height: 100%;
            width: 100%;
            border-width: 0 $notification-border-width $notification-border-width $notification-border-width;
            border-style: solid;
            box-sizing: border-box;
            content: "";
        }
        .notification-info {
            display: flex;
            justify-content: space-between;
            min-height: 3rem;
        }
        .details {
            display: flex;
            margin: 0 0.5rem;
            position: relative;
            top: -1px;
            align-items: center;
            flex: 1;
            min-width: 0; /* 允许flex子元素收缩 */
            .icon {
                border-radius: 50%;
                min-width: 20px;
                min-height: 20px;
                margin-right: 10px;
                flex-shrink: 0; /* 图标不收缩 */
            }
        }
        .title {
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            max-width: 280px; /* 限制标题最大宽度 */
        }
        .message {
            font-size: 15px;
            color: #6d6d6d;
            margin: 0.5rem 0;
            margin-left: 2.4rem;
            margin-top: -0.5rem;
            line-height: 1.35;
            white-space: normal;
            word-break: break-word;
            max-width: calc(100% - 3rem);
        }
        .actions {
            display: flex;
            margin: 0 0.5rem;
            position: relative;
            top: -1px;
            align-items: center;
            margin-left: 2.4rem;
            margin-bottom: 0.5rem;
            .action-button {
                display: flex;
                justify-content: center;
                align-items: center;
                cursor: pointer;
                &:nth-child(2) {
                    margin: 0 0.6rem;
                }
                &:hover {
                    text-decoration: underline;
                }
            }
        }
        .close-button {
            padding: 4px;
            display: flex;
            align-items: center;
            justify-content: center;
            border-radius: 3px;
            margin: 0 0.5rem;
            cursor: pointer;
            color: #6d6d6d;
            transition: all 0.15s ease;
            z-index: 10;
            &:hover {
                background: rgba(239, 68, 68, 0.1);
                color: #ef4444;
            }
        }
    }
</style>
