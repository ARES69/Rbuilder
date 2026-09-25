## Reproduce artifacts

- Use the primary checkout at `C:\Users\NOTEPC\Documents\Rbuilder` as this worktree.
- Copy `.env.local` from the main checkout into this worktree if it exists; do not commit or document secret values.
- Install dependencies with the package manager recorded by `package.json`/lockfiles (`pnpm install --ignore-scripts` in this environment).

## Run the server

- From `C:\Users\NOTEPC\Documents\Rbuilder`, run `pnpm.cmd dev --port 5174 --strictPort` using the Windows detached PowerShell recipe supplied by the preview environment.
- Port 5173 may be occupied by another workspace; use 5174 for this preview.
- Redirect stdout and stderr to separate files, confirm the detached process remains alive, wait for the localhost URL to answer, then register that URL with its process id.
