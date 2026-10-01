/**
 * A cheap line-set diff: enough to print `+N −N` the way the Git tools card
 * does, without shipping a real diff library into the browser bundle.
 *
 * `before` is null for a file the turn created.
 */

export type LineDiff = { added: number; removed: number }

export function lineDiff(before: string | null, after: string): LineDiff {
  const beforeLines = before === null ? [] : before.split('\n')
  const afterLines = after.split('\n')
  const beforeSet = new Set(beforeLines)
  const afterSet = new Set(afterLines)

  return {
    added: afterLines.filter((line) => line.trim() && !beforeSet.has(line)).length,
    removed: beforeLines.filter((line) => line.trim() && !afterSet.has(line)).length,
  }
}

/** One line of a rendered diff, for the colored diff view. */
export type DiffLine = { kind: 'same' | 'add' | 'del'; text: string }

/** Beyond this much churn the LCS walk is skipped and the block is shown whole. */
const MAX_LCS_AREA = 240_000

/**
 * A line diff good enough to paint: common prefix and suffix are peeled off,
 * the middle goes through an LCS walk, and a rewrite too big to walk is shown
 * as one block of removed lines followed by one of added lines.
 */
export function diffLines(before: string | null, after: string): DiffLine[] {
  const beforeLines = before === null ? [] : before.split('\n')
  const afterLines = after.split('\n')

  let prefix = 0
  while (
    prefix < beforeLines.length &&
    prefix < afterLines.length &&
    beforeLines[prefix] === afterLines[prefix]
  )
    prefix += 1

  let suffix = 0
  while (
    suffix < beforeLines.length - prefix &&
    suffix < afterLines.length - prefix &&
    beforeLines[beforeLines.length - 1 - suffix] === afterLines[afterLines.length - 1 - suffix]
  )
    suffix += 1

  const same = (text: string): DiffLine => ({ kind: 'same', text })
  const head = beforeLines.slice(0, prefix).map(same)
  const tail = suffix > 0 ? beforeLines.slice(beforeLines.length - suffix).map(same) : []

  const removed = beforeLines.slice(prefix, beforeLines.length - suffix)
  const added = afterLines.slice(prefix, afterLines.length - suffix)

  if (removed.length * added.length > MAX_LCS_AREA) {
    return [
      ...head,
      ...removed.map((text): DiffLine => ({ kind: 'del', text })),
      ...added.map((text): DiffLine => ({ kind: 'add', text })),
      ...tail,
    ]
  }

  return [...head, ...lcsMiddle(removed, added), ...tail]
}

/** LCS walk over the unshared middle of two files. */
function lcsMiddle(before: string[], after: string[]): DiffLine[] {
  const rows = before.length
  const columns = after.length

  // dp[i][j] = LCS length of before[i..] against after[j..]
  const dp: number[][] = Array.from({ length: rows + 1 }, () => new Array<number>(columns + 1).fill(0))
  for (let i = rows - 1; i >= 0; i -= 1) {
    for (let j = columns - 1; j >= 0; j -= 1) {
      dp[i][j] = before[i] === after[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }

  const lines: DiffLine[] = []
  let i = 0
  let j = 0
  while (i < rows && j < columns) {
    if (before[i] === after[j]) {
      lines.push({ kind: 'same', text: before[i] })
      i += 1
      j += 1
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      lines.push({ kind: 'del', text: before[i] })
      i += 1
    } else {
      lines.push({ kind: 'add', text: after[j] })
      j += 1
    }
  }
  while (i < rows) {
    lines.push({ kind: 'del', text: before[i] })
    i += 1
  }
  while (j < columns) {
    lines.push({ kind: 'add', text: after[j] })
    j += 1
  }
  return lines
}

export function totalDiff(diffs: LineDiff[]): LineDiff {
  return diffs.reduce(
    (sum, entry) => ({ added: sum.added + entry.added, removed: sum.removed + entry.removed }),
    { added: 0, removed: 0 },
  )
}
