# Phase 8: Build Pipeline & npm Distribution

## Goal

Set up a build pipeline using `tsup` that compiles the TypeScript source into a distributable npm package. The output must work for both Node.js and Bun consumers, include type declarations, and produce a standalone CLI binary.

## Context

Currently `package.json` points to raw TypeScript source files (`src/index.ts`), the CLI uses `#!/usr/bin/env bun` as a shebang, and `files: ["src/"]`. This only works for Bun consumers. We need a build step that produces compiled JavaScript compatible with Node.js 20+.

## Prerequisite: Node.js Compatibility Audit

Before building, verify and fix any Bun-specific APIs in the source. Known areas to check:

### `src/core/file-io.ts`
- **Replace** `Bun.file()` with `node:fs/promises` equivalents (`readFile`, `writeFile`, `rename`, `mkdir`, `unlink`)
- **Replace** `Bun.write()` with `node:fs/promises.writeFile()`
- **Replace** any `Bun.file(path).exists()` with `node:fs/promises.access(path)` or `stat()`
- The current atomic write pattern (write-to-temp-then-rename) should work fine with `node:fs/promises.rename()`
- Both `node:path` and `node:fs/promises` work identically in Bun, so no runtime regressions

### `src/bin.ts`
- Change shebang from `#!/usr/bin/env bun` to `#!/usr/bin/env node`
- The built binary will be a bundled JS file, so `node` is the correct interpreter

### `src/core/id.ts`
- Check for `Bun.randomUUID()` or similar — replace with `crypto.randomUUID()` from `node:crypto` if present
- `Date.now()` and `Math.random()` are universal, should be fine

### Other files
- Scan all `src/` files for any `Bun.` global references and replace with Node.js equivalents
- `process.env` works in both runtimes
- `console.log`/`console.error` work in both runtimes
- `JSON.parse`/`JSON.stringify` work in both runtimes

## Build Setup

### 1. Install tsup

```bash
cd packages/library
bun add -d tsup
```

### 2. Create `tsup.config.ts`

```ts
import { defineConfig } from "tsup";

export default defineConfig([
  // Library build — ESM + CJS + type declarations
  {
    entry: ["src/index.ts"],
    format: ["esm", "cjs"],
    dts: true,
    clean: true,
    sourcemap: true,
    target: "node20",
    outDir: "dist",
    // Don't bundle — keep external imports (commander) as peer deps
    // This allows tree-shaking for library consumers
    noExternal: [],
    external: ["commander"],
  },
  // CLI binary build — standalone bundle with node shebang
  {
    entry: ["src/bin.ts"],
    format: ["esm"],
    banner: { js: "#!/usr/bin/env node" },
    clean: false, // don't clean dist/ (library build already did)
    target: "node20",
    outDir: "dist",
    // Bundle everything including commander into the standalone binary
    bundle: true,
    // Rename output to bin.js for clarity
    outExtension: () => ({ js: ".js" }),
  },
]);
```

**Important**: The library entry does NOT bundle dependencies — `commander` stays external so library consumers who only use the programmatic API (not CLI) don't pull it in unnecessarily. The CLI binary DOES bundle everything since it's a standalone executable.

### 3. Update `package.json`

Update these fields:

```json
{
  "main": "./dist/index.cjs",
  "module": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "import": {
        "types": "./dist/index.d.ts",
        "default": "./dist/index.js"
      },
      "require": {
        "types": "./dist/index.d.cts",
        "default": "./dist/index.cjs"
      }
    }
  },
  "bin": {
    "trackgentic": "./dist/bin.js"
  },
  "files": [
    "dist/"
  ],
  "scripts": {
    "build": "tsup",
    "prepublishOnly": "bun run quality",
    "...": "keep all existing scripts unchanged"
  },
  "engines": {
    "node": ">=20.0.0"
  }
}
```

Key changes:
- `main` → `dist/index.cjs` (CJS entry for backward compat)
- `module` → `dist/index.js` (ESM entry)
- `types` → `dist/index.d.ts`
- `exports` → dual ESM/CJS with types conditions
- `bin` → `dist/bin.js` (bundled standalone)
- `files` → `dist/` only (no more shipping source)
- `engines` → `node >= 20.0.0` (drop Bun requirement)
- `build` script added

### 4. Update `tsconfig.json`

No changes needed. The existing config is fine — `tsup` handles its own compilation. The `tsconfig.json` continues to serve `tsc --noEmit` for type checking.

## Verification Steps

After implementation, verify ALL of the following:

### 1. Build succeeds
```bash
cd packages/library
bun run build
```
Should produce `dist/` with:
- `dist/index.js` (ESM library)
- `dist/index.cjs` (CJS library)
- `dist/index.d.ts` (type declarations)
- `dist/index.d.cts` (CJS type declarations)
- `dist/bin.js` (CLI binary)
- Source maps for all

### 2. CLI works with Node.js
```bash
node packages/library/dist/bin.js --help
node packages/library/dist/bin.js --version
```
Should print valid JSON output.

### 3. Library is importable (quick smoke test)
```bash
cd /tmp && mkdir test-import && cd test-import
npm init -y
npm install /path/to/trackgentic/packages/library
node -e "const { Tracker } = require('trackgentic'); console.log(typeof Tracker);"
```
Should print `function`.

### 4. All existing quality gates still pass
```bash
cd packages/library
bun run quality
```
549 tests, 1948 assertions, all green. Typecheck, lint, format all clean.

### 5. Test with Bun still works
```bash
cd packages/library
bun test
```
Bun can still run the test suite against the source (tests import from `src/` not `dist/`).

## Files Changed

| File | Change |
|------|--------|
| `packages/library/tsup.config.ts` | **NEW** — tsup build configuration |
| `packages/library/package.json` | Update `main`, `module`, `types`, `exports`, `bin`, `files`, `engines`, add `build` script |
| `packages/library/src/core/file-io.ts` | Replace Bun APIs with `node:fs/promises` equivalents |
| `packages/library/src/bin.ts` | Change shebang from `#!/usr/bin/env bun` to `#!/usr/bin/env node` |
| Any other `src/` files with `Bun.` references | Replace with Node.js equivalents |
| `packages/library/tsconfig.json` | No changes needed |

## Scope

This is ONLY the build pipeline setup. Documentation generation (TypeDoc HTML) is a separate task for later. Do NOT change any test files, any business logic, or any CLI command behavior. The only source changes are replacing Bun-specific APIs with Node.js equivalents.
