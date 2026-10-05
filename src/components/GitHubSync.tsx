/**
 * GitHub, from the Git panel: sign in, point the folder at a repository, sync.
 *
 * The three things that used to be missing from a project are here in one
 * block, because they are one thing: work that only exists in
 * `Documents\RBuilder\<name>` on one machine is not a project yet.
 *
 * Signing in is a token, not an OAuth dance. A device flow needs an OAuth
 * application registered under a maintainer's account, and this app has none —
 * a flow that cannot be completed is worse than a field that says what it
 * wants. The token is stored by the shell, not in web storage.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { openExternal, readGitHubToken, writeGitHubToken } from '../lib/desktop'
import {
  cloneUrl,
  createRepo,
  fetchAccount,
  fetchRepos,
  parseRepoRef,
  repoName,
  TOKEN_URL,
  type GitHubAccount,
  type GitHubRepo,
} from '../lib/github'
import { connectRemote, syncProject, type SyncStep } from '../lib/sync'

type Props = {
  files: { path: string; content: string }[]
  folder: string | null
  /** The `origin` URL git currently has, when there is one. */
  remote: string | null
  /** The panel re-reads git after the remote changes. */
  onRemoteChanged: () => void
}

export function GitHubSync({ files, folder, remote, onRemoteChanged }: Props) {
  const [token, setToken] = useState<string | null>(null)
  const [account, setAccount] = useState<GitHubAccount | null>(null)
  const [draft, setDraft] = useState('')
  const [repos, setRepos] = useState<GitHubRepo[]>([])
  const [chosen, setChosen] = useState('')
  const [newName, setNewName] = useState('')
  const [isPrivate, setIsPrivate] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [steps, setSteps] = useState<SyncStep[]>([])
  const [summary, setSummary] = useState<string | null>(null)

  /** The repository the folder points at, when it points at GitHub. */
  const bound = useMemo(() => (remote ? parseRepoRef(remote) : null), [remote])

  /** A folder called `my-site` should offer to create `my-site` on GitHub. */
  const suggested = useMemo(
    () => repoName(folder?.split(/[\\/]/).pop() ?? 'rbuilder-project') || 'rbuilder-project',
    [folder],
  )

  const signIn = useCallback(async (value: string) => {
    const candidate = value.trim()
    if (!candidate) return
    setBusy(true)
    setError(null)
    const verified = await fetchAccount(candidate)
    if (!verified.ok) {
      setBusy(false)
      setError(verified.error)
      return
    }
    await writeGitHubToken(candidate)
    setToken(candidate)
    setAccount(verified.value)
    setBusy(false)
  }, [])

  // A stored token is only a claim; the account request is what makes it an
  // identity, and a token GitHub no longer accepts has to be caught here rather
  // than at the first push.
  useEffect(() => {
    let cancelled = false
    void readGitHubToken().then(async (stored) => {
      if (cancelled || !stored) return
      const verified = await fetchAccount(stored)
      if (cancelled) return
      if (verified.ok) {
        setToken(stored)
        setAccount(verified.value)
      } else {
        setError(verified.error)
      }
    })
    return () => {
      cancelled = true
    }
  }, [])

  const signOut = useCallback(async () => {
    await writeGitHubToken(null)
    setToken(null)
    setAccount(null)
    setRepos([])
    setChosen('')
    setError(null)
    setSummary(null)
    setSteps([])
  }, [])

  const loadRepos = useCallback(async () => {
    if (!token) return
    const result = await fetchRepos(token)
    if (result.ok) setRepos(result.value)
    else setError(result.error)
  }, [token])

  const connect = useCallback(
    async (fullName: string) => {
      if (!folder) return
      setBusy(true)
      setError(null)
      setSummary(null)
      const result = await connectRemote(files, folder, cloneUrl(fullName))
      setBusy(false)
      if (!result.ok) {
        setError(result.error ?? 'Не удалось подключить репозиторий.')
        return
      }
      onRemoteChanged()
      setSummary(`Подключён репозиторий ${fullName}. Нажмите Sync, чтобы отправить проект.`)
    },
    [files, folder, onRemoteChanged],
  )

  const create = useCallback(async () => {
    if (!token || !folder) return
    const name = repoName(newName || suggested)
    if (!name) {
      setError('Имя репозитория должно содержать латинские буквы или цифры.')
      return
    }
    setBusy(true)
    setError(null)
    setSummary(null)
    const created = await createRepo(token, name, isPrivate)
    if (!created.ok) {
      setBusy(false)
      setError(created.error)
      return
    }
    const connected = await connectRemote(files, folder, cloneUrl(created.value.fullName))
    setBusy(false)
    if (!connected.ok) {
      setError(
        `${connected.error ?? 'Не удалось подключить репозиторий.'} (${created.value.fullName} создан на GitHub)`,
      )
      return
    }
    onRemoteChanged()
    setSummary(`Создан ${created.value.private ? 'приватный' : 'публичный'} репозиторий ${created.value.fullName}.`)
  }, [token, folder, newName, suggested, isPrivate, files, onRemoteChanged])

  const sync = useCallback(async () => {
    if (!folder) return
    setBusy(true)
    setError(null)
    setSummary(null)
    setSteps([])
    const report = await syncProject({
      files,
      folder,
      token,
      onStep: (step, index) =>
        setSteps((current) => [...current.slice(0, index), step]),
    })
    setSteps(report.steps)
    setSummary(report.summary)
    setBusy(false)
    onRemoteChanged()
  }, [files, folder, token, onRemoteChanged])

  return (
    <div className="github">
      <span className="git-section-label">GitHub</span>

      {account ? (
        <div className="github-row">
          <span className="github-account" title={account.name ?? account.login}>
            <span className="github-dot" aria-hidden="true" />
            {account.login}
          </span>
          <button type="button" className="button button--quiet" onClick={() => void signOut()}>
            Выйти
          </button>
        </div>
      ) : (
        <>
          <p className="dock-note">
            Войдите с токеном GitHub, чтобы отправлять проект в репозиторий и забирать изменения
            одной кнопкой.
          </p>
          <div className="github-row">
            <input
              className="input github-token"
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={draft}
              placeholder="Токен (ghp_…)"
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void signIn(draft)
              }}
            />
            <button
              type="button"
              className="button"
              disabled={busy || !draft.trim()}
              onClick={() => void signIn(draft)}
            >
              {busy ? 'Проверка…' : 'Войти'}
            </button>
          </div>
          <button
            type="button"
            className="button button--quiet"
            onClick={() => void openExternal(TOKEN_URL)}
            title="Открыть страницу создания токена в браузере"
          >
            Как получить токен
          </button>
          <p className="dock-note">
            Нужен classic-токен с правом <code>repo</code>. Он хранится в папке данных приложения,
            а не в браузере, и удаляется кнопкой «Выйти».
          </p>
        </>
      )}

      {account && !bound ? (
        <div className="github-repos">
          <p className="dock-note">
            Папка проекта ещё не подключена к репозиторию. Создайте новый на GitHub или выберите
            существующий.
          </p>
          <div className="github-row">
            <input
              className="input github-token"
              value={newName}
              placeholder={suggested}
              onChange={(event) => setNewName(event.target.value)}
            />
            <label className="github-check">
              <input
                type="checkbox"
                checked={isPrivate}
                onChange={(event) => setIsPrivate(event.target.checked)}
              />
              приватный
            </label>
            <button
              type="button"
              className="button"
              disabled={busy}
              onClick={() => void create()}
            >
              Создать на GitHub
            </button>
          </div>
          {repos.length === 0 ? (
            <button
              type="button"
              className="button button--quiet"
              disabled={busy}
              onClick={() => void loadRepos()}
            >
              Показать мои репозитории
            </button>
          ) : (
            <div className="github-row">
              <select
                className="input github-select"
                value={chosen}
                onChange={(event) => setChosen(event.target.value)}
              >
                <option value="">Выберите репозиторий…</option>
                {repos.map((repo) => (
                  <option key={repo.fullName} value={repo.fullName}>
                    {repo.fullName}
                    {repo.private ? ' · приватный' : ''}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="button button--quiet"
                disabled={busy || !chosen}
                onClick={() => void connect(chosen)}
              >
                Подключить
              </button>
            </div>
          )}
        </div>
      ) : null}

      {bound ? (
        <div className="github-row">
          <span className="github-bound" title={remote ?? undefined}>
            {bound.owner}/{bound.repo}
          </span>
          <button
            type="button"
            className="button button--quiet"
            onClick={() => void openExternal(`https://github.com/${bound.owner}/${bound.repo}`)}
          >
            Открыть
          </button>
          <button type="button" className="button" disabled={busy || !folder} onClick={() => void sync()}>
            {busy ? 'Синхронизация…' : 'Sync'}
          </button>
        </div>
      ) : null}

      {steps.length > 0 ? (
        <ul className="github-steps">
          {steps.map((step, index) => (
            <li key={`${step.label}-${index}`} className={step.ok ? 'github-step' : 'github-step github-step--fail'}>
              <span aria-hidden="true">{step.ok ? '✓' : '✕'}</span>
              <strong>{step.label}</strong>
              <span className="chip-dim">{step.detail}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {summary ? <p className="dock-note">{summary}</p> : null}
      {error ? <p className="dock-note dock-note--error">{error}</p> : null}
    </div>
  )
}