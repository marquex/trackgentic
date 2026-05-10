# Trackgentic Library — Architecture Overview

## 1. Monorepo Structure

The project is a monorepo with two packages. The library is the first to be implemented; the UI will follow later.

```
trackgentic/
├── packages/
│   ├── library/            # The core trackgentic library (this spec)
│   └── ui/                 # Future: web-based UI (not in scope yet)
├── docs/                   # Project documentation
├── .agentic/               # Agentic infrastructure (specs, expertise, etc.)
├── .claude/                # Claude agent config
├── package.json            # Root workspace config
└── README.md
```

### Workspace configuration

The root `package.json` uses Bun workspaces:

```json
{
  "name": "trackgentic",
  "private": true,
  "workspaces": ["packages/*"]
}
```

Each package has its own `package.json`, `tsconfig.json`, and `src/` directory.

## 2. Library Package Structure

```
packages/library/
├── package.json
├── tsconfig.json
├── bunfig.toml
├── src/
│   ├── index.ts                  # Public API barrel export
│   ├── bin.ts                    # CLI entry point (#!/usr/bin/env bun)
│   ├── cli/
│   │   ├── runner.ts             # CLI argument parsing and command dispatch
│   │   ├── output.ts             # JSON formatting to stdout/stderr
│   │   └── commands/             # One file per CLI command
│   │       ├── init.ts
│   │       ├── create.ts
│   │       ├── update.ts
│   │       ├── list.ts
│   │       ├── view.ts
│   │       ├── history.ts
│   │       ├── comments.ts       # add, update, delete, list subcommands
│   │       ├── blockages.ts      # add, resolve, delete, list subcommands
│   │       └── users.ts          # register, list, revoke, regenerate subcommands
│   ├── core/
│   │   ├── tracker.ts            # Main Tracker class — programmatic API
│   │   ├── resolution.ts         # .trackgentic/ directory resolution (walk-up)
│   │   ├── events.ts             # Event append + replay engine
│   │   ├── index-manager.ts      # Sorted index management (insert, update, binary search)
│   │   ├── dependency-manager.ts # Bidirectional dependency map management
│   │   ├── auth.ts               # Token resolution, mode enforcement
│   │   ├── id.ts                 # ID generation (timestamp + random base36)
│   │   └── errors.ts             # Typed error classes
│   └── types/
│       ├── index.ts              # Re-exports
│       ├── issue.ts              # Issue-related types
│       ├── event.ts              # Event-related types
│       ├── index-file.ts         # Index file types
│       ├── dependency.ts         # Dependency types
│       ├── user.ts               # User types
│       ├── config.ts             # Config types
│       └── api.ts                # API response types (return types for every function)
└── tests/
    ├── core/
    │   ├── tracker.test.ts
    │   ├── resolution.test.ts
    │   ├── events.test.ts
    │   ├── index-manager.test.ts
    │   ├── dependency-manager.test.ts
    │   └── auth.test.ts
    └── cli/
        └── commands.test.ts
```

## 3. Design Principles

1. **CLI and programmatic API are interchangeable.** Every CLI command calls a method on the `Tracker` class. The `Tracker` method returns the exact same JSON object that the CLI prints. The CLI is a thin wrapper that parses args, calls the method, and prints the result.

2. **All output is JSON.** Successful results go to stdout as JSON. Errors go to stderr as JSON with a non-zero exit code. The programmatic API returns typed objects and throws `TrackgenticError` instances.

3. **No side effects in the API layer.** The `Tracker` class contains all business logic. CLI commands only handle arg parsing, output formatting, and process exit codes.

4. **File-backed, event-sourced.** All state lives in JSON files under `.trackgentic/`. Issues are append-only event logs. State is computed by replaying events.

5. **Atomic writes.** All file writes use write-to-temp-then-rename to prevent corruption.

6. **Bun-native.** TypeScript source, Bun runtime for execution and testing. Distributed as an npm package so it works in any Node/Bun project.

## 4. Dependencies

### Runtime dependencies

| Package | Purpose | Rationale |
|---------|---------|-----------|
| `commander` | CLI argument parsing | Battle-tested, well-typed, lightweight |

No other runtime dependencies. All file I/O uses Bun/Node built-ins. All JSON parsing is native.

### Development dependencies

| Package | Purpose |
|---------|---------|
| `typescript` | Type checking |
| `@types/bun` | Bun runtime types |
| `bun` (built-in) | Test runner |

## 5. Package Configuration

### `package.json`

```json
{
  "name": "trackgentic",
  "version": "0.1.0",
  "description": "Issue tracker designed for AI agents — file-backed, event-sourced, git-friendly",
  "type": "module",
  "main": "src/index.ts",
  "types": "src/index.ts",
  "exports": {
    ".": "./src/index.ts"
  },
  "bin": {
    "trackgentic": "./src/bin.ts"
  },
  "scripts": {
    "test": "bun test",
    "typecheck": "tsc --noEmit"
  },
  "files": ["src/"],
  "engines": {
    "bun": ">=1.0.0"
  },
  "dependencies": {
    "commander": "^13.0.0"
  },
  "devDependencies": {
    "typescript": "^5.7.0",
    "@types/bun": "^1.2.0"
  }
}
```

### `tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "esModuleInterop": true,
    "strict": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": "src",
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "resolveJsonModule": true,
    "types": ["bun-types"]
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

## 6. How CLI and Programmatic API Relate

```
┌─────────────────────────────────────────────────┐
│                  CLI Layer                       │
│  bin.ts → runner.ts → commands/*.ts              │
│  - Parse arguments                               │
│  - Call Tracker method                           │
│  - Print result as JSON (stdout) or error (stderr)│
│  - Set exit code                                 │
└──────────────────────┬──────────────────────────┘
                       │ calls
┌──────────────────────▼──────────────────────────┐
│              Tracker Class (core/tracker.ts)      │
│  - All business logic                            │
│  - Returns typed API response objects            │
│  - Throws TrackgenticError on failures           │
│                                                  │
│  Uses:                                           │
│  - resolution.ts (find .trackgentic/)            │
│  - events.ts (append + replay)                   │
│  - index-manager.ts (sorted index)               │
│  - dependency-manager.ts (blockage maps)         │
│  - auth.ts (token resolution)                    │
└──────────────────────────────────────────────────┘
```

The `Tracker` class is the single source of truth for all operations. The CLI never performs business logic directly.

## 7. Future: UI Integration

The UI package will import `trackgentic` as a dependency and call the programmatic API directly. Because the API returns the same JSON structures as the CLI outputs, the UI can also shell out to the CLI if needed (e.g., in a different process). This dual-path design is intentional.

The UI is not in scope for this specification.
