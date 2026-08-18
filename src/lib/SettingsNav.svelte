<script lang="ts">
    import { createEventDispatcher } from "svelte";

    export type SettingsItem = { id: number | string; name: string; children?: SettingsItem[] };

    export let items: SettingsItem[] = [];
    export let activeId: number | string | null = null;

    const dispatch = createEventDispatcher<{ select: { id: number | string } }>();

    const handleSelect = (id: number | string) => {
        dispatch("select", { id });
    };

    const isActive = (id: number | string) => activeId === id;

    const isBranchActive = (item: SettingsItem | undefined): boolean => {
        if (!item) return false;
        if (isActive(item.id)) return true;
        return Boolean(item.children?.some(child => isBranchActive(child)));
    };
</script>

<ul class="settings-nav" role="tree">
    {#each items as item (item.id)}
        <li class="nav-item" role="treeitem" aria-expanded={!!item.children}>
            <button
                type="button"
                class="label-button"
                class:active={isBranchActive(item)}
                on:click={() => handleSelect(item.id)}
                aria-current={isActive(item.id) ? "true" : undefined}
            >
                {item.name}
            </button>
            {#if item.children && item.children.length}
                <ul class="nav-children" role="group">
                    {#each item.children as child (child.id)}
                        <li class="nav-child" role="treeitem" aria-expanded={!!child.children}>
                            <button
                                type="button"
                                class="label-button child"
                                class:active={isBranchActive(child)}
                                on:click={() => handleSelect(child.id)}
                                aria-current={isActive(child.id) ? "true" : undefined}
                            >
                                {child.name}
                            </button>
                            {#if child.children && child.children.length}
                                <ul class="nav-children" role="group">
                                    {#each child.children as grand (grand.id)}
                                        <li class="nav-child" role="treeitem">
                                            <button
                                                type="button"
                                                class="label-button child"
                                                class:active={isActive(grand.id)}
                                                on:click={() => handleSelect(grand.id)}
                                                aria-current={isActive(grand.id) ? "true" : undefined}
                                            >
                                                {grand.name}
                                            </button>
                                        </li>
                                    {/each}
                                </ul>
                            {/if}
                        </li>
                    {/each}
                </ul>
            {/if}
        </li>
    {/each}
    <slot />
    <!-- slot allows extra entries like “open settings.json” link -->
</ul>

<style lang="scss">
    .settings-nav {
        margin: 0;
        padding: 0.5rem 0;
        list-style: none;
        user-select: none;
    }
    .nav-item,
    .nav-child {
        padding-left: 1rem;
    }
    .label-button {
        width: 100%;
        display: flex;
        align-items: center;
        justify-content: flex-start;
        gap: 0.5rem;
        min-height: 1.5rem;
        font-size: 14px;
        background: transparent;
        border: none;
        color: var(--window-foreground);
        cursor: pointer;
        text-align: left;
        padding: 0.125rem 0.25rem;
        border-radius: 6px;
        transition: background 0.2s ease, color 0.2s ease;

        &:hover {
            background: rgba(148, 163, 184, 0.12);
        }

        &.active {
            color: var(--accent-color, #3b82f6);
            background: rgba(59, 130, 246, 0.12);
            font-weight: 600;
        }
    }
    .label-button.child {
        font-size: 13px;
        padding-left: 0.75rem;
    }
    .nav-children {
        list-style: none;
        margin: 0;
        padding-left: 0.75rem;
    }
    :global(#json) {
        display: inline-block;
    }

    /* Keep divider width similar to sidebar look */
    :global(.divider) {
        width: 2.3rem;
        height: 0.0625rem;
        margin: 0.25rem auto;
    }
</style>

