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

export function totalDiff(diffs: LineDiff[]): LineDiff {
  return diffs.reduce(
    (sum, entry) => ({ added: sum.added + entry.added, removed: sum.removed + entry.removed }),
    { added: 0, removed: 0 },
  )
}
