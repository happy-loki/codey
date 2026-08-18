<script lang="ts">
  import { createEventDispatcher } from "svelte";
  import { X } from "lucide-svelte";
  import { shouldBlockImeEnter } from "./utility/imeGuard";

  export let value = "";
  export let disabled = false;
  // 结果计数与阈值溢出标志
  export let resultIndex: number = -1;
  export let resultCount: number = 0;
  export let overflow: boolean = false;
  // 搜索选项
  export let caseSensitive = false;
  export let wholeWord = false;
  export let regex = false;

  const dispatch = createEventDispatcher();
  let inputEl: HTMLInputElement;

  // Expose focus() so parent can focus the input
  export function focus() {
    inputEl?.focus();
    inputEl?.select();
  }

  function onKeydown(e: KeyboardEvent) {
    if (disabled) return;
    if (e.key === "Enter") {
      if (shouldBlockImeEnter(e)) {
        e.stopPropagation();
        return;
      }
      e.preventDefault();
      if (e.shiftKey) dispatch("prev", { value });
      else dispatch("next", { value });
    } else if (e.key === "Escape") {
      e.preventDefault();
      if (value.trim() === "") {
        dispatch("close");
      } else {
        value = "";
        dispatch("clear");
      }
    }
  }

  function onInput() {
    // 增量刷新（不强制跳转下一个）
    dispatch("change", { value });
  }

  function onBlur() {
    dispatch("blur");
  }

  function next() {
    if (!disabled) dispatch("next", { value });
  }
  function prev() {
    if (!disabled) dispatch("prev", { value });
  }
  function clear() {
    value = "";
    dispatch("clear");
  }

  function toggleCase() {
    caseSensitive = !caseSensitive;
    dispatch("options", { caseSensitive, wholeWord, regex });
  }
  function toggleWhole() {
    wholeWord = !wholeWord;
    dispatch("options", { caseSensitive, wholeWord, regex });
  }
  function toggleRegex() {
    regex = !regex;
    dispatch("options", { caseSensitive, wholeWord, regex });
  }
</script>

<div class="terminal-search">
  <input
    class="search-input"
    type="text"
    bind:this={inputEl}
    bind:value
    placeholder="Search in terminal…"
    on:keydown={onKeydown}
    on:input={onInput}
    on:blur={onBlur}
    {disabled}
  />
  <div class="toggles">
    <label class="chk"><input type="checkbox" bind:checked={caseSensitive} on:change={toggleCase} />Aa</label>
    <label class="chk"><input type="checkbox" bind:checked={wholeWord} on:change={toggleWhole} />W</label>
    <label class="chk"><input type="checkbox" bind:checked={regex} on:change={toggleRegex} />.*</label>
  </div>
  <button class="btn" on:click={prev} {disabled} title="Previous (Shift+Enter)">Prev</button>
  <button class="btn" on:click={next} {disabled} title="Next (Enter)">Next</button>
  <button class="btn" on:click={clear} title="Clear">Clear</button>
  <button class="btn close-btn" on:click={() => dispatch('close')} title="Close">
    <X size={14} />
  </button>
  <span class="hint">
    {#if overflow}
      {resultCount}+ matches
    {:else}
      {#if resultCount > 0}
        {(resultIndex >= 0 ? resultIndex + 1 : 0)}/{resultCount}
      {:else}
        0/0
      {/if}
    {/if}
  </span>
  
</div>

<style>
  .terminal-search {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 8px;
  }
  .search-input {
    flex: 1 1 auto;
    height: 28px;
    padding: 4px 8px;
    border: 1px solid var(--border-color, #e5e7eb);
    border-radius: 6px;
    background: var(--panel-bg, rgba(0,0,0,0));
    color: inherit;
    outline: none;
  }
  .toggles { display: flex; gap: 6px; align-items: center; }
  .chk { font-size: 12px; opacity: 0.8; display: flex; gap: 4px; align-items: center; }
  .btn {
    height: 28px;
    padding: 0 10px;
    border: 1px solid var(--border-color, #e5e7eb);
    background: var(--btn-bg, rgba(0,0,0,0));
    color: inherit;
    border-radius: 6px;
    cursor: pointer;
  }
  .btn:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .close-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: var(--muted-foreground, #666);
    transition: all 0.15s ease;
  }
  .close-btn:hover:not(:disabled) {
    background: var(--destructive-bg, rgba(239, 68, 68, 0.1));
    color: var(--destructive, #ef4444);
    border-color: var(--destructive, #ef4444);
  }
  .hint {
    margin-left: 6px;
    font-size: 12px;
    opacity: 0.7;
  }
</style>
