<script lang="ts">
    import type { Action } from "svelte/action";
    import Input from "../../utility/Input.svelte";
    import NumberInput from "../../utility/NumberInput.svelte";
    import Select from "../../utility/Select.svelte";
    import type { FontItem } from "../types";

    const noopAction: Action<HTMLElement, unknown> = () => ({ destroy() {} });
    const noopHandler = () => {};

    export let translate: (key: string) => string = key => key;
    export let editorFontSize: string | number = "";
    export let editorFontFamily = "";
    export let editorLineHeight = "";
    export let editorLetterSpacing: string | number = "";
    export let editorTabSize: string | number = "";
    export let editorLineWrapping = false;
    export let fontFamilyItems: FontItem[] = [];
    export let defaultFontFamily = "";
    export let onFontSizeInput: (event: CustomEvent) => void = noopHandler;
    export let onFontFamilySelect: (event: CustomEvent) => void = noopHandler;
    export let onLineHeightInput: (event: CustomEvent) => void = noopHandler;
    export let onLetterSpacingInput: (event: CustomEvent) => void = noopHandler;
    export let onTabSizeInput: (event: CustomEvent) => void = noopHandler;
    export let onLineWrappingSelect: (event: CustomEvent) => void = noopHandler;
    export let categoryAnchor: Action<HTMLElement, unknown> = noopAction;
    export let fontSizeAnchor: Action<HTMLElement, unknown> = noopAction;
    export let fontFamilyAnchor: Action<HTMLElement, unknown> = noopAction;
    export let lineHeightAnchor: Action<HTMLElement, unknown> = noopAction;
    export let letterSpacingAnchor: Action<HTMLElement, unknown> = noopAction;
    export let lineWrappingAnchor: Action<HTMLElement, unknown> = noopAction;
</script>

<div class="settings-category" use:categoryAnchor>
    <div class="heading">{translate("settings.editor")}</div>
    <div class="content">
        <div use:fontSizeAnchor>
            <NumberInput
                _class="settings-input"
                value={editorFontSize}
                min={8}
                max={32}
                step={1}
                extra_small
                label={translate("settings.fontSize")}
                on:d_input={onFontSizeInput}
            />
        </div>
        <div use:fontFamilyAnchor>
            <Select
                label={translate("settings.fontFamily")}
                items={fontFamilyItems}
                selected={editorFontFamily}
                defaultValue={defaultFontFamily}
                on:select={onFontFamilySelect}
            />
        </div>
        <div use:lineHeightAnchor>
            <Input
                _class="settings-input"
                placeholder="default: 1.618"
                value={editorLineHeight}
                medium
                label={translate("settings.lineHeight")}
                on:d_input={onLineHeightInput}
            />
        </div>
        <div use:letterSpacingAnchor>
            <NumberInput
                _class="settings-input"
                value={editorLetterSpacing}
                min={0}
                max={2}
                step={0.1}
                extra_small
                label={translate("settings.letterSpacing")}
                on:d_input={onLetterSpacingInput}
            />
        </div>
        <Input
            _class="settings-input"
            placeholder="default: 4"
            value={String(editorTabSize ?? "")}
            medium
            label={translate("settings.tabSize")}
            on:d_input={onTabSizeInput}
        />
        <div use:lineWrappingAnchor>
            <Select
                label={translate("settings.lineWrapping")}
                items={[
                    { id: "off", name: translate("settings.off") },
                    { id: "on", name: translate("settings.on") }
                ]}
                selected={editorLineWrapping ? translate("settings.on") : translate("settings.off")}
                defaultValue={translate("settings.off")}
                on:select={onLineWrappingSelect}
            />
        </div>
    </div>
</div>
