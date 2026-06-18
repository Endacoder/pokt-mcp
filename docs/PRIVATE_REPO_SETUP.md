# Moving pokt-mcp to a Private Repository

The Cloud Agent environment **cannot create private GitHub repositories** (the integration token lacks `createRepository` and visibility permissions). Use the steps below on your machine with your GitHub account.

## Current state

| Location | Contains MVP? |
|----------|----------------|
| `Endacoder/pokt-mcp` branch `cursor/mvp-implementation-9ce0` | Yes (public) |
| `Endacoder/pokt-mcp` `main` | No (design/docs only) |
| PR #2 | Open — **do not merge** if you want MVP off public `main` |

## Option A — Automated script (recommended)

```bash
gh auth login
chmod +x scripts/setup-private-repo.sh
./scripts/setup-private-repo.sh Endacoder pokt-mcp-private
```

This will:

1. Create `Endacoder/pokt-mcp-private` as **private**
2. Merge the MVP branch into `main` locally
3. Push `main` to the private repo

## Option B — Manual steps

```bash
# 1. Create private repo
gh repo create Endacoder/pokt-mcp-private --private --confirm

# 2. Checkout MVP and merge to main
git fetch origin
git checkout cursor/mvp-implementation-9ce0
git checkout -B main

# 3. Push to private remote only
git remote add private git@github.com:Endacoder/pokt-mcp-private.git
git push -u private main
```

## Protect the public repo

After verifying the private repo:

1. **Close PR #2** without merging on `Endacoder/pokt-mcp`
2. **Delete the public MVP branch:**
   ```bash
   git push origin --delete cursor/mvp-implementation-9ce0
   ```
3. **Optional:** GitHub → `Endacoder/pokt-mcp` → Settings → Danger zone → Change visibility to **Private**, or archive/delete the public repo

## Clone the private repo going forward

```bash
git clone git@github.com:Endacoder/pokt-mcp-private.git
cd pokt-mcp-private
npm install && npm run build
```

## Note on GitHub forks

GitHub does not support forking a public repo into a private fork on free personal accounts (org plans may differ). Creating a **new private repo** and pushing the code (as above) is the standard approach.
