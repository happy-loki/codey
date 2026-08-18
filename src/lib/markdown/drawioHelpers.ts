import { get } from "svelte/store";

import { activeInfo } from "../editorBus";
import { workingDir } from "../File";
import type { DrawioResult } from "./drawioDialogStore";
import { computeRelativePath, ensureRelativePrefix, toForwardSlash } from "./pathUtils";

export const DRAWIO_DEFAULT_ALT = "draw";

export type DrawioPersistOptions = {
  existingXmlRelativePath?: string;
};

export type DrawioPersistResult = {
  imageRelativePath: string;
  xmlRelativePath: string;
  imageAbsolutePath: string;
  xmlAbsolutePath: string;
};

const isTauri =
  typeof window !== "undefined" &&
  typeof navigator !== "undefined" &&
  !!(window as any).__TAURI_INTERNALS__;

export function ensureTauri(): asserts isTauri {
  if (!isTauri) {
    throw new Error("draw 保存仅支持桌面环境");
  }
}

export async function persistDrawioDiagram(
  result: DrawioResult,
  options: DrawioPersistOptions = {},
): Promise<DrawioPersistResult> {
  ensureTauri();

  const info = get(activeInfo);
  if (!info?.path) {
    throw new Error("当前文档尚未保存，无法写入 draw 图形");
  }

  const workspace = get(workingDir) ?? null;
  const [{ dirname, basename, extname, join, resolve }, fs] = await Promise.all([
    import("@tauri-apps/api/path"),
    import("@tauri-apps/plugin-fs"),
  ]);

  const docPath = info.path;
  const docReference = toForwardSlash(docPath);
  const workspaceReference = workspace ? toForwardSlash(workspace) : null;
  const docDir = await dirname(docPath);
  const drawioDir = await join(docDir, "drawio");
  await ensureDirectory(drawioDir, fs);

  let xmlRelativePath: string;
  let xmlAbsolutePath: string;
  let imageRelativePath: string;
  let imageAbsolutePath: string;

  if (options.existingXmlRelativePath) {
    xmlRelativePath = sanitizeRelativePath(options.existingXmlRelativePath);
    xmlAbsolutePath = await resolve(docDir, xmlRelativePath);
    imageRelativePath = sanitizeRelativePath(replaceExtension(xmlRelativePath, ".png"));
    imageAbsolutePath = await resolve(docDir, imageRelativePath);
  } else {
    const docName = await basename(docPath, await extname(docPath));
    const slug = slugify(docName);
    const prefix = slug ? `${slug}-drawio` : "drawio";
    const stem = await ensureUniqueStem(drawioDir, prefix, fs, join);
    xmlAbsolutePath = await join(drawioDir, `${stem}.drawio`);
    imageAbsolutePath = await join(drawioDir, `${stem}.png`);

    xmlRelativePath =
      computeRelativePath(toForwardSlash(xmlAbsolutePath), [docReference, workspaceReference]) ??
      ensureRelativePrefix(`drawio/${stem}.drawio`);
    imageRelativePath =
      computeRelativePath(toForwardSlash(imageAbsolutePath), [docReference, workspaceReference]) ??
      ensureRelativePrefix(`drawio/${stem}.png`);
  }

  const pngBytes = decodePngData(result.base64);
  await Promise.all([
    removeIfExists(imageAbsolutePath, fs),
    removeIfExists(xmlAbsolutePath, fs),
  ]);
  await Promise.all([
    fs.writeFile(imageAbsolutePath, pngBytes),
    fs.writeTextFile(xmlAbsolutePath, result.xmlData),
  ]);

  return {
    imageRelativePath: ensureRelativePrefix(imageRelativePath),
    xmlRelativePath: ensureRelativePrefix(xmlRelativePath),
    imageAbsolutePath,
    xmlAbsolutePath,
  };
}

export async function loadDrawioXml(xmlRelativePath: string): Promise<string> {
  ensureTauri();

  const info = get(activeInfo);
  if (!info?.path) {
    throw new Error("当前文档尚未保存，无法读取 draw 图形");
  }

  const [{ dirname, resolve }, { readTextFile }] = await Promise.all([
    import("@tauri-apps/api/path"),
    import("@tauri-apps/plugin-fs"),
  ]);

  const docDir = await dirname(info.path);
  const absolutePath = await resolve(docDir, sanitizeRelativePath(xmlRelativePath));
  return readTextFile(absolutePath);
}

export function buildDrawioHtml(params: {
  imageRelativePath: string;
  xmlRelativePath: string;
  alt?: string;
}): string {
  const alt = params.alt ?? DRAWIO_DEFAULT_ALT;
  const src = encodePathForAttribute(params.imageRelativePath);
  const xmlAttr = encodePathForAttribute(params.xmlRelativePath);
  const escapedAlt = escapeAttribute(alt);
  return `<img src="${src}" alt="${escapedAlt}" data-drawio="${xmlAttr}" />`;
}

export function findDrawioBlockByXmlPath(
  source: string,
  xmlRelativePath: string,
): { from: number; to: number } | null {
  if (!xmlRelativePath) return null;
  const marker = `data-drawio="${encodePathForAttribute(xmlRelativePath)}"`;
  const pivot = source.indexOf(marker);
  if (pivot === -1) return null;
  const start = source.lastIndexOf("<img", pivot);
  if (start === -1) return null;
  const end = source.indexOf(">", pivot);
  if (end === -1) return null;
  return { from: start, to: end + 1 };
}

function decodePngData(dataUri: string): Uint8Array {
  const match = /^data:(?<mime>.+?);base64,(?<payload>.+)$/i.exec(dataUri ?? "");
  if (!match?.groups?.payload) {
    throw new Error("不支持的 draw 图片数据格式");
  }
  const base64 = match.groups.payload;
  if (typeof atob !== "function") {
    throw new Error("当前环境不支持 base64 解码");
  }
  const binary = atob(base64);
  const length = binary.length;
  const bytes = new Uint8Array(length);
  for (let i = 0; i < length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function ensureDirectory(path: string, fs: typeof import("@tauri-apps/plugin-fs")): Promise<void> {
  const exists = await fs.exists(path).catch(() => false);
  if (!exists) {
    await fs.mkdir(path, { recursive: true });
  }
}

async function removeIfExists(path: string, fs: typeof import("@tauri-apps/plugin-fs")): Promise<void> {
  if (!path) return;
  const exists = await fs.exists(path).catch(() => false);
  if (!exists) return;
  try {
    await fs.remove(path);
  } catch (error) {
    console.warn("删除旧 draw 文件失败", path, error);
  }
}

async function ensureUniqueStem(
  dir: string,
  base: string,
  fs: typeof import("@tauri-apps/plugin-fs"),
  join: typeof import("@tauri-apps/api/path")["join"],
): Promise<string> {
  let counter = 0;
  let stem = base;

  while (true) {
    const [xmlPath, pngPath] = await Promise.all([
      join(dir, `${stem}.drawio`),
      join(dir, `${stem}.png`),
    ]);
    const exists = await Promise.all([
      fs.exists(xmlPath).catch(() => false),
      fs.exists(pngPath).catch(() => false),
    ]);
    if (!exists[0] && !exists[1]) {
      return stem;
    }
    counter += 1;
    stem = `${base}-${counter}`;
  }
}

function encodePathForAttribute(value: string): string {
  const normalized = sanitizeRelativePath(value);
  const encoded = encodeURI(normalized);
  return escapeAttribute(encoded);
}

function sanitizeRelativePath(value: string): string {
  const trimmed = (value ?? "").trim();
  if (!trimmed) return trimmed;
  const normalized = toForwardSlash(trimmed);
  return ensureRelativePrefix(normalized);
}

function replaceExtension(path: string, ext: string): string {
  return path.replace(/\.[^.]+$/, ext);
}

function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function slugify(value: string | null | undefined): string {
  if (!value) return "";
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}
