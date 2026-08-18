import { writable } from 'svelte/store';

export type TerminalCommand =
  | { type: 'add' }
  | { type: 'ensureBase' }
  | { type: 'ensureSearch' }
  | null;

export const terminalCommands = writable<TerminalCommand>(null);

export function requestAddTerminal() {
  terminalCommands.set({ type: 'add' });
  setTimeout(() => terminalCommands.set(null), 0);
}

export function requestEnsureBaseTerminal() {
  terminalCommands.set({ type: 'ensureBase' });
  setTimeout(() => terminalCommands.set(null), 0);
}

export function requestEnsureSearchTerminal() {
  terminalCommands.set({ type: 'ensureSearch' });
  setTimeout(() => terminalCommands.set(null), 0);
}

