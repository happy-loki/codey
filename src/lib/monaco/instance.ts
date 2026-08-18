import * as monaco from "monaco-editor/esm/vs/editor/editor.api";
import * as markdown from "monaco-editor/esm/vs/basic-languages/markdown/markdown";

// Language/tokenization contributions (syntax highlighting, completion stubs, etc.)
import "monaco-editor/esm/vs/basic-languages/monaco.contribution";
import "monaco-editor/esm/vs/language/json/monaco.contribution";
import "monaco-editor/esm/vs/language/css/monaco.contribution";
import "monaco-editor/esm/vs/language/html/monaco.contribution";
import "monaco-editor/esm/vs/language/typescript/monaco.contribution";
// Core editor features (find/replace widget, keybindings, etc.)
import "monaco-editor/esm/vs/editor/contrib/find/browser/findController";
import "monaco-editor/esm/vs/editor/contrib/folding/browser/folding";
import "monaco-editor/esm/vs/editor/contrib/folding/browser/foldingDecorations";
import "monaco-editor/esm/vs/editor/standalone/browser/quickAccess/standaloneGotoLineQuickAccess";
import "monaco-editor/esm/vs/editor/contrib/clipboard/browser/clipboard";

// Monaco relies on web workers per language. Vite can inline them via ?worker imports.
// Only wire them up when running in a browser/WebView environment.
import EditorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import JsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker";
import CssWorker from "monaco-editor/esm/vs/language/css/css.worker?worker";
import HtmlWorker from "monaco-editor/esm/vs/language/html/html.worker?worker";
import TsWorker from "monaco-editor/esm/vs/language/typescript/ts.worker?worker";

type MonacoWorkerFactory = () => Worker;

const workerFactories: Record<string, MonacoWorkerFactory> = {
  json: () => new JsonWorker(),
  css: () => new CssWorker(),
  scss: () => new CssWorker(),
  less: () => new CssWorker(),
  html: () => new HtmlWorker(),
  handlebars: () => new HtmlWorker(),
  razor: () => new HtmlWorker(),
  typescript: () => new TsWorker(),
  javascript: () => new TsWorker(),
};

const defaultWorkerFactory: MonacoWorkerFactory = () => new EditorWorker();

type MonacoEnvironment = {
  getWorker(moduleId: string, label: string): Worker;
};

const globalScope: { MonacoEnvironment?: MonacoEnvironment } | null =
  typeof self !== "undefined"
    ? (self as typeof self & { MonacoEnvironment?: MonacoEnvironment })
    : typeof window !== "undefined"
      ? (window as typeof window & { MonacoEnvironment?: MonacoEnvironment })
      : null;

if (globalScope && !globalScope.MonacoEnvironment) {
  globalScope.MonacoEnvironment = {
    getWorker(_moduleId, label) {
      const factory = workerFactories[label] || defaultWorkerFactory;
      return factory();
    },
  };
}

// 直接同步注册 markdown 的 Monarch 语法，避免首次打开时白屏等待异步 loader。
monaco.languages.setMonarchTokensProvider("markdown", markdown.language);
monaco.languages.setLanguageConfiguration("markdown", markdown.conf);

export type MonacoInstance = typeof monaco;
export { monaco };
