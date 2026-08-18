import { writable, get } from 'svelte/store';

// Global slot for the dedicated search terminal instance id
export const searchTerminalId = writable<string | null>(null);

export function getSearchTerminalId(): string | null { return get(searchTerminalId); }
export function setSearchTerminalId(id: string) { searchTerminalId.set(id); }
export function clearSearchTerminalId() { searchTerminalId.set(null); }

