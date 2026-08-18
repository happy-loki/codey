import { get, writable } from "svelte/store";
import { workingDir } from "../File";
import { disposeById, setActiveInstance } from "../terminalRegistry";
import { searchTerminalId, setSearchTerminalId, clearSearchTerminalId } from "../terminalRoles";

export type TerminalSession = { id: string; title: string; role?: "search" };

const sessions = writable<TerminalSession[]>([]);
const activeId = writable<string | null>(null);

const newId = () => {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
  } catch {}
  return `term_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
};

const baseName = (p: string | null | undefined) => {
  if (!p) return "";
  const parts = String(p).split(/[\\/]/);
  return parts[parts.length - 1] || String(p);
};

export const terminalSessions = sessions;
export const activeTerminalId = activeId;

function setActive(id: string | null) {
  activeId.set(id);
  if (id) {
    try { setActiveInstance(id); } catch {}
  }
}

export function addTerminal(): string {
  const id = newId();
  const title = baseName(get(workingDir)) || "terminal";
  sessions.update((list) => [...list, { id, title }]);
  setActive(id);
  return id;
}

export function addSearchTerminal(): string {
  const currentSearch = get(searchTerminalId);
  const list = get(sessions);
  if (currentSearch) {
    const existing = list.find((item) => item.id === currentSearch);
    if (existing) {
      setActive(existing.id);
      return existing.id;
    }
  }
  const existingByRole = list.find((item) => item.role === "search");
  if (existingByRole) {
    setSearchTerminalId(existingByRole.id);
    setActive(existingByRole.id);
    return existingByRole.id;
  }
  const id = newId();
  sessions.update((list) => [...list, { id, title: "search", role: "search" }]);
  setSearchTerminalId(id);
  setActive(id);
  return id;
}

export function activateTerminal(id: string) {
  const list = get(sessions);
  if (!list.find((item) => item.id === id)) return;
  setActive(id);
}

export function closeTerminalSession(id: string) {
  try { disposeById(id); } catch {}
  const list = get(sessions);
  const filtered = list.filter((item) => item.id !== id);
  sessions.set(filtered);
  if (id === get(searchTerminalId)) {
    clearSearchTerminalId();
  }
  const currentActive = get(activeId);
  if (currentActive === id) {
    const next = filtered.length ? filtered[filtered.length - 1].id : null;
    setActive(next);
  }
}

export function ensureBaseTerminal() {
  const list = get(sessions);
  if (list.length === 0) {
    addTerminal();
  }
}

export function ensureSearchTerminal() {
  addSearchTerminal();
}

export function updateSessionTitle(id: string, title: string) {
  sessions.update((items) => items.map((item) => (item.id === id ? { ...item, title } : item)));
}

export function resetSessions() {
  const list = get(sessions);
  list.forEach((item) => {
    try { disposeById(item.id); } catch {}
  });
  sessions.set([]);
  setActive(null);
  clearSearchTerminalId();
}
