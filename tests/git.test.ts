import { describe, expect, it } from 'vitest'
import { changeLabel, GIT_STATE_COMMAND, gitCommitCommand, gitTone, parseGitState } from '../src/lib/git'

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
})
