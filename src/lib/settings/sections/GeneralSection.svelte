<script lang="ts">
    import type { Action } from "svelte/action";
    import Select from "../../utility/Select.svelte";

    const noopAction: Action<HTMLElement, unknown> = () => ({ destroy() {} });
    const noopHandler = () => {};
    export let translate: (key: string, params?: Record<string, string | number>) => string = key => key;
    export let themes: Array<Record<string, unknown>> = [];
    export let codeyTheme = "";
    export let uiLang = "en";
    export let onThemeSelect: (event: CustomEvent) => void = noopHandler;
    export let onLanguageSelect: (event: CustomEvent) => void = noopHandler;
    export let categoryAnchor: Action<HTMLElement, unknown> = noopAction;
    export let themeAnchor: Action<HTMLElement, unknown> = noopAction;
    export let languageAnchor: Action<HTMLElement, unknown> = noopAction;

    $: languageItems =
        uiLang === "zh-CN"
            ? [
                  { id: 0, name: "zh-CN" },
                  { id: 1, name: "en" }
              ]
            : [
                  { id: 0, name: "en" },
                  { id: 1, name: "zh-CN" }
              ];
</script>

<div class="settings-category" use:categoryAnchor>
    <div class="heading">{translate("settings.general")}</div>
    <div class="content">
        <div use:themeAnchor>
            <Select
                label={translate("settings.theme")}
                items={themes}
                selected={codeyTheme}
                on:select={onThemeSelect}
            />
        </div>
        <div use:languageAnchor>
            {#key uiLang}
                <Select
                    label={translate("settings.language")}
                    items={languageItems}
                    selected={uiLang}
                    on:select={onLanguageSelect}
                />
            {/key}
        </div>
    </div>
</div>
