<script lang="ts">
  import "@xterm/xterm/css/xterm.css";
  import { onMount, onDestroy, tick } from "svelte";
  import { Terminal } from "@xterm/xterm";
  import { FitAddon } from "@xterm/addon-fit";
  import { SearchAddon } from "@xterm/addon-search";
  import { Unicode11Addon } from "@xterm/addon-unicode11";
  import { WebLinksAddon } from "@xterm/addon-web-links";
  import { spawn, type IPty } from "tauri-pty";
  import { resourceDir, join } from "@tauri-apps/api/path";
  import { invoke } from "@tauri-apps/api/core";
  import { is_dark_theme } from "../config/themehandler";
  import { updateTerminalTheme } from "./terminal/updateTheme";
  import { SYSTEM_MONO_FONT_STACK } from "../config/fontStacks";
  import TerminalSearch from "./TerminalSearch.svelte";
  import { registerInstance, unregisterInstance, setActiveInstance } from "./terminalRegistry";
  import { termOptions as globalTermOptions } from './terminalOptions';
  import { openFileAtLine } from "./EditorTabList.svelte";
  import { workingDir } from "./File";
  import { openContextMenu, type MenuItem } from "./utility/contextMenuService";

  let terminalElement: HTMLElement;
  export let hidden = false;
  export let mode: "pty" | "log" = "pty";
  export let instanceId: string | null = null;
  let isInitialized = false;

  // Per-instance state
  const myId = instanceId || (crypto?.randomUUID?.() || `term_${Date.now()}_${Math.floor(Math.random() * 1e6)}`);
  let terminalController: Terminal = null;
  let termFit: FitAddon = null;
  let pty: IPty = null;
  let pendingWrites: string[] = [];
  let lastProfileSignature: string | null = null;
  let pendingPtyLaunch: Promise<void> | null = null;
  let pendingRestart: Promise<void> | null = null;
  let currentResizeObserver: ResizeObserver = null;
  let searchAddon: SearchAddon | null = null;
  let unicodeAddon: Unicode11Addon | null = null;
  let webLinksAddon: WebLinksAddon | null = null;
  let rgLinksDisposable: { dispose: () => void } | null = null;
  let isTerminalOpened = false;
  let isTerminalReady = false;
  let unsubTheme: null | (() => void) = null;
  // Track user-typed input to infer `cd` commands and maintain runtimeCwd without active probes
  let inputLineBuf = "";
  let runtimeCwd: string | null = null;
  let __cwdPrevLine = "";

  // Search UI state
  let searchValue: string = "";
  let showSearch = false;
  let searchRef: any = null;
  let isPointerOver = false;
  let searchCase = false;
  let searchWhole = false;
  let searchRegex = false;
  let resultIndex = -1;
  let resultCount = 0;
  let resultOverflow = false;


  // Themes (kept local for instance use)
  const DEFAULT_TERM_ENV: Record<string, string> = {
    TERM: "xterm-256color",
    COLORTERM: "truecolor",
    TERM_PROGRAM: "codey",
  };
  const darkTheme = {
    background: "#020817",
    foreground: "#f4f4f5",
    cursor: "#f4f4f5",
    cursorAccent: "#f4f4f5",
    selectionBackground: "rgba(96, 165, 250, 0.2)",
    black: "#f4f4f5",
    red: "#f87171",
    green: "#4ade80",
    yellow: "#facc15",
    blue: "#60a5fa",
    magenta: "#c084fc",
    cyan: "#22d3ee",
    white: "#020817",
    brightBlack: "#e4e4e7",
    brightRed: "#fca5a5",
    brightGreen: "#86efac",
    brightYellow: "#fde047",
    brightBlue: "#93c5fd",
    brightMagenta: "#d8b4fe",
    brightCyan: "#67e8f9",
    brightWhite: "#71717a",
  } as const;
  const lightTheme = {
    background: "#ffffff",
    foreground: "#020817",
    cursor: "#020817",
    cursorAccent: "#020817",
    selectionBackground: "rgba(59, 130, 246, 0.1)",
    black: "#020817",
    red: "#ef4444",
    green: "#22c55e",
    yellow: "#eab308",
    blue: "#3b82f6",
    magenta: "#a855f7",
    cyan: "#06b6d4",
    white: "#e2e8f0",
    brightBlack: "#64748b",
    brightRed: "#f87171",
    brightGreen: "#4ade80",
    brightYellow: "#facc15",
    brightBlue: "#60a5fa",
    brightMagenta: "#c084fc",
    brightCyan: "#22d3ee",
    brightWhite: "#f1f5f9",
  } as const;

  function applyTheme(_dark: boolean) {
    if (!terminalController) return;
    try { updateTerminalTheme(terminalController); } catch {}
  }

  function isSystemDark() {
    if (typeof window === "undefined" || !window.matchMedia) return false;
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  }

  // Debounced fit per instance
  function debounce<T extends any[]>(fn: (...args: T) => void, delay = 80) {
    let t: any;
    return (...args: T) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), delay);
    };
  }
  const debouncedFit = debounce(() => fitSelf());

  // Instance helpers exposed to registry
  function fitSelf() {
    if (!terminalController || !termFit) return;
    try {
      const container = terminalController.element as HTMLElement | null;
      if (!container || container.offsetParent === null) return;
      termFit.fit();
      if (pty) pty.resize(terminalController.cols, terminalController.rows);
    } catch (e) {
      console.warn("Failed to fit terminal:", e);
    }
  }
  function applyOptionsSelf(opts: any) {
    if (!terminalController || !opts) return;
    try {
      if (opts.fontFamily) terminalController.options.fontFamily = String(opts.fontFamily);
      if (opts.fontSize) terminalController.options.fontSize = Number(opts.fontSize);
      if (opts.lineHeight) terminalController.options.lineHeight = Number(opts.lineHeight);
      if (opts.cursorStyle) terminalController.options.cursorStyle = opts.cursorStyle;
      const signature = buildProfileSignature(opts);
      if (signature !== lastProfileSignature) {
        lastProfileSignature = signature;
        if (mode === "pty" && (pty || isTerminalOpened)) {
          restartShell().catch(() => {});
        }
      }
      debouncedFit();
    } catch {}
  }
  function clearSelf() {
    // Lean clear: rely on xterm to clear viewport + scrollback only
    try { terminalController?.clear?.(); } catch {}
  }
  function disposeSelf() {
    stopPty();
    try { currentResizeObserver?.disconnect?.(); } catch {}
    currentResizeObserver = null;
    try { unicodeAddon?.dispose?.(); } catch {}
    try { webLinksAddon?.dispose?.(); } catch {}
    try { searchAddon?.dispose?.(); } catch {}
    try { terminalController?.dispose?.(); } catch {}
    terminalController = null;
    isTerminalOpened = false;
    isTerminalReady = false;
  }

  // Public instance action used in template
  export function focusTerminal() {
    try { terminalController?.focus?.(); } catch {}
  }

  async function copySelection() {
    try {
      const sel = terminalController?.getSelection?.() || "";
      if (!sel) return;
      const { isTauriRuntime, writeTextToClipboardTauriOnly } = await import("./utility/tauriClipboard");
      if (isTauriRuntime()) {
        await writeTextToClipboardTauriOnly(sel);
      } else if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(sel);
      }
    } catch {}
  }
  async function pasteFromClipboard() {
    let text = "";
    try {
      const { isTauriRuntime, readTextFromClipboardTauriOnly } = await import("./utility/tauriClipboard");
      if (isTauriRuntime()) {
        text = await readTextFromClipboardTauriOnly();
      } else if (navigator?.clipboard?.readText) {
        text = await navigator.clipboard.readText();
      }
    } catch {}
    try { if (text) terminalController?.paste?.(text); } catch {}
  }
  function selectAll() { try { terminalController?.selectAll?.(); } catch {}; }
  function clearLocal() { clearSelf(); }

  const buildProfileSignature = (opts: any): string => {
    if (!opts || typeof opts !== "object") return "";
    const normalizeArgs = (value: any): string[] => (Array.isArray(value) ? value.map((item) => `${item}`) : []);
    const profile = opts.profile && typeof opts.profile === "object" && !Array.isArray(opts.profile) ? opts.profile : {};
    const name = typeof profile.name === "string" ? profile.name.trim().toLowerCase() : "";
    const program = typeof profile.program === "string" ? profile.program.trim() : "";
    const args = normalizeArgs(profile.args);
    const fallbackProgram = typeof opts.program === "string" ? opts.program.trim() : "";
    const fallbackArgs = normalizeArgs(opts.args);
    return JSON.stringify({ name, program, args, fallbackProgram, fallbackArgs });
  };

  function stopPty() {
    try { pty?.kill?.(); } catch {}
    pty = null;
  }

  function resetShellState() {
    runtimeCwd = null;
    __cwdPrevLine = "";
    inputLineBuf = "";
  }

  function toWindowsDrivePath(input: string): string {
    try {
      const s = String(input || "");
      const m = s.match(/^\/?([a-zA-Z])\/(.*)$/);
      if (m) {
        const drive = m[1].toUpperCase();
        const rest = m[2].replaceAll('/', '\\');
        return `${drive}:\\${rest}`;
      }
      if (/^[A-Za-z]:\//.test(s)) return s.replaceAll('/', '\\');
      return s;
    } catch { return input as any; }
  }

  function ingestCwdProbe(chunk: string) {
    try {
      const str = String(chunk);
      const parts = str.split(/\r?\n/);
      if (parts.length === 1) {
        const cur = (__cwdPrevLine + parts[0]).trim();
        if (cur.startsWith("__NUC_CWD_WIN__")) {
          runtimeCwd = cur.replace(/^__NUC_CWD_WIN__\s+/, "").trim();
        }
        if (__cwdPrevLine.trim() === "__NUC_CWD__" && cur) {
          runtimeCwd = toWindowsDrivePath(cur);
        }
        __cwdPrevLine = parts[0];
        return;
      }
      parts[0] = __cwdPrevLine + parts[0];
      for (const raw of parts) {
        const line = String(raw || "").trim();
        if (!line) continue;
        if (line.startsWith("__NUC_CWD_WIN__")) {
          runtimeCwd = line.replace(/^__NUC_CWD_WIN__\s+/, "").trim();
          continue;
        }
        if (line.startsWith("__NUC_CWD__ ")) {
          runtimeCwd = toWindowsDrivePath(line.replace(/^__NUC_CWD__\s+/, "").trim());
          __cwdPrevLine = line;
          continue;
        }
        const mSh = line.match(/^([A-Za-z]:[\\\/].*?)\s?\$\s*$/);
        const mCmd = line.match(/^([A-Za-z]:[\\\/].*?)>\s*$/);
        if (mSh && mSh[1]) { runtimeCwd = toWindowsDrivePath(mSh[1]); __cwdPrevLine = line; continue; }
        if (mCmd && mCmd[1]) { runtimeCwd = toWindowsDrivePath(mCmd[1]); __cwdPrevLine = line; continue; }
        if (line === "__NUC_CWD__") { __cwdPrevLine = line; continue; }
        if (__cwdPrevLine.trim() === "__NUC_CWD__") {
          runtimeCwd = toWindowsDrivePath(line);
        }
        __cwdPrevLine = line;
      }
    } catch {}
  }

  async function ingestTypedInputForCd(src: string) {
    try {
      if (!src) return;
      inputLineBuf += src;
      const hasNl = /\r|\n/.test(inputLineBuf);
      if (!hasNl) return;
      const lines = inputLineBuf.split(/\r?\n/);
      inputLineBuf = lines.pop() || "";
      for (const raw of lines) {
        const line = String(raw || "").trim();
        if (!line) continue;
        const m = /(?:^|[;&|]{1,2}\s*)cd(?:\s+\/d)?\s+([^;&|]+)\s*$/i.exec(line);
        if (!m) continue;
        let arg = m[1].trim();
        if (!arg || arg === '-' || arg === '"-"' || arg === "'-'") continue;
        arg = arg.replace(/^['"]|['"]$/g, "");
        let target = toWindowsDrivePath(arg);
        const isAbsWin = /^[A-Za-z]:[\\\/]/.test(target);
        const isAbsNix = target.startsWith('/');
        if (!isAbsWin && !isAbsNix) {
          const base = (runtimeCwd && runtimeCwd !== '') ? runtimeCwd : ($workingDir as any);
          try { target = await join(base, target); } catch {}
        }
        try {
          const ok = await invoke('is_folder', { path: target }).catch(() => false) as boolean;
          if (ok) { runtimeCwd = target as any; }
        } catch {}
      }
    } catch {}
  }

  async function launchPty() {
    if (mode !== "pty") return;
    if (!terminalController) return;
    if (pendingPtyLaunch) {
      try { await pendingPtyLaunch; } catch {}
    }
    const task = (async () => {
      const isTauri = typeof window !== "undefined" && !!(window as any).__TAURI_INTERNALS__;
      if (!isTauri) {
        if (!pty) {
          terminalController.writeln("\r\n[terminal] Running in browser dev server.");
          terminalController.writeln("[terminal] Launch the Tauri window to enable shell.");
          terminalController.writeln(" - Use: yarn start-window");
        }
        return;
      }

      const platform = detectPlatform();
      // Prefer the current workspace root (reactive store) over persisted lastDir.
      // This avoids launching a shell in a stale directory after switching workspaces.
      let dir = (($workingDir as any) || localStorage.getItem("lastDir") || undefined) as any;
      try {
        const resolved = await resolveShellCommand(platform);
        const cmd = resolved?.cmd ?? "";
        const args = Array.isArray(resolved?.args) ? resolved.args : [];
        if (!cmd) {
          throw new Error("No shell command resolved from settings");
        }
        // Validate cwd early; fall back to persisted lastDir or no cwd if needed.
        try {
          if (dir) {
            dir = toWindowsDrivePath(String(dir));
            const ok = await invoke("is_folder", { path: dir }).catch(() => false) as boolean;
            if (!ok) {
              const fallback = localStorage.getItem("lastDir") || undefined;
              if (fallback) {
                const fb = toWindowsDrivePath(String(fallback));
                const fbOk = await invoke("is_folder", { path: fb }).catch(() => false) as boolean;
                dir = fbOk ? (fb as any) : undefined;
              } else {
                dir = undefined;
              }
            }
          }
        } catch {}
        const cols = Math.max(terminalController?.cols || 80, 20);
        const rows = Math.max(terminalController?.rows || 24, 10);
        const termOptions = snapshotTermOptions();
        const env = buildSpawnEnv(termOptions);
        const nextPty = spawn(cmd, args, { cols, rows, cwd: dir as any, env });
        pty = nextPty;
        resetShellState();
        nextPty.onData((d) => { try { ingestCwdProbe(d as any); } catch {}; terminalController.write(d); });
        if (pendingWrites.length) {
          for (const w of pendingWrites) { try { nextPty.write(w); } catch {} }
          pendingWrites = [];
        }
      } catch (err) {
        stopPty();
        const msg = (err && (err as any).message) ? (err as any).message : String(err);
        terminalController.writeln("\r\n[terminal] Failed to start shell.");
        terminalController.writeln(`[terminal] ${msg}`);
        terminalController.writeln("[terminal] Try relaunching the Tauri window (yarn start-window).\r\n");
      }
    })();
    pendingPtyLaunch = task;
    try {
      await task;
    } finally {
      pendingPtyLaunch = null;
    }
  }

  async function restartShell() {
    if (mode !== "pty" || !isTerminalOpened) return;
    if (pendingRestart) {
      try { await pendingRestart; } catch {}
      return;
    }
    const job = (async () => {
      stopPty();
      resetShellState();
      await launchPty();
    })();
    pendingRestart = job;
    try {
      await job;
    } finally {
      pendingRestart = null;
    }
  }

  // Search helpers (instance-scoped)
  function findNext(v: string) {
    if (!searchAddon || !v?.trim()) return;
    const dark = $is_dark_theme ?? isSystemDark();
    try {
      searchAddon.findNext(v.trim(), {
        caseSensitive: searchCase,
        wholeWord: searchWhole,
        regex: searchRegex,
        decorations: dark
          ? {
              matchBackground: "rgba(96,165,250,0.22)",
              matchBorder: "rgba(96,165,250,0.70)",
              matchOverviewRuler: "#60a5fa",
              activeMatchBackground: "rgba(245,158,11,0.62)",
              activeMatchBorder: "#f59e0b",
              activeMatchColorOverviewRuler: "#f59e0b",
            }
          : {
              matchBackground: "rgba(59,130,246,0.14)",
              matchBorder: "rgba(59,130,246,0.65)",
              matchOverviewRuler: "#3b82f6",
              activeMatchBackground: "rgba(245,158,11,0.62)",
              activeMatchBorder: "#f59e0b",
              activeMatchColorOverviewRuler: "#f59e0b",
            },
      });
    } catch {}
  }
  function findPrevious(v: string) {
    if (!searchAddon || !v?.trim()) return;
    const dark = $is_dark_theme ?? isSystemDark();
    try {
      searchAddon.findPrevious(v.trim(), {
        caseSensitive: searchCase,
        wholeWord: searchWhole,
        regex: searchRegex,
        decorations: dark
          ? {
              matchBackground: "rgba(96,165,250,0.22)",
              matchBorder: "rgba(96,165,250,0.70)",
              matchOverviewRuler: "#60a5fa",
              activeMatchBackground: "rgba(245,158,11,0.62)",
              activeMatchBorder: "#f59e0b",
              activeMatchColorOverviewRuler: "#f59e0b",
            }
          : {
              matchBackground: "rgba(59,130,246,0.14)",
              matchBorder: "rgba(59,130,246,0.65)",
              matchOverviewRuler: "#3b82f6",
              activeMatchBackground: "rgba(245,158,11,0.62)",
              activeMatchBorder: "#f59e0b",
              activeMatchColorOverviewRuler: "#f59e0b",
            },
      });
    } catch {}
  }
  function clearSearch() { try { searchAddon?.clearDecorations?.(); } catch {} }
  function searchIncremental(v: string) {
    if (!searchAddon || !v?.trim()) return;
    const dark = $is_dark_theme ?? isSystemDark();
    try {
      searchAddon.findNext(v.trim(), {
        caseSensitive: searchCase,
        wholeWord: searchWhole,
        regex: searchRegex,
        incremental: true,
        decorations: dark
          ? {
              matchBackground: "rgba(96,165,250,0.22)",
              matchBorder: "rgba(96,165,250,0.70)",
              matchOverviewRuler: "#60a5fa",
              activeMatchBackground: "rgba(245,158,11,0.62)",
              activeMatchBorder: "#f59e0b",
              activeMatchColorOverviewRuler: "#f59e0b",
            }
          : {
              matchBackground: "rgba(59,130,246,0.14)",
              matchBorder: "rgba(59,130,246,0.65)",
              matchOverviewRuler: "#3b82f6",
              activeMatchBackground: "rgba(245,158,11,0.62)",
              activeMatchBorder: "#f59e0b",
              activeMatchColorOverviewRuler: "#f59e0b",
            },
      });
    } catch {}
  }
  function updateSearchOptions(opts: { caseSensitive?: boolean; wholeWord?: boolean; regex?: boolean }) {
    if (typeof opts.caseSensitive === "boolean") searchCase = opts.caseSensitive;
    if (typeof opts.wholeWord === "boolean") searchWhole = opts.wholeWord;
    if (typeof opts.regex === "boolean") searchRegex = opts.regex;
  }
  function clearActiveSearchDecoration() { try { searchAddon?.clearActiveDecoration?.(); } catch {} }

  // Reactive: when panel shows, fit and focus
  $: if (!hidden && isInitialized) {
    setTimeout(() => {
      try { debouncedFit(); } catch {}
      try { focusTerminal(); } catch {}
    }, 0);
  }

  onMount(async () => {
    await initShell(terminalElement, mode);
    isInitialized = true;
    // Track active
    try { setActiveInstance(myId); } catch {}
    // Theme sync
    try {
      applyTheme($is_dark_theme ?? isSystemDark());
      unsubTheme = is_dark_theme.subscribe((dark) => applyTheme(!!dark));
    } catch {}
    // Listen search results on this instance
    try {
      searchAddon?.onDidChangeResults?.(({ resultIndex: ri, resultCount: rc }) => {
        resultIndex = ri ?? -1;
        resultCount = rc ?? 0;
        resultOverflow = resultIndex === -1 && resultCount > 0;
      });
    } catch {}

    // Window resize fallback
    const onWinResize = () => { try { debouncedFit(); } catch {} };
    window.addEventListener("resize", onWinResize);

    return () => {
      window.removeEventListener("resize", onWinResize);
    };
  });

  onDestroy(() => {
    try { unsubTheme?.(); } catch {}
    try { unregisterInstance(myId); } catch {}
    try { rgLinksDisposable?.dispose?.(); } catch {}
    disposeSelf();
  });

  function handleKeydown(e: KeyboardEvent) {
    const isMac = navigator.platform.toLowerCase().includes("mac");
    const isFind = (isMac ? e.metaKey : e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "f";
    const target = e.target as HTMLElement | null;
    const tag = (target?.tagName || "").toLowerCase();
    const isEditable = tag === "input" || tag === "textarea" || (target?.isContentEditable ?? false);
    if (isFind) {
      const within = !!(terminalElement && document.activeElement && terminalElement.contains(document.activeElement));
      const scopeOk = isPointerOver || within || showSearch;
      if (isEditable && !within) return;
      if (!scopeOk) return;
      e.preventDefault();
      showSearch = !showSearch;
      if (showSearch) setTimeout(() => { try { searchRef?.focus?.(); } catch {} }, 0);
      else { searchValue = ""; clearSearch(); }
      return;
    }

    // Copy/Paste within scope
    const within = !!(terminalElement && document.activeElement && terminalElement.contains(document.activeElement));
    const scopeOk = isPointerOver || within || showSearch;
    const isCopy = (isMac ? e.metaKey : e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "c";
    const isPaste = ((isMac ? e.metaKey : e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "v") || (e.shiftKey && !e.ctrlKey && e.key === "Insert");
    if ((isCopy || isPaste) && scopeOk) {
      if (isEditable && !within) return;
      if (isCopy) {
        const textSel = (window.getSelection?.()?.toString?.() || "") + "";
        const termSel = (terminalController as any)?.getSelection?.()?.toString?.() ?? (terminalController as any)?.getSelection?.();
        const hasSel = !!(termSel || textSel);
        if (hasSel) { e.preventDefault(); copySelection(); }
      } else if (isPaste) { e.preventDefault(); pasteFromClipboard(); }
    }
  }

  function shouldHandleTerminalPaste(target: EventTarget | null): boolean {
    if (!terminalElement) return false;
    let element = (target as HTMLElement | null) ?? (document.activeElement as HTMLElement | null);
    if (!element) return false;
    if (searchRef && searchRef.contains(element)) {
      return false;
    }
    const withinTerminal = terminalElement.contains(element);
    const isHelperTextarea = element.tagName === "TEXTAREA" && element.classList.contains("xterm-helper-textarea");
    if (!withinTerminal && !isHelperTextarea) {
      return false;
    }
    if (!isHelperTextarea) {
      const tag = element.tagName;
      if (tag === "INPUT" || (tag === "TEXTAREA" && !isHelperTextarea) || element.isContentEditable) {
        return false;
      }
    }
    return true;
  }

  function handleWindowPaste(event: ClipboardEvent) {
    if (!shouldHandleTerminalPaste(event.target)) return;
    event.preventDefault();
    // xterm also handles paste on its helper textarea; stop propagation to avoid double paste.
    event.stopPropagation();
    (event as any).stopImmediatePropagation?.();
    void pasteFromClipboard();
  }

  function onToggleClose() {
    showSearch = false; searchValue = ""; clearSearch();
  }
  function onSearchNext(ev: CustomEvent<{ value: string }>) { searchValue = ev.detail?.value ?? ""; findNext(searchValue); }
  function onSearchPrev(ev: CustomEvent<{ value: string }>) { searchValue = ev.detail?.value ?? ""; findPrevious(searchValue); }
  function onSearchClear() { searchValue = ""; clearSearch(); }
  function onSearchChange(ev: CustomEvent<{ value: string }>) { searchValue = ev.detail?.value ?? ""; if (searchValue.trim()) searchIncremental(searchValue); else clearSearch(); }
  function onSearchOptions(ev: CustomEvent<{ caseSensitive: boolean; wholeWord: boolean; regex: boolean }>) {
    searchCase = !!ev.detail?.caseSensitive; searchWhole = !!ev.detail?.wholeWord; searchRegex = !!ev.detail?.regex;
    updateSearchOptions({ caseSensitive: searchCase, wholeWord: searchWhole, regex: searchRegex });
    if (searchValue.trim()) searchIncremental(searchValue);
  }
  function onSearchBlur() { clearActiveSearchDecoration(); }
  function handleContextMenu(e: MouseEvent) {
    e.preventDefault();
    const terminalSelection = (terminalController as any)?.getSelection?.()?.toString?.() ?? (terminalController as any)?.getSelection?.() ?? "";
    const domSelection = window.getSelection?.()?.toString?.() ?? "";
    const hasSelection = Boolean(terminalSelection || domSelection);
    const isMac = detectPlatform() === "macos";
    const shortcut = (key: string) => (isMac ? "Cmd+" + key : "Ctrl+" + key);
    const items: MenuItem[] = [
      { name: "复制", shortcut: shortcut("C"), disabled: !hasSelection, action: () => { void copySelection(); } },
      { name: "粘贴", shortcut: shortcut("V"), action: () => { void pasteFromClipboard(); } },
      { name: "全选", shortcut: shortcut("A"), action: () => { selectAll(); } },
      { type: "separator", id: "terminal-menu-sep" },
      { name: "清屏", action: () => { clearLocal(); } },
    ];
    openContextMenu(items, e.clientX, e.clientY);
  }

  // Helpers
  function detectPlatform(): string {
    const w: any = typeof window !== "undefined" ? (window as any) : {};
    const injected = w.__TAURI_OS_PLUGIN_INTERNALS__;
    if (injected && typeof injected.platform === "string") return injected.platform;
    const ua = (typeof navigator !== "undefined" ? navigator.userAgent : "").toLowerCase();
    if (ua.includes("windows")) return "windows";
    if (ua.includes("mac os") || ua.includes("macintosh")) return "macos";
    if (ua.includes("android")) return "android";
    if (/iphone|ipad|ipod/.test(ua)) return "ios";
    return "linux";
  }

  function snapshotTermOptions(): any {
    try {
      return $globalTermOptions ?? {};
    } catch {
      return {};
    }
  }

  function normalizeEnvMap(value: unknown): Record<string, string> {
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    const result: Record<string, string> = {};
    for (const [maybeKey, maybeVal] of Object.entries(value as Record<string, unknown>)) {
      const key = typeof maybeKey === "string" ? maybeKey.trim() : "";
      if (!key) continue;
      if (maybeVal === undefined || maybeVal === null) continue;
      result[key] = `${maybeVal}`;
    }
    return result;
  }

  function buildSpawnEnv(options: any): Record<string, string> {
    const envSources: Record<string, string>[] = [DEFAULT_TERM_ENV];
    if (options) {
      if (options.env) {
        envSources.push(normalizeEnvMap(options.env));
      }
      const profile = options.profile && typeof options.profile === "object" && !Array.isArray(options.profile)
        ? options.profile
        : null;
      if (profile && (profile as any).env) {
        envSources.push(normalizeEnvMap((profile as any).env));
      }
    }
    return envSources.reduce((acc, chunk) => Object.assign(acc, chunk), {} as Record<string, string>);
  }

  async function locateBusyboxExecutable(): Promise<string | null> {
    try {
      const resDir = await resourceDir();
      const preferred = await join(resDir, "resources", "shell", "busybox64u.exe");
      const hasPreferred = await invoke("is_file", { path: preferred }).catch(() => false);
      if (hasPreferred) {
        return preferred;
      }
      const fallback = await join(resDir, "shell", "busybox64u.exe");
      const hasFallback = await invoke("is_file", { path: fallback }).catch(() => false);
      if (hasFallback) {
        return fallback;
      }
    } catch {}
    return null;
  }

  async function resolveShellCommand(platform: string): Promise<{ cmd: string; args: string[] }> {
    const options = snapshotTermOptions();

    const parseArgList = (value: any): string[] => {
      if (Array.isArray(value)) {
        return value.map((item: any) => `${item}`);
      }
      if (typeof value === "string" && value.trim().length > 0) {
        return [value.trim()];
      }
      return [];
    };

    const profileValue = options?.profile;
    const profileObject = profileValue && typeof profileValue === "object" && !Array.isArray(profileValue) ? profileValue : {};
    const profileNameRaw = typeof profileObject?.name === "string"
      ? profileObject.name.trim()
      : typeof profileValue === "string"
        ? profileValue.trim()
        : "";
    const profileProgramRaw = typeof profileObject?.program === "string" ? profileObject.program.trim() : "";
    const profileArgs = parseArgList(profileObject?.args);
    const normalizedName = profileNameRaw.toLowerCase();

    const withArgs = (defaults: string[]): string[] => (profileArgs.length > 0 ? profileArgs : defaults);

    const resolveExplicitProgram = async (): Promise<{ cmd: string; args: string[] } | null> => {
      if (!profileProgramRaw) {
        return null;
      }
      if (platform === "windows") {
        const lowered = profileProgramRaw.toLowerCase();
        if (lowered === "busybox" || lowered === "busybox.exe") {
          const located = await locateBusyboxExecutable();
          if (located) {
            return { cmd: located, args: withArgs(["sh"]) };
          }
        }
      }
      return { cmd: profileProgramRaw, args: withArgs([]) };
    };

    const resolveNameAsProgram = async (): Promise<{ cmd: string; args: string[] } | null> => {
      if (!profileNameRaw) return null;
      if (platform === "windows") {
        if (["busybox", "busybox.exe"].includes(normalizedName)) {
          const located = await locateBusyboxExecutable();
          const cmd = located ?? profileNameRaw;
          return { cmd, args: withArgs(["sh"]) };
        }
        if (normalizedName === "cmd" || normalizedName === "cmd.exe") {
          return { cmd: "cmd.exe", args: profileArgs.length > 0 ? profileArgs : ["/K"] };
        }
        if (normalizedName === "powershell" || normalizedName === "powershell.exe") {
          return { cmd: "powershell.exe", args: profileArgs.length > 0 ? profileArgs : ["-NoExit", "-NoLogo"] };
        }
        if (normalizedName === "pwsh" || normalizedName === "pwsh.exe" || normalizedName === "powershell-core") {
          return { cmd: "pwsh.exe", args: profileArgs.length > 0 ? profileArgs : ["-NoExit"] };
        }
        if (normalizedName === "wsl" || normalizedName === "wsl.exe") {
          return { cmd: "wsl.exe", args: profileArgs };
        }
      }

      const unixProfiles: Record<string, { cmd: string; args: string[] }> = {
        bash: { cmd: "/bin/bash", args: ["--login", "-i"] },
        zsh: { cmd: "/bin/zsh", args: ["--login", "-i"] },
        fish: { cmd: "/usr/bin/fish", args: ["-i"] },
        sh: { cmd: "/bin/sh", args: ["-i"] },
      };

      if (unixProfiles[normalizedName]) {
        const candidate = unixProfiles[normalizedName];
        return { cmd: candidate.cmd, args: withArgs(candidate.args) };
      }

      if (platform === "windows" && /[\\/]/.test(profileNameRaw)) {
        return { cmd: profileNameRaw, args: withArgs([]) };
      }
      if (profileNameRaw.startsWith("/")) {
        return { cmd: profileNameRaw, args: withArgs([]) };
      }

      return null;
    };

    const explicitProgram = await resolveExplicitProgram();
    if (explicitProgram) {
      return explicitProgram;
    }

    const nameProgram = await resolveNameAsProgram();
    if (nameProgram) {
      return nameProgram;
    }

    if (platform === "windows") {
      const busybox = await locateBusyboxExecutable();
      return {
        cmd: busybox ?? "busybox",
        args: profileArgs.length > 0 ? profileArgs : ["sh"],
      };
    }

    if (platform === "macos") {
      return { cmd: "/bin/zsh", args: profileArgs.length > 0 ? profileArgs : ["--login", "-i"] };
    }

    if (platform === "linux") {
      return { cmd: "/bin/bash", args: profileArgs.length > 0 ? profileArgs : ["--login", "-i"] };
    }

    return { cmd: "/bin/sh", args: profileArgs.length > 0 ? profileArgs : ["-i"] };
  }

  async function initShell(el: HTMLElement, runMode: "pty" | "log") {
    // Create terminal controller
    terminalController = new Terminal({
      fontFamily: SYSTEM_MONO_FONT_STACK,
      fontSize: 14,
      scrollback: 5000,
      convertEol: true,
      cursorBlink: true,
      cursorStyle: "block",
      allowTransparency: false,
      allowProposedApi: true,
      disableStdin: runMode === "log",
    });

    // Addons
    termFit = new FitAddon();
    terminalController.loadAddon(termFit);
    searchAddon = new SearchAddon();
    terminalController.loadAddon(searchAddon);
    try { unicodeAddon = new Unicode11Addon(); terminalController.loadAddon(unicodeAddon); terminalController.unicode.activeVersion = "11"; } catch {}
    try {
      const handler = (ev: MouseEvent, uri: string) => {
        try { ev?.preventDefault?.(); ev?.stopPropagation?.(); } catch {};
        const isMac = navigator.platform.toLowerCase().includes("mac");
        const requireMod = isMac ? (ev.metaKey && !ev.ctrlKey) : (ev.ctrlKey && !ev.metaKey);
        if (!requireMod) return; // URL requires Ctrl/Cmd + click
        openExternalLink(uri);
      };
      webLinksAddon = new WebLinksAddon(handler);
      terminalController.loadAddon(webLinksAddon);
    } catch {}
    // Detect ripgrep style matches and expose as clickable file:line links
    try {
      rgLinksDisposable = terminalController.registerLinkProvider({
        provideLinks: (bufferLineNumber, callback) => {
          try {
            const buf = terminalController.buffer?.active;
            const lineObj = buf?.getLine(bufferLineNumber - 1);
            const text = lineObj?.translateToString(true) ?? "";
            if (!text) { callback(undefined); return; }

            const links: any[] = [];
            const y = bufferLineNumber;

            // Limit link range to the visible row only (avoid spanning wrapped rows)
            const cols = Math.max(1, terminalController?.cols || 1);
            const rowLen = Math.min(cols, (lineObj as any)?.getTrimmedLength?.() ?? cols);
            const mkFullRowRange = () => ({
              start: { x: 1, y },
              end: { x: Math.max(1, rowLen), y },
            });

            // Heuristic for determining whether a string looks like a file path
            const isLikelyPath = (s: string) => {
              const v = s.replace(/\x1b\[[0-9;]*m/g, "").trim().replace(/^['"]|['"]$/g, "");
              if (!v) return false;
              if (/^[A-Za-z]:[\\\/]/.test(v)) return true; // Windows drive
              if (v.startsWith("/")) return true; // Unix abs
              if (/[\\\/]/.test(v)) return true; // Contains path sep
              if (/\.[A-Za-z0-9_\-]+$/.test(v)) return true; // filename.ext
              return false;
            };
            const activate = async (_ev: MouseEvent, fullPath: string, line: number, col: number = 1) => {
              try {
                if (/^[a-z]+:\/\//i.test(fullPath)) return; // let WebLinks handle web urls
                // Sanitize: strip ANSI color codes and surrounding quotes
                let target = (fullPath || "")
                  .replace(/\x1b\[[0-9;]*m/g, "")
                  .trim()
                  .replace(/^['"]|['"]$/g, "");
                const isAbsWin = /^[A-Za-z]:[\\\/]?/.test(target);
                const isAbsNix = target.startsWith("/");
                if (!isAbsWin && !isAbsNix) {
                  // Try runtimeCwd first, then workspace root. Prefer the one that exists.
                  const tryBases: string[] = [];
                  const cwdBase = runtimeCwd && runtimeCwd !== '' ? runtimeCwd : null;
                  const wsBase = ($workingDir && ($workingDir as any) !== '') ? ($workingDir as any) : null;
                  if (cwdBase) tryBases.push(cwdBase);
                  if (wsBase) tryBases.push(wsBase);

                  let chosen: string | null = null;
                  let candCwd: string | null = null;
                  try {
                    if (cwdBase) { candCwd = await join(cwdBase, target); }
                  } catch {}
                  for (const b of tryBases) {
                    try {
                      const cand = b === cwdBase && candCwd ? candCwd : await join(b, target);
                      const ok = await invoke('is_file', { path: cand }).catch(() => false);
                      if (ok) { chosen = cand as any; break; }
                    } catch {}
                  }
                  if (!chosen) {
                    // If neither exists, still prefer resolving against the terminal's runtime CWD,
                    // because rg printed the path relative to the shell CWD, not the workspace root.
                    if (candCwd) chosen = candCwd;
                    else if (cwdBase) { try { chosen = await join(cwdBase, target); } catch { chosen = null; } }
                    if (!chosen && wsBase) { try { chosen = await join(wsBase, target); } catch { chosen = null; } }
                  }
                  if (chosen) target = chosen;
                }
                // no debug trace
                await openFileAtLine(target, Number(line) || 1, Number(col) || 1);
              } catch {}
            };

            // Decide the best candidate for this line; if found, make the WHOLE line clickable for file jump
            let candidate: { file: string; line: number; col: number } | null = null;
            // Inline pattern: path:line[:col]
            const inlineRe = /((?:[A-Za-z]:)?(?:[\\/][^:\r\n]+)+|[^:\s]+?\.[^\s:]+):(\d+)(?::(\d+))?/g;
            const m = inlineRe.exec(text);
            if (m && !m[0].includes("://")) {
              candidate = { file: m[1], line: parseInt(m[2] || '1', 10), col: parseInt(m[3] || '1', 10) };
            }

            // Heading block pattern: previous line is file path, current line starts with N[:C]:
            const headLine = text.match(/^(\d+)(?::(\d+))?:/);
            if (!candidate && headLine) {
              const ln = parseInt(headLine[1] || '1', 10);
              const col = parseInt(headLine[2] || '1', 10);
              let fileHeading: string | null = null;
              // Walk upwards skipping wrapped continuation rows and non-path lines.
              // Use a high cap so matches far from the file heading still resolve.
              for (let row = bufferLineNumber - 2, steps = 0; row >= 0 && steps < 10000; row--, steps++) {
                const prevObj: any = buf?.getLine(row);
                if (!prevObj) break;
                if (prevObj.isWrapped) continue; // skip visual continuations
                const prev = prevObj.translateToString(true) ?? '';
                const s = prev.replace(/\x1b\[[0-9;]*m/g, '').trim();
                if (!s) continue;
                if (/^(\d+)(?::(\d+))?:/.test(s)) continue; // numbered line
                if (!isLikelyPath(s)) continue; // avoid picking random content like 'z",'
                fileHeading = s.replace(/^['"]|['"]$/g, '');
                break;
              }
              if (fileHeading && !/^https?:\/\//i.test(fileHeading)) {
                candidate = { file: fileHeading, line: ln, col };
              }
            }

            if (candidate) {
              // Entire line clickable; single-click opens file. Ctrl/Cmd+click opens URL (if any)
              const urlMatch = /(https?:\/\/[^\s]+)/.exec(text);
              links.push({
                text,
                range: mkFullRowRange(),
                activate: (e: MouseEvent) => {
                  const isMac = navigator.platform.toLowerCase().includes("mac");
                  const wantUrl = isMac ? (e.metaKey && !e.ctrlKey) : (e.ctrlKey && !e.metaKey);
                  if (wantUrl && urlMatch) { openExternalLink(urlMatch[0]); return; }
                  activate(e, candidate!.file, candidate!.line, candidate!.col);
                },
                decorations: { underline: true }
              });
            }

            callback(links.length ? links : undefined);
          } catch { callback(undefined); }
        }
      });
    } catch { rgLinksDisposable = null; }
    // Force canvas renderer; WebGL addon is disabled to reduce persistent GPU usage
    try { terminalController.options.rendererType = "canvas"; } catch {}

    // Apply initial options from settings (font, size, etc.)
    try { applyOptionsSelf($globalTermOptions); } catch {}
    // Theme at start
    applyTheme($is_dark_theme ?? isSystemDark());

    // Open
    terminalController.open(el);
    isTerminalOpened = true;

    // Register in global registry for multi-instance control
  registerInstance({ id: myId, fit: fitSelf, applyOptions: applyOptionsSelf, clear: clearSelf, dispose: disposeSelf, updateTheme: () => { try { updateTerminalTheme(terminalController); } catch {} }, write: (data: string) => {
    try {
      const payload = data.endsWith("\r") || data.endsWith("\n") ? data : data + "\r";
      if (pty) { pty.write(payload); }
      else { pendingWrites.push(payload); }
    } catch {}
  } });

    // First fit and focus after open
    setTimeout(() => { isTerminalReady = true; fitSelf(); focusTerminal(); }, 150);

    // Observe size
    currentResizeObserver = new ResizeObserver(() => { debouncedFit(); });
    currentResizeObserver.observe(el);

    if (runMode === "pty") {
      terminalController.onData((d) => { try { ingestTypedInputForCd(d); } catch {}; pty?.write?.(d); });
      terminalController.onResize((s) => { try { pty?.resize?.(s.cols, s.rows); } catch {} });
      await launchPty();
    }
  }

  async function openExternalLink(url: string) {
    try {
      const u = new URL(url); const scheme = u.protocol.toLowerCase(); if (scheme !== "http:" && scheme !== "https:") return;
    } catch { return; }
    try {
      const isTauri = typeof window !== "undefined" && !!(window as any).__TAURI_INTERNALS__;
      if (isTauri) { const mod = await import("@tauri-apps/plugin-shell"); await mod.open(url); return; }
    } catch {}
    try { window.open(url, "_blank", "noopener,noreferrer"); } catch {}
  }
</script>

<script lang="ts" context="module">
  import { get } from "svelte/store";
  import { fitAll, applyOptionsAll, closeAll, clearActiveOrAll } from "./terminalRegistry";
  export { termOptions } from './terminalOptions';
  // Back-compat API for external callers
  export function fitTerminal() { try { fitAll(); } catch {} }
  export function updateTermOptions() { try { applyOptionsAll(get(termOptions)); } catch {} }
  export function closeTerminal() { try { closeAll(); } catch {} }
  export function clearTerminal() { try { clearActiveOrAll(); } catch {} }
</script>

<svelte:window on:keydown|capture={handleKeydown} on:paste|capture={handleWindowPaste} />
<div class="terminal-wrapper" on:mouseenter={() => { isPointerOver = true; setActiveInstance(myId); }} on:mouseleave={() => (isPointerOver = false)}>
  {#if showSearch}
    <TerminalSearch
      bind:this={searchRef}
      bind:value={searchValue}
      resultIndex={resultIndex}
      resultCount={resultCount}
      overflow={resultOverflow}
      caseSensitive={searchCase}
      wholeWord={searchWhole}
      regex={searchRegex}
      on:next={onSearchNext}
      on:prev={onSearchPrev}
      on:clear={onSearchClear}
      on:close={onToggleClose}
      on:change={onSearchChange}
      on:options={onSearchOptions}
      on:blur={onSearchBlur}
    />
  {/if}
  <div class="terminal-shell">
    <div class="terminal" bind:this={terminalElement} class:hidden on:click={() => { setActiveInstance(myId); focusTerminal(); }} on:contextmenu={handleContextMenu} />
  </div>

</div>

<style>
  .terminal-wrapper {
    display: flex;
    flex-direction: column;
    height: 100%;
    width: 100%;
  }
  .terminal-shell {
    flex: 1 1 auto;
    height: 100%;
    width: 100%;
    padding: 8px 8px;
    box-sizing: border-box;
  }
  .terminal {
    height: 100%;
    width: 100%;
    overflow: hidden;
    user-select: text;
    background-color: var(--terminal-background);
    color: var(--terminal-foreground);
  }
  .hidden { display: none; }
</style>
