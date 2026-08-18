<script lang="ts">
  import { Plus, X, SquareTerminal as Terminal } from 'lucide-svelte';
  import {
    terminalSessions,
    activeTerminalId,
    addTerminal,
    activateTerminal,
    closeTerminalSession
  } from './terminalSessions';

  function handleActivate(id: string) {
    activateTerminal(id);
  }

  function handleClose(id: string) {
    closeTerminalSession(id);
  }

  function handleAdd() {
    addTerminal();
  }
</script>

<div class="terminal-tabs" role="tablist" aria-label="Terminal sessions">
  <div class="tab-scroll">
    {#each $terminalSessions as session (session.id)}
      <div class="tab" class:active={session.id === $activeTerminalId} role="presentation">
        <button
          class="tab-trigger"
          type="button"
          role="tab"
          aria-selected={session.id === $activeTerminalId}
          on:click={() => handleActivate(session.id)}
        >
          <Terminal size={14} />
          <span class="tab-title">{session.title}</span>
        </button>
        <button
          class="tab-close"
          type="button"
          title="Close terminal"
          aria-label="Close terminal"
          on:click|stopPropagation={() => handleClose(session.id)}
        >
          <X size={14} />
        </button>
      </div>
    {/each}
  </div>
  <div class="tab-actions">
    <button class="tab-action" type="button" title="New terminal" on:click={handleAdd}>
      <Plus size={16} />
    </button>
  </div>
</div>

<style>
  .terminal-tabs {
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 2px 4px;
    flex: 1;
    background: var(--terminal-tabbar-background, hsl(var(--background)));
    border-radius: 6px;
    border: 1px solid hsl(var(--border));
  }

  .tab-scroll {
    display: flex;
    align-items: stretch;
    gap: 1px;
    overflow-x: auto;
    flex: 1;
  }

  .tab {
    display: inline-flex;
    align-items: center;
    background: transparent;
    border-radius: 4px;
    border: 1px solid transparent;
    color: hsl(var(--muted-foreground));
    transition: all 0.15s ease;
    min-height: 28px;
  }

  .tab:hover {
    background: hsl(var(--accent));
    color: hsl(var(--accent-foreground));
  }

  .tab.active {
    background: hsl(var(--primary) / 0.1);
    border-color: hsl(var(--primary) / 0.2);
    color: hsl(var(--foreground));
  }

  .tab-trigger {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px 8px;
    background: transparent;
    color: inherit;
    border: none;
    font-size: 0.8rem;
    cursor: pointer;
    font-weight: 400;
  }

  .tab.active .tab-trigger {
    font-weight: 500;
  }

  .tab-trigger:focus-visible {
    outline: 2px solid hsl(var(--ring));
    outline-offset: 2px;
  }

  .tab-title {
    max-width: 120px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .tab-close {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 2px;
    margin-right: 2px;
    background: transparent;
    border: none;
    color: inherit;
    cursor: pointer;
    border-radius: 3px;
    opacity: 0;
    visibility: hidden;
    transition: all 0.15s ease;
  }

  .tab:hover .tab-close {
    opacity: 1;
    visibility: visible;
  }

  .tab-close:hover {
    background: hsl(var(--destructive) / 0.1);
    color: hsl(var(--destructive));
    opacity: 1;
  }

  .tab-actions {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    flex-shrink: 0;
    margin-left: 4px;
  }

  .tab-action {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    border-radius: 4px;
    background: transparent;
    border: 1px solid transparent;
    color: hsl(var(--muted-foreground));
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .tab-action:hover {
    background: hsl(var(--accent));
    color: hsl(var(--accent-foreground));
  }
</style>
