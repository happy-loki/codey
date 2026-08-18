import type { ReadTimeResults } from '@md/shared/types'

const DEFAULT_WORDS_PER_MINUTE = 300
const TOKEN_MATCHER = /[\u4E00-\u9FFF]|[^\s]+/g

function countTokens(text: string): number {
  if (!text) {
    return 0
  }

  const matches = text.match(TOKEN_MATCHER)
  return matches ? matches.length : 0
}

export function calculateReadingTime(text: string, wordsPerMinute: number = DEFAULT_WORDS_PER_MINUTE): ReadTimeResults {
  const words = countTokens(text)

  if (!words) {
    return {
      text: `0 min read`,
      minutes: 0,
      time: 0,
      words: 0,
    }
  }

  const minutes = words / Math.max(1, wordsPerMinute)
  const time = Math.ceil(minutes * 60 * 1000)
  const roundedMinutes = Math.max(1, Math.ceil(minutes))

  return {
    text: `${roundedMinutes} min read`,
    minutes,
    time,
    words,
  }
}
