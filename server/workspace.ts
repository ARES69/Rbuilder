/**
 * The terminal. Commands run in a scratch copy of the project, never against the
 * app's own source: the virtual project is written to
 * `.freebuff-workspace/project/` and `bash -c <command>` runs there.
 *
 * This is a local developer tool with the developer's own permissions, so the
 * guardrails are honest ones rather than a sandbox: privileged commands and a
 * few destructive patterns are refused, there is a wall-clock timeout, and
 * output is capped. Anything stronger needs a container.
 */

import { spawn } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

export const WORKSPACE_DIR = '.freebuff-workspace'
export const PROJECT_SUBDIR = 'project'
export const MAX_OUTPUT_BYTES = 64 * 1024
export const COMMAND_TIMEOUT_MS = 20_000
export const MAX_COMMAND_LENGTH = 400

export type CommandFile = { path: string; content: string }

export type CommandEvent =
  | { type: 'stdout'; text: string }
  | { type: 'stderr'; text: string }
  | { type: 'exit'; code: number | null; timedOut: boolean }
  | { type: 'error'; message: string }

const BLOCKED: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /\bsudo\b/i, reason: 'privileged commands are not available here' },
  { pattern: /\bdoas\b/i, reason: 'privileged commands are not available here' },
  { pattern: /\bpkexec\b/i, reason: 'privileged commands are not available here' },
  { pattern: /-Verb\s+RunAs/i, reason: 'privileged commands are not available here' },
  { pattern: /\brm\s+(-[a-z]*\s+)*-[a-z]*r[a-z]*f?\s+(\/|~|\$HOME)/i, reason: 'refusing to delete outside the workspace' },
  { pattern: /:\s*\(\s*\)\s*\{/, reason: 'refusing fork bombs' },
  { pattern: /\bmkfs\b/i, reason: 'refusing disk formatting' },
  { pattern: /\bdd\s+if=/i, reason: 'refusing raw disk writes' },
  { pattern: /\/dev\/sd[a-z]/i, reason: 'refusing raw disk writes' },
  { pattern: /\b(shutdown|reboot|halt)\b/i, reason: 'refusing to stop the machine' },
  { pattern: /\bgit\s+push\b/i, reason: 'refusing to push anywhere from the preview terminal' },
]

export function refusalFor(command: string): string | null {
  const trimmed = command.trim()
  if (!trimmed) return 'Type a command first.'
  if (trimmed.length > MAX_COMMAND_LENGTH) {
    return `Commands are limited to ${MAX_COMMAND_LENGTH} characters.`
  }
  for (const entry of BLOCKED) {
    if (entry.pattern.test(trimmed)) return `Blocked: ${entry.reason}.`
  }
  return null
}

/** Rejects absolute paths and traversal so nothing is written outside the workspace. */
export function safeRelativePath(candidate: string): string | null {
  const value = candidate.trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '')
  if (!value) return null
  if (/^[a-zA-Z]:/.test(value)) return null
  if (value.split('/').some((segment) => segment === '..' || segment === '')) return null
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(value)) return null
  return value
}

/** Writes the project into the workspace and returns the directory to run in. */
export async function materializeProject(root: string, files: CommandFile[]): Promise<string> {
  const projectDir = path.join(root, WORKSPACE_DIR, PROJECT_SUBDIR)
  await mkdir(projectDir, { recursive: true })

  for (const file of files) {
    const relative = safeRelativePath(file.path)
    if (!relative) continue

    const target = path.join(projectDir, relative)
    await mkdir(path.dirname(target), { recursive: true })
    await writeFile(target, file.content, 'utf8')
  }

  return projectDir
}

export function runCommand(
  command: string,
  cwd: string,
  onEvent: (event: CommandEvent) => void,
): Promise<void> {
  return new Promise((resolve) => {
    let bytes = 0
    let finished = false
    let timedOut = false

    const child = spawn('bash', ['-c', command], {
      cwd,
      env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' },
    })

    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
    }, COMMAND_TIMEOUT_MS)

    const emit = (event: CommandEvent) => {
      if (finished) return
      onEvent(event)
    }

    const forward = (type: 'stdout' | 'stderr') => (chunk: Buffer) => {
      if (bytes > MAX_OUTPUT_BYTES) return
      bytes += chunk.length
      const text = chunk.toString('utf8')
      if (bytes > MAX_OUTPUT_BYTES) {
        emit({ type, text: `${text}\n… output truncated at ${MAX_OUTPUT_BYTES / 1024} KB` })
        child.kill('SIGKILL')
        return
      }
      emit({ type, text })
    }

    child.stdout.on('data', forward('stdout'))
    child.stderr.on('data', forward('stderr'))

    child.on('error', (error) => {
      clearTimeout(timer)
      finished = true
      emit({
        type: 'error',
        message:
          error.message.includes('ENOENT')
            ? 'No shell available on this machine (bash was not found).'
            : error.message,
      })
      emit({ type: 'exit', code: null, timedOut })
      resolve()
    })

    child.on('close', (code) => {
      clearTimeout(timer)
      finished = true
      emit({ type: 'exit', code, timedOut })
      resolve()
    })
  })
}
