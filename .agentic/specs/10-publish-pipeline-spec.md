# Phase 9: Publish Pipeline — npm + GitHub Pages

## Goal

Set up a complete publish pipeline that:
1. Runs quality gates on every push/PR (CI)
2. Publishes the library to npm on version tag push
3. Builds TypeDoc HTML API documentation and deploys to GitHub Pages

## Context

The build pipeline (Phase 8) is complete: tsup produces `dist/` with ESM + CJS + `.d.ts` + CLI binary. TypeDoc is installed and parses cleanly (`docs:check` passes). All public exports have JSDoc from Phase 7. Now we need to configure TypeDoc for HTML output and create GitHub Actions workflows for CI and release.

## Architecture

```
Developer pushes code          Developer cuts release (git tag v*)
        ↓                              ↓
   ┌─────────┐              ┌──────────────────────┐
   │  CI.yml │              │     Release.yml       │
   │         │              │                       │
   │ quality │              │ quality → build       │
   │ build   │              │    ↓          ↓       │
   └─────────┘              │ npm publish  docs     │
                             │              ↓       │
                             │    GitHub Pages      │
                             └──────────────────────┘
```

## Developer Release Workflow

```bash
# 1. Bump version (creates commit + tag)
cd packages/library
npm version patch   # or minor, major

# 2. Push commit + tag
git push --follow-tags

# 3. GitHub Actions handles the rest
```

## Task A: TypeDoc HTML Configuration

### 1. Update `packages/library/typedoc.json`

Configure TypeDoc to produce HTML output to `docs-html/` directory:

- Remove or disable `typedoc-plugin-markdown` if it's currently the renderer
- Set `"out": "docs-html"` 
- Ensure entry point is `src/index.ts`
- Include all source files (src/core/\*, src/types/\*, src/cli/\*, src/bin.ts)
- Enable search, navigation, and breadcrumbs (default HTML theme features)

The exact config depends on what's currently in typedoc.json. Key fields to ensure:

```json
{
  "entryPoints": ["src/index.ts"],
  "out": "docs-html",
  "excludePrivate": true,
  "excludeInternal": true,
  "readme": "none"
}
```

Note: `"readme": "none"` prevents TypeDoc from looking for a README.md. If there is a useful README at `packages/library/README.md`, you can omit this field and let TypeDoc use it as the index page.

### 2. Add `docs` script to `packages/library/package.json`

Add a `"docs"` script that generates the HTML documentation:

```json
"docs": "typedoc"
```

The `typedoc` command reads its config from `typedoc.json` automatically.

Keep the existing `docs:check` script unchanged (it validates JSDoc without generating output).

### 3. Update `.gitignore`

Add `docs-html/` to the root `.gitignore` file (it's generated output, not committed):

```
# Generated docs
docs-html/
```

## Task B: CI Workflow

Create `.github/workflows/ci.yml`:

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  quality:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: "1.3.11"

      - run: bun install

      - run: cd packages/library && bun run quality

      - run: cd packages/library && bun run build
```

Purpose: catches regressions before merge. Runs on every push to main and every PR targeting main.

## Task C: Release Workflow

Create `.github/workflows/release.yml`:

```yaml
name: Release

on:
  push:
    tags: ['v*']
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: false

jobs:
  release:
    runs-on: ubuntu-latest
    environment: github-pages

    steps:
      - uses: actions/checkout@v4

      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: "1.3.11"

      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          registry-url: https://registry.npmjs.org

      - run: bun install

      - run: cd packages/library && bun run quality

      - run: cd packages/library && bun run build

      # Publish to npm
      - run: cd packages/library && npm publish --access public
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}

      # Build and deploy API docs to GitHub Pages
      - run: cd packages/library && bun run docs

      - uses: actions/upload-pages-artifact@v3
        with:
          path: packages/library/docs-html

      - uses: actions/deploy-pages@v4
```

Design notes:
- **Single sequential job**: if npm publish fails, docs don't deploy (prevents version mismatch)
- **`workflow_dispatch`**: allows manual re-runs for docs-only redeployments
- **Bun for build + Node for publish**: Bun is our build tool; `npm publish` needs Node.js for registry auth via `NODE_AUTH_TOKEN`
- **`environment: github-pages`**: required by GitHub Pages deployment

## Verification Steps

After all changes are made, verify:

### 1. TypeDoc HTML generation works
```bash
cd packages/library
bun run docs
```
Should produce `docs-html/` directory with `index.html` and full API documentation site. Verify:
- `docs-html/index.html` exists and is valid HTML
- All public exports (Tracker class, types, errors) are documented
- JSDoc content appears correctly
- Search and navigation work in the HTML

### 2. All existing quality gates still pass
```bash
cd packages/library
bun run quality
```
549 tests, 1950+ assertions, typecheck clean, lint clean.

### 3. `docs:check` still passes
```bash
cd packages/library
bun run docs:check
```

### 4. Build still works
```bash
cd packages/library
bun run build
```

### 5. Workflow files are valid YAML
Open `.github/workflows/ci.yml` and `.github/workflows/release.yml` and verify:
- Valid YAML syntax
- No trailing spaces or tabs
- Correct indentation

## Files Changed

| File | Change |
|------|--------|
| `packages/library/typedoc.json` | Update for HTML output to `docs-html/` |
| `packages/library/package.json` | Add `"docs"` script |
| `.gitignore` | Add `docs-html/` |
| `.github/workflows/ci.yml` | **NEW** — CI quality gates on push/PR |
| `.github/workflows/release.yml` | **NEW** — npm publish + docs deploy on tag push |

## One-Time Manual Setup (document for user)

After implementation, the user needs to:

1. **NPM token**: Generate an automation token at https://www.npmjs.com/settings/tokens → add as `NPM_TOKEN` in GitHub repo Settings → Secrets → Actions
2. **GitHub Pages source**: Go to repo Settings → Pages → Source → select **"GitHub Actions"** (not "Deploy from a branch")
3. **First release**: `cd packages/library && npm version 0.1.0 && git push --follow-tags`

## Scope

This is ONLY the publish pipeline. No source code changes to `src/`. No test changes. No business logic changes.
