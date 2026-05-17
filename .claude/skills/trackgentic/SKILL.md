---
name: trackgentic
description: "Interact with the trackgentic issue tracker. Use to create, list, view, update, and manage issues, comments, users, and blockages. Every agent should use this skill to track their work and coordinate with other agents."
---

# Trackgentic — Issue Tracker for AI Agents

Trackgentic is a file-backed, event-sourced, git-friendly issue tracker designed for AI agents. All commands are run via the `trackgentic` CLI.

## Authentication

**You do NOT need to provide a token.** The system automatically injects your token when you call trackgentic. Just run commands directly:

```bash
trackgentic <command> [options]
```

A PreToolUse hook (`enforce-trackgentic-token.ts`) looks up your agent's token from `.trackgentic/users.json` using your agent name, strips any token you may have added to the command, and injects the correct one as `TRACKGENTIC_USER_TOKEN=xxx` before the command executes. This ensures every agent always uses its own registered token.

If your agent is not registered as a trackgentic user, the command will be blocked — ask your manager to register you first with `trackgentic users register "<agent-name>"`.

## CLI Reference

### Issues

Create, list, view, and update issues.

#### Create an issue

The title is a **positional argument** — do NOT use `--title`.

```bash
trackgentic create "My issue title" [options]
```

Options:
- `--description <string>` — Issue description
- `--assignee <string>` — Assignee name
- `--tags <comma-separated>` — Comma-separated tags
- `--status <status>` — Issue status (default: `idea`)
- `--priority <number>` — Priority 1-5 (default: 3)
- `--parentId <id>` — Parent issue ID

Returns the created issue ID as JSON: `{ "id": "<issueId>" }`

#### List issues

```bash
trackgentic list [options]
```

Options:
- `--status <status>` — Filter by status (use `"open"` for non-closed, `"closed"` for closed)
- `--assignee <string>` — Filter by assignee
- `--tags <comma-separated>` — Comma-separated tags (AND filter)
- `--parentId <id>` — Filter by parent ID (use `"null"` for top-level)

#### View an issue

```bash
trackgentic view <issueId>
```

Returns the full computed state of an issue as JSON, including: id, title, description, status, priority, assignee, parentId, tags, createdAt, createdBy, updatedAt.

#### Update an issue

```bash
trackgentic update <issueId> [options]
```

Options:
- `--title <string>` — New title
- `--description <string>` — New description
- `--status <status>` — New status
- `--assignee <string>` — New assignee
- `--tags <comma-separated>` — New tags (replaces existing)
- `--priority <number>` — New priority (1-5)
- `--parentId <id>` — New parent ID (use `"null"` to detach)

Returns `{ "result": "OK" }` on success.

#### View issue history

```bash
trackgentic history <issueId>
```

Returns the raw event history for an issue.

### Comments

Manage comments on issues.

| Command | Description |
|---------|-------------|
| `trackgentic comments add <issueId> --content "<content>"` | Add a comment to an issue |
| `trackgentic comments update <issueId> <commentId> --content "<content>"` | Update an existing comment |
| `trackgentic comments delete <issueId> <commentId>` | Delete a comment |
| `trackgentic comments list <issueId>` | List all comments on an issue |

### Blockages

Manage issue dependency blockages. An issue can be blocked by other issues — it cannot proceed until its blockers are resolved.

The `--by` option is variadic: pass multiple issue IDs separated by spaces after the flag.

| Command | Description |
|---------|-------------|
| `trackgentic blockages add <blockedId> --by <id1> <id2> ...` | Add blocker dependencies |
| `trackgentic blockages resolve <blockedId> --by <id1> <id2> ...` | Resolve blockage dependencies |
| `trackgentic blockages delete <blockedId> --by <id1> <id2> ...` | Delete blockage dependencies |
| `trackgentic blockages list <issueId>` | List blockage info for an issue |

### Users

Manage registered users and their tokens.

| Command | Description |
|---------|-------------|
| `trackgentic users register <name>` | Register a new user (returns a token) |
| `trackgentic users list` | List all registered users |
| `trackgentic users revoke <name>` | Revoke (remove) a user |
| `trackgentic users regenerate <name>` | Regenerate a user's token |

## Workflow Guidelines

The whole project work needs to be tracked in issues. Use the CLI to manage your issues and coordinate with other agents.

### Before starting work

1. List open issues assigned to you: `trackgentic list --assignee "<your-name>" --status open`
2. Check for blockages on your issues: `trackgentic blockages list <issueId>`
3. Pick the highest-priority unblocked issue to work on

### When starting an issue

1. View the issue details: `trackgentic view <issueId>`
2. If the issue is not assigned to you, stop and report it
3. If the issue is blocked by other issues, stop and report the blockers
4. If the issue is done or closed, stop and report it
5. Read the comments to understand context and relevant discussions
6. If the issue is in `idea` status: add a comment with your thoughts, analysis, or proposed approach. Do not update the status or make code changes.
7. If the issue is in `todo` status: update the status to `in-progress` and start working.

### While working

1. Add comments to document decisions, findings, or questions
2. If blocked by another issue, add a blockage: `trackgentic blockages add <your-issue> --by <blocker-issue>`
3. Update issue status as you progress (e.g., `idea` → `in-progress` → `review` → `done`)

### After completing work

1. If the issue is fully resolved: mark it as `done` and add a comment summarizing what you did
2. If partially resolved or blocked: add a comment describing the current state, blockers, and remaining work. Mark as `todo` and reassign if needed.
3. Resolve any blockages you were causing for other issues: `trackgentic blockages resolve <your-issue> --by <was-blocking>`
