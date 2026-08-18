<script lang="ts">
    import { confirmModalState, resolveConfirmModal } from "./confirmModalStore";
    import Button from "./Button.svelte";

    function handleKeydown(event: KeyboardEvent) {
        if (!$confirmModalState.open) return;
        if (event.key === "Escape") {
            event.preventDefault();
            resolveConfirmModal(false);
            return;
        }
        if (event.key === "Enter") {
            event.preventDefault();
            resolveConfirmModal(true);
        }
    }
</script>

<svelte:window on:keydown={handleKeydown} />

{#if $confirmModalState.open}
    <!-- svelte-ignore a11y-click-events-have-key-events -->
    <div class="confirm-backdrop" role="presentation" on:click={() => resolveConfirmModal(false)}>
        <!-- svelte-ignore a11y-no-static-element-interactions -->
        <div class="confirm-modal" role="dialog" aria-modal="true" on:click|stopPropagation>
            <div class="confirm-modal__title">{$confirmModalState.title}</div>
            <div class="confirm-modal__message">{$confirmModalState.message}</div>
            <div class="confirm-modal__actions">
                <Button
                    style="secondary"
                    label={$confirmModalState.cancelLabel}
                    on:click={() => resolveConfirmModal(false)}
                />
                <Button
                    style={$confirmModalState.confirmStyle}
                    label={$confirmModalState.confirmLabel}
                    on:click={() => resolveConfirmModal(true)}
                />
            </div>
        </div>
    </div>
{/if}

<style>
    .confirm-backdrop {
        position: fixed;
        inset: 0;
        z-index: 2000;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 24px;
        background: rgba(0, 0, 0, 0.35);
        backdrop-filter: blur(2px);
    }

    .confirm-modal {
        width: min(440px, calc(100vw - 48px));
        border-radius: 12px;
        padding: 18px 18px 16px;
        background: var(--bg-secondary, #ffffff);
        color: var(--text-primary, #111827);
        border: 1px solid var(--border-color, rgba(17, 24, 39, 0.12));
        box-shadow: 0 18px 50px rgba(0, 0, 0, 0.18);
        display: flex;
        flex-direction: column;
        gap: 10px;
    }

    .confirm-modal__title {
        font-size: 15px;
        font-weight: 650;
        margin: 0;
        letter-spacing: 0.2px;
    }

    .confirm-modal__message {
        font-size: 13px;
        line-height: 1.5;
        color: var(--text-secondary, rgba(17, 24, 39, 0.72));
        margin: 0;
        white-space: pre-wrap;
    }

    .confirm-modal__actions {
        display: flex;
        justify-content: flex-end;
        gap: 10px;
        padding-top: 6px;
    }

    .confirm-modal__actions :global(.action-button) {
        height: 32px;
        min-width: 96px;
        padding: 0 12px;
        border-radius: 8px;
        border: 1px solid transparent;
        font-size: 13px;
        font-weight: 600;
        letter-spacing: 0.2px;
    }

    .confirm-modal__actions :global(.action-button.secondary) {
        background: transparent;
        color: var(--text-primary, #111827);
        border-color: color-mix(
            in srgb,
            var(--text-primary, #111827) 18%,
            transparent
        );
    }

    .confirm-modal__actions :global(.action-button.secondary:hover:not(:disabled)) {
        background: color-mix(
            in srgb,
            var(--text-primary, #111827) 6%,
            transparent
        );
    }

    .confirm-modal__actions :global(.action-button.danger) {
        background: var(--error-color, #ef4444);
        color: #ffffff;
    }

    .confirm-modal__actions :global(.action-button.danger:hover:not(:disabled)) {
        background: var(--error-hover, #dc2626);
    }

    .confirm-modal__actions :global(.action-button:disabled) {
        opacity: 0.6;
        cursor: not-allowed;
    }

    :global(.dark) .confirm-backdrop,
    :global(html[data-theme="dark"]) .confirm-backdrop {
        background: rgba(3, 7, 18, 0.55);
    }

    :global(.dark) .confirm-modal,
    :global(html[data-theme="dark"]) .confirm-modal {
        background: var(--bg-secondary, var(--editor-background, #111827));
        color: var(--text-primary, var(--editor-foreground, #ffffff));
        border-color: var(--border-color, rgba(255, 255, 255, 0.12));
    }

    :global(.dark) .confirm-modal__message,
    :global(html[data-theme="dark"]) .confirm-modal__message {
        color: var(--text-secondary, rgba(255, 255, 255, 0.72));
    }

    :global(.dark) .confirm-modal__actions :global(.action-button.secondary),
    :global(html[data-theme="dark"]) .confirm-modal__actions :global(.action-button.secondary) {
        color: var(--text-primary, var(--editor-foreground, #ffffff));
        border-color: color-mix(
            in srgb,
            var(--text-primary, var(--editor-foreground, #ffffff)) 18%,
            transparent
        );
    }

    :global(.dark) .confirm-modal__actions :global(.action-button.secondary:hover:not(:disabled)),
    :global(html[data-theme="dark"]) .confirm-modal__actions :global(.action-button.secondary:hover:not(:disabled)) {
        background: color-mix(
            in srgb,
            var(--text-primary, var(--editor-foreground, #ffffff)) 6%,
            transparent
        );
    }
</style>
