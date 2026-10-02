import { describe, expect, it } from 'vitest'
import {
  changeLabel,
  GIT_STATE_COMMAND,
  gitCheckoutCommand,
  gitCommitCommand,
  gitDiffCommand,
  gitInitCommand,
  gitTagCommand,
  gitTone,
  isGitUsable,
  parseGitExtra,
  parseGitState,
  parseUnifiedDiff,
} from '../src/lib/git'

describe('git initialization', () => {
  it('creates a repository in the folder the task is bound to', () => {
    expect(gitInitCommand('C:/work/site')).toBe('git init -q -b main 2>/dev/null || git init -q')
    expect(isGitUsable('C:/work/site')).toBe(true)
  })

  it('refuses to create one for an unbound task', () => {
    // Without a folder the command would run in `.freebuff-workspace/project`,
    // which is rewritten on every command. The repository would vanish with the
    // next run, and until then the panel reports a branch that owns nothing.
    expect(gitInitCommand(null)).toBeNull()
    expect(isGitUsable(null)).toBe(false)
  })

  it('does not treat an empty folder as bound', () => {
    expect(gitInitCommand('')).toBeNull()
    expect(isGitUsable('')).toBe(false)
  })
})

describe('git state parsing', () => {
  it('reads branch, changes and last commit out of one command', () => {
    const output = [
      'RB_REPO',
      'RB_BRANCH',
      'main',
      'RB_STATUS',
      ' M src/App.tsx',
      '?? notes.md',
      'D  removed.css',
      'RB_LOG',
      'a1b2c3d Add the export view',
      '',
    ].join('\n')

    const state = parseGitState(output)
    expect(state.isRepo).toBe(true)
    expect(state.branch).toBe('main')
    expect(state.lastCommit).toBe('a1b2c3d Add the export view')
    expect(state.changes.map((change) => change.path)).toEqual([
      'src/App.tsx',
      'notes.md',
      'removed.css',
    ])
  })

  it('reports a directory that is not its own repository', () => {
    const state = parseGitState('RB_NO_REPO\nRB_BRANCH\nRB_STATUS\nRB_LOG\n')
    expect(state.isRepo).toBe(false)
    expect(state.branch).toBeNull()
    expect(state.changes).toEqual([])
    expect(gitTone(state)).toBe('missing')
  })

  it('ignores the enclosing repository output when there is no .git of its own', () => {
    // `git rev-parse` would answer for the application checkout; the marker keeps
    // the panel honest about the scratch workspace.
    const state = parseGitState('RB_NO_REPO\nRB_STATUS\n')
    expect(state.isRepo).toBe(false)
    expect(state.changes).toEqual([])
  })

  it('tells a clean tree from a dirty one', () => {
    expect(gitTone({ isRepo: true, branch: 'main', changes: [], lastCommit: null })).toBe('clean')
    expect(
      gitTone({ isRepo: true, branch: 'main', changes: [{ index: ' ', worktree: 'M', path: 'a' }], lastCommit: null }),
    ).toBe('dirty')
  })

  it('labels porcelain status codes for the list', () => {
    expect(changeLabel({ index: '?', worktree: '?', path: 'new.md' })).toBe('A')
    expect(changeLabel({ index: ' ', worktree: 'M', path: 'a.ts' })).toBe('M')
    expect(changeLabel({ index: 'D', worktree: ' ', path: 'gone.ts' })).toBe('D')
    expect(changeLabel({ index: 'R', worktree: ' ', path: 'moved.ts' })).toBe('R')
    expect(changeLabel({ index: 'U', worktree: 'U', path: 'conflict.ts' })).toBe('C')
  })
})

describe('git commands', () => {
  it('asks about the workspace repository first', () => {
    expect(GIT_STATE_COMMAND).toContain('[ -d .git ]')
    expect(GIT_STATE_COMMAND).toContain('git status --porcelain')
  })

  it('passes an identity so a commit never depends on global config', () => {
    const command = gitCommitCommand('first checkpoint')
    expect(command).toContain('user.name=RBUILDER')
    expect(command).toContain('add -A &&')
    expect(command).toContain('commit -q -m "first checkpoint"')
  })

  it('keeps quotes in a message from breaking the shell command', () => {
    const command = gitCommitCommand('fix "quoted" thing')
    expect(command).toContain(`fix 'quoted' thing`)
    expect(command.match(/"/g)).toHaveLength(2)
  })

  it('quotes a diff path so it cannot become a second command', () => {
    // A path reaches this from `git status`; quoting keeps the shell from
    // reading the rest of it as syntax.
    expect(gitDiffCommand('src/app.ts')).toBe(`git --no-pager diff --no-color -- 'src/app.ts'`)
    // A legitimate name with a space survives: filtering would have mangled it.
    expect(gitDiffCommand('my notes.md')).toBe(`git --no-pager diff --no-color -- 'my notes.md'`)
    // Only an embedded quote or a newline can break out of the quotes.
    expect(gitDiffCommand("it's")).toBe('true')
    expect(gitDiffCommand('a\nb')).toBe('true')
  })

  it('refuses an unsafe branch or tag name instead of guessing', () => {
    expect(gitCheckoutCommand('feature/login')).toContain(`git checkout -q -- 'feature/login'`)
    expect(gitCheckoutCommand('feature/login')).toContain(`-b -- 'feature/login'`)
    expect(gitTagCommand('v1.0')).toBe(`git tag -- 'v1.0'`)
    expect(gitCheckoutCommand('$(whoami)')).toBe(`git checkout -q -- '$(whoami)' 2>/dev/null || git checkout -q -b -- '$(whoami)'`)
    expect(gitTagCommand('  ')).toBe('true')
    expect(gitTagCommand('')).toBe('true')
  })
})

describe('git extras parsing', () => {
  it('reads branches, tags, remote, tracking and history in one round trip', () => {
    const output = [
      'RB_BRANCHES',
      'main',
      'feature/login',
      'RB_TAGS',
      'v0.1.5',
      'RB_REMOTE',
      'git@github.com:ARES69/Rbuilder.git',
      'RB_TRACKING',
      'origin/main',
      'RB_LOG',
      'a1b2c3dARES692026-10-01Move tasks to IndexedDB',
      'b786ab2ARES692026-10-02Watch the project folder',
      '',
    ].join('\n')

    const extra = parseGitExtra(output)
    expect(extra.branches).toEqual(['main', 'feature/login'])
    expect(extra.tags).toEqual(['v0.1.5'])
    expect(extra.remote).toBe('git@github.com:ARES69/Rbuilder.git')
    expect(extra.tracking).toBe('origin/main')
    expect(extra.commits.map((commit) => commit.subject)).toEqual([
      'Move tasks to IndexedDB',
      'Watch the project folder',
    ])
    expect(extra.commits[0]!.hash).toBe('a1b2c3d')
  })

  it('treats a fresh repository as empty rather than broken', () => {
    // `git init` with no commit: every section answers nothing, and that is a
    // normal state the panel has to render.
    const extra = parseGitExtra('RB_BRANCHES\nRB_TAGS\nRB_REMOTE\nRB_TRACKING\nRB_LOG\n')
    expect(extra.branches).toEqual([])
    expect(extra.tags).toEqual([])
    expect(extra.remote).toBeNull()
    expect(extra.tracking).toBeNull()
    expect(extra.commits).toEqual([])
  })

  it('skips a log line that is missing a field', () => {
    const extra = parseGitExtra('RB_LOG\nonly-a-hash\n')
    expect(extra.commits).toEqual([])
  })

  it('flags a branch that diverged from its upstream', () => {
    // porcelain=v2 reports `branch.ab +N -M`, not the word "ahead".
    expect(parseGitExtra('RB_SYNC\n# branch.ab +1 -0\n').outOfSync).toBe(true)
    expect(parseGitExtra('RB_SYNC\n# branch.ab +0 -3\n').outOfSync).toBe(true)
    expect(parseGitExtra('RB_SYNC\n# branch.ab +0 -0\n').outOfSync).toBe(false)
    // No upstream at all: nothing to be out of sync with.
    expect(parseGitExtra('RB_SYNC\n').outOfSync).toBe(false)
  })
})

describe('unified diff parsing', () => {
  it('tags added, removed, context and meta lines', () => {
    const lines = parseUnifiedDiff(
      [
        'diff --git a/index.html b/index.html',
        'index 1234567..89abcde 100644',
        '--- a/index.html',
        '+++ b/index.html',
        '@@ -1,3 +1,3 @@',
        ' <h1>one</h1>',
        '-<p>old</p>',
        '+<p>new</p>',
        ' <footer/>',
      ].join('\n'),
    )

    expect(lines.filter((line) => line.kind === 'add').map((line) => line.text)).toEqual([
      '+<p>new</p>',
    ])
    expect(lines.filter((line) => line.kind === 'remove').map((line) => line.text)).toEqual([
      '-<p>old</p>',
    ])
    expect(lines.filter((line) => line.kind === 'context')).toHaveLength(2)
    // The hunk header stays visible so the reader knows the range it covers.
    expect(lines.some((line) => line.text.startsWith('@@'))).toBe(true)
  })

  it('returns nothing when the file matches HEAD', () => {
    expect(parseUnifiedDiff('')).toEqual([])
    expect(parseUnifiedDiff('\n\n')).toEqual([])
  })
})
