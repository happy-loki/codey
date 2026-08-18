<script lang="ts">
  import { onDestroy, onMount, tick } from "svelte";

  import {
    defaultStyleConfig,
    getMarkdownCssPath,
    markdownCodeBlockThemeOptions,
    markdownColorOptions,
    markdownFontFamilyOptions,
    markdownFontSizeOptions,
    markdownThemeOptions,
    markdownWidthOptions,
    setStyleOption,
    styleConfig,
    type StyleConfig,
  } from "./markdown/styleStore";
  import { addEditorTab } from "./EditorTabList.svelte";
  import {
    AlignJustify,
    Check,
    Braces,
    Code2,
    Link2,
    ListIndentIncrease,
    ListOrdered,
    Monitor,
    Palette,
    Sparkles,
    Type,
  } from "lucide-svelte";

  const ICON_SIZE = 16;

  let currentConfig: StyleConfig = { ...defaultStyleConfig };
  let selectedTheme = currentConfig.theme;
  let selectedCodeTheme = currentConfig.codeBlockTheme;
  let selectedFontFamily = currentConfig.fontFamily;
  let selectedFontSize = currentConfig.fontSize;
  let selectedWidth = currentConfig.width ?? defaultStyleConfig.width;
  let selectedColor = currentConfig.primaryColor;
  let showLineNumber = currentConfig.isShowLineNumber;
  let macCodeBlock = currentConfig.isMacCodeBlock;
  let useIndent = currentConfig.isUseIndent ?? false;
  let citeStatus = currentConfig.isCiteStatus ?? false;
  let useJustify = currentConfig.isUseJustify ?? false;
  let useCustomCss = currentConfig.useCustomCss ?? false;
  let openingCustomCss = false;
  let fontMenuOpen = false;
  let codeMenuOpen = false;
  let themeMenuOpen = false;
  let colorMenuOpen = false;
  let fontMenuEl: HTMLDivElement | null = null;
  let fontTriggerEl: HTMLButtonElement | null = null;
  let codeMenuEl: HTMLDivElement | null = null;
  let codeTriggerEl: HTMLButtonElement | null = null;
  let themeMenuEl: HTMLDivElement | null = null;
  let themeTriggerEl: HTMLButtonElement | null = null;
  let colorMenuEl: HTMLDivElement | null = null;
  let colorTriggerEl: HTMLButtonElement | null = null;
  let fontMenuAlignRight = false;
  let codeMenuAlignRight = false;
  let themeMenuAlignRight = false;
  let colorMenuAlignRight = false;
  $: customCssMode = Boolean(useCustomCss);

  const unsubscribeStyle = styleConfig.subscribe((value) => {
    currentConfig = value;
    selectedTheme = value.theme;
    selectedCodeTheme = value.codeBlockTheme;
    selectedFontFamily = value.fontFamily;
    selectedFontSize = value.fontSize;
    selectedWidth = value.width ?? defaultStyleConfig.width;
    selectedColor = value.primaryColor;
    showLineNumber = Boolean(value.isShowLineNumber);
    macCodeBlock = Boolean(value.isMacCodeBlock);
    useIndent = Boolean(value.isUseIndent);
    citeStatus = Boolean(value.isCiteStatus);
    useJustify = Boolean(value.isUseJustify);
    useCustomCss = Boolean(value.useCustomCss);
  });

  function handleCodeThemeChange(event: Event) {
    const target = event.currentTarget as HTMLSelectElement | null;
    if (!target) return;
    setStyleOption("codeBlockTheme", target.value as StyleConfig["codeBlockTheme"]);
  }

  function handleFontFamilyChange(event: Event) {
    const target = event.currentTarget as HTMLSelectElement | null;
    if (!target) return;
    setStyleOption("fontFamily", target.value as StyleConfig["fontFamily"]);
  }

  function handleFontSizeChange(event: Event) {
    const target = event.currentTarget as HTMLSelectElement | null;
    if (!target) return;
    setStyleOption("fontSize", target.value as StyleConfig["fontSize"]);
  }

  function updateStyleOption<K extends keyof StyleConfig>(key: K, value: StyleConfig[K]) {
    setStyleOption(key, value);
  }

  function toggleBooleanOption<K extends keyof StyleConfig>(key: K, current: StyleConfig[K]) {
    setStyleOption(key, (!current) as StyleConfig[K]);
  }

  $: fontFamilyLabel = markdownFontFamilyOptions.find((option) => option.value === selectedFontFamily)?.label ?? selectedFontFamily;
  $: fontSizeLabel = markdownFontSizeOptions.find((option) => option.value === selectedFontSize)?.label ?? selectedFontSize;
  $: fontButtonLabel = `${fontFamilyLabel} · ${fontSizeLabel}`;
  $: codeThemeLabel = markdownCodeBlockThemeOptions.find((option) => option.value === selectedCodeTheme)?.label ?? selectedCodeTheme;
  $: themeLabel = markdownThemeOptions.find((option) => option.value === selectedTheme)?.label ?? selectedTheme;
  $: selectedColorOption = markdownColorOptions.find((option) => option.value === selectedColor);

  function toggleFontMenu() {
    fontMenuOpen = !fontMenuOpen;
    if (fontMenuOpen) {
      codeMenuOpen = false;
      themeMenuOpen = false;
      colorMenuOpen = false;
      queueDropdownAlignmentUpdate("font");
    }
  }

  function toggleCodeMenu() {
    codeMenuOpen = !codeMenuOpen;
    if (codeMenuOpen) {
      fontMenuOpen = false;
      themeMenuOpen = false;
      colorMenuOpen = false;
      queueDropdownAlignmentUpdate("code");
    }
  }

  function toggleThemeMenu() {
    themeMenuOpen = !themeMenuOpen;
    if (themeMenuOpen) {
      fontMenuOpen = false;
      codeMenuOpen = false;
      colorMenuOpen = false;
      queueDropdownAlignmentUpdate("theme");
    }
  }

  function toggleColorMenu() {
    colorMenuOpen = !colorMenuOpen;
    if (colorMenuOpen) {
      fontMenuOpen = false;
      codeMenuOpen = false;
      themeMenuOpen = false;
      queueDropdownAlignmentUpdate("color");
    }
  }

  function selectTheme(value: string) {
    updateStyleOption("theme", value as StyleConfig["theme"]);
    themeMenuOpen = false;
  }

  function selectPrimaryColor(value: string) {
    updateStyleOption("primaryColor", value as StyleConfig["primaryColor"]);
    colorMenuOpen = false;
  }

  function closeMenus() {
    fontMenuOpen = false;
    codeMenuOpen = false;
    themeMenuOpen = false;
    colorMenuOpen = false;
  }

  function shouldAlignRight(menuEl: HTMLElement | null, triggerEl: HTMLElement | null): boolean {
    if (!menuEl || !triggerEl || typeof window === "undefined") {
      return false;
    }
    const viewportWidth = window.innerWidth || 0;
    const margin = 12;
    const triggerRect = triggerEl.getBoundingClientRect();
    const menuRect = menuEl.getBoundingClientRect();

    if (triggerRect.left + menuRect.width > viewportWidth - margin) {
      return true;
    }

    if (triggerRect.left < margin) {
      return false;
    }

    return false;
  }

  async function queueDropdownAlignmentUpdate(kind: "font" | "code" | "theme" | "color") {
    await tick();
    const update = () => {
      switch (kind) {
        case "font":
          fontMenuAlignRight = shouldAlignRight(fontMenuEl, fontTriggerEl);
          break;
        case "code":
          codeMenuAlignRight = shouldAlignRight(codeMenuEl, codeTriggerEl);
          break;
        case "theme":
          themeMenuAlignRight = shouldAlignRight(themeMenuEl, themeTriggerEl);
          break;
        case "color":
          colorMenuAlignRight = shouldAlignRight(colorMenuEl, colorTriggerEl);
          break;
      }
    };

    requestAnimationFrame(update);
  }

  function handleDocumentClick(event: MouseEvent) {
    const target = event.target as Node | null;
    if (!target) return;

    if (fontMenuOpen) {
      const insideFontMenu = (fontMenuEl && fontMenuEl.contains(target)) || (fontTriggerEl && fontTriggerEl.contains(target));
      if (!insideFontMenu) {
        fontMenuOpen = false;
      }
    }

    if (codeMenuOpen) {
      const insideCodeMenu = (codeMenuEl && codeMenuEl.contains(target)) || (codeTriggerEl && codeTriggerEl.contains(target));
      if (!insideCodeMenu) {
        codeMenuOpen = false;
      }
    }

    if (themeMenuOpen) {
      const insideThemeMenu = (themeMenuEl && themeMenuEl.contains(target)) || (themeTriggerEl && themeTriggerEl.contains(target));
      if (!insideThemeMenu) {
        themeMenuOpen = false;
      }
    }

    if (colorMenuOpen) {
      const insideColorMenu = (colorMenuEl && colorMenuEl.contains(target)) || (colorTriggerEl && colorTriggerEl.contains(target));
      if (!insideColorMenu) {
        colorMenuOpen = false;
      }
    }
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === "Escape") {
      closeMenus();
    }
  }

  onMount(() => {
    document.addEventListener("click", handleDocumentClick, true);
    document.addEventListener("keydown", handleKeydown, true);
  });

  async function handleOpenCustomCss(event: Event) {
    event.preventDefault();
    if (openingCustomCss) return;
    openingCustomCss = true;
    try {
      const cssPath = await getMarkdownCssPath();
      if (!cssPath) {
        return;
      }
      const parts = cssPath.split(/[/\\]/);
      const label = parts[parts.length - 1] || "markdown.css";
      await addEditorTab(cssPath, label);
    }
    catch (error) {
      console.warn("Failed to open markdown.css", error);
    }
    finally {
      openingCustomCss = false;
    }
  }

  onDestroy(() => {
    unsubscribeStyle();
    document.removeEventListener("click", handleDocumentClick, true);
    document.removeEventListener("keydown", handleKeydown, true);
  });
</script>

<div class="markdown-theme-controls">
  <div class="row row--primary">
    <div class="menu-trigger">
      <button
        type="button"
        class="menu-button"
        bind:this={themeTriggerEl}
        aria-haspopup="true"
        aria-expanded={themeMenuOpen}
        on:click={toggleThemeMenu}
      >
        <span class="menu-button__icon"><Sparkles size={ICON_SIZE} /></span>
        <span class="menu-button__label">
          风格
          <small>{themeLabel}</small>
        </span>
      </button>
      {#if themeMenuOpen}
        <div class="dropdown" class:right-align={themeMenuAlignRight} bind:this={themeMenuEl} on:click|stopPropagation>
          <div class="option-list">
            {#each markdownThemeOptions as option}
              <button
                type="button"
                class:active={selectedTheme === option.value}
                disabled={customCssMode}
                on:click={() => selectTheme(option.value)}
              >
                <span class="option-label">{option.label}</span>
                {#if selectedTheme === option.value}
                  <Check size={12} class="option-check" aria-hidden="true" />
                {/if}
              </button>
            {/each}
          </div>
        </div>
      {/if}
    </div>

    <div class="menu-trigger">
      <button
        type="button"
        class="menu-button"
        bind:this={colorTriggerEl}
        aria-haspopup="true"
        aria-expanded={colorMenuOpen}
        on:click={toggleColorMenu}
      >
        <span class="menu-button__icon"><Palette size={ICON_SIZE} /></span>
        <span class="menu-button__label">
          主题色
          <small>
            <span
              class="color-chip"
              style={`--chip-color: ${selectedColorOption?.value ?? selectedColor}`}
            />
            {selectedColorOption?.label ?? selectedColor}
          </small>
        </span>
      </button>
      {#if colorMenuOpen}
        <div class="dropdown" class:right-align={colorMenuAlignRight} bind:this={colorMenuEl} on:click|stopPropagation>
          <div class="option-list">
            {#each markdownColorOptions as option}
              <button
                type="button"
                class:active={selectedColor === option.value}
                disabled={customCssMode}
                on:click={() => selectPrimaryColor(option.value)}
              >
                <span class="color-chip" style={`--chip-color: ${option.value}`} />
                <span class="option-meta">
                  <strong>{option.label}</strong>
                  <small>{option.value}</small>
                </span>
                {#if selectedColor === option.value}
                  <Check size={12} class="option-check" aria-hidden="true" />
                {/if}
              </button>
            {/each}
          </div>
        </div>
      {/if}
    </div>

    <div class="menu-trigger">
      <button
        type="button"
        class="menu-button"
        bind:this={fontTriggerEl}
        aria-haspopup="true"
        aria-expanded={fontMenuOpen}
        on:click={toggleFontMenu}
      >
        <span class="menu-button__icon"><Type size={ICON_SIZE} /></span>
        <span class="menu-button__label">
          字体
          <small>{fontButtonLabel}</small>
        </span>
      </button>
      {#if fontMenuOpen}
        <div class="dropdown" class:right-align={fontMenuAlignRight} bind:this={fontMenuEl} on:click|stopPropagation>
          <label>
            <span>字体</span>
            <select bind:value={selectedFontFamily} on:change={handleFontFamilyChange} disabled={customCssMode}>
              {#each markdownFontFamilyOptions as option}
                <option value={option.value}>{option.label}</option>
              {/each}
            </select>
          </label>
          <label>
            <span>字号</span>
            <select bind:value={selectedFontSize} on:change={handleFontSizeChange} disabled={customCssMode}>
              {#each markdownFontSizeOptions as option}
                <option value={option.value}>{option.label}</option>
              {/each}
            </select>
          </label>
        </div>
      {/if}
    </div>
    <div class="format-toggle" role="group" aria-label="排版格式">
        <button
          type="button"
          class:active={useIndent}
          aria-pressed={useIndent}
          title="首行缩进"
          disabled={customCssMode}
          on:click={() => toggleBooleanOption("isUseIndent", useIndent)}
        >
        <ListIndentIncrease size={16} />
        <span>首行</span>
      </button>
        <button
          type="button"
          class:active={useJustify}
          aria-pressed={useJustify}
          title="两端对齐"
          disabled={customCssMode}
          on:click={() => toggleBooleanOption("isUseJustify", useJustify)}
        >
        <AlignJustify size={16} />
        <span>对齐</span>
      </button>
    </div>
  </div>

  <div class="row row--secondary">
    <div class="width-toggle" role="group" aria-label="预览宽度">
      {#each markdownWidthOptions as option}
        <button
          type="button"
          class:active={selectedWidth === option.value}
          on:click={() => updateStyleOption("width", option.value)}
        >
          {option.label}
        </button>
      {/each}
    </div>

    <div class="menu-trigger">
      <button
        type="button"
        class="menu-button"
        bind:this={codeTriggerEl}
        aria-haspopup="true"
        aria-expanded={codeMenuOpen}
        on:click={toggleCodeMenu}
      >
        <span class="menu-button__icon"><Code2 size={ICON_SIZE} /></span>
        <span class="menu-button__label">
          代码
          <small>{codeThemeLabel}</small>
        </span>
      </button>
      {#if codeMenuOpen}
        <div class="dropdown" class:right-align={codeMenuAlignRight} bind:this={codeMenuEl} on:click|stopPropagation>
          <label>
            <span>代码高亮</span>
            <select bind:value={selectedCodeTheme} on:change={handleCodeThemeChange} disabled={customCssMode}>
              {#each markdownCodeBlockThemeOptions as option}
                <option value={option.value}>{option.label}</option>
              {/each}
            </select>
          </label>
          <div class="toggle-list">
            <button
              type="button"
              class:active={showLineNumber}
              aria-pressed={showLineNumber}
              disabled={customCssMode}
              on:click={() => toggleBooleanOption("isShowLineNumber", showLineNumber)}
            >
              <span class="option-label">
                <ListOrdered size={ICON_SIZE} />
                <span>行号</span>
              </span>
              {#if showLineNumber}
                <Check size={12} class="option-check" aria-hidden="true" />
              {/if}
            </button>
            <button
              type="button"
              class:active={macCodeBlock}
              aria-pressed={macCodeBlock}
              disabled={customCssMode}
              on:click={() => toggleBooleanOption("isMacCodeBlock", macCodeBlock)}
            >
              <span class="option-label">
                <Monitor size={ICON_SIZE} />
                <span>Mac 样式</span>
              </span>
              {#if macCodeBlock}
                <Check size={12} class="option-check" aria-hidden="true" />
              {/if}
            </button>
          </div>
        </div>
      {/if}
    </div>

    <div class="inline-toggle" role="group" aria-label="链接排版">
      <button
        type="button"
        class:active={citeStatus}
        aria-pressed={citeStatus}
        title="微信外链转底部引用"
        disabled={customCssMode}
        on:click={() => toggleBooleanOption("isCiteStatus", citeStatus)}
      >
        <Link2 size={16} />
      </button>
    </div>

    <div class="custom-css-group" aria-label="自定义 CSS">
      <button
        type="button"
        class:active={useCustomCss}
        aria-pressed={useCustomCss}
        title="使用自定义 CSS"
        on:click={() => toggleBooleanOption("useCustomCss", useCustomCss)}
      >
        <Braces size={16} />
        <span>使用自定义 CSS</span>
      </button>
      <button
        type="button"
        class="link-button"
        on:click={handleOpenCustomCss}
        disabled={openingCustomCss || !useCustomCss}
      >
        编辑
      </button>
    </div>

    {#if customCssMode}
      <div class="custom-css-hint" role="status" aria-live="polite">
        已启用接管模式，预览样式由 <code>markdown.css</code> 控制，其他排版选项已停用。
      </div>
    {/if}
  </div>
</div>

<style lang="scss">
.markdown-theme-controls {
  --toolbar-font-size: var(--ui-font-size, 16px);
  --toolbar-control-height: clamp(28px, calc(var(--toolbar-font-size) * 2.25), 46px);
  --toolbar-group-padding: 2px;
  --toolbar-button-horizontal-padding: clamp(12px, calc(var(--toolbar-font-size) * 0.9), 22px);

  position: sticky;
  top: 0;
  z-index: 2;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  padding: 8px 12px;
  background: var(--window-panelBackground, rgba(255, 255, 255, 0.9));
  border-bottom: 1px solid var(--window-borderColor, rgba(0, 0, 0, 0.08));
  backdrop-filter: blur(12px);

  .row {
    display: contents;
  }

  .menu-trigger,
  .format-toggle,
  .width-toggle,
  .inline-toggle,
  .custom-css-group,
  .custom-css-hint {
    flex-shrink: 0;
  }

  .custom-css-hint {
    display: inline-flex;
    align-items: center;
    min-height: var(--toolbar-control-height);
    padding: 0 12px;
    border-radius: 16px;
    background: color-mix(in srgb, var(--accent-color, #3b82f6) 10%, transparent);
    color: var(--window-fg, inherit);
    font-size: calc(var(--toolbar-font-size) * 0.92);
    white-space: nowrap;

    code {
      font-family: var(--monospace-font, ui-monospace, "SFMono-Regular", "Menlo", "Monaco", "Consolas", "Liberation Mono", "Roboto Mono", "JetBrains Mono", monospace);
      font-size: 0.95em;
      padding: 0 0.2em;
    }
  }

  .width-toggle {
    display: inline-flex;
    border-radius: 18px;
    border: 1px solid var(--window-inputBorder, rgba(0, 0, 0, 0.12));
    background: var(--window-inputBackground, rgba(255, 255, 255, 0.85));
    padding: var(--toolbar-group-padding);
    gap: 6px;

    button {
      border: none;
      background: transparent;
      padding: 0 var(--toolbar-button-horizontal-padding);
      height: var(--toolbar-control-height);
      font-size: var(--toolbar-font-size);
      color: inherit;
      border-radius: 18px;
      line-height: 1;
      transition: background 0.2s ease, color 0.2s ease;

      &.active {
        background: var(--accent-color, #3b82f6);
        color: #fff;
      }

      &:not(.active):hover {
        background: color-mix(in srgb, var(--accent-color, #3b82f6) 12%, transparent);
      }
    }
  }

  .menu-trigger {
    position: relative;
    display: inline-flex;
    align-items: center;
    padding: var(--toolbar-group-padding);
    border-radius: 22px;
    background: var(--window-inputBackground, rgba(255, 255, 255, 0.82));
    border: 1px solid color-mix(in srgb, var(--window-inputBorder, rgba(0, 0, 0, 0.1)) 75%, transparent);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, transparent 88%, var(--window-inputBorder, rgba(0, 0, 0, 0.08)) 12%);
  }

  .menu-button {
    display: inline-flex;
    align-items: center;
    gap: clamp(6px, calc(var(--toolbar-font-size) * 0.45), 10px);
    height: var(--toolbar-control-height);
    padding: 0 var(--toolbar-button-horizontal-padding);
    border-radius: 18px;
    border: none;
    background: transparent;
    color: inherit;
    font-size: var(--toolbar-font-size);
    line-height: 1;
    transition: background 0.2s ease, box-shadow 0.2s ease;

    &:hover {
      background: color-mix(in srgb, var(--accent-color, #3b82f6) 12%, transparent);
    }

    &[aria-expanded="true"] {
      background: color-mix(in srgb, var(--accent-color, #3b82f6) 18%, transparent);
      box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent-color, #3b82f6) 35%, transparent);
    }

    .menu-button__icon {
      display: grid;
      place-items: center;
    }

    .menu-button__label {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      justify-content: center;
      height: 100%;
      min-width: 0;
      line-height: 1.05;
      font-weight: 600;
      gap: clamp(1px, calc(var(--toolbar-font-size) * 0.05), 4px);
      padding-right: clamp(2px, calc(var(--toolbar-font-size) * 0.15), 8px);

      small {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        max-width: clamp(124px, calc(var(--toolbar-font-size) * 7.5), 176px);
        font-size: clamp(11px, calc(var(--toolbar-font-size) * 0.68), var(--toolbar-font-size) - 3px);
        line-height: 1.05;
        color: var(--window-descriptionForeground, rgba(60, 72, 88, 0.7));
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
    }
  }

  .dropdown {
    position: absolute;
    top: calc(100% + 6px);
    left: 0;
    right: auto;
    min-width: 220px;
    padding: 12px;
    border-radius: 12px;
    background: var(--window-menuBackground, rgba(255, 255, 255, 0.95));
    box-shadow: var(--modern-shadow-md, 0 12px 24px rgba(15, 23, 42, 0.15));
    border: 1px solid var(--window-borderColor, rgba(0, 0, 0, 0.08));
    display: grid;
    gap: 10px;
    z-index: 5;

    label {
      display: flex;
      flex-direction: column;
      gap: 6px;
      font-size: var(--toolbar-font-size);

      select {
        min-width: unset;
        width: 100%;
      }
    }
  }

  .option-list {
    display: grid;
    gap: 6px;

    button {
      width: 100%;
      display: grid;
      grid-template-columns: auto 1fr auto;
      align-items: center;
      gap: 8px;
      border: 1px solid transparent;
      background: color-mix(in srgb, var(--accent-color, #3b82f6) 0%, transparent);
      border-radius: 8px;
      padding: 8px 12px;
      font-size: var(--toolbar-font-size);
      color: inherit;
      transition: background 0.2s ease, border-color 0.2s ease;

      &:hover {
        background: color-mix(in srgb, var(--accent-color, #3b82f6) 12%, transparent);
      }

      &.active {
        border-color: color-mix(in srgb, var(--accent-color, #3b82f6) 30%, transparent);
        background: color-mix(in srgb, var(--accent-color, #3b82f6) 16%, transparent);
      }

      .option-label {
        grid-column: 1 / 3;
        justify-self: start;
        display: inline-flex;
        align-items: center;
        gap: 6px;
      }

      .option-check {
        justify-self: end;
        margin-left: auto;
        color: var(--accent-color, #3b82f6);
      }
    }
  }

  .color-chip {
    width: 12px;
    height: 12px;
    border-radius: 999px;
    background: var(--chip-color, transparent);
    border: 1px solid rgba(0, 0, 0, 0.1);
    box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.4);
    flex-shrink: 0;
  }

  .option-meta {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    line-height: 1.1;

    strong {
      font-weight: 600;
    }

    small {
      font-size: clamp(11px, calc(var(--toolbar-font-size) * 0.68), var(--toolbar-font-size) - 3px);
      color: var(--window-descriptionForeground, rgba(60, 72, 88, 0.7));
    }
  }

  .dropdown.right-align {
    left: auto;
    right: 0;
  }

  .toggle-list {
    display: grid;
    gap: 6px;

    button {
      display: grid;
      grid-template-columns: auto 1fr auto;
      align-items: center;
      gap: 6px;
      border-radius: 8px;
      padding: 8px 12px;
      border: 1px solid transparent;
      background: color-mix(in srgb, var(--accent-color, #3b82f6) 0%, transparent);
      color: inherit;
      font-size: var(--toolbar-font-size);

      &:hover {
        background: color-mix(in srgb, var(--accent-color, #3b82f6) 12%, transparent);
      }

      &.active {
        background: color-mix(in srgb, var(--accent-color, #3b82f6) 18%, transparent);
        border-color: color-mix(in srgb, var(--accent-color, #3b82f6) 30%, transparent);
      }

      .option-label {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        grid-column: 1 / 3;
      }

      .option-check {
        justify-self: end;
        color: var(--accent-color, #3b82f6);
      }
    }
  }

  .format-toggle {
    display: inline-flex;
    align-items: center;
    gap: 0;
    padding: 0;
    border-radius: 22px;
    background: var(--window-inputBackground, rgba(255, 255, 255, 0.8));
    border: 1px solid var(--window-inputBorder, rgba(0, 0, 0, 0.08));
    height: var(--toolbar-control-height);
    overflow: hidden;

    button {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      border: none;
      border-radius: 0;
      padding: 0 clamp(12px, calc(var(--toolbar-font-size) * 0.85), 20px);
      height: var(--toolbar-control-height);
      font-size: var(--toolbar-font-size);
      background: transparent;
      color: inherit;
      transition: background 0.2s ease, color 0.2s ease;

      &:hover {
        background: color-mix(in srgb, var(--accent-color, #3b82f6) 12%, transparent);
      }

      &.active {
        background: var(--accent-color, #3b82f6);
        color: #fff;
      }
    }
  }

  .inline-toggle {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: var(--toolbar-group-padding);
    border-radius: 22px;
    background: var(--window-inputBackground, rgba(255, 255, 255, 0.8));
    border: 1px solid var(--window-inputBorder, rgba(0, 0, 0, 0.08));

    button {
      width: var(--toolbar-control-height);
      height: var(--toolbar-control-height);
      display: grid;
      place-items: center;
      border-radius: 18px;
      border: none;
      background: transparent;
      color: inherit;
      transition: background 0.2s ease, color 0.2s ease;

      &:hover {
        background: color-mix(in srgb, var(--accent-color, #3b82f6) 12%, transparent);
      }

      &.active {
        background: var(--accent-color, #3b82f6);
        color: #fff;
      }
    }
  }

  .custom-css-group {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: var(--toolbar-group-padding);
    border-radius: 22px;
    background: var(--window-inputBackground, rgba(255, 255, 255, 0.8));
    border: 1px solid var(--window-inputBorder, rgba(0, 0, 0, 0.08));

    button {
      border: none;
      border-radius: 18px;
      height: var(--toolbar-control-height);
      font-size: var(--toolbar-font-size);
    }

    button:first-child {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 0 var(--toolbar-button-horizontal-padding);
      background: transparent;
      color: inherit;
      transition: background 0.2s ease, color 0.2s ease;

      &:hover {
        background: color-mix(in srgb, var(--accent-color, #3b82f6) 12%, transparent);
      }

      &.active {
        background: var(--accent-color, #3b82f6);
        color: #fff;
      }
    }
  }

  .link-button {
    font-size: var(--toolbar-font-size);
    color: var(--accent-color, #3b82f6);
    background: none;
    border: none;
    padding: 0 var(--toolbar-button-horizontal-padding);
    min-width: 48px;
    height: var(--toolbar-control-height);
    border-radius: 18px;
    transition: background 0.2s ease;

    &:hover:enabled {
      background: color-mix(in srgb, var(--accent-color, #3b82f6) 10%, transparent);
    }

    &:disabled {
      opacity: 0.5;
      cursor: default;
    }
  }
}

:global(#workarea.mode-split) .markdown-theme-controls {
  margin-left: 0;
  padding-left: 12px;
}
</style>
