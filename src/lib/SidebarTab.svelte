<script lang="ts">
    export let id:string;
    export let active = false;
    export let label: string;
</script>

<!-- svelte-ignore a11y-click-events-have-key-events -->
<div
    {id}
    class="sidebar-tab"
    class:active
    title={label}
    aria-label={label}
    on:click
>
    <span class="icon">
        <slot></slot>
    </span>
</div>

<style lang="scss">
    .sidebar-tab {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 0;
        width: 100%;
        height: var(--sidebar-tab-height, 2.4rem);
        margin: 0;
        padding: 0;
        border-radius: var(--sidebar-radius, 4px);
        cursor: pointer;
        color: inherit;
        text-decoration: none;
        text-align: center;
    }
    .sidebar-tab .icon {
        display: flex;
        align-items: center;
        justify-content: center;
    }
    .sidebar-tab :global(svg) {
        width: var(--sidebar-icon-size, 22px);
        height: var(--sidebar-icon-size, 22px);
        transition: width 0.12s ease, height 0.12s ease;
    }
</style>
