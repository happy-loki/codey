export interface TerminalInstanceApi {
  id: string;
  fit: () => void;
  applyOptions: (opts: any) => void;
  clear: () => void;
  dispose: () => void;
  write?: (data: string) => void;
  updateTheme?: () => void;
}

const instances = new Map<string, TerminalInstanceApi>();
let activeId: string | null = null;

export function registerInstance(api: TerminalInstanceApi) {
  instances.set(api.id, api);
}

export function unregisterInstance(id: string) {
  instances.delete(id);
  if (activeId === id) activeId = instances.size ? Array.from(instances.keys())[0] : null;
}

export function setActiveInstance(id: string) {
  if (instances.has(id)) activeId = id;
}

export function getActiveInstance(): TerminalInstanceApi | null {
  return (activeId && instances.get(activeId)) || null;
}

export function forEachInstance(fn: (api: TerminalInstanceApi) => void) {
  instances.forEach((api) => {
    try { fn(api); } catch { /* ignore */ }
  });
}

export function fitAll() { forEachInstance((i) => i.fit()); }

export function applyOptionsAll(opts: any) { forEachInstance((i) => i.applyOptions(opts)); }

export function updateThemeAll() { forEachInstance((i) => { try { i.updateTheme?.(); } catch {} }); }

export function clearActiveOrAll() {
  const active = getActiveInstance();
  if (active) { try { active.clear(); } catch {} return; }
  forEachInstance((i) => i.clear());
}

export function closeAll() { forEachInstance((i) => i.dispose()); }

// Per-id helpers for manager UIs
export function getInstance(id: string): TerminalInstanceApi | undefined {
  return instances.get(id);
}
export function clearById(id: string) {
  const i = instances.get(id); if (i) try { i.clear(); } catch {}
}
export function disposeById(id: string) {
  const i = instances.get(id); if (i) try { i.dispose(); } catch {}
  unregisterInstance(id);
}
export function fitById(id: string) {
  const i = instances.get(id); if (i) try { i.fit(); } catch {}
}

// Write helpers
export function writeActive(data: string) {
  const i = getActiveInstance();
  if (i && typeof i.write === 'function') {
    try { i.write!(data); return true; } catch {}
  }
  return false;
}
