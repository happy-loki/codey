<script lang="ts">
  import { onMount } from "svelte";
  import { get } from "svelte/store";
  import { ALargeSmall } from "lucide-svelte";
  import { workspaceName } from "./File";
  import { is_dark_theme } from "../config/themehandler";
  import { ensureSearchPanelOpen } from "./Statusbar.svelte";
  import { runSearch, searchState, toggleCaseSensitive, toggleIncludeHidden } from "./search/searchStore";
  import type { SearchState } from "./search/searchStore";
  import { t } from "./i18n";
  import { shouldBlockImeEnter } from "./utility/imeGuard";

  export let open = false;
  export let onClose: () => void = () => {};

  let query = "";
  let state: SearchState = get(searchState);
  $: state = $searchState;
  let wasOpen = false;
  let inputEl: HTMLInputElement | null = null;

  onMount(() => {
    if (open) {
      setTimeout(() => inputEl?.focus(), 0);
    }
  });

  $: {
    if (open && !wasOpen) {
      query = "";
      wasOpen = true;
      setTimeout(() => inputEl?.focus(), 0);
    } else if (!open && wasOpen) {
      wasOpen = false;
      query = "";
    }
  }

  function handleOverlayKey(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      closePopup();
    }
  }

  function handleInputKey(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      closePopup();
      return;
    }
    if (e.key === "Enter") {
      if (shouldBlockImeEnter(e)) {
        e.stopPropagation();
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      doSearch();
    }
  }

  function closePopup() {
    query = "";
    onClose();
  }

  function doSearch() {
    const q = (query || "").trim();
    if (!q) { onClose(); return; }
    // 打开底部面板中的搜索视图并运行查询
    ensureSearchPanelOpen();
    void runSearch(q);
    // 清空输入框，为下次搜索做准备
    closePopup();
  }

  function handleToggleCase() {
    toggleCaseSensitive(false);
    setTimeout(() => inputEl?.focus(), 0);
  }

  function handleToggleHidden() {
    toggleIncludeHidden(false);
    setTimeout(() => inputEl?.focus(), 0);
  }
</script>

{#if open}
<div class="overlay" data-theme={$is_dark_theme ? 'dark' : 'light'} on:keydown={handleOverlayKey} tabindex="0" on:click={closePopup}>
  <div class="panel" on:click|stopPropagation>
    <div class="input-wrap">
      <input
        bind:this={inputEl}
        type="text"
        class="big-input"
        placeholder={$workspaceName ? `${$workspaceName} (Workspace)` : "Search (Ctrl+Shift+F)"}
        bind:value={query}
        on:keydown={handleInputKey}
      />
    </div>
    <div class="options">
      <button
        class="case-toggle"
        class:active={state.caseSensitive}
        on:click={handleToggleCase}
        type="button"
        title={state.caseSensitive ? $t("search.caseSensitiveOn") : $t("search.caseSensitiveOff")}
      >
        <ALargeSmall />
        <span>{$t("search.caseSensitiveLabel")}</span>
      </button>
      <label class="hidden-toggle">
        <input
          type="checkbox"
          checked={state.includeHidden}
          on:change={handleToggleHidden}
        />
        <span>{$t("search.includeHiddenLabel")}</span>
      </label>
    </div>
    <div class="actions">
      <button class="primary" on:click={doSearch}>Search</button>
      <button class="ghost" on:click={closePopup}>Cancel (Esc)</button>
    </div>
    <!-- 可扩展：列表、历史、提示等 -->
  </div>
</div>
{/if}

<style>
  .overlay {
    position: fixed;
    inset: 0;
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding-top: 8vh;
    z-index: 1000;
    background: rgba(0,0,0,0.35);
  }
  .panel {
    width: min(760px, 90vw);
    border-radius: 10px;
    border: 1px solid transparent;
    box-shadow: 0 10px 30px rgba(0,0,0,0.35);
    padding: 16px;
  }
  .input-wrap {
    position: relative;
  }
  .big-input {
    width: 100%;
    height: 44px;
    border-radius: 8px;
    padding: 0 14px 0 36px;
    outline: none;
    border: 1px solid;
    font-size: 15px;
    background-repeat: no-repeat;
    background-position: 12px 50%;
    background-size: 18px 18px;
  }
  .actions {
    margin-top: 12px;
    display: flex;
    gap: 8px;
  }
  .options {
    margin-top: 10px;
    display: flex;
    gap: 8px;
  }
  .case-toggle {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 6px 12px;
    border-radius: 6px;
    border: 1px solid #cfcfcf;
    background: transparent;
    cursor: pointer;
    font-size: 13px;
    color: #333333;
  }
  .case-toggle svg {
    width: 16px;
    height: 16px;
  }
  .case-toggle.active {
    background: rgba(47,128,237,0.12);
    border-color: rgba(47,128,237,0.6);
    color: #2f80ed;
  }
  .hidden-toggle {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 13px;
    color: var(--text-secondary, #555);
  }
  .hidden-toggle input {
    margin: 0;
  }
  .primary {
    padding: 6px 12px;
    border-radius: 6px;
    border: 1px solid transparent;
    cursor: pointer;
  }
  .ghost {
    padding: 6px 12px;
    border-radius: 6px;
    border: 1px solid transparent;
    background: transparent;
    cursor: pointer;
  }

  /* 主题联动 */
  .overlay[data-theme="dark"] .panel {
    background: #1f1f1f;
    border-color: #2c2c2c;
  }
  .overlay[data-theme="dark"] .big-input {
    background-color: #2a2a2a;
    border-color: #3a3a3a;
    color: #eaeaea;
    caret-color: #eaeaea;
    /* 放大镜图标（深色） */
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='18' height='18' viewBox='0 0 24 24' fill='none' stroke='%23cfcfcf' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Ccircle cx='11' cy='11' r='7'/%3E%3Cline x1='21' y1='21' x2='16.65' y2='16.65'/%3E%3C/svg%3E");
  }
  .overlay[data-theme="dark"] .big-input:focus {
    border-color: #0078d4;
    box-shadow: 0 0 0 2px rgba(0,120,212,0.25);
    background-color: #2b2b2b;
  }
  .overlay[data-theme="dark"] .primary {
    background: #2f80ed;
    color: #fff;
  }
  .overlay[data-theme="dark"] .case-toggle {
    border-color: #3a3a3a;
    color: #eaeaea;
  }
  .overlay[data-theme="dark"] .case-toggle.active {
    background: rgba(47,128,237,0.2);
    border-color: rgba(47,128,237,0.6);
    color: #2f80ed;
  }
  .overlay[data-theme="dark"] .ghost {
    color: #cfcfcf;
    border-color: #3a3a3a;
  }


  .overlay[data-theme="light"] .panel {
    background: #ffffff;
    border-color: #d9d9d9;
  }
  .overlay[data-theme="light"] .big-input {
    background-color: #f3f3f3;
    border-color: #cfcfcf;
    color: #333333;
    caret-color: #333333;
    /* 放大镜图标（浅色） */
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='18' height='18' viewBox='0 0 24 24' fill='none' stroke='%236a6a6a' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Ccircle cx='11' cy='11' r='7'/%3E%3Cline x1='21' y1='21' x2='16.65' y2='16.65'/%3E%3C/svg%3E");
  }
  .overlay[data-theme="light"] .big-input:focus {
    border-color: #0078d4;
    box-shadow: 0 0 0 2px rgba(0,120,212,0.25);
    background-color: #f6f6f6;
  }
  .overlay[data-theme="light"] .primary {
    background: #2f80ed;
    color: #fff;
  }
  .overlay[data-theme="light"] .case-toggle {
    border-color: #cfcfcf;
    color: #333333;
  }
  .overlay[data-theme="light"] .case-toggle.active {
    background: rgba(47,128,237,0.12);
    border-color: rgba(47,128,237,0.6);
    color: #2f80ed;
  }
  .overlay[data-theme="light"] .ghost {
    color: #333;
    border-color: #cfcfcf;
  }

</style>
