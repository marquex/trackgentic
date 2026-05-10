# Trackgentic Library — CLI Specification

The CLI is a thin wrapper over the `Tracker` class. Every command parses arguments, calls the corresponding Tracker method, and prints the result.

## 1. Entry Point

`src/bin.ts` is the CLI entry point, referenced in `package.json` `bin` field.

```typescript
#!/usr/bin/env bun
```

Argument parsing is done with `commander`.

## 2. Output Format

- **Success:** JSON printed to **stdout**, exit code **0**.
- **Error:** JSON printed to **stderr**, exit code from error's `exitCode` field.

Error format:
```json
{ "result": "[ERROR_CODE]", "message": "[human-readable message]" }
```

## 3. Global Behavior

- All commands except `init` and `users register` first resolve the `.trackgentic/` directory by walking up from `cwd`.
- If not found → `NOT_INITIALIZED` error to stderr, exit 1.
- Auth token is read from `TRACKGENTIC_USER_TOKEN` env var and passed to Tracker methods.

## 4. Command Reference

### `trackgentic init`

| | |
|---|---|
| **Args** | None |
| **Flags** | None |
| **Auth** | None |
| **Calls** | `tracker.init()` |
| **Output** | `{ "result": "OK", "path": "/abs/path/to/.trackgentic" }` |
| **Error** | `{ "result": "ALREADY_INITIALIZED", "path": "/abs/path/to/.trackgentic" }` |

### `trackgentic create <title>`

| | |
|---|---|
| **Args** | `title` (required, positional) |
| **Flags** | `--description <string>` |
| | `--assignee <string>` |
| | `--tags <comma-separated>` → parsed to `string[]` |
| | `--status <status>` → default `"idea"` |
| | `--priority <1-5>` → default `3` |
| | `--parentId <id>` |
| | `--path <string>` |
| **Auth** | Write |
| **Calls** | `tracker.create({ title, ...flags, author })` |
| **Output** | `{ "id": "l0j3k2a9b7" }` |

### `trackgentic update <issueId>`

| | |
|---|---|
| **Args** | `issueId` (required, positional) |
| **Flags** | `--title <string>` |
| | `--description <string>` |
| | `--status <status>` |
| | `--assignee <string>` |
| | `--tags <comma-separated>` |
| | `--priority <1-5>` |
| | `--parentId <id>` (use `"null"` string to clear) |
| **Auth** | Write |
| **Calls** | `tracker.update(issueId, { ...flags, author })` |
| **Output** | `{ "result": "OK" }` |
| **Validates** | At least one flag must be provided → `INVALID_PARAMS` |

### `trackgentic list`

| | |
|---|---|
| **Args** | None |
| **Flags** | `--status <status or "open">` |
| | `--assignee <string>` |
| | `--tags <comma-separated>` |
| | `--parentId <id>` (use `"null"` for top-level) |
| **Auth** | Read (depends on mode) |
| **Calls** | `tracker.list({ ...flags })` |
| **Output** | `[{ "id": "...", "title": "...", "status": "...", "assignee": "...", "tags": [...], "parentId": "...", "priority": 3 }, ...]` |

### `trackgentic view <issueId>`

| | |
|---|---|
| **Args** | `issueId` (required, positional) |
| **Flags** | None |
| **Auth** | Read (depends on mode) |
| **Calls** | `tracker.view(issueId)` |
| **Output** | `{ "id": "...", "title": "...", "description": "...", "status": "...", "assignee": "...", "tags": [...], "parentId": null, "priority": 3, "createdAt": "...", "createdBy": "...", "updatedAt": "..." }` |

### `trackgentic history <issueId>`

| | |
|---|---|
| **Args** | `issueId` (required, positional) |
| **Flags** | None |
| **Auth** | Read (depends on mode) |
| **Calls** | `tracker.history(issueId)` |
| **Output** | `[{ "timestamp": "...", "type": "creation", "author": "..." }, ...]` |

### `trackgentic comments add <issueId> --content <content>`

| | |
|---|---|
| **Args** | `issueId` (required, positional) |
| **Flags** | `--content <string>` (required) |
| **Auth** | Write |
| **Calls** | `tracker.commentsAdd(issueId, { content, author })` |
| **Output** | `{ "result": "OK", "commentId": "..." }` |

### `trackgentic comments update <issueId> <commentId> --content <content>`

| | |
|---|---|
| **Args** | `issueId`, `commentId` (both required, positional) |
| **Flags** | `--content <string>` (required) |
| **Auth** | Write |
| **Calls** | `tracker.commentsUpdate(issueId, commentId, { content, author })` |
| **Output** | `{ "result": "OK" }` |

### `trackgentic comments delete <issueId> <commentId>`

| | |
|---|---|
| **Args** | `issueId`, `commentId` (both required, positional) |
| **Flags** | None |
| **Auth** | Write |
| **Calls** | `tracker.commentsDelete(issueId, commentId, { author })` |
| **Output** | `{ "result": "OK" }` |

### `trackgentic comments list <issueId>`

| | |
|---|---|
| **Args** | `issueId` (required, positional) |
| **Flags** | None |
| **Auth** | Read (depends on mode) |
| **Calls** | `tracker.commentsList(issueId)` |
| **Output** | `[{ "id": "...", "author": "...", "content": "...", "timestamp": "...", "editedAt": null }, ...]` |

### `trackgentic blockages add <blockedId> --by <blockerId...>`

| | |
|---|---|
| **Args** | `blockedId` (required, positional) |
| **Flags** | `--by <id...>` (required, one or more blocker IDs as comma-separated or repeated flag) |
| **Auth** | Write |
| **Calls** | `tracker.blockagesAdd(blockedId, { blockerIds, author })` |
| **Output** | `{ "result": "OK" }` |

### `trackgentic blockages resolve <blockedId> --by <blockerId...>`

| | |
|---|---|
| **Args** | `blockedId` (required, positional) |
| **Flags** | `--by <id...>` (required) |
| **Auth** | Write |
| **Calls** | `tracker.blockagesResolve(blockedId, { blockerIds, author })` |
| **Output** | `{ "result": "OK" }` |

### `trackgentic blockages delete <blockedId> --by <blockerId...>`

| | |
|---|---|
| **Args** | `blockedId` (required, positional) |
| **Flags** | `--by <id...>` (required) |
| **Auth** | Write |
| **Calls** | `tracker.blockagesDelete(blockedId, { blockerIds, author })` |
| **Output** | `{ "result": "OK" }` |

### `trackgentic blockages list <issueId>`

| | |
|---|---|
| **Args** | `issueId` (required, positional) |
| **Flags** | None |
| **Auth** | Read (depends on mode) |
| **Calls** | `tracker.blockagesList(issueId)` |
| **Output** | `{ "issueId": "...", "blockedBy": [...], "blocks": [...] }` |

### `trackgentic users register <name>`

| | |
|---|---|
| **Args** | `name` (required, positional) |
| **Flags** | None |
| **Auth** | None (this is how users get tokens) |
| **Calls** | `tracker.usersRegister(name)` |
| **Output** | `{ "result": "OK", "name": "alice", "token": "tk_k7x2m9p4" }` |

### `trackgentic users list`

| | |
|---|---|
| **Args** | None |
| **Flags** | None |
| **Auth** | Read (depends on mode) |
| **Calls** | `tracker.usersList()` |
| **Output** | `[{ "name": "alice", "registeredAt": "..." }, ...]` |

### `trackgentic users revoke <name>`

| | |
|---|---|
| **Args** | `name` (required, positional) |
| **Flags** | None |
| **Auth** | Write (any registered user) |
| **Calls** | `tracker.usersRevoke(name, token)` |
| **Output** | `{ "result": "OK" }` |

### `trackgentic users regenerate <name>`

| | |
|---|---|
| **Args** | `name` (required, positional) |
| **Flags** | None |
| **Auth** | Write (must be the user themselves) |
| **Calls** | `tracker.usersRegenerate(name, token)` |
| **Output** | `{ "result": "OK", "name": "alice", "token": "tk_r5t1y8u2" }` |

## 5. CLI Error Handling Pattern

```typescript
// In each command handler:
try {
  const result = await tracker.someMethod(params);
  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
} catch (err) {
  if (err instanceof TrackgenticError) {
    process.stderr.write(JSON.stringify({ result: err.result, message: err.message }) + "\n");
    process.exit(err.exitCode);
  }
  // Unexpected errors
  process.stderr.write(JSON.stringify({ result: "INTERNAL_ERROR", message: err.message }) + "\n");
  process.exit(1);
}
```
