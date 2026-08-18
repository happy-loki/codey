import frontMatter from "front-matter";
import { dump } from "js-yaml";

export type GenericFrontmatter = Record<string, unknown>;

export type ParseMarkdownResult = {
  attributes: GenericFrontmatter;
  body: string;
  hasFrontmatter: boolean;
};

export type WechatDraftMeta = {
  title?: string;
  author?: string;
  summary?: string;
  cover?: string;
  coverMediaId?: string;
  mediaId?: string;
  itemId?: number;
};

const WECHAT_KEYS = {
  title: "title",
  author: "author",
  summary: "summary",
  cover: "cover",
  coverMediaId: "cover_media_id",
  mediaId: "media_id",
  itemId: "item_id"
} as const;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function toOptionalString(value: unknown): string | undefined {
  if (!isNonEmptyString(value)) return undefined;
  return value.trim();
}

function toOptionalNumber(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return value;
}

export function parseMarkdown(text: string): ParseMarkdownResult {
  try {
    const parsed = frontMatter(text ?? "");
    return {
      attributes: (parsed.attributes ?? {}) as GenericFrontmatter,
      body: typeof parsed.body === "string" ? parsed.body : "",
      hasFrontmatter: parsed.frontmatter != null && String(parsed.frontmatter).trim().length > 0
    };
  } catch (error) {
    console.error("Failed to parse markdown front matter", error);
    return {
      attributes: {},
      body: text ?? "",
      hasFrontmatter: false
    };
  }
}

export function extractWechatMeta(attributes: GenericFrontmatter): WechatDraftMeta {
  return {
    title: toOptionalString(attributes[WECHAT_KEYS.title]),
    author: toOptionalString(attributes[WECHAT_KEYS.author]),
    summary: toOptionalString(attributes[WECHAT_KEYS.summary]),
    cover: toOptionalString(attributes[WECHAT_KEYS.cover]),
    coverMediaId: toOptionalString(attributes[WECHAT_KEYS.coverMediaId]),
    mediaId: toOptionalString(attributes[WECHAT_KEYS.mediaId]),
    itemId: toOptionalNumber(attributes[WECHAT_KEYS.itemId])
  };
}

export function applyWechatMeta(
  attributes: GenericFrontmatter,
  updates: WechatDraftMeta
): GenericFrontmatter {
  const next: GenericFrontmatter = { ...attributes };

  const setters: Array<[keyof typeof WECHAT_KEYS, unknown]> = [
    ["title", updates.title],
    ["author", updates.author],
    ["summary", updates.summary],
    ["cover", updates.cover],
    ["coverMediaId", updates.coverMediaId],
    ["mediaId", updates.mediaId],
    ["itemId", updates.itemId]
  ];

  for (const [logicalKey, value] of setters) {
    const yamlKey = WECHAT_KEYS[logicalKey];
    if (value === undefined || value === null || value === "") {
      delete next[yamlKey];
    } else {
      next[yamlKey] = value;
    }
  }

  return next;
}

export function composeMarkdown(attributes: GenericFrontmatter, body: string): string {
  const cleanedAttributes = Object.fromEntries(
    Object.entries(attributes).filter(([, value]) => value !== undefined && value !== null)
  );

  const hasAttributes = Object.keys(cleanedAttributes).length > 0;
  if (!hasAttributes) {
    return body;
  }

  const yamlContent = dump(cleanedAttributes, {
    lineWidth: 0,
    noRefs: true,
    skipInvalid: true
  }).trimEnd();

  const normalizedBody = typeof body === "string" ? body : "";
  const separator = yamlContent.length > 0 ? `${yamlContent}\n` : "";
  let bodySection = "\n";
  if (normalizedBody.length > 0) {
    bodySection = normalizedBody.startsWith("\n") ? normalizedBody : `\n${normalizedBody}`;
  }

  return `---\n${separator}---${bodySection}`;
}
