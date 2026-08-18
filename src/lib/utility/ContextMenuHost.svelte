<script lang="ts">
  import { onMount, afterUpdate } from 'svelte';
  import { contextMenuState, closeContextMenu } from './contextMenuService';
  let menuRef: HTMLElement | null = null;
  let adjustedX = 0;
  let adjustedY = 0;

  function portal(node: HTMLElement) {
    document.body.appendChild(node);
    return { destroy() { try { node.parentNode?.removeChild(node); } catch {} } };
  }

  // 调整菜单位置，防止超出屏幕边界
  function adjustPosition() {
    if (!menuRef) return;
    
    const rect = menuRef.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    
    let x = $contextMenuState.x;
    let y = $contextMenuState.y;
    
    // 如果菜单超出右边界，向左展开（从鼠标位置向左偏移菜单宽度）
    if (x + rect.width > viewportWidth - 8) {
      x = x - rect.width;
      // 如果向左展开后超出左边界，则贴着右边界显示
      if (x < 8) {
        x = viewportWidth - rect.width - 8;
      }
    }
    
    // 确保菜单不会超出左边界
    if (x < 8) {
      x = 8;
    }
    
    // 如果菜单超出底部边界，向上展开
    if (y + rect.height > viewportHeight - 8) {
      y = y - rect.height;
      // 如果向上展开后超出顶部边界，则贴着底部显示
      if (y < 8) {
        y = viewportHeight - rect.height - 8;
      }
    }
    
    // 确保菜单不会超出顶部边界
    if (y < 8) {
      y = 8;
    }
    
    adjustedX = x;
    adjustedY = y;
  }

  // 当菜单状态变化时调整位置
  $: if ($contextMenuState.open && menuRef) {
    adjustedX = $contextMenuState.x;
    adjustedY = $contextMenuState.y;
    // 使用 requestAnimationFrame 确保 DOM 已更新
    requestAnimationFrame(() => adjustPosition());
  }

  onMount(() => {
    const onClickWindow = (e: MouseEvent) => {
      // 若点击发生在菜单内部，则不在这里关闭，让选项自身的点击逻辑先处理
      if (menuRef && e.target && menuRef.contains(e.target as Node)) return;
      closeContextMenu();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeContextMenu(); };
    const onWheel = () => closeContextMenu();
    const onResize = () => closeContextMenu();
    // 使用冒泡阶段，避免早于菜单项点击执行
    window.addEventListener('click', onClickWindow, false);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('wheel', onWheel, { passive: true } as any);
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('click', onClickWindow, false);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('wheel', onWheel as any);
      window.removeEventListener('resize', onResize);
    };
  });
</script>

{#if $contextMenuState.open}
  <div use:portal class="ctx-host">
    <div class="context-menu" bind:this={menuRef} style={`top:${adjustedY}px; left:${adjustedX}px`}>
      {#each $contextMenuState.items as item, index (item.id ?? index)}
        {#if item.type === "separator"}
          <div class="context-menu-separator" aria-hidden="true"></div>
        {:else}
          <!-- svelte-ignore a11y-click-events-have-key-events -->
          <div
            class="context-menu-option"
            title=""
            class:disabled={item.disabled}
            on:click={() => {
              if (!item.disabled) {
                closeContextMenu();
                try { item.action(); } catch {}
              }
            }}
          >
            <span class="option-name">{item.name}</span>
            {#if item.shortcut}
              <span class="option-shortcut">{item.shortcut}</span>
            {/if}
          </div>
        {/if}
      {/each}
    </div>
  </div>
{/if}

<style>
  .ctx-host { position: fixed; inset: 0; z-index: 100000; pointer-events: none; }
  .context-menu {
    position: fixed;
    min-width: 12rem;
    max-width: 20rem;
    padding: 4px;
    z-index: 100001;
    border-radius: 6px;
    pointer-events: auto;
    background: var(--context-menu-surface, rgba(30, 30, 30, 0.95));
    color: var(--context-menu-foreground, #f3f4f6);
    border: 1px solid var(--context-menu-border, rgba(255, 255, 255, 0.08));
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
    backdrop-filter: blur(8px);
  }
  .context-menu-option { display:flex; align-items:center; justify-content:space-between; min-height:24px; padding:6px 0; width:100%; font-size:0.875rem; cursor:pointer; border-radius:4px; }
  .option-name, .option-shortcut { padding: 0 10px; }
  .option-shortcut { margin-left: 10px; }
  .context-menu-option:not(.disabled):hover { background: rgba(255, 255, 255, 0.08); }
  .disabled { cursor: not-allowed; opacity: 0.5; }
  .context-menu-separator { height: 1px; margin: 4px 8px; background: rgba(255, 255, 255, 0.08); }
  :global(html[data-theme="light"]) .context-menu,
  :global(body:not([data-theme="dark"])) .context-menu {
    background: var(--context-menu-surface-light, rgba(255, 255, 255, 0.98));
    color: var(--context-menu-foreground-light, #111827);
    border-color: rgba(15, 23, 42, 0.08);
    box-shadow: 0 10px 30px rgba(15, 23, 42, 0.15);
  }
  :global(html[data-theme="light"]) .context-menu-separator,
  :global(body:not([data-theme="dark"])) .context-menu-separator {
    background: rgba(15, 23, 42, 0.08);
  }
  :global(html[data-theme="light"]) .context-menu-option:not(.disabled):hover,
  :global(body:not([data-theme="dark"])) .context-menu-option:not(.disabled):hover {
    background: rgba(15, 23, 42, 0.08);
  }
</style>
