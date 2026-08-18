import type { MarkedExtension } from 'marked'

export interface MarkedKatexOptions {
  nonStandard?: boolean
}

const inlineRule = /^(\${1,2})(?!\$)((?:\\.|[^\\\n])*?(?:\\.|[^\\\n$]))\1(?=[\s?!.,:？！。，：]|$)/
const inlineRuleNonStandard = /^(\${1,2})(?!\$)((?:\\.|[^\\\n])*?(?:\\.|[^\\\n$]))\1/
const blockRule = /^\s{0,3}(\${1,2})[ \t]*\n([\s\S]+?)\n\s{0,3}\1[ \t]*(?:\n|$)/

const INLINE_CLASS = 'mathjax-inline'
const BLOCK_CLASS = 'mathjax-block'

function escapeForText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function escapeForAttr(value: string): string {
  return escapeForText(value)
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function buildMathWrapper(tokenText: string, display: boolean, styleAttr: string): string {
  const trimmed = tokenText.trim()
  const textEscaped = escapeForText(trimmed)
  const attrEscaped = escapeForAttr(trimmed)
  const [open, close] = display ? ['\\[', '\\]'] : ['\\(', '\\)']
  const tag = display ? 'section' : 'span'
  const className = display ? BLOCK_CLASS : INLINE_CLASS

  const attributes: string[] = []
  const styleText = styleAttr?.trim()
  if (styleText) {
    attributes.push(styleText)
  }
  attributes.push(`class="${className}"`)
  attributes.push(`data-math-display="${display ? 'true' : 'false'}"`)
  attributes.push(`data-math-content="${attrEscaped}"`)

  return `<${tag} ${attributes.join(' ')}>${open}${textEscaped}${close}</${tag}>`
}

function inlineKatex(options: MarkedKatexOptions | undefined, renderer: any) {
  const nonStandard = options && options.nonStandard
  const ruleReg = nonStandard ? inlineRuleNonStandard : inlineRule
  return {
    name: `inlineKatex`,
    level: `inline`,
    start(src: string) {
      let index
      let indexSrc = src

      while (indexSrc) {
        index = indexSrc.indexOf(`$`)
        if (index === -1) {
          return
        }
        const f = nonStandard ? index > -1 : index === 0 || indexSrc.charAt(index - 1) === ` `
        if (f) {
          const possibleKatex = indexSrc.substring(index)

          if (possibleKatex.match(ruleReg)) {
            return index
          }
        }

        indexSrc = indexSrc.substring(index + 1).replace(/^\$+/, ``)
      }
    },
    tokenizer(src: string) {
      const match = src.match(ruleReg)
      if (match) {
        return {
          type: `inlineKatex`,
          raw: match[0],
          text: match[2].trim(),
          displayMode: match[1].length === 2,
        }
      }
    },
    renderer,
  }
}

function blockKatex(_options: MarkedKatexOptions | undefined, renderer: any) {
  return {
    name: `blockKatex`,
    level: `block`,
    tokenizer(src: string) {
      const match = src.match(blockRule)
      if (match) {
        return {
          type: `blockKatex`,
          raw: match[0],
          text: match[2].trim(),
          displayMode: match[1].length === 2,
        }
      }
    },
    renderer,
  }
}

export function MDKatex(options: MarkedKatexOptions | undefined, inlineStyle: string, blockStyle: string): MarkedExtension {
  return {
    extensions: [
      inlineKatex(options, (token: any) => buildMathWrapper(token.text, false, inlineStyle)),
      blockKatex(options, (token: any) => `${buildMathWrapper(token.text, true, blockStyle)}\n`),
    ],
  }
}
