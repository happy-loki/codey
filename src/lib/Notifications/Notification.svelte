<script lang="ts">
    import { getTime } from "../../config/config";
    import { closeNotification, updateReadStatus } from "./notifications";
    import { t } from "../i18n";
    import { Info, AlertTriangle, CircleX, X } from "lucide-svelte";

    export let id;
    export let type = "";
    export let title = "";
    export let message = "";
    export let read = false;
    export let actions = [];

    let notification: HTMLElement | null;
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
    $: markLabel = read ? $t("notifications.markAsUnread") : $t("notifications.markAsRead");
</script>

<div class="info">
    <span>{getTime()}</span>
    <!-- svelte-ignore a11y-click-events-have-key-events -->
    <span class="mark-read" on:click|preventDefault={() => {
            read = !read
            updateReadStatus(id, read); 
        }
    }>
        {markLabel}
    </span>
</div>
<div bind:this={notification} class="notification" class:error={type === "Error"} class:warning={type === "Warning"} class:read>
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
        <span class="close-button" on:click={() => {closeNotification(id)}}>
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
    .info {
        color: #6d6d6d;
        font-weight: 200;
        font-size: 0.7rem;
        margin-bottom: 0.5rem;
        margin-top: 0.2rem;
        display: flex;
        align-items: center;
        span {
            margin: 0 5px;
        }
        .mark-read {
            text-decoration: underline;
            cursor: pointer;
            &:hover {
                color: #939393;
            }
        }
    }
    .notification {
        display: flex;
        min-height: $notification-height;
        margin-bottom: 0.8rem;
        position: relative;
        flex-direction: column;
        justify-content: center;
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
                color: $warning-color;
            }
        }
        &.error {
            border-top: 3px solid $error-color;
            .icon {
                color: $error-color;
            }
        }
        &.read {
            .action-button {
                color: #bdd4ff75 !important;
            }
            :global(.bx--toast-notification__close-button .bx--toast-notification__close-icon) {
                fill: #bdd4ff75 !important;
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
            .icon {
                border-radius: 50%;
                min-width: 20px;
                min-height: 20px;
                margin-right: 10px;
            }
        }
        .message {
            font-size: 15px;
            color: #6d6d6d;
            margin: 0.5rem 0;
            margin-left: 2.4rem;
            margin-top: -0.5rem;
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
