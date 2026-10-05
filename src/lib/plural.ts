/**
 * Russian counts.
 *
 * The interface is Russian, and a number in Russian takes three forms: `1 файл`,
 * `2 файла`, `5 файлов`. Getting it wrong is the sort of thing that reads as a
 * machine-translated app even when every other word is fine, and the rule is
 * easy to get subtly wrong: it keys on the last two digits, not the last one.
 */

/** `1`, `2`, `5` — which form a count takes. */
export type PluralForm = 'one' | 'few' | 'many'

/**
 * Which form `count` takes.
 *
 * - `one`: ends in 1, except 11 (`1 файл`, `21 файл`, but `11 файлов`)
 * - `few`: ends in 2–4, except 12–14 (`2 файла`, `23 файла`, but `12 файлов`)
 * - `many`: everything else (`5 файлов`, `11 файлов`, `100 файлов`)
 *
 * A count below zero is nonsense as a noun phrase, so it is read as an absolute
 * value rather than returning something undefined.
 */
export function pluralForm(count: number): PluralForm {
  const n = Math.abs(Math.trunc(count))
  const lastTwo = n % 100
  const last = n % 10
  if (lastTwo >= 11 && lastTwo <= 14) return 'many'
  if (last === 1) return 'one'
  if (last >= 2 && last <= 4) return 'few'
  return 'many'
}

/** `1 файл`, `2 файла`, `5 файлов` — the count and its word. */
export function withCount(count: number, one: string, few: string, many: string): string {
  return `${count} ${plural(count, one, few, many)}`
}

/** `файлом`, `файлами`, `файлами` — the word alone, for a count printed elsewhere. */
export function plural(count: number, one: string, few: string, many: string): string {
  switch (pluralForm(count)) {
    case 'one':
      return one
    case 'few':
      return few
    default:
      return many
  }
}