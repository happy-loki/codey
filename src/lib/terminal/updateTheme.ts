import type { Terminal } from '@xterm/xterm';

const cssVar = (name: string): string =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim();

export function updateTerminalTheme(term: Terminal) {
  if (!term) return;
  term.options.theme = {
    background: cssVar('--terminal-background'),
    foreground: cssVar('--terminal-foreground'),
    cursor: cssVar('--terminal-cursor'),
    selectionBackground: cssVar('--terminal-selectionBackground'),

    black: cssVar('--ansi-black'),
    red: cssVar('--ansi-red'),
    green: cssVar('--ansi-green'),
    yellow: cssVar('--ansi-yellow'),
    blue: cssVar('--ansi-blue'),
    magenta: cssVar('--ansi-magenta'),
    cyan: cssVar('--ansi-cyan'),
    white: cssVar('--ansi-white'),

    brightBlack: cssVar('--ansi-brightBlack'),
    brightRed: cssVar('--ansi-brightRed'),
    brightGreen: cssVar('--ansi-brightGreen'),
    brightYellow: cssVar('--ansi-brightYellow'),
    brightBlue: cssVar('--ansi-brightBlue'),
    brightMagenta: cssVar('--ansi-brightMagenta'),
    brightCyan: cssVar('--ansi-brightCyan'),
    brightWhite: cssVar('--ansi-brightWhite'),
  } as any;
}