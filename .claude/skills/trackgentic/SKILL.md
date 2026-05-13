---
name: trackgentic
description: "Interact with the trackgentic issue tracker. Use to create, list, view, update, and manage issues, comments, users, and blockages. Every agent should use this skill to track their work and coordinate with other agents."
---

# Trackgentic — Issue Tracker for AI Agents

Trackgentic is a file-backed, event-sourced, git-friendly issue tracker designed for AI agents. All commands are run via the `trackgentic` CLI.

## Authentication

You must authenticate using your own token. Prepend the environment variable to every command:

```bash
TRACKGENTIC_TOKEN="<your-token>" trackgentic <command> [options]
```

The token will be provided to you by, if you don't have it yet do not try to use trackgentic, STOP and ask for it. Each agent should have its own token to allow for proper attribution.


## CLI Reference

### Issues

Create, list, view, and update issues.

#### Create an issue

```bash
TRACKGENTIC_TOKEN="<token>" trackgentic create "<title>" [options]
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
TRACKGENTIC_TOKEN="<token>" trackgentic list [options]
```

Options:
- `--status <status>` — Filter by status (use `"open"` for non-closed, `"closed"` for closed)
- `--assignee <string>` — Filter by assignee
- `--tags <comma-separated>` — Comma-separated tags (AND filter)
- `--parentId <id>` — Filter by parent ID (use `"null"` for top-level)

#### View an issue

```bash
TRACKGENTIC_TOKEN="<token>" trackgentic view <issueId>
```

Returns the full computed state of an issue as JSON, including: id, title, description, status, priority, assignee, parentId, tags, createdAt, createdBy, updatedAt.

#### Update an issue

```bash
TRACKGENTIC_TOKEN="<token>" trackgentic update <issueId> [options]
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
TRACKGENTIC_TOKEN="<token>" trackgentic history <issueId>
```

Returns the raw event history for an issue.

### Comments

Manage comments on issues.

| Command | Description |
|---------|-------------|
| `TRACKGENTIC_TOKEN="<token>" trackgentic comments add <issueId> --content "<content>"` | Add a comment |
| `TRACKGENTIC_TOKEN="<token>" trackgentic comments update <issueId> <commentId> --content "<content>"` | Update a comment |
| `TRACKGENTIC_TOKEN="<token>" trackgentic comments delete <issueId> <commentId>` | Delete a comment |
| `TRACKGENTIC_TOKEN="<token>" trackgentic comments list <issueId>` | List all comments on an issue |

### Blockages

Manage issue dependency blockages. An issue can be blocked by other issues — it cannot proceed until its blockers are resolved.

| Command | Description |
|---------|-------------|
| `TRACKGENTIC_TOKEN="<token>" trackgentic blockages add <blockedId> --by <blockerId1> <blockerId2> ...` | Add blocker dependencies |
| `TRACKGENTIC_TOKEN="<token>" trackgentic blockages resolve <blockedId> --by <blockerId1> ...` | Resolve blockage dependencies |
| `TRACKGENTIC_TOKEN="<token>" trackgentic blockages delete <blockedId> --by <blockerId1> ...` | Delete blockage dependencies |
| `TRACKGENTIC_TOKEN="<token>" trackgentic blockages list <issueId>` | List blockage info for an issue |

## Workflow Guidelines

The whole project work needs to be tracked in issues. Use the CLI to manage your issues and coordinate with other agents.

### Before working on an issue

If you are given an issue id to work on, use `trackgentic view <issueId>` to get the details. Then check:

* If the issue is not assigned to you, stop and report it.
* If the issue is blocked by other issues, stop and report the blockers.
* If the issue is done or closed, stop and report it.

### When working on an issue

1. Read the comments of the issue to understand the context and any relevant discussions.
2.a If the issue is in `idea` status, add a comment with your thoughts, analysis, or proposed approach. Do not update the issue status or make any code changes at this point.
2.b If the issue is in `todo` status, update the status to `in-progress` and start working on it.

### When finishing work on an issue

If the issue gets completely resolved by your work, mark it as `done` and add a comment summarizing what you did.

If the issue was only partially resolved or you get blocked by some reason during the development, add a comment describing the current state, any blockers you encountered, and what remains to be done, mark the issue as `todo` again and assign it to the next responsible agent if needed.



If the issue is an `idea`, do not update any code. Instead, add a comment to the issue with your thoughts, analysis, or proposed approach.
If the issue is `todo`, move it to `in-progress` and start working on it. Update the issue with comments as you make progress, and if you encounter any blockers, add them as blockages.
When you finish working on an issue, update its status to `review` and add a comment summarizing what you did. Then wait for the reviewer to review your work and either approve it (move to `done`) or request changes (move back to `in-progress` with feedback in comments).



When you start working on an issue:

If the ticket is blocked by other issues, check the blockers with `trackgentic blockages list <issueId>`. If it's blocked, stop and report the blockers. If it's not blocked, proceed with the work.



When you start working on an issue

### Before starting work
1. List open issues assigned to you: `TRACKGENTIC_TOKEN="$TOKEN" trackgentic list --assignee "<your-name>" --status open`
2. Check for blockages on your issues: `TRACKGENTIC_TOKEN="$TOKEN" trackgentic blockages list <issueId>`
3. Pick the highest-priority unblocked issue to work on

### While working
1. Update issue status as you progress (e.g., `idea` → `in-progress` → `review` → `done`)
2. Add comments to document decisions, findings, or questions
3. If blocked by another issue, add a blockage: `TRACKGENTIC_TOKEN="$TOKEN" trackgentic blockages add <your-issue> --by <blocker-issue>`

### After completing work
1. Update the issue status to `done` or `closed`
2. Add a completion comment summarizing what was done
3. Resolve any blockages you were causing for other issues
