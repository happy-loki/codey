<script lang="ts">
    import { createEventDispatcher } from "svelte";

    export let title: string;
    export let description = "";
    export let open = false;

    let popup = null;
    let wrapper = null;

    const dispatch = createEventDispatcher();

    function handleClick(e) 
    {
        if (e.target === wrapper) {
            open = false;   
        }
    }
</script>

{#if open}
    <!-- svelte-ignore a11y-click-events-have-key-events -->
    <div class="popup-wrapper" bind:this={wrapper} on:click={handleClick}>
        <div class="popup-container" bind:this={popup}>
            <div class="popup-header">
                <span class="title">{title}</span>
            </div>
            <div class="popup-content">
                <p class="description">{description}</p>
                <div class="content">
                    <slot></slot>
                </div>
                <div class="button-group">
                    <slot name="buttons"></slot>
                </div>
            </div>
        </div>
    </div>
{/if}

<style lang="scss">
    .popup-wrapper {
        position: fixed;
        top: 0;
        left: 0;
        display: flex;
        justify-content: center;
        align-items: center;
        width: 100vw;
        height: 100vh;
        z-index: 100050; /* above workspace overlays and context UI */
        pointer-events: none; /* 不拦截底层交互，保持非模态 */
        background: transparent !important; /* 覆盖主题里的半透明遮罩，避免视觉上“遮住整个应用” */
    }
    .popup-container {
        position: static;
        min-height: unset;
        min-width: 320px;
        max-width: 480px;
        width: auto;
        border-radius: 4px;
        border: 1px solid var(--vscode-panel-border, rgba(128, 128, 128, 0.35));
        pointer-events: auto; /* 仅对话框自身可交互 */
    }
    /* 移除大尺寸自适应，让输入弹窗保持小巧 */
    @media(min-width: 42rem) { .popup-container { max-height: 90%; } }
    @media(min-width: 66rem) { .popup-container { max-height: 84%; } }
    @media(min-width: 82rem) { .popup-container { max-height: 84%; } }
    .popup-header {
        display: flex;
        align-items: center;
        padding: 1.5rem 3rem 0.5rem 1rem;
        font-size: 1.25rem;
    }
    .popup-content {
        display: flex;
        padding: 1rem 3rem 0.5rem 1rem;
        flex-direction: column;
        justify-content: center;
        .description {
            margin-top: -5px;
            font-size: 0.9rem;
        }
        .content {
            width: 100%;
        }
        .button-group {
            width: 100%;
            display: flex;
            align-items: center;
            justify-content: center;
            margin-top: 40px;
            margin-bottom: 30px;
            :global(button) {
                min-width: 90px;
                height: 35px;
                border-radius: 2px;
                margin: 0 10px;
                display: flex;
                justify-content: center;
                align-items: center;
                cursor: pointer;
                padding: 0 10px;
                font-size: 15px;
            }
        }
    }
</style>
