<script lang="ts">
    import { ChevronDown } from "lucide-svelte";
    import { afterUpdate, createEventDispatcher, onMount } from "svelte";
    const dispatch = createEventDispatcher();

    export let label: string;
    export let items = [
        {id: 0, name: "No items listed"},
    ];

    let open = false;
    let button;
    let list;
    export let selected = items[0]?.value ?? items[0]?.name ?? "";
    export let defaultValue: string | null = null;

    function itemValue(item) {
        return item?.value ?? item?.name ?? "";
    }

    function itemDisplay(item) {
        return item?.label ?? item?.name ?? "";
    }

    function findItemByValue(value) {
        return items.find(item => itemValue(item) === value);
    }

    function resolveDisplay(value) {
        const found = findItemByValue(value);
        if (found) return itemDisplay(found);
        return value ?? "";
    }

    let currentSelection = resolveDisplay(selected);
    let default_value = defaultValue ?? selected;

    function handleSelect(item) {
        const value = itemValue(item);
        currentSelection = itemDisplay(item);
        selected = value;
        dispatch("select", { selection: item, value });
    }

    afterUpdate(() => {
        if (open && list) {
            const { width, height, top } = list.getBoundingClientRect();
            //list.style.width = `${width}px`;
            //button.style.width = `${width}px`;
        }
    })

    $: if (!selected && items.length > 0) {
        selected = itemValue(items[0]);
    }

    $: currentSelection = resolveDisplay(selected);

    $: {
        if (defaultValue !== null && defaultValue !== default_value) {
            default_value = defaultValue;
        } else if (default_value == null) {
            default_value = defaultValue ?? selected;
        }
    }
</script>

<svelte:window on:click={(e) => {
    if (open && !button.contains(e.target)) {
        open = false;
    }
}}></svelte:window>

<div class="select">
    <label for="selectButton" class="label">{label}:</label>
    <div class="select-list" class:open>
        <button name="selectButton" bind:this={button} on:click={() => {open = !open}}>
            <span>{currentSelection}</span>
            <span class="arrow"><ChevronDown></ChevronDown></span>
        </button>
        {#if open}
            <div bind:this={list} class="item-list">
                {#each items as item}
                    <button
                        type="button"
                        id={item.id.toString()}
                        class="item"
                        on:click={() => {
                            handleSelect(item);
                            open = false;
                        }}
                    >
                        {itemDisplay(item)}
                        {#if default_value === itemValue(item)}
                            <span class="default">default</span>
                        {/if}
                    </button>
                {/each}
            </div>
        {/if}
    </div>
</div>

<style lang="scss">
    .select {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        justify-content: center;
        margin: 10px 0;
    }
    .label {
        font-size: 0.9rem;
    }
    .open {
        .arrow {
            transform: rotateZ(180deg) !important;
        }
    }
    .select-list {
        min-width: 15rem;
        button {
            display: flex;
            align-items: center;
            justify-content: space-between;
            min-height: 2rem;
            width: 100%;
            padding: 0 20px;
            span {
                display: flex;
                align-items: center;
                &:nth-child(1) {
                    margin-right: 5px;
                }
                &.arrow {
                    transform: rotateZ(0);
                    transition: 0.2s;
                    margin-top: 3px;
                }
            }
        }
    }
    .item-list {
        position: relative;
        top: 1px;
        max-height: 15rem;
        overflow-y: overlay;
        z-index: 1;
        --scrollbar-size: 12px;
        --scrollbar-thumb-border: 2px;
        .item {
            display: flex;
            align-items: center;
            min-height: 2rem;
            justify-content: space-between;
            cursor: pointer;
            padding: 0 20px;
            width: 100%;
            background: transparent;
            border: none;
            color: inherit;
            text-align: left;

            &:hover,
            &:focus-visible {
                background: rgba(148, 163, 184, 0.08);
                outline: none;
            }
        }
    }
    .default {
        color: var(--window-menuShortcutForeground);
    }
</style>
