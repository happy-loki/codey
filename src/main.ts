import "./theme.scss";
import "./global.css";
import "monaco-editor/esm/vs/editor/browser/widget/codeEditor/editor.css";
import "monaco-editor/esm/vs/editor/contrib/find/browser/findWidget.css";
import "monaco-editor/esm/vs/editor/browser/widget/diffEditor/style.css";
import "monaco-editor/esm/vs/editor/contrib/hover/browser/hover.css";
import "monaco-editor/esm/vs/base/browser/ui/codicons/codicon/codicon.css";
import App from './App.svelte';
// import { attachConsole } from "tauri-plugin-log-api";
import { attachConsole } from '@tauri-apps/plugin-log';

attachConsole();

// Platform hint for CSS. Used for small platform-specific polish (e.g. resize cursors).
try {
    const ua = typeof navigator !== "undefined" ? navigator.userAgent.toLowerCase() : "";
    const platform =
        ua.includes("windows") ? "windows" :
        ua.includes("mac os") ? "macos" :
        ua.includes("linux") ? "linux" :
        "unknown";
    document.documentElement.setAttribute("data-platform", platform);
} catch {}

const app = new App({
	target: document.body
});

export default app;
