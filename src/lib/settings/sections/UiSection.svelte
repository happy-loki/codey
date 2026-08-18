<script lang="ts">
    import type { Action } from "svelte/action";
    import NumberInput from "../../utility/NumberInput.svelte";
    import Select from "../../utility/Select.svelte";
    import type { FontItem } from "../types";

    const noopAction: Action<HTMLElement, unknown> = () => ({ destroy() {} });
    const noopHandler = () => {};

    export let translate: (key: string) => string = key => key;
    export let uiFontSize: string | number = "";
    export let uiFontFamily = "";
    export let fontFamilyItems: FontItem[] = [];
    export let defaultFontFamily = "";
    export let onFontSizeInput: (event: CustomEvent) => void = noopHandler;
    export let onFontFamilySelect: (event: CustomEvent) => void = noopHandler;
    export let categoryAnchor: Action<HTMLElement, unknown> = noopAction;
    export let fontSizeAnchor: Action<HTMLElement, unknown> = noopAction;
    export let fontFamilyAnchor: Action<HTMLElement, unknown> = noopAction;
</script>

<div class="settings-category" use:categoryAnchor>
    <div class="heading">{translate("settings.ui")}</div>
    <div class="content">
        <div use:fontSizeAnchor>
            <NumberInput
                _class="settings-input"
                value={uiFontSize}
                min={12}
                max={24}
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
                selected={uiFontFamily}
                defaultValue={defaultFontFamily}
                on:select={onFontFamilySelect}
            />
        </div>
    </div>
</div>
