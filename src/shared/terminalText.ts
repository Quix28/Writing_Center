/**
 * Note text and file names are untrusted: strip every control character (ESC, CR, C1 codes…) except newline and
 * tab, so nothing written into the Claude Code terminal can end a paste early or press Enter on the writer's behalf.
 */
export const clean = (s: string) => s.replace(/\r\n?/g, '\n').replace(/[\x00-\x08\x0b-\x1f\x7f\x80-\x9f]/g, '')

export const oneLine = (s: string) => clean(s).replace(/[\n\t]+/g, ' ')

/** Bracketed paste: the terminal treats the text as one pasted block instead of typed lines. */
export const paste = (text: string) => `\x1b[200~${clean(text)}\x1b[201~`
