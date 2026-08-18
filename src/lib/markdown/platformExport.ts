import html2canvas from "html2canvas";
import juice from "juice";
import { get } from "svelte/store";

import { addNotification, NotifType } from "../Notifications/notifications";
import { themeStylesheet } from "./themeStore";
import { defaultStyleConfig, styleConfig } from "./styleStore";

type PlatformKey = "wechat" | "zhihu" | "juejin";

const PLATFORM_LABEL: Record<PlatformKey, string> = {
  wechat: "微信",
  zhihu: "知乎",
  juejin: "掘金"
};

const EXPORT_FILENAME = "markdown-preview.png";

export async function copyPlatformHtml(platform: PlatformKey): Promise<void> {
  if (typeof window === "undefined" || typeof document === "undefined") {
    throw new Error("当前环境不支持导出");
  }

  if (platform === "wechat") {
    const normalizedHtml = await generateWechatHtml();
    const copied = await copyWechatContent(normalizedHtml);
    if (copied) {
      addNotification(NotifType.Success, `${PLATFORM_LABEL[platform]}格式已复制`, [], "粘贴到目标平台即可");
    } else {
      addNotification(NotifType.Error, "复制失败", [], "请检查浏览器剪贴板权限");
    }
    return;
  }

  const root = clonePreviewRoot(platform);

  switch (platform) {
    case "zhihu":
      transformZhihuMath(root);
      break;
    case "juejin":
      transformJuejinMath(root);
      appendJuejinSuffix(root);
      break;
    default:
      break;
  }

  const htmlWithStyles = inlineHtml(root.outerHTML);
  const platformHtml = platform === "juejin" ? transformJuejinCode(htmlWithStyles) : htmlWithStyles;
  const plainText = extractPlainText(root);

  const copied = await copyRichContent(platformHtml, plainText);
  if (copied) {
    addNotification(NotifType.Success, `${PLATFORM_LABEL[platform]}格式已复制`, [], "粘贴到目标平台即可");
  } else {
    addNotification(NotifType.Error, "复制失败", [], "请检查浏览器剪贴板权限");
  }
}

export async function generateWechatHtml(): Promise<string> {
  if (typeof window === "undefined" || typeof document === "undefined") {
    throw new Error("当前环境不支持导出");
  }

  const previewRoot = clonePreviewRoot("wechat");
  const root = unwrapWechatRoot(previewRoot);
  transformWeChatMath(root);
  adjustWechatDom(root);

  const htmlWithStyles = inlineHtml(root.outerHTML);
  const currentStyle = get(styleConfig);
  const primaryColor = currentStyle.primaryColor || defaultStyleConfig.primaryColor;
  return normalizeWechatHtml(htmlWithStyles, primaryColor);
}

export async function exportPreviewImage(): Promise<void> {
  if (typeof window === "undefined" || typeof document === "undefined") {
    throw new Error("当前环境不支持导出图片");
  }

  const container = document.querySelector<HTMLElement>(".markdown-preview");
  if (!container) {
    addNotification(NotifType.Error, "未找到预览容器", [], "请确认已打开 Markdown 预览");
    return;
  }

  const overlay = buildExportOverlay(container);

  try {
    container.scrollTo({ top: 0, left: 0, behavior: "auto" });
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });

    await new Promise((resolve) => setTimeout(resolve, 300));

    const height = container.scrollHeight;
    const canvas = await html2canvas(container, {
      useCORS: true,
      height,
      windowHeight: height + 120,
      backgroundColor: window.getComputedStyle(container).backgroundColor || "#ffffff"
    });

    const link = document.createElement("a");
    link.href = canvas.toDataURL("image/png");
    link.download = EXPORT_FILENAME;
    link.click();
    addNotification(NotifType.Success, "图片导出完成", [], `已保存为 ${EXPORT_FILENAME}`);
  } catch (error) {
    console.error("导出图片失败", error);
    addNotification(NotifType.Error, "图片导出失败", [], String(error));
  } finally {
    overlay.remove();
  }
}

function clonePreviewRoot(platform?: PlatformKey): HTMLElement {
  const source = document.querySelector<HTMLElement>(".markdown-preview #nice");
  if (!source) {
    throw new Error("未找到 Markdown 预览内容");
  }

  const clone = source.cloneNode(true) as HTMLElement;
  inlineMermaidSvgStyles(source, clone, platform !== "wechat");
  return clone;
}

function unwrapWechatRoot(previewRoot: HTMLElement): HTMLElement {
  const firstRenderable = Array.from(previewRoot.children).find(
    (node): node is HTMLElement => node instanceof HTMLElement && node.tagName !== "STYLE" && node.tagName !== "SCRIPT"
  );

  if (!firstRenderable) {
    return previewRoot;
  }

  const exportRoot = firstRenderable.cloneNode(true) as HTMLElement;
  exportRoot.removeAttribute("id");
  exportRoot.removeAttribute("class");

  const wrapperStyle = previewRoot.getAttribute("style");
  if (wrapperStyle?.trim()) {
    const mergedStyle = mergeInlineStyles(exportRoot.getAttribute("style"), wrapperStyle);
    if (mergedStyle) {
      exportRoot.setAttribute("style", mergedStyle);
    }
  }

  return exportRoot;
}

function mergeInlineStyles(base: string | null, addition: string | null): string | null {
  const declarations = new Map<string, string>();

  const collect = (input: string | null | undefined) => {
    if (!input) return;
    input
      .split(";")
      .map((item) => item.trim())
      .filter((item) => item.length > 0)
      .forEach((item) => {
        const [prop, ...rest] = item.split(":");
        if (!prop || rest.length === 0) return;
        const value = rest.join(":").trim();
        if (!value) return;
        declarations.set(prop.trim().toLowerCase(), `${prop.trim()}: ${value}`);
      });
  };

  collect(base);
  collect(addition);

  if (declarations.size === 0) {
    return null;
  }

  return Array.from(declarations.values()).join("; ") + ";";
}

const INLINE_SVG_STYLE_PROPS: Array<keyof CSSStyleDeclaration> = [
  "fill",
  "stroke",
  "color",
  "backgroundColor",
  "fontSize",
  "fontWeight",
  "fontStyle",
  "fontFamily",
  "lineHeight",
  "letterSpacing",
  "textTransform",
  "textDecoration",
  "textAlign",
  "whiteSpace",
  "strokeWidth",
  "strokeDasharray",
  "strokeDashoffset",
  "strokeLinecap",
  "strokeLinejoin",
  "opacity",
  "fillOpacity",
  "strokeOpacity",
  "stopColor"
];

function inlineMermaidSvgStyles(sourceRoot: HTMLElement, cloneRoot: HTMLElement, embedAsImage: boolean): void {
  if (typeof window === "undefined" || typeof window.getComputedStyle !== "function") {
    return;
  }

  const sourceSvgs = sourceRoot.querySelectorAll<SVGSVGElement>(".mermaid svg");
  const cloneSvgs = cloneRoot.querySelectorAll<SVGSVGElement>(".mermaid svg");

  if (!sourceSvgs.length || sourceSvgs.length !== cloneSvgs.length) {
    return;
  }

  sourceSvgs.forEach((sourceSvg, index) => {
    const cloneSvg = cloneSvgs[index];
    if (!cloneSvg) {
      return;
    }
    inlineSvgElementStyles(sourceSvg, cloneSvg);
    if (embedAsImage) {
      embedSvgAsDataImage(sourceSvg, cloneSvg);
    }
  });
}

function inlineSvgElementStyles(sourceEl: Element, cloneEl: Element): void {
  if (!(cloneEl instanceof Element)) {
    return;
  }

  const computed = window.getComputedStyle(sourceEl);

  INLINE_SVG_STYLE_PROPS.forEach((prop) => {
    const value = computed[prop];
    if (!value || value === "auto") {
      return;
    }

    // @ts-expect-error SVG 样式属性在 CSSStyleDeclaration 中以字符串形式存在
    cloneEl.style[prop] = value;

    if (
      prop === "fill"
      || prop === "stroke"
      || prop === "strokeWidth"
      || prop === "strokeDasharray"
      || prop === "strokeDashoffset"
      || prop === "fillOpacity"
      || prop === "strokeOpacity"
      || prop === "stopColor"
      || prop === "fontSize"
      || prop === "fontWeight"
      || prop === "fontStyle"
      || prop === "fontFamily"
      || prop === "letterSpacing"
    ) {
      const attrName = prop.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`);
      cloneEl.setAttribute(attrName, value);
    }
  });

  const sourceChildren = sourceEl.children;
  const cloneChildren = cloneEl.children;

  for (let index = 0; index < sourceChildren.length; index += 1) {
    const sourceChild = sourceChildren[index];
    const cloneChild = cloneChildren[index];
    if (sourceChild && cloneChild) {
      inlineSvgElementStyles(sourceChild, cloneChild);
    }
  }
}

function adjustWechatDom(root: HTMLElement): void {
  normalizeWechatRootSpacing(root);
  flattenNestedLists(root);
  fixWechatImages(root);
  normalizeMermaidContainers(root);
  flattenMermaidLabels(root);
}

function normalizeWechatRootSpacing(root: HTMLElement): void {
  // Mobile preview may carry narrow-device padding/max-width into the export root.
  // Reset the outer wrapper so WeChat can use the available viewport width.
  const existing = root.getAttribute("style") ?? "";
  const cleaned = removeStyleProperties(existing, [
    "width",
    "max-width",
    "min-width",
    "margin",
    "margin-left",
    "margin-right",
    "padding",
    "padding-left",
    "padding-right",
    "box-sizing",
    "border",
    "border-left",
    "border-right",
    "border-radius",
    "box-shadow",
    "background-clip",
  ]);
  const merged = appendStyleDeclarations(cleaned, [
    "width: 100% !important",
    "max-width: 100% !important",
    "margin: 0 !important",
    "padding-left: 0 !important",
    "padding-right: 0 !important",
    "box-sizing: border-box",
  ]);
  root.setAttribute("style", merged);
}

function flattenNestedLists(root: HTMLElement): void {
  const nestedLists = root.querySelectorAll<HTMLElement>("li > ul, li > ol");
  nestedLists.forEach((list) => {
    const parent = list.parentElement;
    if (!parent) return;
    const grandParent = parent.parentElement;
    if (!grandParent) return;
    grandParent.insertBefore(list, parent.nextSibling);
  });
}

function fixWechatImages(root: HTMLElement): void {
  const images = root.querySelectorAll<HTMLImageElement>("img");
  images.forEach((image) => {
    const widthAttr = image.getAttribute("width");
    const heightAttr = image.getAttribute("height");
    if (widthAttr) {
      image.style.width = ensureCssUnit(widthAttr);
      image.removeAttribute("width");
    }
    if (heightAttr) {
      image.style.height = ensureCssUnit(heightAttr);
      image.removeAttribute("height");
    }
  });
}

function ensureCssUnit(value: string): string {
  const trimmed = value.trim();
  if (/^\d+(?:\.\d+)?$/.test(trimmed)) {
    return `${trimmed}px`;
  }
  return trimmed;
}

function normalizeMermaidContainers(root: HTMLElement): void {
  const nodes = root.querySelectorAll<HTMLElement>(".nodeLabel");
  nodes.forEach((node) => {
    const parent = node.parentElement as HTMLElement | null;
    if (!parent) return;
    const grandParent = parent.parentElement as HTMLElement | null;
    if (!grandParent) return;

    const doc = node.ownerDocument;
    const replacement = doc.createElement("section");
    const xmlns = parent.getAttribute("xmlns");
    const style = parent.getAttribute("style");
    if (xmlns) {
      replacement.setAttribute("xmlns", xmlns);
    }
    if (style) {
      replacement.setAttribute("style", style);
    }
    replacement.innerHTML = parent.innerHTML;

    grandParent.innerHTML = "";
    grandParent.appendChild(replacement);
  });
}

function flattenMermaidLabels(root: HTMLElement): void {
  flattenLabelParagraphs(root, ".nodeLabel");
  flattenLabelParagraphs(root, ".edgeLabel");
}

function flattenLabelParagraphs(root: HTMLElement, selector: string): void {
  const labels = root.querySelectorAll<HTMLElement>(selector);
  labels.forEach((label) => {
    const paragraphs = label.querySelectorAll<HTMLParagraphElement>("p");
    paragraphs.forEach((paragraph) => {
      const parent = paragraph.parentElement;
      if (!parent) return;
      while (paragraph.firstChild) {
        parent.insertBefore(paragraph.firstChild, paragraph);
      }
      paragraph.remove();
    });
  });
}

function embedSvgAsDataImage(sourceSvg: SVGSVGElement, cloneSvg: SVGSVGElement): void {
  const svgForExport = cloneSvg.cloneNode(true) as SVGSVGElement;

  if (!svgForExport.getAttribute("xmlns")) {
    svgForExport.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  }
  if (!svgForExport.getAttribute("xmlns:xlink") && sourceSvg.getAttribute("xmlns:xlink")) {
    svgForExport.setAttribute("xmlns:xlink", "http://www.w3.org/1999/xlink");
  }

  const serializer = new XMLSerializer();
  const svgString = serializer.serializeToString(svgForExport);
  const svgBytes = new TextEncoder().encode(svgString);
  let binary = "";
  svgBytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  const encoded = window.btoa(binary);
  const dataUrl = `data:image/svg+xml;base64,${encoded}`;

  const dimension = sourceSvg.getBoundingClientRect();
  const viewBox = svgForExport.viewBox?.baseVal;
  const width = dimension.width || viewBox?.width || Number(svgForExport.getAttribute("width")) || 0;
  const height = dimension.height || viewBox?.height || Number(svgForExport.getAttribute("height")) || 0;

  const img = document.createElement("img");
  img.src = dataUrl;
  img.alt = "Mermaid diagram";
  img.style.display = "block";
  img.style.maxWidth = "100%";

  if (width) {
    img.style.width = `${width}px`;
  }
  if (height) {
    img.style.height = `${height}px`;
  }

  const parent = cloneSvg.parentNode;
  if (parent) {
    parent.replaceChild(img, cloneSvg);
  }
}

function inlineHtml(html: string): string {
  const css = get(themeStylesheet);
  try {
    return juice.inlineContent(html, css, {
      inlinePseudoElements: true,
      preserveImportant: true
    });
  } catch (error) {
    console.warn("CSS 内联失败，返回原始 HTML", error);
    return html;
  }
}

function normalizeWechatHtml(html: string, primaryColor: string): string {
  if (typeof window === "undefined" || typeof DOMParser === "undefined") {
    return html;
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");
  const body = doc.body;

  const normalizedPrimary = resolvePrimaryColor(primaryColor);
  const rgb = parseColorToRgb(normalizedPrimary);

  const walker = doc.createTreeWalker(body, NodeFilter.SHOW_ELEMENT, null);
  let current = walker.nextNode() as (HTMLElement | SVGElement | null);
  while (current) {
    if (current instanceof HTMLElement || current instanceof SVGElement) {
      adjustWechatElementStyle(current, normalizedPrimary, rgb);
    }
    current = walker.nextNode() as (HTMLElement | SVGElement | null);
  }

  // fix Mermaid tspans getting stroke color overrides in WeChat
  body.querySelectorAll("tspan").forEach((tspan) => {
    if (!(tspan instanceof Element)) return;
    const existing = tspan.getAttribute("style") ?? "";
    const cleaned = removeStyleProperties(existing, ["fill", "color", "stroke"]);
    const merged = appendStyleDeclarations(cleaned, [
      "fill: #333333 !important",
      "color: #333333 !important",
      "stroke: none !important"
    ]);
    tspan.setAttribute("style", merged);
  });

  return body.innerHTML;
}

interface RGBColor {
  r: number;
  g: number;
  b: number;
}

function resolvePrimaryColor(primaryColor: string): string {
  const candidate = primaryColor?.trim();
  if (candidate) {
    return candidate;
  }
  return defaultStyleConfig.primaryColor;
}

function parseColorToRgb(color: string): RGBColor | null {
  if (!color) {
    return null;
  }
  const trimmed = color.trim();
  const hexMatch = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(trimmed);
  if (hexMatch) {
    return hexToRgb(trimmed);
  }
  const rgbMatch = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/.exec(trimmed);
  if (rgbMatch) {
    const r = Number(rgbMatch[1]);
    const g = Number(rgbMatch[2]);
    const b = Number(rgbMatch[3]);
    if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) {
      return null;
    }
    return { r: clampColor(r), g: clampColor(g), b: clampColor(b) };
  }
  return null;
}

function hexToRgb(hex: string): RGBColor {
  let value = hex.replace("#", "");
  if (value.length === 3) {
    value = value.split("").map((char) => char + char).join("");
  }
  const int = parseInt(value, 16);
  const r = (int >> 16) & 255;
  const g = (int >> 8) & 255;
  const b = int & 255;
  return { r, g, b };
}

function clampColor(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function adjustWechatElementStyle(element: HTMLElement | SVGElement, primaryColor: string, rgb: RGBColor | null): void {
  const styleAttr = element.getAttribute("style");
  if (!styleAttr) {
    return;
  }

  let styleString = styleAttr.replace(/([^-])top:\s*([\-\d.]+)em/g, (_, prefix: string, value: string) => {
    return `${prefix}transform: translateY(${value}em)`;
  });

  const declarations = parseStyleDeclarations(styleString);
  if (!declarations.length) {
    element.removeAttribute("style");
    return;
  }

  for (const declaration of declarations) {
    let { value } = declaration;
    if (!value) continue;

    if (primaryColor) {
      value = value.replace(/var\(--md-primary-color\)/g, primaryColor);
    }
    value = value
      .replace(/hsl\(var\(--foreground\)\)/g, "#3f3f3f")
      .replace(/var\(--blockquote-background\)/g, "#f7f7f7");

    if (value.includes("color-mix(")) {
      value = replaceColorMix(value, primaryColor, rgb);
    }

    declaration.value = value;
  }

  const filtered = declarations.filter((decl) => decl.prop !== "--md-primary-color" && decl.prop !== "--blockquote-background");

  const serialized = serializeStyleDeclarations(filtered);
  if (serialized) {
    element.setAttribute("style", serialized);
  } else {
    element.removeAttribute("style");
  }
}

interface StyleDeclaration {
  prop: string;
  value: string;
}

function parseStyleDeclarations(style: string): StyleDeclaration[] {
  if (!style) return [];
  return style
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      const colonIndex = item.indexOf(":");
      if (colonIndex === -1) {
        return null;
      }
      const prop = item.slice(0, colonIndex).trim();
      const value = item.slice(colonIndex + 1).trim();
      if (!prop) {
        return null;
      }
      return { prop, value } as StyleDeclaration | null;
    })
    .filter((item): item is StyleDeclaration => Boolean(item));
}

function serializeStyleDeclarations(declarations: StyleDeclaration[]): string {
  return declarations
    .map((decl) => `${decl.prop}: ${decl.value}`)
    .join("; ");
}

function replaceColorMix(value: string, primaryColor: string, rgb: RGBColor | null): string {
  const colorPattern = /color-mix\(\s*in\s+srgb\s*,\s*var\(--md-primary-color\)\s*([0-9]+(?:\.[0-9]+)?)%\s*,\s*transparent(?:\s*[0-9]+(?:\.[0-9]+)?)?\s*\)/gi;
  const replacementColor = rgb ? (alpha: number) => formatRgba(rgb, alpha) : () => primaryColor;

  return value.replace(colorPattern, (_match, percentRaw: string) => {
    const percent = Number(percentRaw);
    if (Number.isNaN(percent)) {
      return primaryColor;
    }
    const alpha = Math.max(0, Math.min(1, percent / 100));
    return replacementColor(alpha);
  });
}

function formatRgba(rgb: RGBColor, alpha: number): string {
  const formattedAlpha = alpha === 0 || alpha === 1
    ? `${alpha}`
    : alpha.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${formattedAlpha})`;
}

function removeStyleProperties(style: string, properties: string[]): string {
  if (!style) {
    return "";
  }
  const normalizedProps = properties.map((prop) => prop.toLowerCase());
  const filtered = parseStyleDeclarations(style).filter((decl) => !normalizedProps.includes(decl.prop.toLowerCase()));
  return serializeStyleDeclarations(filtered);
}

function appendStyleDeclarations(style: string, declarations: string[]): string {
  const existing = parseStyleDeclarations(style);
  const baseProps = new Set(existing.map(({ prop }) => prop.toLowerCase()));

  declarations.forEach((declaration) => {
    const colonIndex = declaration.indexOf(":");
    if (colonIndex === -1) {
      return;
    }
    const prop = declaration.slice(0, colonIndex).trim();
    const value = declaration.slice(colonIndex + 1).trim();
    if (!prop) return;
    const lower = prop.toLowerCase();
    if (baseProps.has(lower)) {
      const target = existing.find((item) => item.prop.toLowerCase() === lower);
      if (target) {
        target.value = value;
      }
    } else {
      existing.push({ prop, value });
      baseProps.add(lower);
    }
  });

  return serializeStyleDeclarations(existing);
}

async function copyWechatContent(html: string): Promise<boolean> {
  // 与参考项目完全一致的复制逻辑
  const attempts: Array<() => Promise<boolean>> = [];

  if (navigator?.clipboard && "write" in navigator.clipboard) {
    attempts.push(async () => {
      try {
        const value = new Blob([html], { type: "text/html" });
        // @ts-expect-error ClipboardItem legacy types
        const item = new ClipboardItem({ "text/html": value, "text/plain": value });
        await navigator.clipboard.write([item]);
        return true;
      } catch (error) {
        console.warn("ClipboardItem 写入失败", error);
        return false;
      }
    });
  }

  attempts.push(async () => {
    try {
      return legacyExecCopy(html, html);
    } catch (error) {
      console.warn("execCommand 复制失败", error);
      return false;
    }
  });

  for (const attempt of attempts) {
    // eslint-disable-next-line no-await-in-loop
    if (await attempt()) {
      return true;
    }
  }
  return false;
}

function transformWeChatMath(root: HTMLElement) {
  const mathContainers = root.querySelectorAll<HTMLElement>("mjx-container");
  mathContainers.forEach((mjx) => {
    if (!mjx.hasAttribute("jax")) {
      return;
    }
    mjx.removeAttribute("jax");
    mjx.removeAttribute("tabindex");
    mjx.removeAttribute("ctxtmenu_counter");
    const svg = mjx.firstElementChild as HTMLElement | null;
    if (!svg) return;
    const width = svg.getAttribute("width");
    const height = svg.getAttribute("height");
    svg.removeAttribute("width");
    svg.removeAttribute("height");
    if (width) svg.style.width = width;
    if (height) svg.style.height = height;
    svg.setAttribute("focusable", "false");

    mjx.querySelectorAll("mjx-assistive-mml").forEach((assistive) => assistive.remove());

    const isBlock = mjx.hasAttribute("display");
    if (isBlock) {
      mjx.removeAttribute("display");
      mjx.style.display = "block";
      mjx.style.margin = "16px 0";
    } else {
      mjx.style.display = "inline-flex";
      mjx.style.alignItems = "center";
    }
  });
}

function transformZhihuMath(root: HTMLElement) {
  const mathContainers = root.querySelectorAll<HTMLElement>("mjx-container");
  mathContainers.forEach((mjx) => {
    const formula = mjx.getAttribute("data-formula") || mjx.getAttribute("data-latex");
    if (!formula) {
      return;
    }
    const isBlock = mjx.hasAttribute("display");
    const suffix = isBlock && !formula.includes("\\tag") ? "\\\\" : "";
    const replacement = `<img class="Formula-image" data-eeimg="true" src="" alt="${formula}${suffix}">`;
    mjx.outerHTML = replacement;
  });
}

function transformJuejinMath(root: HTMLElement) {
  const mathContainers = root.querySelectorAll<HTMLElement>("mjx-container");
  mathContainers.forEach((mjx) => {
    const formula = mjx.getAttribute("data-formula") || mjx.getAttribute("data-latex") || "";
    const isBlock = mjx.hasAttribute("display");
    if (!formula) {
      return;
    }
    if (isBlock) {
      mjx.outerHTML = `<figure><img class="equation" src="https://juejin.im/equation?tex=${formula}" alt=""/></figure>`;
    } else {
      mjx.outerHTML = `<span><img style="display:inline;" class="equation" src="https://juejin.im/equation?tex=${formula}" alt=""/></span>`;
    }
  });
}

function transformJuejinCode(html: string): string {
  // 掘金代码不换行问题 - 与参考项目完全一致的处理逻辑
  const brReg = /<pre([^>])*class="custom"([^>])*>(.*?)<\/pre>/g;
  const brMatchList = html.match(brReg);
  if (brMatchList) {
    for (const item of brMatchList) {
      const content = item
        .replace(/display: -webkit-box;/g, "display: block;") // -webkit-box替换为block
        .replace(/<br>/g, "\n<span/>") // <br>替换为\n<span/>
        .replace(/&nbsp;/g, " "); // 空格转回，不转回遇到 "$ " 情况会出现问题

      html = html.replace(item, content);
    }
  }
  return html;
}

function appendJuejinSuffix(root: HTMLElement) {
  if (root.querySelector(".nice-suffix-juejin-container")) {
    return;
  }
  const paragraph = root.ownerDocument.createElement("p");
  paragraph.id = "nice-suffix-juejin-container";
  paragraph.className = "nice-suffix-juejin-container";
  paragraph.innerHTML = '本文使用 <a href="https://mdnice.com/?from=juejin">mdnice</a> 排版';
  root.appendChild(paragraph);
}

async function copyRichContent(html: string, plainText: string): Promise<boolean> {
  const attempts: Array<() => Promise<boolean>> = [];

  if (navigator?.clipboard && "write" in navigator.clipboard) {
    attempts.push(async () => {
      try {
        const data: Record<string, Blob> = {
          "text/html": new Blob([html], { type: "text/html" }),
          "text/plain": new Blob([plainText], { type: "text/plain" })
        };
        // @ts-expect-error ClipboardItem is not in lib dom typings for older TS targets
        const item = new ClipboardItem(data);
        await navigator.clipboard.write([item]);
        return true;
      } catch (error) {
        console.warn("ClipboardItem 写入失败", error);
        return false;
      }
    });
  }

  if (navigator?.clipboard && "writeText" in navigator.clipboard) {
    attempts.push(async () => {
      try {
        await navigator.clipboard.writeText(plainText);
        return true;
      } catch (error) {
        console.warn("writeText 失败", error);
        return false;
      }
    });
  }

  attempts.push(async () => {
    try {
      const success = legacyExecCopy(html, plainText);
      return success;
    } catch (error) {
      console.warn("execCommand 复制失败", error);
      return false;
    }
  });

  for (const attempt of attempts) {
    // eslint-disable-next-line no-await-in-loop
    if (await attempt()) {
      return true;
    }
  }
  return false;
}

function legacyExecCopy(html: string, plainText: string): boolean {
  const input = document.createElement("textarea");
  input.value = plainText;
  input.style.position = "fixed";
  input.style.top = "-2000px";
  input.style.opacity = "0";
  document.body.appendChild(input);
  input.select();

  const handleCopy = (event: ClipboardEvent) => {
    event.preventDefault();
    event.clipboardData?.setData("text/html", html);
    event.clipboardData?.setData("text/plain", plainText);
  };

  document.addEventListener("copy", handleCopy, { once: true });
  const result = document.execCommand("copy");
  document.removeEventListener("copy", handleCopy);
  input.remove();
  return result;
}

function extractPlainText(root: HTMLElement): string {
  const temp = document.createElement("div");
  temp.innerHTML = root.outerHTML;
  temp.querySelectorAll(".code-snippet__line-index").forEach((element) => element.remove());
  temp.querySelectorAll(".code-snippet__line-number").forEach((element) => element.remove());
  return temp.textContent || temp.innerText || "";
}

function buildExportOverlay(container: HTMLElement): HTMLDivElement {
  const overlay = document.createElement("div");
  overlay.setAttribute("data-export-overlay", "true");
  overlay.style.position = "absolute";
  overlay.style.top = "0";
  overlay.style.left = "0";
  overlay.style.width = "100%";
  overlay.style.height = "100%";
  overlay.style.display = "flex";
  overlay.style.alignItems = "center";
  overlay.style.justifyContent = "center";
  overlay.style.backgroundColor = "rgba(0, 0, 0, 0.45)";
  overlay.style.color = "#fff";
  overlay.style.fontSize = "16px";
  overlay.style.zIndex = "999";
  overlay.textContent = "图片导出中...";

  const host = container.parentElement ?? container;
  const hostStyle = window.getComputedStyle(host);
  if (hostStyle.position === "static") {
    host.style.position = "relative";
  }

  host.appendChild(overlay);
  return overlay;
}
