<script lang="ts">
    import type { Action } from "svelte/action";
    import Select from "../../utility/Select.svelte";

    const noopAction: Action<HTMLElement, unknown> = () => ({ destroy() {} });
    const noopHandler = () => {};

    export let translate: (key: string) => string = (key) => key;
    export let macosShortcut: string = "fn_double";
    export let onMacosShortcutSelect: (event: CustomEvent) => void = noopHandler;
    export let categoryAnchor: Action<HTMLElement, unknown> = noopAction;
    export let macShortcutAnchor: Action<HTMLElement, unknown> = noopAction;

    const isMac = typeof navigator !== "undefined" && /mac/i.test(navigator?.platform || "");

    const shortcutItems = [
        { id: 0, name: "fn_double" },
        { id: 1, name: "ctrl_double" },
    ];
</script>

<div class="settings-category" use:categoryAnchor>
    <div class="heading">{translate("settings.systemDictationTitle")}</div>
    <div class="content">
        <div class="settings-group">
            <div class="enable-row">
                <div class="enable-meta">
                    <div class="enable-title">{translate("settings.systemDictationHintTitle")}</div>
                    <div class="enable-sub">{translate("settings.systemDictationHintBody")}</div>
                </div>
            </div>
        </div>

        <div use:macShortcutAnchor class:is-disabled={!isMac} aria-disabled={!isMac}>
            <Select
                label={translate("settings.systemDictationMacShortcut")}
                items={shortcutItems}
                selected={macosShortcut}
                on:select={isMac ? onMacosShortcutSelect : noopHandler}
            />
        </div>
    </div>
</div>

<style>
    .is-disabled {
        opacity: 0.5;
        pointer-events: none;
    }
</style>

