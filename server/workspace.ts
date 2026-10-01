/**
 * The terminal. Commands run in a scratch copy of the project, never against the
 * app's own source: the virtual project is written to
 * `.freebuff-workspace/project/` and a shell runs the command there.
 *
 * The interpreter is `bash -c` when one is installed — that keeps the dev
 * experience identical on macOS, Linux and Windows-with-Git-Bash — and falls back
 * to the platform shell (cmd.exe, then PowerShell) otherwise, because the packaged
 * application must have a working terminal on a machine without Git too.
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

export type ShellCommand = { file: string; args: string[] }

/**
 * Shells to try, in order. `RBUILDER_SHELL` overrides the first one so a
 * developer can point the terminal at zsh, sh or a specific bash build.
 */
export function shellCandidates(command: string): ShellCommand[] {
  const override = process.env.RBUILDER_SHELL?.trim()
  const posix: ShellCommand = { file: override || 'bash', args: ['-c', command] }

  if (process.platform !== 'win32') return [posix]

  const comspec = process.env.ComSpec?.trim() || 'cmd.exe'
  return [
    posix,
    { file: comspec, args: ['/d', '/s', '/c', command] },
    { file: 'powershell.exe', args: ['-NoProfile', '-NonInteractive', '-Command', command] },
  ]
}

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

/** Writes the project into the scratch workspace and returns the directory to run in. */
export async function materializeProject(root: string, files: CommandFile[]): Promise<string> {
  const projectDir = path.join(root, WORKSPACE_DIR, PROJECT_SUBDIR)
  return writeProjectInto(projectDir, files)
}

/**
 * Writes `files` directly into `dir` — the folder the user bound to this
 * project — and returns it. The bound folder is the real home of the project,
 * so a terminal command sees exactly what the model wrote.
 */
export async function writeProjectInto(dir: string, files: CommandFile[]): Promise<string> {
  await mkdir(dir, { recursive: true })

  for (const file of files) {
    const relative = safeRelativePath(file.path)
    if (!relative) continue

    const target = path.join(dir, relative)
    await mkdir(path.dirname(target), { recursive: true })
    await writeFile(target, file.content, 'utf8')
  }

  return dir
}

export function runCommand(
  command: string,
  cwd: string,
  onEvent: (event: CommandEvent) => void,
): Promise<void> {
  const shells = shellCandidates(command)
  let bytes = 0

  const attempt = (index: number): Promise<void> =>
    new Promise((resolve) => {
      const shell = shells[index] ?? shells[shells.length - 1]!
      let finished = false
      let timedOut = false

      const child = spawn(shell.file, shell.args, {
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

        // A missing interpreter is not a failed command: try the next shell.
        if ((error as NodeJS.ErrnoException).code === 'ENOENT' && index < shells.length - 1) {
          finished = true
          resolve(attempt(index + 1))
          return
        }

        // The closing event must not be swallowed by the guard, so it is handed
        // over before the command is considered finished.
        emit({
          type: 'error',
          message: (error as NodeJS.ErrnoException).code === 'ENOENT'
            ? 'No shell available on this machine (bash, cmd and PowerShell were all missing).'
            : error.message,
        })
        emit({ type: 'exit', code: null, timedOut })
        finished = true
        resolve()
      })

      child.on('close', (code) => {
        clearTimeout(timer)
        emit({ type: 'exit', code, timedOut })
        finished = true
        resolve()
      })
    })

  return attempt(0)
}
