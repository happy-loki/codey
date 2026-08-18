<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import DiffEditors from "../widgets/DiffEditors.svelte";
  import { sessions, activeId, justOpenedId } from "./diffStore";
  import type { Writable } from "svelte/store";
  export let sessionId: string;
  export let hidden: boolean = false;
  // Allow passing concrete store instances from creator to avoid duplicate-module issues
  export let sessionsStore: Writable<Record<string, any>> = sessions;
  export let activeIdStore: Writable<string | null> = activeId;
  export let justOpenedIdStore: Writable<string | null> = justOpenedId;
  export let initialSession: any = null;
  // Be resilient if props arrive before store or vice versa
  let sessionsValue: Record<string, any> = {};
  let unsubSessions: (() => void) | null = null;
  onMount(() => {
    unsubSessions = sessionsStore.subscribe((v) => {
      sessionsValue = v || {};
      s = (effectiveId ? sessionsValue[effectiveId] : null) || initialSession;
    });
  });
  onDestroy(() => { unsubSessions?.(); unsubSessions = null; });
  $: effectiveId = sessionId || $justOpenedIdStore || $activeIdStore;
  $: s = (effectiveId ? sessionsValue[effectiveId] : null) || initialSession;
  $: console.log('[DiffTab] render', { sessionId, effectiveId, keys: Object.keys($sessionsStore || {}), has: !!(effectiveId && $sessionsStore && $sessionsStore[effectiveId]) });
  $: if (!hidden && effectiveId) activeIdStore.set(effectiveId);
  onDestroy(() => {
    // no-op; Tab.ts will destroy this component when its tab closes
  });
</script>

{#if s}
  <div class="diff-tab" hidden={hidden}>
    <div class="body">
      <DiffEditors
        original={s.original}
        content={s.content}
        scrollToLine={s.lastChangeLine}
        scrollRequestId={s.scrollRequestId}
        path={s.path}
      />
    </div>
  </div>
{:else}
  <div class="diff-tab empty" hidden={hidden}>Diff session not found.</div>
{/if}

<style>
  .diff-tab { height: 100%; width: 100%; display: flex; flex-direction: column; position: relative; min-height: 0; }
  /* Remove internal title bar to align with regular editors */
  .body { flex: 1 1 auto; min-height: 0; overflow: hidden; width: 100%; }
  .empty { display: flex; align-items: center; justify-content: center; color: #888; }
  :global(.diff-tab .merge) { height: 100%; width: 100%; }
</style>
