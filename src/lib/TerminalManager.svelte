<script lang="ts">
  import { onMount } from 'svelte';
  import Terminal from './Terminal.svelte';
  import { terminalCommands } from './terminalBus';
  import {
    terminalSessions,
    activeTerminalId,
    addTerminal,
    ensureBaseTerminal,
    ensureSearchTerminal
  } from './terminal/terminalSessions';

  onMount(() => {
    ensureBaseTerminal();
    const unsubscribe = terminalCommands.subscribe((cmd) => {
      if (!cmd) return;
      if (cmd.type === 'add') addTerminal();
      if (cmd.type === 'ensureBase') ensureBaseTerminal();
      if (cmd.type === 'ensureSearch') ensureSearchTerminal();
    });
    return () => unsubscribe();
  });
</script>

<div class="terminal-manager">
  <div class="terminal-stack">
    {#each $terminalSessions as session (session.id)}
      <div
        class="terminal-pane"
        class:active={session.id === $activeTerminalId}
        role="tabpanel"
        aria-hidden={session.id !== $activeTerminalId}
      >
        <Terminal instanceId={session.id} hidden={session.id !== $activeTerminalId} mode="pty" />
      </div>
    {/each}
  </div>
</div>

<style>
  .terminal-manager {
    height: 100%;
    display: flex;
    flex-direction: column;
    background: var(--terminal-background, var(--window-panelColor, #020817));
  }

  .terminal-stack {
    flex: 1;
    position: relative;
    overflow: hidden;
  }

  .terminal-pane {
    position: absolute;
    inset: 0;
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.12s ease;
  }

  .terminal-pane.active {
    opacity: 1;
    pointer-events: auto;
  }

  .terminal-pane :global(.terminal-wrapper) {
    position: absolute;
    inset: 0;
  }
</style>
