<script lang="ts">
    import { toasts } from "./notifications";
    import NotificationToast from "./NotificationToast.svelte";
</script>
<div id="notificationtoasts">
    {#each $toasts as toast}
        <NotificationToast id={toast.id} type={toast.type} title={toast.title} message={toast.message} actions={toast.actions} />
    {/each}
</div>

<style lang="scss">
    #notificationtoasts {
        width: 32rem;
        height: calc(80% - 2rem);
        position: fixed;
        top: 5%;
        right: 1rem;
        padding: 1.5rem 0 10px;
        box-sizing: border-box;
        display: flex;
        flex-direction: column;
        justify-content: flex-start;
        pointer-events: none;
        z-index: 100060;
    }

    #notificationtoasts :global(.notification-toast) {
        pointer-events: auto;
    }
</style>
