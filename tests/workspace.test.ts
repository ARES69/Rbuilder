import { describe, expect, it } from 'vitest'
import { changedWorkspaceFiles, createWorkspace, projectFromWorkspaceFiles, shouldIgnoreWorkspacePath } from '../src/lib/workspace'

describe('workspace primitives', () => {
  it('ignores secrets and generated directories', () => {
    expect(shouldIgnoreWorkspacePath('.env')).toBe(true)
    expect(shouldIgnoreWorkspacePath('.env.local')).toBe(true)
    expect(shouldIgnoreWorkspacePath('node_modules/react/index.js')).toBe(true)
    expect(shouldIgnoreWorkspacePath('src/main.ts')).toBe(false)
  })

  it('creates an isolated baseline and reports edits', () => {
    const workspace = createWorkspace({ files: [{ path: 'src/main.ts', content: 'one' }] }, 'shop')
    workspace.project.files[0]!.content = 'two'
    expect(workspace.metadata.name).toBe('shop')
    expect(changedWorkspaceFiles(workspace)).toEqual([{ path: 'src/main.ts', content: 'two' }])
  })

  it('keeps .rbuilder rules in the imported project', () => {
    const project = projectFromWorkspaceFiles([
      { path: '.rbuilder/rules.md', content: 'Use strict TypeScript.' },
      { path: '.env', content: 'SECRET=hidden' },
    ])
    expect(project.files.map((file) => file.path)).toEqual(['.rbuilder/rules.md'])
  })
})
