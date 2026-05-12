# trackgentic

Issue tracker designed for AI agents — file-backed, event-sourced, git-friendly.

Every issue is an append-only event log stored as JSON. State is computed by replaying events, so the full history of every issue is always preserved. All data lives in a `.trackgentic/` directory inside your project, making it easy to version-control alongside your code.

## Features

- **File-backed** — all state is JSON in `.trackgentic/`, ready for `git add`
- **Event-sourced** — every change is an immutable event; full history is always available
- **CLI + Programmatic API** — use from the shell or import as a library, same JSON output
- **Issue hierarchy** — parent/child relationships with automatic status propagation
- **Blockage tracking** — dependency graph with cycle detection and auto-resolution
- **Comments** — add, update, delete per issue, computed from events
- **Auth modes** — `open`, `read-only`, or `strict` token-based authentication
- **Zero runtime deps** (besides `commander` for CLI parsing)

## Install

```bash
npm install trackgentic
```

Requires Node.js >= 20 or Bun >= 1.0.

## Quick Start

### CLI

```bash
# Initialize a tracker in the current directory
npx trackgentic init

# Create an issue
npx trackgentic create "Fix login bug" --priority 2 --tags bug,auth

# List open issues
npx trackgentic list

# View an issue
npx trackgentic view <issueId>

# Update an issue
npx trackgentic update <issueId> --status in-progress --assignee alice

# View full event history
npx trackgentic history <issueId>
```

### Comments

```bash
npx trackgentic comments add <issueId> --content "Reproduced on staging"
npx trackgentic comments list <issueId>
npx trackgentic comments update <issueId> <commentId> --content "Updated note"
npx trackgentic comments delete <issueId> <commentId>
```

### Blockages

```bash
# Mark issue A as blocked by issue B
npx trackgentic blockages add <blockedId> --by <blockerId>

# View what blocks / is blocked by an issue
npx trackgentic blockages list <issueId>

# Resolve a blockage (also happens automatically when blocker is done/closed)
npx trackgentic blockages resolve <blockedId> --by <blockerId>

# Remove a blockage entirely
npx trackgentic blockages delete <blockedId> --by <blockerId>
```

### Users & Auth

```bash
# Register a user and get a token
npx trackgentic users register alice

# List registered users
npx trackgentic users list

# Revoke a user
npx trackgentic users revoke alice

# Regenerate token (self-service, requires your own token)
TRACKGENTIC_USER_TOKEN=tk_xxxxxxxx npx trackgentic users regenerate alice
```

### Programmatic API

```typescript
import { Tracker } from "trackgentic";

const tracker = new Tracker(); // resolves .trackgentic/ from cwd

// Initialize
await tracker.init();

// Create an issue
const { id } = await tracker.create({
  title: "Fix login bug",
  priority: 2,
  tags: ["bug", "auth"],
});

// List issues
const issues = await tracker.list({ status: "open" });

// View an issue with full computed state
const issue = await tracker.view(id);

// Update an issue
await tracker.update(id, { status: "in-progress", assignee: "alice" });

// Full event history
const events = await tracker.history(id);
```

## How It Works

Running `trackgentic init` creates a `.trackgentic/` directory in your project:

```
.trackgentic/
├── config.json         # Auth mode and defaults
├── index.json          # Sorted index of all issues (open + closed)
├── dependencies.json   # Blockage graph (blockedBy + blocks)
├── users.json          # Registered users and tokens
└── issues/
    └── l0j3k2a9b7.json # One file per issue — append-only event log
```

Each issue file is an array of events:

```json
[
  { "type": "creation", "timestamp": "...", "author": "alice" },
  { "type": "update", "timestamp": "...", "author": "alice", "content": { "status": "in-progress" } },
  { "type": "comment", "timestamp": "...", "author": "bob", "content": { "id": "m4n5o6p7q8", "content": "Looking into it" } },
  { "type": "update", "timestamp": "...", "author": "alice", "content": { "status": "done" } }
]
```

The current state of an issue is always computed by replaying its event log. There is no mutable state — only events.

## Issue Status Flow

```
idea → todo → in-progress → done → closed
```

Hierarchical constraints are enforced:

- A `closed` parent cannot have new children added
- When a parent is closed, all `done` children are automatically closed (downward cascade)
- When all children of a parent are `done` or `closed`, the parent is auto-promoted to `done` (upward promotion)

Blockages are auto-resolved when the blocking issue moves to `done` or `closed`.

## Configuration

Auth mode is set in `.trackgentic/config.json`:

| Mode | Behavior |
|------|----------|
| `open` | Writes use `defaultUser` if no token provided |
| `read-only` | Reads are open, writes require a token |
| `strict` | All operations require a token |

Default on `init` is `open` with `defaultUser: "anonymous"`.

## License

[MIT](LICENSE)
