<script lang="ts">
    import { t } from "../i18n";

    export let onYes: () => void;
    export let onNo: () => void;
</script>

<div class="sheet" data-kind="plan-implement">
    <div class="sheet-header">
        <div class="sheet-heading">
            <p class="sheet-title">{$t("codex.planImplement.title")}</p>
            <p class="sheet-subtitle">{$t("codex.planImplement.subtitle")}</p>
        </div>
        <div class="sheet-actions">
            <button type="button" class="btn outline" on:click={onNo}>
                {$t("codex.planImplement.no")}
            </button>
            <button type="button" class="btn primary" on:click={onYes}>
                {$t("codex.planImplement.yes")}
            </button>
        </div>
    </div>

    <div class="sheet-body">
        <div class="hint-row">
            <div class="hint-label">{$t("codex.planImplement.yes")}</div>
            <div class="hint-desc">{$t("codex.planImplement.yesDesc")}</div>
        </div>
        <div class="hint-row">
            <div class="hint-label">{$t("codex.planImplement.no")}</div>
            <div class="hint-desc">{$t("codex.planImplement.noDesc")}</div>
        </div>
    </div>
</div>

<style>
    .sheet {
        /* Match the RequestUserInputDialog shell so drawer feels consistent. */
        --sheet-surface: rgba(16, 18, 22, 0.92);
        --sheet-border: rgba(255, 255, 255, 0.08);
        background: var(--sheet-surface);
        border: 1px solid var(--sheet-border);
        border-radius: 8px;
        padding: 10px 12px;
        box-shadow: 0 12px 30px rgba(0, 0, 0, 0.35);
        animation: sheet-slide-up 0.15s ease;
    }

    :global(html[data-theme="light"]) .sheet {
        --sheet-surface: #f5f7fb;
        --sheet-border: rgba(15, 23, 42, 0.14);
        box-shadow: 0 10px 24px rgba(15, 23, 42, 0.12);
    }

    @keyframes sheet-slide-up {
        from {
            opacity: 0;
            transform: translateY(16px);
        }
        to {
            opacity: 1;
            transform: translateY(0);
        }
    }

    .sheet-header {
        display: flex;
        gap: 6px;
        flex-wrap: wrap;
        justify-content: space-between;
        align-items: center;
        padding-bottom: 6px;
        border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    }

    :global(html[data-theme="light"]) .sheet-header {
        border-bottom-color: rgba(15, 23, 42, 0.12);
    }

    .sheet-heading {
        flex: 1;
        min-width: 260px;
        display: flex;
        flex-direction: column;
        gap: 3px;
    }

    .sheet-title {
        margin: 0;
        font-size: 13px;
        font-weight: 700;
        color: var(--text-primary, #f5f5f5);
        line-height: 1.2;
    }

    :global(html[data-theme="light"]) .sheet-title {
        color: #0f172a;
    }

    .sheet-subtitle {
        margin: 0;
        font-size: 11px;
        color: var(--text-secondary, rgba(255, 255, 255, 0.65));
        line-height: 1.25;
    }

    :global(html[data-theme="light"]) .sheet-subtitle {
        color: rgba(15, 23, 42, 0.6);
    }

    .sheet-actions {
        display: flex;
        gap: 6px;
        flex-wrap: nowrap;
    }

    .btn {
        border-radius: 6px;
        padding: 4px 12px;
        font-size: 11px;
        font-weight: 500;
        border: 1px solid transparent;
        cursor: pointer;
        transition:
            background 0.15s ease,
            color 0.15s ease,
            border-color 0.15s ease,
            opacity 0.15s ease;
    }

    .btn.primary {
        background: var(--accent-color, #0ea5e9);
        color: #ffffff;
        border-color: transparent;
    }

    .btn.primary:hover:enabled {
        background: var(--accent-hover, #0284c7);
    }

    .btn.outline {
        background: transparent;
        border-color: rgba(14, 165, 233, 0.5);
        color: var(--text-primary, #f5f5f5);
    }

    :global(html[data-theme="light"]) .btn.outline {
        color: #0f172a;
    }

    .btn.outline:hover:enabled {
        border-color: rgba(14, 165, 233, 0.9);
        background: rgba(14, 165, 233, 0.08);
    }

    .sheet-body {
        padding-top: 10px;
        display: grid;
        gap: 8px;
    }

    .hint-row {
        display: grid;
        grid-template-columns: 170px 1fr;
        gap: 10px;
        align-items: baseline;
        padding: 8px 10px;
        border-radius: 10px;
        border: 1px solid rgba(255, 255, 255, 0.08);
        background: rgba(255, 255, 255, 0.02);
    }

    :global(html[data-theme="light"]) .hint-row {
        border-color: rgba(15, 23, 42, 0.12);
        background: rgba(15, 23, 42, 0.02);
    }

    .hint-label {
        font-weight: 700;
        font-size: 12px;
        color: var(--text-primary, #f5f5f5);
        line-height: 1.2;
    }

    :global(html[data-theme="light"]) .hint-label {
        color: #0f172a;
    }

    .hint-desc {
        font-size: 11px;
        color: var(--text-secondary, rgba(255, 255, 255, 0.65));
        line-height: 1.25;
    }

    :global(html[data-theme="light"]) .hint-desc {
        color: rgba(15, 23, 42, 0.6);
    }

    @media (max-width: 520px) {
        .hint-row {
            grid-template-columns: 1fr;
            gap: 4px;
        }
    }
</style>
