<script lang="ts">
    import { afterUpdate } from 'svelte';
    export let menu;

    export let right = false;

    let button = null;
    let dropdownList = null;
    let open = false;

    afterUpdate(() => {
        if (open && dropdownList) {
            const { height , left, width, top } = button.getBoundingClientRect();
            dropdownList.style.top = `${height}px`;
            if (right) {
                dropdownList.style.right = `0px`;
                dropdownList.style.left = `auto`;
            }
            else {
                dropdownList.style.left = `${0}px`;
            }
        }
    })
</script>

<svelte:window on:click={(e) => {
    if (open && !button.contains(e.target)) {
        open = false;
    }
}}></svelte:window>

<!-- svelte-ignore a11y-click-events-have-key-events -->
<div bind:this={button} class="menu-button" class:open on:click={() => {open = !open}}>
    {#if menu.icon}
        <svelte:component this={menu.icon}></svelte:component>
    {:else}
        {menu.menuname}
    {/if}
    {#if open}
        <div bind:this={dropdownList} class="menu-list">
            {#each menu.children as child}
                <!-- svelte-ignore a11y-click-events-have-key-events -->
                <div
                    class="menu-item"
                    class:disabled={child.disabled}
                    title={child.title}
                    on:click={() => {
                    if (!child.disabled) {
                        child.action();
                    }
                }}>
                    <span class="item-copy">
                        <span class="item-primary">
                            <span class="item-name">
                                {child.name}
                            </span>
                            {#if child.subtitle}
                                <span class="item-subtitle">{child.subtitle}</span>
                            {/if}
                        </span>
                    </span>
                    {#if child.shortcut}
                        <span class="shortcut">{child.shortcut}</span>
                    {/if}
                </div>
            {/each}
        </div>
    {/if}
</div>

<style lang="scss">
    .menu-button {
        height: calc(100% - 6px);
        margin: 3px 0;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 1.0rem;
        min-width: 2.2rem;
        padding: 0 8px;
        position: relative;
        cursor: pointer;
        border-radius: 4px;
        transition: all 0.2s ease;
        :global(svg) {
            width: 18px;
            height: 18px;
        }
    }
    .menu-list {
        position: absolute;
        display: flex;
        flex-direction: column;
        justify-content: center;
        min-width: 11.5rem;
        width: max-content;
        align-items: center;
        border-radius: 3px;
        z-index: 9999;
    }
    .menu-item {
        display: flex;
        align-items: center;
        justify-content: space-between;
        height: 17px;
        padding: 7px 0;
        width: 100%;
        font-size: 0.875rem;
        cursor: pointer;
    }
    .item-copy {
        display: flex;
        align-items: center;
        min-width: 0;
    }
    .item-primary {
        display: inline-flex;
        align-items: center;
        gap: 10px;
        min-width: 0;
    }
    .item-name, .shortcut {
        padding: 0 10px;
    }
    .item-subtitle {
        padding-right: 10px;
        font-size: 0.75rem;
        line-height: 1.2;
        color: #d97706;
        font-weight: 600;
        white-space: nowrap;
    }
    .shortcut {
        margin-left: 20px;
        align-self: center;
    }
    .disabled {
        cursor: not-allowed;
    }
</style>
