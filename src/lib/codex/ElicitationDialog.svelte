<script lang="ts">
    import { open } from "@tauri-apps/plugin-shell";
    import { get } from "svelte/store";
    import { t } from "../i18n";
    import type {
        McpServerElicitationRequestParams,
        McpServerElicitationRequestResponse,
    } from "./types";

    export let requestId: string;
    export let params: McpServerElicitationRequestParams;
    export let onSubmit: (response: McpServerElicitationRequestResponse) => void;
    export let onCancel: () => void;
    export let onDecline: (() => void) | null = null;

    let drafts: Record<string, string | number | boolean | string[]> = {};
    let urlOpened = false;

    type FormField = {
        key: string;
        title: string;
        description: string;
        type: "string" | "number" | "boolean" | "singleSelect" | "multiSelect";
        required: boolean;
        options?: Array<{ value: string; label: string }>;
        minLength?: number;
        maxLength?: number;
        minimum?: number;
        maximum?: number;
        minItems?: number;
        maxItems?: number;
        format?: string;
    };

    type BrowserOriginApproval = {
        origin: string;
    };

    function asRecord(value: unknown): Record<string, any> | null {
        if (!value || typeof value !== "object" || Array.isArray(value)) return null;
        return value as Record<string, any>;
    }

    function resolveBrowserOriginApproval(): BrowserOriginApproval | null {
        const meta = asRecord(params?._meta);
        if (!meta) return null;
        if (meta.connector_id !== "browser-use") return null;
        if (meta.tool_name !== "access_browser_origin") return null;
        if (meta.codex_request_type !== "approval_request") return null;
        if (meta.codex_approval_kind !== "mcp_tool_call") return null;
        const toolParams = asRecord(meta.tool_params);
        const origin = typeof toolParams?.origin === "string" ? toolParams.origin.trim() : "";
        if (!origin) return null;
        return { origin };
    }

    function fieldTitle(key: string, schema: any): string {
        return schema?.title || key;
    }

    function fieldDescription(schema: any): string {
        return schema?.description || "";
    }

    function selectOptions(schema: any): Array<{ value: string; label: string }> {
        if (Array.isArray(schema?.enum)) {
            const names = Array.isArray(schema?.enumNames) ? schema.enumNames : [];
            return schema.enum.map((value: string, index: number) => ({
                value,
                label: names[index] || value,
            }));
        }
        if (Array.isArray(schema?.oneOf)) {
            return schema.oneOf.map((opt: any) => ({
                value: String(opt?.const ?? ""),
                label: String(opt?.title ?? opt?.const ?? ""),
            }));
        }
        if (Array.isArray(schema?.items?.enum)) {
            return schema.items.enum.map((value: string) => ({
                value,
                label: value,
            }));
        }
        if (Array.isArray(schema?.items?.anyOf)) {
            return schema.items.anyOf.map((opt: any) => ({
                value: String(opt?.const ?? ""),
                label: String(opt?.title ?? opt?.const ?? ""),
            }));
        }
        return [];
    }

    function toFormField(key: string, schema: any, requiredKeys: string[]): FormField {
        const required = requiredKeys.includes(key);
        if (schema?.type === "boolean") {
            return {
                key,
                title: fieldTitle(key, schema),
                description: fieldDescription(schema),
                type: "boolean",
                required,
            };
        }
        if (schema?.type === "number" || schema?.type === "integer") {
            return {
                key,
                title: fieldTitle(key, schema),
                description: fieldDescription(schema),
                type: "number",
                required,
                minimum: typeof schema?.minimum === "number" ? schema.minimum : undefined,
                maximum: typeof schema?.maximum === "number" ? schema.maximum : undefined,
            };
        }
        if (schema?.type === "array") {
            return {
                key,
                title: fieldTitle(key, schema),
                description: fieldDescription(schema),
                type: "multiSelect",
                required,
                options: selectOptions(schema),
                minItems:
                    typeof schema?.minItems === "bigint"
                        ? Number(schema.minItems)
                        : typeof schema?.minItems === "number"
                          ? schema.minItems
                          : undefined,
                maxItems:
                    typeof schema?.maxItems === "bigint"
                        ? Number(schema.maxItems)
                        : typeof schema?.maxItems === "number"
                          ? schema.maxItems
                          : undefined,
            };
        }
        if (Array.isArray(schema?.enum) || Array.isArray(schema?.oneOf)) {
            return {
                key,
                title: fieldTitle(key, schema),
                description: fieldDescription(schema),
                type: "singleSelect",
                required,
                options: selectOptions(schema),
            };
        }
        return {
            key,
            title: fieldTitle(key, schema),
            description: fieldDescription(schema),
            type: "string",
            required,
            minLength: typeof schema?.minLength === "number" ? schema.minLength : undefined,
            maxLength: typeof schema?.maxLength === "number" ? schema.maxLength : undefined,
            format: typeof schema?.format === "string" ? schema.format : undefined,
        };
    }

    function valueForField(field: FormField) {
        const existing = drafts[field.key];
        if (existing !== undefined) return existing;
        if (params.mode !== "form") return "";
        const schema = params.requestedSchema?.properties?.[field.key] as any;
        if (schema?.default !== undefined) return schema.default;
        if (field.type === "multiSelect") return [];
        if (field.type === "boolean") return false;
        return "";
    }

    function updateDraft(key: string, value: string | number | boolean | string[]) {
        drafts = { ...drafts, [key]: value };
    }

    function handleTextInput(key: string, event: Event) {
        const target = event.currentTarget as HTMLInputElement | null;
        updateDraft(key, target?.value ?? "");
    }

    function handleNumberInput(key: string, event: Event) {
        const target = event.currentTarget as HTMLInputElement | null;
        const raw = target?.value ?? "";
        updateDraft(key, raw === "" ? "" : Number(raw));
    }

    function handleBooleanInput(key: string, event: Event) {
        const target = event.currentTarget as HTMLInputElement | null;
        updateDraft(key, Boolean(target?.checked));
    }

    function handleSingleSelect(key: string, event: Event) {
        const target = event.currentTarget as HTMLSelectElement | null;
        updateDraft(key, target?.value ?? "");
    }

    function handleMultiToggle(key: string, value: string) {
        const current = Array.isArray(drafts[key]) ? (drafts[key] as string[]) : [];
        const next = current.includes(value)
            ? current.filter((item) => item !== value)
            : [...current, value];
        updateDraft(key, next);
    }

    function isMultiSelected(field: FormField, optionValue: string): boolean {
        const value = valueForField(field);
        return Array.isArray(value) && value.includes(optionValue);
    }

    $: formFields =
        params.mode === "form"
            ? Object.entries(params.requestedSchema?.properties ?? {}).map(([key, schema]) =>
                  toFormField(key, schema, params.requestedSchema?.required ?? [])
              )
            : [];
    $: browserOriginApproval = resolveBrowserOriginApproval();

    function isFieldComplete(field: FormField): boolean {
        const value = valueForField(field);
        if (!field.required) return true;
        if (field.type === "multiSelect") return Array.isArray(value) && value.length > 0;
        if (field.type === "boolean") return typeof value === "boolean";
        if (field.type === "number") return value !== "" && Number.isFinite(Number(value));
        return String(value ?? "").trim().length > 0;
    }

    function isValidEmail(value: string): boolean {
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
    }

    function validationMessage(field: FormField): string | null {
        const $t = get(t);
        const value = valueForField(field);
        if (field.required && !isFieldComplete(field)) {
            return $t("codex.elicitation.errorRequired");
        }
        if (field.type === "string") {
            const text = String(value ?? "").trim();
            if (!text) return null;
            if (field.minLength != null && text.length < field.minLength) {
                return $t("codex.elicitation.errorMinLength", { count: field.minLength });
            }
            if (field.maxLength != null && text.length > field.maxLength) {
                return $t("codex.elicitation.errorMaxLength", { count: field.maxLength });
            }
            if (field.format === "email" && !isValidEmail(text)) {
                return $t("codex.elicitation.errorEmail");
            }
            if ((field.format === "uri" || field.format === "date" || field.format === "date-time") && !text) {
                return $t("codex.elicitation.errorInvalid");
            }
            return null;
        }
        if (field.type === "number") {
            if (value === "") return null;
            const num = Number(value);
            if (!Number.isFinite(num)) {
                return $t("codex.elicitation.errorNumber");
            }
            if (field.minimum != null && num < field.minimum) {
                return $t("codex.elicitation.errorMinimum", { value: field.minimum });
            }
            if (field.maximum != null && num > field.maximum) {
                return $t("codex.elicitation.errorMaximum", { value: field.maximum });
            }
            return null;
        }
        if (field.type === "multiSelect") {
            const list = Array.isArray(value) ? value : [];
            if (field.minItems != null && list.length < field.minItems) {
                return $t("codex.elicitation.errorMinItems", { count: field.minItems });
            }
            if (field.maxItems != null && list.length > field.maxItems) {
                return $t("codex.elicitation.errorMaxItems", { count: field.maxItems });
            }
            return null;
        }
        return null;
    }

    function isAllowPrompt(): boolean {
        const message = String(params?.message ?? "").trim();
        if (!message) return false;
        return /^allow\b/i.test(message) || /允许.+(mcp|tool|server)/i.test(message);
    }

    function primaryActionLabel(): string {
        const $t = get(t);
        if (browserOriginApproval) {
            return $t("codex.elicitation.browserOriginAllow");
        }
        if (params.mode === "url" && urlOpened) {
            return $t("codex.elicitation.urlCompleted");
        }
        if (isAllowPrompt()) {
            return $t("codex.elicitation.allow");
        }
        return $t("codex.elicitation.submit");
    }

    function declineActionLabel(): string {
        const $t = get(t);
        if (browserOriginApproval) {
            return $t("codex.elicitation.browserOriginDecline");
        }
        return $t("codex.elicitation.decline");
    }

    function dialogTitle(): string {
        const $t = get(t);
        if (browserOriginApproval) {
            return $t("codex.elicitation.browserOriginTitle");
        }
        return $t("codex.elicitation.title");
    }

    function dialogSubtitle(): string {
        const $t = get(t);
        if (browserOriginApproval) {
            return $t("codex.elicitation.browserOriginSubtitle");
        }
        return params.serverName;
    }

    function dialogMessage(): string {
        const $t = get(t);
        if (browserOriginApproval) {
            return $t("codex.elicitation.browserOriginMessage");
        }
        return params.message;
    }

    $: canSubmit =
        params.mode === "url"
            ? true
            : formFields.length === 0 || formFields.every((field) => validationMessage(field) === null);

    function buildContent() {
        if (params.mode !== "form") return null;
        const content: Record<string, any> = {};
        for (const field of formFields) {
            const value = valueForField(field);
            if (field.type === "number") {
                if (value !== "") content[field.key] = Number(value);
                continue;
            }
            if (field.type === "multiSelect") {
                content[field.key] = Array.isArray(value) ? value : [];
                continue;
            }
            content[field.key] = value;
        }
        return content;
    }

    function handleSubmit() {
        onSubmit({
            action: "accept",
            content: buildContent(),
            _meta: params._meta ?? null,
        });
    }

    async function openUrl() {
        if (params.mode !== "url") return;
        try {
            await open(params.url);
        } catch {
            try {
                window.open(params.url, "_blank", "noopener,noreferrer");
            } catch {}
        }
        urlOpened = true;
    }
</script>

<div class="sheet" data-request-id={requestId}>
    <div class="sheet-header">
        <div class="sheet-heading">
            <p class="sheet-title">{dialogTitle()}</p>
            <p class="sheet-subtitle">{dialogSubtitle()}</p>
        </div>
        <div class="sheet-actions">
            {#if onDecline}
                <button type="button" class="btn outline" on:click={onDecline}>
                    {declineActionLabel()}
                </button>
            {/if}
            <button type="button" class="btn outline" on:click={onCancel}>
                {$t("codex.elicitation.cancel")}
            </button>
            <button type="button" class="btn primary" on:click={handleSubmit} disabled={!canSubmit}>
                {primaryActionLabel()}
            </button>
        </div>
    </div>

    <div class="sheet-body">
        <div class="message">{dialogMessage()}</div>
        {#if browserOriginApproval}
            <div class="origin-card">
                <div class="origin-label">{$t("codex.elicitation.browserOriginLabel")}</div>
                <div class="origin-url">{browserOriginApproval.origin}</div>
            </div>
        {/if}

        {#if params.mode === "url"}
            <div class="url-card">
                <div class="url">{params.url}</div>
                <div class="url-hint">{$t("codex.elicitation.urlHint")}</div>
                <button type="button" class="btn primary open-btn" on:click={openUrl}>
                    {$t("codex.elicitation.openLink")}
                </button>
            </div>
        {:else}
            {#each formFields as field (field.key)}
                <div class="field-card" class:incomplete={validationMessage(field) !== null}>
                    <div class="field-title">{field.title}{field.required ? " *" : ""}</div>
                    {#if field.description}
                        <div class="field-desc">{field.description}</div>
                    {/if}

                    {#if field.type === "string"}
                        <input
                            class="text-input"
                            type="text"
                            value={String(valueForField(field) ?? "")}
                            placeholder={field.description || $t("codex.elicitation.inputPlaceholder")}
                            on:input={(e) => handleTextInput(field.key, e)}
                        />
                    {:else if field.type === "number"}
                        <input
                            class="text-input"
                            type="number"
                            value={String(valueForField(field) ?? "")}
                            placeholder={field.description || $t("codex.elicitation.inputPlaceholder")}
                            on:input={(e) => handleNumberInput(field.key, e)}
                        />
                    {:else if field.type === "boolean"}
                        <label class="checkbox-row">
                            <input
                                type="checkbox"
                                checked={Boolean(valueForField(field))}
                                on:change={(e) => handleBooleanInput(field.key, e)}
                            />
                            <span>{$t("codex.elicitation.booleanTrue")}</span>
                        </label>
                    {:else if field.type === "singleSelect"}
                        <select
                            class="text-input"
                            value={String(valueForField(field) ?? "")}
                            on:change={(e) => handleSingleSelect(field.key, e)}
                        >
                            <option value="">{$t("codex.elicitation.selectPlaceholder")}</option>
                            {#each field.options ?? [] as option (option.value)}
                                <option value={option.value}>{option.label}</option>
                            {/each}
                        </select>
                    {:else if field.type === "multiSelect"}
                        <div class="options">
                            {#each field.options ?? [] as option (option.value)}
                                <label class="option">
                                    <input
                                        type="checkbox"
                                        checked={isMultiSelected(field, option.value)}
                                        on:change={() => handleMultiToggle(field.key, option.value)}
                                    />
                                    <span>{option.label}</span>
                                </label>
                            {/each}
                        </div>
                    {/if}
                    {#if validationMessage(field)}
                        <div class="field-error">{validationMessage(field)}</div>
                    {/if}
                </div>
            {/each}
        {/if}
    </div>
</div>

<style>
    .sheet {
        --sheet-surface: rgba(16, 18, 22, 0.92);
        --sheet-border: rgba(255, 255, 255, 0.08);
        background: var(--sheet-surface);
        border: 1px solid var(--sheet-border);
        border-radius: 8px;
        padding: 10px 12px;
        box-shadow: 0 12px 30px rgba(0, 0, 0, 0.35);
    }

    :global(html[data-theme="light"]) .sheet {
        --sheet-surface: #f5f7fb;
        --sheet-border: rgba(15, 23, 42, 0.14);
        box-shadow: 0 10px 24px rgba(15, 23, 42, 0.12);
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

    .sheet-heading {
        display: flex;
        flex-direction: column;
        gap: 2px;
        min-width: 220px;
    }

    .sheet-title {
        margin: 0;
        font-size: 13px;
        font-weight: 700;
    }

    .sheet-subtitle {
        margin: 0;
        font-size: 11px;
        opacity: 0.7;
    }

    .sheet-actions {
        display: flex;
        gap: 6px;
    }

    .sheet-body {
        display: flex;
        flex-direction: column;
        gap: 10px;
        padding-top: 10px;
    }

    .message {
        font-size: 12px;
        line-height: 1.5;
        white-space: pre-wrap;
    }

    .field-card,
    .url-card,
    .origin-card {
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 8px;
        padding: 10px;
        display: flex;
        flex-direction: column;
        gap: 8px;
    }

    .origin-label {
        font-size: 11px;
        opacity: 0.68;
    }

    .origin-url {
        font-size: 12px;
        font-weight: 700;
        overflow-wrap: anywhere;
    }

    .field-card.incomplete {
        border-color: rgba(239, 68, 68, 0.45);
    }

    .field-title {
        font-size: 12px;
        font-weight: 700;
    }

    .field-desc {
        font-size: 11px;
        opacity: 0.72;
        white-space: pre-wrap;
    }

    .field-error {
        font-size: 11px;
        color: #ef4444;
        line-height: 1.4;
    }

    .text-input {
        width: 100%;
        min-height: 34px;
        border-radius: 6px;
        border: 1px solid rgba(255, 255, 255, 0.12);
        background: rgba(255, 255, 255, 0.04);
        color: inherit;
        padding: 6px 10px;
        box-sizing: border-box;
    }

    .checkbox-row,
    .option {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 12px;
    }

    .options {
        display: flex;
        flex-direction: column;
        gap: 6px;
    }

    .url {
        font-size: 11px;
        word-break: break-all;
        opacity: 0.78;
    }

    .url-hint {
        font-size: 11px;
        opacity: 0.72;
        line-height: 1.5;
    }

    .open-btn {
        align-self: flex-start;
    }

    .btn {
        border-radius: 6px;
        padding: 4px 12px;
        font-size: 11px;
        font-weight: 500;
        border: 1px solid transparent;
        cursor: pointer;
    }

    .btn:disabled {
        opacity: 0.55;
        cursor: not-allowed;
    }

    .btn.primary {
        background: var(--accent-color, #0ea5e9);
        color: #fff;
    }

    .btn.outline {
        background: transparent;
        border-color: rgba(14, 165, 233, 0.5);
        color: inherit;
    }
</style>
