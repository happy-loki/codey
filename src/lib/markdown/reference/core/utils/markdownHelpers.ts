import type { ReadTimeResults, RendererAPI } from '@md/shared/types'
import DOMPurify from 'isomorphic-dompurify'
import { marked } from 'marked'

/**
 * 渲染 Markdown 内容
 * @param raw - 原始 markdown 字符串
 * @param renderer - 渲染器 API
 * @returns 渲染结果，包含 HTML 和阅读时间
 */
export function renderMarkdown(raw: string, renderer: RendererAPI) {
  // 解析 front-matter 和正文
  const { markdownContent, readingTime }
    = renderer.parseFrontMatterAndContent(raw)

  // marked -> html
  let html = marked.parse(markdownContent) as string
  html = escapeRawTextElements(html)

  // XSS 处理
  html = DOMPurify.sanitize(html, { ADD_TAGS: [`mp-common-profile`] })

  return { html, readingTime }
}

/**
 * 后处理 HTML 内容
 * @param baseHtml - 基础 HTML 字符串
 * @param reading - 阅读时间结果
 * @param renderer - 渲染器 API
 * @returns 处理后的 HTML 字符串
 */
export function postProcessHtml(baseHtml: string, reading: ReadTimeResults, renderer: RendererAPI): string {
  let html = `${renderer.buildReadingTime(reading)}${baseHtml}`

  html += renderer.buildFootnotes()
  html += renderer.buildAddition()
  html += `
    <style>
      .code__pre {
        padding: 0 !important;
      }

      .hljs.code__pre code {
        display: -webkit-box;
        padding: 0.5em 1em 1em;
        overflow-x: auto;
        text-indent: 0;
      }
      h2 strong {
        color: inherit !important;
      }
    </style>
  `

  const wrapped = renderer.createContainer(html)

  if (typeof window === 'undefined' || typeof DOMParser === 'undefined') {
    return applyMarginResetFallback(wrapped)
  }

  try {
    const parser = new DOMParser()
    const doc = parser.parseFromString(wrapped, 'text/html')
    const container = doc.body.firstElementChild as HTMLElement | null

    if (container) {
      container.setAttribute('style', overrideStyleDeclaration(container.getAttribute('style') ?? '', 'margin-top', '0 !important'))

      const firstElement = findFirstRenderableElement(container)
      if (firstElement) {
        firstElement.setAttribute(
          'style',
          overrideStyleDeclaration(firstElement.getAttribute('style') ?? '', 'margin-top', '0 !important'),
        )
      }
    }

    return doc.body.innerHTML
  }
  catch (error) {
    console.warn('Failed to normalize markdown container styles', error)
    return applyMarginResetFallback(wrapped)
  }
}

function applyMarginResetFallback(wrappedHtml: string): string {
  if (!wrappedHtml.includes('style="')) {
    return wrappedHtml
  }

  let adjusted = wrappedHtml.replace(/style="([^"]*)"/, (_, style: string) => {
    return `style="${overrideStyleDeclaration(style, 'margin-top', '0 !important')}"`
  })

  adjusted = adjusted.replace(/(<section[^>]*>\s*)(<[^>]+style=")([^"]*)(")/, (_, prefix: string, open: string, style: string, close: string) => {
    return `${prefix}${open}${overrideStyleDeclaration(style, 'margin-top', '0 !important')}${close}`
  })

  if (!/<section[^>]*>\s*<[^>]+style="/.test(adjusted)) {
    adjusted = adjusted.replace(/(<section[^>]*>\s*<[^>]+)(>)/, (_, start: string, end: string) => {
      return `${start} style="margin-top: 0 !important;"${end}`
    })
  }

  return adjusted
}

function findFirstRenderableElement(parent: HTMLElement): HTMLElement | null {
  let current = parent.firstElementChild as HTMLElement | null

  while (current) {
    if (current.tagName !== 'STYLE' && current.tagName !== 'SCRIPT') {
      return current
    }
    current = current.nextElementSibling as HTMLElement | null
  }

  return null
}

function overrideStyleDeclaration(style: string, property: string, value: string): string {
  const trimmed = style.trim()
  const sanitizedProperty = escapeRegExp(property)
  const propertyRegex = new RegExp(`(?:^|;)\\s*${sanitizedProperty}\\s*:[^;]*;?`, 'gi')
  const cleaned = trimmed.replace(propertyRegex, '').replace(/;;+/g, ';').trim()
  const normalized = cleaned.length === 0 ? '' : cleaned.endsWith(';') ? cleaned : `${cleaned};`
  return `${normalized}${property}: ${value};`
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * 修改 HTML 内容
 * @param content - 原始内容
 * @param renderer - 渲染器 API
 * @returns 修改后的 HTML 字符串
 */
export function modifyHtmlContent(content: string, renderer: RendererAPI): string {
  const {
    markdownContent,
    readingTime: readingTimeResult,
  } = renderer.parseFrontMatterAndContent(content)

  let html = marked.parse(markdownContent) as string
  html = escapeRawTextElements(html)
  html = DOMPurify.sanitize(html, {
    ADD_TAGS: [`mp-common-profile`],
  })
  return postProcessHtml(html, readingTimeResult, renderer)
}

function escapeRawTextElements(html: string): string {
  return html.replace(/<(\/?)(script|style)(\b[^>]*)?>/gi, (_match, slash: string, tag: string, attrs: string = ``) => {
    const prefix = slash || ``
    const attributeText = attrs || ``
    return `&lt;${prefix}${tag}${attributeText}&gt;`
  })
}
