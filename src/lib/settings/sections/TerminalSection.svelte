<script lang="ts">
    import type { Action } from "svelte/action";
    import Input from "../../utility/Input.svelte";
    import NumberInput from "../../utility/NumberInput.svelte";
    import Select from "../../utility/Select.svelte";
    import type { FontItem } from "../types";

    const noopAction: Action<HTMLElement, unknown> = () => ({ destroy() {} });
    const noopHandler = () => {};

    export let translate: (key: string) => string = key => key;
    export let terminalOptions: Record<string, unknown> = {};
    export let fontFamilyItems: FontItem[] = [];
    export let defaultFontFamily = "";
    export let onFontSizeInput: (event: CustomEvent) => void = noopHandler;
    export let onFontFamilySelect: (event: CustomEvent) => void = noopHandler;
    export let onLineHeightInput: (event: CustomEvent) => void = noopHandler;
    export let onCursorStyleSelect: (event: CustomEvent) => void = noopHandler;
    export let categoryAnchor: Action<HTMLElement, unknown> = noopAction;
    export let fontSizeAnchor: Action<HTMLElement, unknown> = noopAction;
    export let fontFamilyAnchor: Action<HTMLElement, unknown> = noopAction;

    $: fontSizeValue = terminalOptions?.fontSize ?? "";
    $: fontFamilyValue = terminalOptions?.fontFamily ?? "";
    $: lineHeightValue = terminalOptions?.lineHeight ?? "";
    $: cursorStyleValue = terminalOptions?.cursorStyle ?? "";
</script>

<div class="settings-category" use:categoryAnchor>
    <div class="heading">{translate("settings.terminal")}</div>
    <p class="terminal-hint">{translate("settings.terminalChangeHint")}</p>
    <div class="content">
        <div use:fontSizeAnchor>
            <NumberInput
                label={translate("settings.fontSize")}
                _class="settings-input"
                value={fontSizeValue}
                min={8}
                max={32}
                step={1}
                extra_small
                on:d_input={onFontSizeInput}
            />
        </div>

<style>
    .terminal-hint {
        margin: 6px 0 0 0;
        font-size: 12px;
        color: var(--text-muted, #9ca3af);
    }
</style>
        <div use:fontFamilyAnchor>
            <Select
                label={translate("settings.fontFamily")}
                items={fontFamilyItems}
                selected={String(fontFamilyValue ?? "")}
                defaultValue={defaultFontFamily}
                on:select={onFontFamilySelect}
            />
        </div>
        <Input
            label={translate("settings.lineHeight")}
            _class="settings-input"
            placeholder="default: 1.2"
            value={String(lineHeightValue ?? "")}
            medium
            on:d_input={onLineHeightInput}
        />
        <Select
            label={translate("settings.cursorStyle")}
            items={[
                { id: 0, name: "bar" },
                { id: 1, name: "block" },
                { id: 2, name: "underline" }
            ]}
            selected={String(cursorStyleValue ?? "")}
            on:select={onCursorStyleSelect}
        />
    </div>
</div>
