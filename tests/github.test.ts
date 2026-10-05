import { describe, expect, it } from 'vitest'
import {
  cloneUrl,
  gitAuthArgs,
  isGitHubRemote,
  parseRepoRef,
  repoName,
} from '../src/lib/github'
import {
  gitCommitIfAnyCommand,
  gitLsRemoteCommand,
  gitPullRebaseCommand,
  gitPushBranchCommand,
  gitRemoteCommand,
  shellQuote,
} from '../src/lib/git'

describe('repository names', () => {
  it('keeps what GitHub already accepts', () => {
    expect(repoName('my-site')).toBe('my-site')
    expect(repoName('site_v2.final')).toBe('site_v2.final')
  })

  it('transliterates instead of dropping the name', () => {
    expect(repoName('Мой проект')).toBe('moj-proekt')
  })

  it('turns separators into a single dash', () => {
    expect(repoName('a   b//c')).toBe('a-b-c')
  })

  it('cannot produce a name made only of dashes', () => {
    expect(repoName('///')).toBe('')
    expect(repoName('   ')).toBe('')
  })
})

describe('remote references', () => {
  it('reads owner/name as written', () => {
    expect(parseRepoRef('ares69/rbuilder')).toEqual({ owner: 'ares69', repo: 'rbuilder' })
  })

  it('reads every form a remote arrives in', () => {
    expect(parseRepoRef('https://github.com/ares69/rbuilder.git')).toEqual({
      owner: 'ares69',
      repo: 'rbuilder',
    })
    expect(parseRepoRef('git@github.com:ares69/rbuilder.git')).toEqual({
      owner: 'ares69',
      repo: 'rbuilder',
    })
    expect(parseRepoRef('  https://github.com/ares69/rbuilder/  ')).toEqual({
      owner: 'ares69',
      repo: 'rbuilder',
    })
  })

  it('refuses what is not a repository', () => {
    expect(parseRepoRef('')).toBeNull()
    expect(parseRepoRef('rbuilder')).toBeNull()
    expect(parseRepoRef('owner/repo/extra')).toBeNull()
    expect(parseRepoRef('https://github.com/ares69')).toBeNull()
  })

  it('builds the https remote git stores', () => {
    expect(cloneUrl('ares69/rbuilder')).toBe('https://github.com/ares69/rbuilder.git')
  })

  it('knows which remotes are GitHub and need the token', () => {
    expect(isGitHubRemote('https://github.com/ares69/rbuilder.git')).toBe(true)
    expect(isGitHubRemote('git@github.com:ares69/rbuilder.git')).toBe(true)
    expect(isGitHubRemote('https://gitlab.com/ares69/rbuilder.git')).toBe(false)
    expect(isGitHubRemote(null)).toBe(false)
  })
})

describe('git authentication', () => {
  it('passes the token as a header rather than in the URL', () => {
    const args = gitAuthArgs('ghp_secret')
    // The remote must stay a plain https URL: a token in `.git/config` is a
    // credential in plain text that every clone of the project inherits.
    expect(args).not.toContain('ghp_secret')
    expect(args).toContain('http.https://github.com/.extraheader')
    // base64 of `x-access-token:ghp_secret`
    expect(args).toContain('eC1hY2Nlc3MtdG9rZW46Z2hwX3NlY3JldA==')
    expect(args.startsWith("-c '")).toBe(true)
    expect(args.endsWith("'")).toBe(true)
  })
})

describe('sync commands', () => {
  it('says so when there is nothing to commit instead of failing', () => {
    const command = gitCommitIfAnyCommand('Синхронизация')
    expect(command).toContain('RB_NOTHING_TO_COMMIT')
    expect(command).toContain('git add -A')
    expect(command).toContain('commit -q -m "Синхронизация"')
  })

  it('adds the remote or repoints it, so connecting twice is not an error', () => {
    expect(gitRemoteCommand('https://github.com/a/b.git')).toBe(
      "git remote add origin 'https://github.com/a/b.git' 2>/dev/null || git remote set-url origin 'https://github.com/a/b.git'",
    )
  })

  it('quotes what the shell would otherwise take apart', () => {
    // A semicolon is not dangerous inside single quotes, and a branch name
    // cannot contain one anyway — but quoting is what makes that true.
    expect(gitPushBranchCommand('main; rm -rf /')).toBe(
      "git push -u origin HEAD:'main; rm -rf /' 2>&1",
    )
    // A quote is the one thing that could break out of them, so it is refused.
    expect(shellQuote("a'b")).toBeNull()
    expect(gitRemoteCommand("a'b")).toBe('true')
    expect(gitPullRebaseCommand('a`b')).toContain("origin 'a`b'")
    expect(gitPullRebaseCommand("a'b")).toBe('true')
    expect(gitLsRemoteCommand('')).toBe('echo')
  })

  it('rebases rather than merges, so the shared branch stays a line', () => {
    const pull = gitPullRebaseCommand('main')
    expect(pull).toContain('--rebase')
    expect(pull).toContain("origin 'main'")
    // A rebase replays commits, so it needs an identity: a machine with no
    // global git config would otherwise stop the sync here.
    expect(pull).toContain('user.email=rbuilder@local')
    expect(gitPushBranchCommand('main')).toBe("git push -u origin HEAD:'main' 2>&1")
  })

  it('asks the remote whether the branch is there instead of assuming', () => {
    // The first sync has nothing to pull, and a failing `ls-remote` would be
    // reported as a broken remote rather than as a new repository.
    expect(gitLsRemoteCommand('main')).toBe("git ls-remote --heads origin 'main' 2>/dev/null || true")
  })
})