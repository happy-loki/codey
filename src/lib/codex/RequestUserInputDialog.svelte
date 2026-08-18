<script lang="ts">
    import { t } from "../i18n";
    import type {
        ToolRequestUserInputParams,
        ToolRequestUserInputQuestion,
        ToolRequestUserInputResponse,
    } from "./types";

    export let requestId: string;
    export let params: ToolRequestUserInputParams;
    export let onSubmit: (response: ToolRequestUserInputResponse) => void;
    export let onCancel: () => void;

    type Draft = {
        selected: string[];
        otherText: string;
    };

    let drafts: Record<string, Draft> = {};

    function setDraft(questionId: string, next: Draft) {
        drafts = { ...drafts, [questionId]: next };
    }

    function toggleOption(questionId: string, label: string) {
        const draft = drafts[questionId] ?? { selected: [], otherText: "" };
        const exists = draft.selected.includes(label);
        const selected = exists
            ? draft.selected.filter((x) => x !== label)
            : [...draft.selected, label];
        setDraft(questionId, { ...draft, selected });
    }

    function setOtherText(questionId: string, value: string) {
        const draft = drafts[questionId] ?? { selected: [], otherText: "" };
        setDraft(questionId, { ...draft, otherText: value });
    }

    function handleOtherInput(questionId: string, event: Event) {
        const target = event.currentTarget as HTMLInputElement | null;
        const value = target?.value ?? "";
        setOtherText(questionId, value);
    }

    function isDraftComplete(draft: Draft): boolean {
        const other = (draft.otherText ?? "").trim();
        return draft.selected.length > 0 || other.length > 0;
    }

    function answersForQuestion(question: ToolRequestUserInputQuestion): string[] {
        // Important: reference `drafts` directly so Svelte reactivity updates canSubmit / required badges.
        const draft = drafts[question.id] ?? { selected: [], otherText: "" };
        const otherAllowed = question.isOther || !question.options || question.options.length === 0;
        const other = otherAllowed ? (draft.otherText ?? "").trim() : "";

        const answers = [...draft.selected];
        if (other) {
            if (!answers.includes(other)) {
                answers.push(other);
            }
        }
        return answers;
    }

    $: questions = params?.questions ?? [];
    // Depend on drafts explicitly; otherwise canSubmit won't update when user edits inputs.
    $: canSubmit = drafts && questions.length > 0 && questions.every((q) => {
        const draft = drafts[q.id] ?? { selected: [], otherText: "" };
        return isDraftComplete(draft);
    });

    function handleSubmit() {
        if (!canSubmit) return;
        const answers: ToolRequestUserInputResponse["answers"] = {};
        for (const q of questions) {
            answers[q.id] = { answers: answersForQuestion(q) };
        }
        onSubmit({ answers });
    }
</script>

<div class="sheet" data-request-id={requestId}>
    <div class="sheet-header">
        <div class="sheet-heading">
            <p class="sheet-title">{$t("codex.requestUserInput.title")}</p>
            <p class="sheet-subtitle">{$t("codex.requestUserInput.subtitle")}</p>
        </div>
        <div class="sheet-actions">
            <button type="button" class="btn outline" on:click={onCancel}>
                {$t("codex.requestUserInput.cancel")}
            </button>
            <button type="button" class="btn primary" on:click={handleSubmit} disabled={!canSubmit}>
                {$t("codex.requestUserInput.submit")}
            </button>
        </div>
    </div>

    <div class="sheet-body">
        {#each questions as q (q.id)}
            {@const draft = drafts[q.id] ?? { selected: [], otherText: "" }}
            {@const complete = isDraftComplete(draft)}
            <div class="question-card" class:incomplete={!complete}>
                <div class="question-header">
                    <div class="question-title">
                        {q.header || $t("codex.requestUserInput.defaultHeader")}
                    </div>
                    {#if !complete}
                        <div class="question-badge">{$t("codex.requestUserInput.required")}</div>
                    {/if}
                </div>
                <div class="question-text">{q.question}</div>

                {#if q.options && q.options.length > 0}
                    <div class="options">
                        {#each q.options as opt (opt.label)}
                            <label class="option">
                                <input
                                    type="checkbox"
                                    checked={draft.selected.includes(opt.label)}
                                    on:change={() => toggleOption(q.id, opt.label)}
                                />
                                <span class="option-main">
                                    <span class="option-label">{opt.label}</span>
                                    {#if opt.description}
                                        <span class="option-desc">{opt.description}</span>
                                    {/if}
                                </span>
                            </label>
                        {/each}
                    </div>
                {/if}

                {#if q.isOther || !q.options || q.options.length === 0}
                    <div class="other">
                        <input
                            class="other-input"
                            type="text"
                            placeholder={$t("codex.requestUserInput.otherPlaceholder")}
                            value={draft.otherText}
                            on:input={(e) => handleOtherInput(q.id, e)}
                        />
                    </div>
                {/if}
            </div>
        {/each}
    </div>
</div>

<style>
    .sheet {
        /* Keep it consistent with ApprovalDialog + existing Codex panel chrome. */
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
        gap: 2px;
    }

    .sheet-title {
        margin: 0;
        font-size: 13px;
        font-weight: 700;
        color: var(--text-primary, #f5f5f5);
        line-height: 1.2;
    }

    .sheet-subtitle {
        margin: 0;
        font-size: 11px;
        color: var(--text-secondary, rgba(255, 255, 255, 0.65));
    }

    :global(html[data-theme="light"]) .sheet-title {
        color: #0f172a;
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

    .btn:disabled {
        opacity: 0.55;
        cursor: not-allowed;
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
        color: #7dd3fc;
    }

    :global(html[data-theme="light"]) .btn.outline {
        color: #0c4a6e;
        border-color: rgba(14, 165, 233, 0.5);
    }

    .btn.outline:hover:enabled {
        background: rgba(14, 165, 233, 0.12);
    }

    .sheet-body {
        margin-top: 10px;
        display: flex;
        flex-direction: column;
        gap: 10px;
        max-height: min(50vh, 520px);
        overflow: auto;
        padding-right: 2px;
    }

    .question-card {
        border-radius: 8px;
        border: 1px solid rgba(255, 255, 255, 0.08);
        background: rgba(255, 255, 255, 0.02);
        padding: 10px;
        display: flex;
        flex-direction: column;
        gap: 8px;
    }

    :global(html[data-theme="light"]) .question-card {
        border-color: rgba(15, 23, 42, 0.12);
        background: #ffffff;
        box-shadow: 0 1px 0 rgba(15, 23, 42, 0.02);
    }

    .question-card.incomplete {
        border-color: rgba(14, 165, 233, 0.35);
    }

    .question-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
    }

    .question-title {
        font-size: 12px;
        font-weight: 700;
        color: var(--text-primary, #f8fafc);
    }

    :global(html[data-theme="light"]) .question-title {
        color: #0f172a;
    }

    .question-badge {
        font-size: 11px;
        font-weight: 600;
        color: var(--accent-color, #0ea5e9);
        display: inline-flex;
        align-items: center;
        gap: 6px;
        flex: 0 0 auto;
    }

    .question-badge::before {
        content: "";
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: var(--accent-color, #0ea5e9);
        opacity: 0.9;
    }

    :global(html[data-theme="light"]) .question-badge {
        color: var(--accent-color, #2563eb);
    }

    .question-text {
        font-size: 12px;
        color: var(--text-secondary, rgba(255, 255, 255, 0.75));
        line-height: 1.5;
        white-space: pre-wrap;
    }

    :global(html[data-theme="light"]) .question-text {
        color: rgba(15, 23, 42, 0.75);
    }

    .options {
        display: flex;
        flex-direction: column;
        gap: 6px;
    }

    .option {
        display: flex;
        align-items: center;
        gap: 8px;
        cursor: pointer;
        padding: 6px 8px;
        border-radius: 8px;
        border: 1px solid rgba(255, 255, 255, 0.06);
        background: rgba(255, 255, 255, 0.02);
    }

    .option input {
        margin: 0;
        transform: translateY(1px);
    }

    :global(html[data-theme="light"]) .option {
        border-color: rgba(15, 23, 42, 0.1);
        background: #ffffff;
    }

    .option:hover {
        border-color: rgba(14, 165, 233, 0.45);
    }

    .option-main {
        display: flex;
        flex-direction: column;
        gap: 2px;
    }

    .option-label {
        font-size: 12px;
        font-weight: 600;
        color: var(--text-primary, #f8fafc);
    }

    :global(html[data-theme="light"]) .option-label {
        color: #0f172a;
    }

    .option-desc {
        font-size: 11px;
        color: var(--text-secondary, rgba(255, 255, 255, 0.65));
        line-height: 1.35;
    }

    :global(html[data-theme="light"]) .option-desc {
        color: rgba(15, 23, 42, 0.6);
    }

    .other {
        display: flex;
        gap: 8px;
        align-items: center;
    }

    .other-input {
        width: 100%;
        border-radius: 8px;
        padding: 8px 10px;
        border: 1px solid rgba(255, 255, 255, 0.08);
        background: rgba(2, 6, 23, 0.6);
        color: var(--text-primary, #f8fafc);
        font-size: 12px;
        outline: none;
    }

    :global(html[data-theme="light"]) .other-input {
        border-color: rgba(15, 23, 42, 0.18);
        background: #ffffff;
        color: #0f172a;
    }

    .other-input:focus {
        border-color: rgba(14, 165, 233, 0.6);
        box-shadow: 0 0 0 2px rgba(14, 165, 233, 0.18);
    }
</style>
