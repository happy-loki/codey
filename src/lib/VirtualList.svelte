<script lang="ts">
  export let rowHeight = 22;
  export let items: any[] = [];
  export let overscan = 6;
  import { onMount, tick } from "svelte";
  let container: HTMLDivElement;
  let width = 0;
  let height = 0;
  let scrollTop = 0;
  let ro: ResizeObserver | null = null;

  $: total = items.length * rowHeight;
  $: start = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  $: end = Math.min(items.length, Math.ceil((scrollTop + height) / rowHeight) + overscan);
  $: offsetTop = start * rowHeight;
  $: visible = items.slice(start, end);

  function onScroll() {
    if (!container) return;
    scrollTop = container.scrollTop;
  }
  function recalc() {
    height = container?.clientHeight || 0;
    width = container?.clientWidth || 0;
  }
  export function scrollToIndex(index: number, align: 'start' | 'center' | 'end' = 'center') {
    if (!container || !Number.isFinite(index) || index < 0) return;
    const totalHeight = items.length * rowHeight;
    if (totalHeight <= 0) return;
    const maxScroll = Math.max(0, totalHeight - (container.clientHeight || 0));
    let target = index * rowHeight;
    if (align === 'center') {
      target = target - (container.clientHeight / 2) + (rowHeight / 2);
    } else if (align === 'end') {
      target = target - (container.clientHeight || 0) + rowHeight;
    }
    if (!Number.isFinite(target)) return;
    const clamped = Math.min(maxScroll, Math.max(0, target));
    container.scrollTop = clamped;
    scrollTop = clamped;
  }
  onMount(async () => {
    await tick();
    recalc();
    if (typeof ResizeObserver !== "undefined" && container) {
      ro = new ResizeObserver(() => {
        recalc();
      });
      ro.observe(container);
    }
    return () => {
      ro?.disconnect();
      ro = null;
    };
  });
</script>
<svelte:window on:resize={recalc} />
<div bind:this={container} class="vl-container" on:scroll={onScroll}>
  <div class="vl-spacer" style={`height:${total}px;`}></div>
  <div class="vl-viewport" style={`transform: translateY(${offsetTop}px); width:100%;`}>
    <slot name="row" {visible} {start}></slot>
  </div>
</div>

<style>
  .vl-container { position: relative; width: 100%; height: 100%; overflow: auto; }
  .vl-spacer { width: 1px; opacity: 0; }
  .vl-viewport { position: absolute; left: 0; top: 0; }
</style>
