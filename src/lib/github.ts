/**
 * GitHub: who you are, what you can push to, and how git is told about it.
 *
 * The panel talks to the REST API directly. GitHub answers with
 * `Access-Control-Allow-Origin: *`, so this works from the desktop webview and
 * from a browser tab alike; the requests carry a token in a header and no
 * cookies, which is exactly the case `*` is allowed for.
 *
 * The token itself is never put in a remote URL. A URL ending up in
 * `.git/config` is a credential written to disk in plain text and shared with
 * every clone; instead git is handed an `http.extraHeader` for the one command
 * that needs it, and the remote stays a plain `https://github.com/owner/repo`.
 */

const API_ROOT = 'https://api.github.com'

/** The page GitHub offers for minting a token with exactly the scopes used. */
export const TOKEN_URL =
  'https://github.com/settings/tokens/new?scopes=repo&description=RBuilder'

export type GitHubAccount = {
  login: string
  /** Display name, when the account has one. */
  name: string | null
}

export type GitHubRepo = {
  /** `owner/name`, the only form both the API and a remote URL agree on. */
  fullName: string
  private: boolean
  description: string | null
  updatedAt: string
}

export type GitHubResult<T> = { ok: true; value: T } | { ok: false; error: string }

/** GitHub's own error messages are more useful than any translation of them. */
async function request<T>(
  token: string,
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<GitHubResult<T>> {
  let response: Response
  try {
    response = await fetch(`${API_ROOT}${path}`, {
      method: init.method ?? 'GET',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: init.body ? JSON.stringify(init.body) : undefined,
    })
  } catch (error) {
    return { ok: false, error: `GitHub недоступен: ${describe(error)}` }
  }

  if (response.status === 401) {
    return { ok: false, error: 'Токен не принят GitHub — проверьте его и попробуйте снова.' }
  }
  if (!response.ok) {
    const detail = await errorMessage(response)
    return { ok: false, error: `GitHub ответил ${response.status}${detail ? `: ${detail}` : ''}` }
  }

  try {
    return { ok: true, value: (await response.json()) as T }
  } catch {
    return { ok: false, error: 'GitHub ответил не тем, чем обычно.' }
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function errorMessage(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as { message?: string }
    return payload.message ?? ''
  } catch {
    return ''
  }
}

/** Confirms a token and says whose it is. */
export async function fetchAccount(token: string): Promise<GitHubResult<GitHubAccount>> {
  const result = await request<{ login: string; name: string | null }>(token, '/user')
  if (!result.ok) return result
  return { ok: true, value: { login: result.value.login, name: result.value.name ?? null } }
}

/** The account's own repositories, most recently touched first. */
export async function fetchRepos(token: string): Promise<GitHubResult<GitHubRepo[]>> {
  const result = await request<
    { full_name: string; private: boolean; description: string | null; updated_at: string }[]
  >(token, '/user/repos?per_page=100&sort=updated')
  if (!result.ok) return result
  return {
    ok: true,
    value: result.value.map((repo) => ({
      fullName: repo.full_name,
      private: repo.private,
      description: repo.description,
      updatedAt: repo.updated_at,
    })),
  }
}

/** Creates a repository for the signed-in account and returns its name. */
export async function createRepo(
  token: string,
  name: string,
  isPrivate: boolean,
): Promise<GitHubResult<GitHubRepo>> {
  const result = await request<{
    full_name: string
    private: boolean
    description: string | null
    updated_at: string
  }>(token, '/user/repos', {
    method: 'POST',
    body: { name, private: isPrivate, auto_init: false },
  })
  if (!result.ok) return result
  return {
    ok: true,
    value: {
      fullName: result.value.full_name,
      private: result.value.private,
      description: result.value.description,
      updatedAt: result.value.updated_at,
    },
  }
}

/* ------------------------------------------------------------------ */
/* Names and URLs                                                      */
/* ------------------------------------------------------------------ */

/**
 * A repository name GitHub will accept.
 *
 * GitHub allows letters, digits, `.`, `-` and `_`; everything else is turned
 * into a dash rather than dropped, so `Мой проект` becomes `my-proekt` instead
 * of collapsing to nothing. Cyrillic is transliterated — a repository named in
 * Cyrillic is legal but hard to type on a phone.
 */
export function repoName(raw: string): string {
  const table: Record<string, string> = {
    а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z',
    и: 'i', й: 'j', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r',
    с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch',
    ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
  }
  const cleaned = raw
    .toLowerCase()
    .split('')
    .map((char) => table[char] ?? char)
    .join('')
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-._]+|[-._]+$/g, '')
    .slice(0, 100)
  return cleaned
}

/**
 * `owner/name` out of whatever the user pasted or git has stored: a full name,
 * a repository URL, or the `git@github.com:owner/name.git` remote git writes.
 * Null when there is nothing usable in it.
 */
export function parseRepoRef(input: string): { owner: string; repo: string } | null {
  // A pasted browser URL keeps its trailing slash, and a git remote keeps its
// `.git`; neither is part of the name.
  const trimmed = input.trim().replace(/\.git$/i, '').replace(/\/+$/, '')
  // Both shapes end in `owner/repo`, and the first one also matches the second
  // — `git@github.com:a/b` looks like an owner called `git@github.com:a`. Each
  // candidate is therefore validated before it is accepted, rather than the
  // first match being taken.
  const candidates = [
    /^(?:https?:\/\/[^/]+\/)?([^/\s]+)\/([^/\s]+)$/.exec(trimmed),
    /^git@[^:]+:([^/\s]+)\/([^/\s]+)$/.exec(trimmed),
  ]
  for (const match of candidates) {
    if (!match) continue
    const [, owner, repo] = match
    if (/^[\w.-]+$/.test(owner) && /^[\w.-]+$/.test(repo)) return { owner, repo }
  }
  return null
}

/** The remote URL for a repository, in the form `git remote add` wants. */
export function cloneUrl(fullName: string): string {
  return `https://github.com/${fullName}.git`
}

/** True when a remote points at github.com, and therefore needs our token. */
export function isGitHubRemote(url: string | null): boolean {
  return Boolean(url && /(^https:\/\/github\.com\/|github\.com[:/])/.test(url))
}

/**
 * The git options that authenticate one command against github.com.
 *
 * `x-access-token` is the username GitHub documents for token auth; Basic
 * auth with it is what git itself sends when a credential helper has the token.
 * The base64 alphabet has no quotes, so the value needs no escaping — but it is
 * quoted anyway, because a command string is a shell string.
 */
export function gitAuthArgs(token: string): string {
  const encoded = base64(`x-access-token:${token}`)
  return `-c 'http.https://github.com/.extraheader=Authorization: Basic ${encoded}'`
}

/** `btoa` for the desktop webview and Node alike, without pulling in a polyfill. */
function base64(value: string): string {
  if (typeof btoa === 'function') return btoa(value)
  return Buffer.from(value, 'utf-8').toString('base64')
}