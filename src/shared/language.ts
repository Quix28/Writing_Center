const EN_FUNCTION_WORDS = new Set(
  'the of and to in is that it for was on with as are this be by not have i you we he she they a an at or but from my your his their what which there been has had were will would can could do does did so if'.split(' ')
)

/**
 * Cheap English check for deciding whether Harper (English-only) should judge a note. Counts common English
 * function words against words with non-English letters (ç ğ ı ş é ñ ä ß …). Works on short notes, where
 * Harper's own detector is unreliable.
 */
export function looksEnglish(text: string): boolean {
  const words = text.toLowerCase().match(/[\p{L}']+/gu) ?? []
  if (words.length < 4) return true
  const english = words.filter((w) => EN_FUNCTION_WORDS.has(w)).length
  const foreignLetters = words.filter((w) => /[^\x00-\x7f]/.test(w)).length
  return english / words.length >= 0.12 && english > foreignLetters
}
