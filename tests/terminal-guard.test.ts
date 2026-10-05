import { describe, expect, it } from 'vitest'
import { MAX_COMMAND_LENGTH, refusalFor, safeRelativePath } from '../server/workspace'

describe('terminal guardrails', () => {
  it('refuses the things a terminal must never do', () => {
    expect(refusalFor('sudo rm -rf /')).toContain('privileged')
    expect(refusalFor('mkfs.ext4 /dev/sda')).toContain('formatting')
    expect(refusalFor('dd if=/dev/zero of=/dev/sda')).toContain('raw disk')
    expect(refusalFor('shutdown -h now')).toContain('stop the machine')
    expect(refusalFor('')).toContain('Type a command')
  })

  it('refuses to push from the terminal, where the command text is all there is', () => {
    // The agent writes this string. Whether a person meant it is not something
    // the command itself can say, so the terminal does not take its word for it.
    expect(refusalFor('git push origin main')).toContain('refusing to push')
    expect(refusalFor('cd repo && git push')).toContain('refusing to push')
  })

  it('lets a push through when the request says a person pressed the button', () => {
    // The Git panel and Sync set this flag; the agent's terminal never does.
    expect(refusalFor('git push -u origin HEAD:main', { allowGitPush: true })).toBeNull()
    expect(refusalFor('git push', { allowGitPush: false })).toContain('refusing to push')
  })

  it('does not let the push exception open anything else', () => {
    expect(refusalFor('git push && sudo apt install', { allowGitPush: true })).toContain('privileged')
  })

  it('caps how long a command may be', () => {
    expect(refusalFor('x'.repeat(MAX_COMMAND_LENGTH + 1))).toContain('limited to')
    expect(refusalFor('x'.repeat(MAX_COMMAND_LENGTH))).toBeNull()
  })

  it('refuses paths that would escape the workspace', () => {
    expect(safeRelativePath('src/main.ts')).toBe('src/main.ts')
    expect(safeRelativePath('./index.html')).toBe('index.html')
    expect(safeRelativePath('../secrets.txt')).toBeNull()
    // A leading slash does not escape: the path is joined onto the workspace
    // directory, so `/etc/passwd` is a file inside the project, not the system
    // one. `..` is the only way out, and that is refused.
    expect(safeRelativePath('/etc/passwd')).toBe('etc/passwd')
    expect(safeRelativePath('C:/Windows/system32')).toBeNull()
  })
})