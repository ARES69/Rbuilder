# RBUILDER

Chat with an agent on the left, watch the web app it writes render live on the right — and let
the agent check its own work instead of asking you to look.

```
┌──────────────────────────────┬──────────────────────────────────────┐
│ Chat                         │ Preview                              │
│ transcript, attachments,     │ the project's index.html, rebuilt    │
│ checklist, tool trace        │ as files land                        │
│                              ├──────────────────────────────────────┤
│                              │ Dock: Files · Console · Checks ·     │
│                              │       Terminal                       │
│ composer · Build/Plan        │                                      │
└──────────────────────────────┴──────────────────────────────────────┘
```

## Requirements

- Node.js 20.19+ (24 recommended)
- pnpm

## Quick start

```bash
pnpm install
cp .env.example .env.local   # then put your key in it
pnpm dev
```

Open the URL Vite prints (default http://localhost:5173). No key yet? The app still runs: the
chat explains how to configure one and the preview keeps rendering the starter project.

## The model

Freebuff Web talks to **any OpenAI-compatible chat completions endpoint**. Configure it in
`.env.local`:

| Variable | Default | Notes |
| --- | --- | --- |
| `OPENAI_API_KEY` | — | Required. Absent ⇒ the app runs in unconfigured mode. |
| `OPENAI_BASE_URL` | `https://api.openai.com/v1` | OpenAI, OpenRouter, Groq, Ollama, LM Studio… |
| `OPENAI_MODEL` | `gpt-4o-mini` | Any model id the endpoint accepts. |

The key is read by the dev server only. The browser never receives it: it learns just whether a
model is configured and which model id is in use. Endpoints that ignore `stream: true` are
handled, and tool calling is used in build mode (a provider without it still works — you just
lose the self-checking).

## What it does

**Chat.** Plain prose replies, streamed as they arrive. Stop a turn at any time.

**Attach any file.** The paperclip button accepts any type, and files can be dropped onto the
chat. Text-like files (code, markdown, JSON, CSV, …) are read and handed to the model inline as
context, truncated at 64 KB. Anything else is passed as name, type and size, and the model is
told the contents were not read.

**Applications, not demos.** The agent writes a real project: folders and modules, as many pages
as the app needs, npm packages, and the integrations those pages call. `index.html` is the entry
point the preview opens; a `package.json` is written when the project needs real dependencies and
scripts, which the terminal runs for real. Nothing is built for you, so there is no build step to
forget — but nothing is collapsed into a single file either.

**Live preview.** Files the agent writes go into an in-memory project. The preview builds that
project into one document — linked stylesheets and `<script src>` files are inlined, because a
sandboxed `srcdoc` document cannot resolve relative URLs — and renders it in an iframe. Rebuilds
happen as file blocks finish streaming. Refresh re-mounts the frame; **Open** opens the current
build in a new tab.

**The agent can look at the page.** The preview carries a small injected runtime that records
console output, runtime errors, rejected promises and failed requests, and answers requests from
the page over `postMessage`. The model gets four tools:

| Tool | What it does |
| --- | --- |
| `inspect_preview` | page title, visible text, an outline of headings/text/interactive elements with selectors, console tail, errors, failed requests |
| `interact_with_preview` | click, type or press a key — targeting a selector or visible text — and report what changed |
| `read_project_file` | full current contents of one file |
| `run_checks` | the project checks below |

A turn is bounded by a budget the agent manages itself — by default 5 minutes and 200k tokens —
not by a fixed round cap. The model is told what is left at every step and paces itself; when the
budget is nearly spent, tools are withdrawn so the turn lands with a summary instead of dying
mid-thought. A run that needs twenty inspections gets them; one stuck in a loop does not burn them
endlessly (a runaway guard far beyond any real budget guarantees termination). The chat shows the
same numbers live — time left, tokens used, steps taken — with a Stop button that ends the turn at
once. Token counts are exact when the provider reports usage (`stream_options.include_usage`) and
estimated from text volume otherwise.
Every call appears as a row in the chat you can expand to see exactly what came back.

**Dock.**

- **Files** — browse the generated project, edit a file by hand and Save (the preview rebuilds),
  delete, or send it to the agent with "Ask".
- **Console** — everything the preview logged, plus an evaluate line that runs JavaScript in the
  page, a Clear button, and **Ask Freebuff to fix** which sends the captured errors as the next
  turn. The tab badge counts problems. The header shows the same count.
- **Checks** — HTML structure and referenced files, CSS brace balance and JavaScript syntax (the
  code is parsed with the `Function` constructor, never executed). Same "Ask Freebuff to fix".
- **Terminal** — a real shell command in a scratch copy of the project
  (`.freebuff-workspace/project/`), streamed back line by line.

**Plan mode.** The Build/Plan switch sits in the composer. In plan mode no tools are offered and
**file blocks are not applied**: you get an approach plus a checklist, and nothing changes until
you press **Approve & build**, which switches to build mode and tells the agent to work the list.
The checklist is re-emitted each turn and rendered with progress above the composer.

**Persistence.** Transcript, project, plan and mode are saved to `localStorage`; a reload keeps
all of it. Terminal output and check results are session-only. **New project** starts over.

**Resizable columns.** The shell is three columns — tasks, chat, inspector — and the outer two
are yours to size: drag the handle, focus it and use ←/→ (shift for a bigger step), or
double-click to hand the width back to the stylesheet. Both widths are remembered between
launches, and a width saved on a wide monitor is clamped on a narrow one.

## How a turn works

1. The browser sends the whole transcript (including previous tool calls and their results) plus
   the current file list to `POST /api/chat`, along with the mode.
2. The proxy adds the system prompt and, in build mode, the tool definitions, then streams one
   provider step back as newline-delimited JSON: `meta`, `delta`, `tool_call`, then `done`.
3. Each delta is re-parsed. Completed file blocks are written into the project — which rebuilds
   the preview — and removed from the prose; completed plan blocks become the checklist. Nothing
   is applied from a file block that has not closed yet.
4. If the step asked for tools, the browser runs them (inspecting the live frame, reading the
   project, running the checks), appends the results, and asks for the next step.

The proxy is stateless and the loop lives in the browser, because only the page can see its own
project and preview.

## External APIs (Bitrix24, amoCRM, Yandex, any REST service)

The preview runs in a sandboxed frame with an opaque origin, so a generated app cannot call a
third-party host directly — every such request dies on CORS. Instead the agent writes apps that
call the dev-server passthrough:

```js
const response = await fetch('/api/proxy', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    url: 'https://company.bitrix24.ru/rest/1/xxxx/crm.lead.add.json',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: { NAME: 'Ivan' } }),
  }),
})
```

The envelope is `{ url, method?, headers?, body?, timeoutMs? }`; the upstream response comes back
verbatim with its original status and content type, so JSON, XML and webhook payloads all work.
The system prompt teaches the agent this pattern, including webhook-style services (Bitrix24
inbound webhooks, Telegram bots) where the key lives in the URL.

Safety: requests to private and local network addresses (loopback, 10/8, 172.16/12, 192.168/16,
169.254/16, CGNAT, `.local`) are refused — including hostnames that resolve to them, which closes
direct SSRF and DNS rebinding. Hop-by-hop request headers (`Host`, `Content-Length`, cookies) are
stripped, upstream `Set-Cookie` and CORS headers are not forwarded. To test against a service on
your own machine, start the dev server with `PROXY_ALLOW_PRIVATE=1`. Bodies and responses are
capped at 10 MB; upstream calls time out after 20s (envelope can raise to 60s).

## Guardrails, honestly stated

- The preview iframe is sandboxed with `allow-scripts allow-forms allow-modals allow-popups` and
  **without** `allow-same-origin`, so the generated app cannot touch this page. The parent reaches
  it only over `postMessage`, and every reply carries a channel derived from the project, so a
  frame that has been rebuilt cannot answer for the current preview.
- Generated JavaScript is only *parsed* by the checks — the app's own code is never executed
  outside the sandboxed frame.
- The terminal is a local developer tool with your own permissions, not a sandbox. Privileged
  commands (`sudo`, `doas`, `pkexec`, `-Verb RunAs`), fork bombs, disk writes, `git push` and
  deletes aimed outside the workspace are refused; commands have a 20 s timeout and 64 KB output
  cap. Anything stronger needs a container.
- `git push` is refused *for the agent* and allowed for the person: the exec route carries a flag
  only the Git panel and Sync set, so the guard is about who asked rather than what the command
  looks like. A prompt that talks the model into publishing still cannot publish.
- The agent has no shell tool: it can run the checks, not your machine.

## Cost

The composer shows what the last turn cost next to the model picker, since that
is where the decision is made. A running total for the session appears after a
few turns.

Money is only shown when it is known. A model missing from the price table reads
as "цена неизвестна", a local model reads as free, and a provider that reports
no usage says so — none of them show `$0.00`, which would read as free rather
than as an absence of a number. Input and output tokens are billed at their own
rates, because they differ by up to 40× and an agent turn is input-heavy.

Prices are a dated snapshot in `src/lib/pricing.ts`; they go stale.

## Multi-page projects

A project with several HTML files gets a page picker next to the preview
controls. Because the preview is a `srcdoc` document it has no URL of its own,
so a link to `about.html` cannot simply be followed: it would resolve against
the parent and take the whole app with it. Instead a small router injected into
the document intercepts links to other pages of the same project, and the pane
rebuilds the frame for the target page. The URL fragment tracks the page, so a
reload lands in the same place.

Links are left alone when they are not ours to handle: a same-document anchor, an
external URL, and a link to a file that does not exist. That last one matters —
a dead link stays dead so the model can see it, rather than the preview silently
"navigating" somewhere.

## Where a project lives

A new task gets a folder of its own without anybody being asked: the shell creates
`Documents\RBuilder\<task name>`, taking the first free variant of that name, and
the task is bound to it. Everything the model writes lands there, the terminal
runs there, and git runs there — so the project is a folder you can open, back up
and commit, not a state inside the app.

The name is turned into a folder name that Windows will actually accept:
characters no path segment may hold become dashes, trailing dots and spaces go,
reserved device names (`con`, `NUL.txt`) are prefixed rather than suffixed, and
an existing folder is never reused — a second `Новый проект` becomes
`Новый проект 2` instead of quietly overwriting the first.

**Open Folder** still binds a task to a folder you choose yourself, for a project
that already exists.

## Git

The Git panel runs real `git` in the **bound project folder** — the same folder
the model writes to and the terminal runs in, so what the panel reports can be
verified outside the app. It gives status, a per-file diff, the recent history,
branch switching and creation, tags, and push/pull.

A task with no bound folder gets no git actions. Its commands run in the scratch
copy at `.freebuff-workspace/project`, which is rewritten from scratch on every
command: a repository created there would be thrown away with the next run, and
until then the panel would report a branch and a history belonging to nothing.
The panel says so instead of offering the actions.

### GitHub and Sync

The top of the Git panel signs in to GitHub and connects the folder to a
repository. **Sign in** asks for a personal access token — a classic token with
the `repo` scope — and **How to get a token** opens GitHub's own page for it. A
device flow would be prettier, but it needs an OAuth application registered under
someone's account; a flow that cannot be completed is worse than a field that
says what it wants.

The token is stored by the shell in its own data directory, not in web storage,
and **Sign out** deletes the file.

With an account connected you can create a new repository (private by default) or
pick one of your existing ones, and the folder's `origin` is pointed at it.

**Sync** is one button for both directions, and it does what a person does when
they sit down with a working copy and a remote:

1. create the repository if the folder has none yet,
2. commit whatever is here,
3. fetch,
4. rebase onto `origin/<branch>` — or skip it, when the branch is not there yet,
5. push.

The order is the design: committing first makes the local work safe before the
rebase can touch it, and pushing last means nothing is published until it is known
to fit. A rebase that conflicts is not swept up — the files are left unmerged and
the panel's conflict view takes over, so the next Sync finishes the job.

Every step reports separately, because "sync failed" is not something anyone can
act on. "GitHub refused the token" is.

The token is never written into a remote URL: a URL in `.git/config` is a
credential in plain text that every clone of the project inherits. Instead git is
handed an `http.extraHeader` for the one command that needs it.

### Merge conflicts

Unmerged paths are listed on their own, above the change list, because a conflict
is the one case where a diff is not an answer: the file on disk carries
`<<<<<<<` markers, so the diff shows the markers rather than the disagreement.

Clicking a file shows three columns — **your branch**, the **common ancestor**,
and the **merged-in branch** — one row per region. The ancestor is included
because most real conflicts are both sides editing the same line, and it is what
tells the two edits apart; the `diff3` form (`|||||||`) and the plain two-way form
are both read. **Оставить мою** and **Взять их** run
`git checkout --<side> -- <path> && git add -- <path>`, which writes the chosen
side and clears the unmerged state, so the row disappears on its own.

Choosing a side is the whole operation by design. A real three-way merge of a
region belongs to git: an editor that invented its own would be worse than the
conflict it replaced. To combine both sides by hand, edit the file in the code
column, remove the markers and commit — the panel says the same thing.

## Watching the project folder

A bound folder is watched with the OS's own filesystem notifications (`notify`:
ReadDirectoryChangesW, FSEvents, inotify), so an edit made in another editor lands
in the open task.

Raw notifications need two things before they are useful, and both are in
`src-tauri/folder_watch.rs`:

- **Debouncing.** One save is a create, a write, a rename and a metadata touch.
  Events are collected and reported once the tree has been quiet for 400ms, so a
  burst costs one re-read instead of four.
- **Filtering.** Access events are dropped (opening a file is not a change to it),
  and the same directories the importer skips — `node_modules`, `dist`, `.git` —
  are ignored here, so a build or a `git status` does not wake the app.

A cheap tree fingerprint is still checked before reporting: the net effect of a
burst is often nothing (a `touch`, or a file written and then deleted), and
re-reading the project for that would be pure noise.

`cargo test` covers the filtering and debouncing rules, and
`src-tauri/tests/watcher_integration.rs` checks against the real OS backend that a
file written in a watched directory — including one in a directory created after
the watch started — actually produces an event.

## Scripts

| Command | What it does |
| --- | --- |
| `pnpm dev` | Dev server with the `/api/chat` and `/api/exec` middleware (the supported way to run it) |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm test` | Vitest: project, protocol, attachments, markdown, checks, the preview runtime and React components |
| `pnpm test:visual` | Screenshot tests for the preview pane (needs `pnpm exec playwright install chromium`) |
| `pnpm test:visual:update` | Re-record the screenshot baselines after an intended visual change |
| `pnpm build` | Production build of the front end (no API middleware) |

### Component tests

`tests/components/` renders real components into jsdom and drives them the way a
person does — press a button, read what the screen says. It is what keeps
behaviour like «which turn offers a rewind» and «what does the confirmation say
before it throws work away» from being verified by clicking through the app.

The harness is `tests/harness/render.tsx`, and it is hand-written on top of
`react-dom/client`, `act` and `querySelector` rather than pulled from a testing
library. All of that is already a dependency of the app and of the preview
tests, so nothing new is installed and nothing can go stale behind a version
bump. What it gives up is a matcher vocabulary; in exchange a test reads the
same selectors the interface renders, so renaming a class name breaks the test —
which is the point.

```tsx
import { render, screen } from '../harness/render'

render(<MessageList messages={messages} examples={[]} onExample={() => {}} />)
screen.click('.turn-rewind')
expect(screen.text('.confirm-question')).toContain('Вернуться')
```

A test file asks for the DOM with a `@vitest-environment jsdom` header at the
top; everything else runs in Node as before. The harness stands in for the
browser where jsdom has none (scrolling, layout), so a component that scrolls
does not crash on mount and a test does not have to know it is running headless.

To check that a test can still fail, break the component on purpose and read the
failure. An assertion that passes both ways is decoration.

### Preview screenshot tests

`tests/visual/` renders what the preview actually shows: the same
`buildPreviewDocument` output the app hands to its iframe, opened in Chromium,
compared pixel by pixel against the committed baselines in `tests/visual/baselines/`.

They are kept out of `pnpm test` on purpose — they need a browser and take
seconds per shot, and nobody wants that inside the loop they run all day. CI runs
them as their own step.

When a change to the preview pipeline is intended, re-record the baselines with
`pnpm test:visual:update` and review the PNGs in the diff. A failing run writes
the frames it compared to `tests/visual/output/`, which is gitignored.

## Layout

```
server/chat-proxy.ts       /api/chat (provider + tools) and /api/exec (terminal)
server/workspace.ts        scratch workspace, command runner, guardrails
src/App.tsx                turn lifecycle, tool execution, checks, terminal wiring
src/lib/protocol.ts        prompts, stream events, file/plan parsers, tool schemas
src/lib/previewRuntime.ts  the script injected into the preview
src/lib/inspector.ts       parent side: event log, request/response, channels
src/lib/tools.ts           executes model tool calls
src/lib/checks.ts          HTML/CSS/JS checks
src/lib/turn.ts            the multi-step turn loop
src/lib/project.ts         virtual project, path safety, preview document builder
src/lib/agent.ts           browser side of both streams
src/lib/attachments.ts     file reading, text detection, truncation
src/lib/store.ts           reducer + localStorage persistence
src/lib/git.ts             git commands and output parsing
src/lib/sync.ts            the one-button Sync, step by step
src/lib/github.ts          GitHub REST client, repo names, git auth
src/components/            ColumnResizer, SplitLayout, ChatPanel, MessageList, Markdown,
                           Composer, AttachmentChips, PreviewPane, Dock, GitHubSync,
                           PlanPanel
src/styles/global.css      Minimalism theme (near-monochrome, hairline rules, dark mode)
tests/                     Vitest suites
```

## Debugging the preview

In dev the page exposes two aids:

- `window.__freebuffTrace` — recent inspector posts and receives, with channel and attach counts.
  That is how the "tool ran against the previous document" class of bug was found.
- `window.__freebuffDebug` — the live inspector and the current channel.

## Not included

Accounts and auth (the GitHub token is yours, pasted by you), hosted git — forges other than
GitHub use whatever credentials the machine already has — a model picker, sessions and quotas,
hosting and deployment, containers or a sandboxed terminal.

The preview runs the front end of the application: whatever `index.html` loads, with npm
packages pulled in at preview time, and no build step for anyone to run or remember. It does
not host anything — a Node service, a database or a deploy target is something the project's own
terminal can work with, not something this app runs for you.
