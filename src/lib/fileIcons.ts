/**
 * File-type glyphs shared by the transcript, the inspector and the code tree —
 * one tone per extension, in the spirit of zcode's material icons.
 */

export function fileGlyphClass(path: string): string {
  const extension = path.slice(path.lastIndexOf('.') + 1).toLowerCase()
  if (extension === 'htm') return 'html'
  if (extension === 'mjs') return 'js'
  if (extension === 'tsx') return 'ts'
  if (['html', 'css', 'js', 'ts', 'json'].includes(extension)) return extension
  return 'other'
}

export function fileGlyph(path: string): string {
  switch (fileGlyphClass(path)) {
    case 'html':
      return '\u25C9'
    case 'css':
      return '\u25A0'
    case 'js':
      return '\u25CF'
    case 'ts':
      return '\u25B2'
    case 'json':
      return '\u25A6'
    default:
      return '\u25AB'
  }
}
