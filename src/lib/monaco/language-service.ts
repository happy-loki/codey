import { monaco } from "./instance";

export type MonacoLanguageDescriptor = {
  id: string;
  label: string;
};

const FALLBACK_LANGUAGE: MonacoLanguageDescriptor = {
  id: "plaintext",
  label: "Plain Text",
};

const customExtensionMap = new Map<string, MonacoLanguageDescriptor>([
  ["md", { id: "markdown", label: "Markdown" }],
  ["mkd", { id: "markdown", label: "Markdown" }],
  ["markdown", { id: "markdown", label: "Markdown" }],
  ["vue", { id: "html", label: "HTML" }],
  ["svelte", { id: "html", label: "HTML" }],
  ["cjs", { id: "javascript", label: "JavaScript" }],
  ["mjs", { id: "javascript", label: "JavaScript" }],
  ["jsx", { id: "javascript", label: "JavaScript" }],
  ["tsx", { id: "typescript", label: "TypeScript" }],
]);

function normalize(value: string | null | undefined): string {
  return (value || "").trim().toLowerCase();
}

function stripLeadingDot(value: string): string {
  return value.startsWith(".") ? value.slice(1) : value;
}

function pickDescriptor(id: string, fallbackLabel?: string | undefined): MonacoLanguageDescriptor {
  const language = monaco.languages.getLanguages().find((lang) => lang.id === id);
  const label = language?.aliases?.[0] ?? fallbackLabel ?? id;
  return { id, label };
}

export function detectLanguageByExtension(ext: string | null | undefined): MonacoLanguageDescriptor {
  const normalized = normalize(ext);
  if (!normalized) {
    return FALLBACK_LANGUAGE;
  }

  const custom = customExtensionMap.get(normalized);
  if (custom) {
    return custom;
  }

  const languages = monaco.languages.getLanguages();
  const match = languages.find((lang) => {
    const extensions = lang.extensions?.map(stripLeadingDot) ?? [];
    const aliases = lang.aliases?.map((alias) => alias.toLowerCase()) ?? [];
    const filenames = lang.filenames?.map((name) => name.toLowerCase()) ?? [];
    return (
      extensions.includes(normalized) ||
      aliases.includes(normalized) ||
      filenames.includes(normalized)
    );
  });
  if (match) {
    return {
      id: match.id,
      label: match.aliases?.[0] ?? match.id,
    };
  }

  return FALLBACK_LANGUAGE;
}

export function detectLanguageByPath(path: string | null | undefined): MonacoLanguageDescriptor {
  if (!path) return FALLBACK_LANGUAGE;
  const normalized = path.replace(/\\/g, "/");
  const filename = normalized.split("/").pop() ?? normalized;
  const dotIndex = filename.lastIndexOf(".");
  if (dotIndex === -1 || dotIndex === filename.length - 1) {
    return FALLBACK_LANGUAGE;
  }
  const ext = filename.slice(dotIndex + 1);
  return detectLanguageByExtension(ext);
}

export function detectLanguage({
  extension,
  hint,
  path,
}: {
  extension?: string | null;
  hint?: string | null;
  path?: string | null;
}): MonacoLanguageDescriptor {
  const normalizedHint = normalize(hint);
  if (normalizedHint) {
    const byHint = detectLanguageByExtension(normalizedHint);
    if (byHint.id !== FALLBACK_LANGUAGE.id || !extension) {
      return byHint;
    }
  }
  if (extension) {
    const byExt = detectLanguageByExtension(extension);
    if (byExt.id !== FALLBACK_LANGUAGE.id) {
      return byExt;
    }
  }
  if (path) {
    const byPath = detectLanguageByPath(path);
    if (byPath.id !== FALLBACK_LANGUAGE.id) {
      return byPath;
    }
  }
  return FALLBACK_LANGUAGE;
}

export function applyLanguageToModel(
  model: monaco.editor.ITextModel | null | undefined,
  descriptor: MonacoLanguageDescriptor,
): void {
  if (!model) return;
  if (model.getLanguageId() === descriptor.id) return;
  monaco.editor.setModelLanguage(model, descriptor.id);
}
