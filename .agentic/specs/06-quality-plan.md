# Trackgentic Library — Quality Plan

This document defines the quality standards, tooling, processes, and organizational patterns for the trackgentic library. Every change to the library code must pass through these gates before being considered complete.

## 1. Linting

### Tool: Biome

**Rationale:** Biome is a fast, all-in-one toolchain for TypeScript/JavaScript that handles both formatting and linting. It replaces ESLint + Prettier with a single tool, has zero config for sensible defaults, and is extremely fast (Rust-based). It integrates well with Bun projects and requires minimal setup.

**Configuration:** `biome.json` in `packages/library/`

```json
{
  "$schema": "https://biomejs.dev/schemas/2.0.0/schema.json",
  "organizeImports": { "enabled": true },
  "linter": {
    "enabled": true,
    "rules": {
      "recommended": true,
      "correctness": {
        "noUnusedVariables": "error",
        "noUnusedImports": "error"
      },
      "style": {
        "useConst": "error",
        "noVar": "error",
        "useTemplate": "error"
      },
      "suspicious": {
        "noExplicitAny": "warn",
        "noConsole": "off"
      },
      "complexity": {
        "noExcessiveCognitiveComplexity": {
          "level": "warn",
          "options": { "maxAllowedComplexity": 15 }
        }
      }
    }
  },
  "formatter": {
    "enabled": true,
    "indentStyle": "space",
    "indentWidth": 2,
    "lineWidth": 100
  },
  "javascript": {
    "formatter": {
      "quoteStyle": "double",
      "semicolons": "always",
      "trailingCommas": "all"
    }
  }
}
```

### Rules enforced

| Category | Rule | Level | Rationale |
|----------|------|-------|-----------|
| Correctness | No unused variables | Error | Dead code signals incomplete refactoring |
| Correctness | No unused imports | Error | Keeps imports clean |
| Style | Use const | Error | Prefer immutability |
| Style | No var | Error | Always use let/const |
| Style | Use template literals | Error | Consistent string formatting |
| Suspicious | No explicit any | Warn | Flag spots where types are bypassed |
| Complexity | Cognitive complexity <= 15 | Warn | Catch overly complex functions early |
| Formatting | Consistent style | Error | Automated, no debates |

### NPM script

```json
{
  "lint": "biome check src/ tests/",
  "lint:fix": "biome check --fix src/ tests/",
  "format": "biome format --write src/ tests/"
}
```

### When to run

- **Before every commit** (library-quality validates)
- **On every PR / code review**
- **CI pipeline** (when set up)

---

## 2. Typechecking

### Tool: TypeScript (`tsc --noEmit`)

**Rationale:** Already configured. TypeScript's `--strict` mode provides the strongest type safety guarantees. No additional tools needed.

### Current configuration (from tsconfig.json)

```json
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitOverride": true,
    "noPropertyAccessFromIndexSignature": true
  }
}
```

### Additional strict flags to add

Beyond `strict: true`, the following flags should be enabled for maximum type safety:

| Flag | Purpose |
|------|---------|
| `noUncheckedIndexedAccess` | Array/object index access returns `T \| undefined` |
| `exactOptionalPropertyTypes` | Distinguishes between `undefined` and missing |
| `noImplicitOverride` | Requires `override` keyword on inherited methods |
| `noPropertyAccessFromIndexSignature` | Forces bracket notation for dynamic keys |

These are important for this library because we heavily use indexed access (index files, dependency maps, childrenOf) and the type system should reflect that index access may return undefined.

### NPM script (already exists)

```json
{
  "typecheck": "tsc --noEmit"
}
```

### When to run

- **Before every commit** (library-quality validates)
- **On every PR / code review**

---

## 3. Testing

### Tool: Bun Test Runner (built-in)

**Rationale:** Bun's built-in test runner is already in use. It provides:
- `describe`, `test`, `expect` (jest-compatible API)
- `beforeEach`, `afterEach`, `beforeAll`, `afterAll` lifecycle hooks
- Built-in mocking via `mock` module
- Fast execution
- No additional dependencies needed

### Test configuration: `bunfig.toml`

```toml
[test]
coverage = true
coverageThreshold = 80
```

### Coverage requirements

| Module type | Minimum line coverage | Rationale |
|-------------|-----------------------|-----------|
| `src/core/` | 90% | Core business logic — must be thoroughly tested |
| `src/types/` | N/A | Type-only files, no runtime code to test |
| `src/cli/` | 80% | CLI commands are thinner wrappers, but still need coverage |
| Overall | 80% | Project-wide minimum |

### NPM scripts

```json
{
  "test": "bun test",
  "test:coverage": "bun test --coverage",
  "test:watch": "bun test --watch"
}
```

---

## 4. Test File Organization

### Directory structure

```
packages/library/tests/
├── core/                       # Unit tests for core modules
│   ├── id.test.ts
│   ├── resolution.test.ts
│   ├── errors.test.ts
│   ├── file-io.test.ts
│   ├── tracker.test.ts         # Unit tests for individual Tracker methods
│   ├── events.test.ts
│   ├── index-manager.test.ts
│   ├── dependency-manager.test.ts
│   └── auth.test.ts
├── cli/                        # CLI integration tests
│   ├── commands/               # One file per CLI command
│   │   ├── init.test.ts
│   │   ├── create.test.ts
│   │   ├── update.test.ts
│   │   ├── list.test.ts
│   │   ├── view.test.ts
│   │   ├── history.test.ts
│   │   ├── comments.test.ts
│   │   ├── blockages.test.ts
│   │   └── users.test.ts
│   └── runner.test.ts          # CLI argument parsing and routing tests
├── integration/                # Cross-module integration tests
│   ├── lifecycle.test.ts       # Full CRUD lifecycle tests
│   ├── hierarchy.test.ts       # Parent-child constraint tests
│   └── blockages.test.ts       # Blockage lifecycle with cycle detection
└── helpers/                    # Shared test utilities
    ├── setup.ts                # Test directory setup/teardown
    ├── fixtures.ts             # Reusable test data and factories
    └── assertions.ts           # Custom assertion helpers
```

### Naming conventions

| Pattern | Example | Purpose |
|---------|---------|---------|
| `{module}.test.ts` | `events.test.ts` | Tests for a single source module |
| `{command}.test.ts` | `comments.test.ts` | Tests for a single CLI command |
| `{feature}.test.ts` | `lifecycle.test.ts` | Integration tests across modules |
| Tests inside files use `describe` blocks to group related tests |

### Test case patterns

#### Unit tests (core/)

```typescript
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtempSync, rmSync } from "node:fs";

describe("EventEngine", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), "trackgentic-test-"));
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  describe("appendEvent()", () => {
    test("appends a valid event to an issue file", async () => {
      // Arrange: set up preconditions
      // Act: call the function under test
      // Assert: verify the result and side effects
    });

    test("rejects invalid event structure", async () => {
      // ...
    });
  });
});
```

#### Integration tests (integration/)

```typescript
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { Tracker } from "../../src/core/tracker";

describe("Full issue lifecycle", () => {
  let testDir: string;
  let tracker: Tracker;

  beforeEach(async () => {
    testDir = mkdtempSync(join(tmpdir(), "trackgentic-test-"));
    tracker = new Tracker(testDir);
    await tracker.init();
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  test("create → list → view → update → history", async () => {
    const created = await tracker.create({ title: "Test issue", priority: 2 });
    const listed = await tracker.list({});
    const viewed = await tracker.view(created.id);
    const updated = await tracker.update(created.id, { status: "in-progress" });
    const history = await tracker.history(created.id);
    // ... assertions
  });
});
```

### Test helpers (helpers/)

**`setup.ts`** — Manages temporary test directories:

```typescript
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

export function createTestDir(): string {
  return mkdtempSync(join(tmpdir(), "trackgentic-test-"));
}

export function cleanupTestDir(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}
```

**`fixtures.ts`** — Factory functions for test data:

```typescript
import type { CreateIssueParams, UpdateIssueParams } from "../../src/types/api";

export function createIssueParams(overrides?: Partial<CreateIssueParams>): CreateIssueParams {
  return {
    title: "Test issue",
    priority: 2,
    ...overrides,
  };
}
```

### Test writing rules

1. **Every public Tracker method gets tests.** Each method should have: happy path, each error case, edge cases.
2. **Every error code gets a test.** If `ErrorCodes` defines an error, there must be a test that triggers it.
3. **Use Arrange-Act-Assert pattern.** Each test should clearly separate setup, execution, and verification.
4. **Tests must be isolated.** Use `beforeEach` to create fresh state. Never share mutable state between tests.
5. **Test real file I/O.** Don't mock the filesystem — use real temp directories. This catches real-world issues.
6. **No test interdependencies.** Each test must be able to run alone. Order must not matter.
7. **Integration tests cover cross-cutting concerns.** Auth + create, hierarchy + update, blockages + status changes.
8. **Descriptive test names.** Test names should read like a specification: "rejects duplicate user names with USER_ALREADY_EXISTS".

---

## 5. Code Review Process

### Process flow

```
library-developer completes implementation
        │
        ▼
library-quality runs quality gates (lint, typecheck, test)
        │
        ├── FAIL → report issues back to library-developer
        │
        └── PASS → generate/update documentation
                    │
                    ▼
              CTO reviews for architectural alignment
                    │
                    ├── DRIFT → course-correct, update specs if needed
                    │
                    └── ALIGNED → changes accepted
```

### Quality checklist

Every change to `packages/library/src/` must pass this checklist before acceptance:

#### Lint & Format
- [ ] `bun run lint` passes with zero errors
- [ ] Code is auto-formatted (`bun run format`)
- [ ] No `any` types introduced without justification
- [ ] No cognitive complexity warnings (or justified exemption)

#### Type Safety
- [ ] `bun run typecheck` passes with zero errors
- [ ] New types follow patterns established in `02-data-model.md`
- [ ] Return types are explicitly declared on all public methods
- [ ] Error types use `TrackgenticError` class

#### Testing
- [ ] All new functions/methods have corresponding tests
- [ ] All new error paths have tests that trigger them
- [ ] Coverage threshold met (90% for core/, 80% for cli/)
- [ ] Tests follow Arrange-Act-Assert pattern
- [ ] Tests are isolated (fresh test directory per test)
- [ ] Integration tests added for cross-module behavior

#### API Consistency
- [ ] Public API matches `03-api-specification.md`
- [ ] CLI flags match `04-cli-specification.md`
- [ ] Return shapes match `api.ts` type definitions
- [ ] Error codes match `ErrorCodes` enum
- [ ] JSON output format is consistent

#### Documentation
- [ ] JSDoc added to all new public methods
- [ ] JSDoc added to all new exported types
- [ ] TypeDoc-generated API docs updated
- [ ] README updated if user-facing behavior changed

#### File Hygiene
- [ ] No debug/logging statements left in code
- [ ] No TODO comments without linked issue
- [ ] Imports are organized (Biome handles this)
- [ ] No files outside the expected directory structure

---

## 6. Documentation

### 6.1 Documentation Tool: TypeDoc

**Decision:** Use [TypeDoc](https://typedoc.org/) as the primary API documentation generator.

**Rationale:**

| Criteria | TypeDoc | API Extractor | Docusaurus | VitePress |
|----------|---------|---------------|------------|-----------|
| Reads JSDoc from TS | Yes | Yes | No (manual) | No (manual) |
| Reads TS types | Yes | Yes | No | No |
| Generates HTML | Yes | No | N/A | N/A |
| Generates Markdown | Via plugin | Via plugin | N/A | N/A |
| Handles `src/` directly | Yes | Needs .d.ts | N/A | N/A |
| npm ecosystem fit | Excellent | Good | Good | Good |
| Community/maintenance | Very active | Active | Active | Active |
| Setup complexity | Low | Medium | High | High |

TypeDoc is the best choice because:
1. It reads TypeScript source directly — no build step needed
2. JSDoc comments in code become documentation automatically
3. The `typedoc-plugin-markdown` plugin generates Markdown for a future docs site
4. It handles our barrel exports (`index.ts`) correctly
5. It's the standard for TypeScript library documentation

### 6.2 Documentation layers

| Layer | Tool | Audience | Location |
|-------|------|----------|----------|
| **API Reference** | TypeDoc | Library users (programmatic API) | `docs/api/` (generated) |
| **CLI Reference** | Hand-written Markdown | CLI users | `docs/cli-reference.md` |
| **JSDoc in code** | JSDoc/TSDoc standard | Both (via TypeDoc) | Inline in `src/` |
| **Usage guide** | Hand-written Markdown | New users | `docs/guide.md` |

### 6.3 JSDoc standards

Every exported function, class, interface, and type alias must have JSDoc:

```typescript
/**
 * Creates a new issue in the tracker.
 *
 * @param params - Issue creation parameters
 * @param params.title - The issue title (required, 1-200 characters)
 * @param params.priority - Priority level 1-5 (default: 3)
 * @param params.tags - Array of string tags
 * @param params.parentId - Parent issue ID for hierarchy
 * @returns The created issue ID and metadata
 * @throws {TrackgenticError} NOT_INITIALIZED if tracker not initialized
 * @throws {TrackgenticError} HIERARCHY_CONSTRAINT if parent is closed
 *
 * @example
 * ```typescript
 * const result = await tracker.create({
 *   title: "Fix login bug",
 *   priority: 2,
 *   tags: ["bug", "auth"]
 * });
 * // result: { result: "OK", id: "m1abc2defg" }
 * ```
 */
async create(params: CreateIssueParams): Promise<CreateIssueResult>;
```

### 6.4 TypeDoc configuration

**File:** `packages/library/typedoc.json`

```json
{
  "$schema": "https://typedoc.org/schema.json",
  "entryPoints": ["src/index.ts"],
  "out": "../../docs/api",
  "plugin": ["typedoc-plugin-markdown"],
  "readme": "none",
  "excludePrivate": true,
  "excludeProtected": false,
  "excludeInternal": true,
  "categorizeByGroup": true,
  "categoryOrder": ["Core", "Types", "Errors", "*"]
}
```

### 6.5 NPM scripts

```json
{
  "docs:generate": "typedoc",
  "docs:check": "typedoc --emit none"
}
```

### 6.6 Documentation update process

Every change to library source code triggers this documentation process:

```
Code changes in src/
        │
        ▼
1. JSDoc comments updated in changed files
   (responsibility of library-developer or library-quality)
        │
        ▼
2. library-quality runs `bun run docs:check`
   - Verifies TypeDoc can parse all JSDoc without errors
   - Catches missing/broken references
        │
        ▼
3. library-quality runs `bun run docs:generate`
   - Regenerates docs/api/ from source
   - Only committed if content changed
        │
        ▼
4. library-quality reviews generated docs
   - API reference is complete and accurate
   - Examples render correctly
   - Types are properly documented
```

---

## 7. Dependencies to Install

### Development dependencies for quality tooling

```json
{
  "devDependencies": {
    "@biomejs/biome": "^2.0.0",
    "typedoc": "^0.28.0",
    "typedoc-plugin-markdown": "^4.0.0",
    "typescript": "^5.7.0",
    "@types/bun": "^1.2.0"
  }
}
```

### Full scripts section

```json
{
  "scripts": {
    "test": "bun test",
    "test:coverage": "bun test --coverage",
    "test:watch": "bun test --watch",
    "typecheck": "tsc --noEmit",
    "lint": "biome check src/ tests/",
    "lint:fix": "biome check --fix src/ tests/",
    "format": "biome format --write src/ tests/",
    "docs:generate": "typedoc",
    "docs:check": "typedoc --emit none",
    "quality": "bun run typecheck && bun run lint && bun run test:coverage"
  }
}
```

The `quality` script runs all gates in sequence: typecheck → lint → test with coverage. This is the single command that must pass before any change is accepted.

---

## 8. library-quality Agent Responsibilities

The `library-quality` agent is responsible for:

1. **Running quality gates** on every change: `bun run quality`
2. **Writing tests** for new and modified code
3. **Reviewing test coverage** and identifying gaps
4. **Generating documentation** via TypeDoc
5. **Reviewing JSDoc quality** in source code
6. **Enforcing the quality checklist** from Section 5

### When library-quality runs

| Trigger | Action |
|---------|--------|
| library-developer completes a phase | Full quality gate + test gap analysis + doc generation |
| library-developer makes incremental changes | Run quality gate on changed files + write missing tests |
| CTO requests quality review | Full quality gate + checklist review + coverage report |

### library-quality access needs

The `library-quality` agent needs read+write access to:
- `packages/library/tests/` — to write tests
- `packages/library/docs/` — to generate documentation (or `docs/api/` at monorepo root)
- Read access to `packages/library/src/` — to understand code being tested

---

## 9. Quality Metrics

The following metrics should be tracked per phase:

| Metric | Target | How to measure |
|--------|--------|----------------|
| Line coverage (core/) | >= 90% | `bun run test:coverage` |
| Line coverage (cli/) | >= 80% | `bun run test:coverage` |
| Line coverage (overall) | >= 80% | `bun run test:coverage` |
| TypeScript strict errors | 0 | `bun run typecheck` |
| Lint errors | 0 | `bun run lint` |
| Lint warnings | <= 5 | `bun run lint` |
| Public API methods with JSDoc | 100% | `bun run docs:check` |
| Error codes with tests | 100% | grep test files for each ErrorCode |
