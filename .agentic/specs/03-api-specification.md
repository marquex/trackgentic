# Trackgentic Library — Programmatic API Specification

The `Tracker` class is the single entry point for the programmatic API. It is exported from `src/index.ts` alongside all response types.

## 1. Constructor

```typescript
class Tracker {
  constructor(cwd?: string);
}
```

- `cwd` is the starting directory for `.trackgentic/` resolution. Defaults to `process.cwd()`.
- The constructor does **not** validate that `.trackgentic/` exists. Resolution happens on each method call.

## 2. Initialization

### `init(): Promise<InitResult>`

```typescript
type InitResult =
  | { result: "OK"; path: string }
  | { result: "ALREADY_INITIALIZED"; path: string };
```

- Creates `.trackgentic/` directory with `config.json`, `index.json`, `dependencies.json`, `users.json`, and `issues/` subdirectory.
- Idempotent: if already initialized (`.trackgentic/` exists in cwd), returns `ALREADY_INITIALIZED` with the existing path. Does **not** overwrite existing files.

## 3. Issue CRUD

### `create(params: CreateParams): Promise<CreateResult>`

```typescript
interface CreateParams {
  title: string;
  description?: string;
  assignee?: string;
  tags?: string[];         // defaults to []
  status?: IssueStatus;    // defaults to "idea"
  priority?: 1 | 2 | 3 | 4 | 5; // defaults to 3
  parentId?: IssueId | null;
  path?: string;           // defaults to issues/[id].json
  author?: string;         // resolved by auth layer if not provided
}

type CreateResult =
  | { id: IssueId }
  | TrackgenticError;
```

**Behavior:**
1. Resolve author via auth system.
2. Generate issue ID.
3. Create issue file with two events: `creation` then `update` (with initial properties).
4. Insert entry into index (sorted by id in the `open` or `closed` array).
5. If `parentId` is provided, update `childrenOf` map in index.
6. If `parentId` is provided and parent is `closed`, reject with error.
7. Return `{ id }`.

### `update(id: IssueId, params: UpdateParams): Promise<UpdateResult>`

```typescript
interface UpdateParams {
  title?: string;
  description?: string;
  status?: IssueStatus;
  assignee?: string | null;   // null to clear
  tags?: string[];
  priority?: 1 | 2 | 3 | 4 | 5;
  parentId?: IssueId | null;  // null to detach
  author?: string;
}

type UpdateResult =
  | { result: "OK" }
  | TrackgenticError;
```

**Behavior:**
1. Resolve author via auth system.
2. Validate issue exists (index lookup + file existence).
3. At least one field must be provided.
4. Append `update` event to issue file with changed fields.
5. Update index entry with new computed state.
6. If `status` changed:
   - If moving to `closed`, check downward constraints (no non-done/non-closed children).
   - If moving to `done` or `closed`, check upward constraints (auto-promote parent if needed).
   - Auto-resolve any active blockages where this issue is the blocker.
   - Move between `open` and `closed` index arrays as needed.
7. If `parentId` changed:
   - Update `childrenOf` map (remove from old parent, add to new).
   - If new parent is `closed`, reject.
   - Check upward constraints with new parent.
8. If status changed to `done` or `closed`, cascade: auto-close `done` children if closing parent.
9. Return `{ result: "OK" }`.

### `list(params?: ListParams): Promise<ListResult>`

```typescript
interface ListParams {
  status?: IssueStatus | "open";  // "open" = all except closed
  assignee?: string;
  tags?: string[];                // AND filter — issue must have ALL tags
  parentId?: IssueId | null;      // null = top-level issues only
}

type ListResult = IndexEntry[];  // From index file, no issue file reads
```

**Behavior:**
1. Read index file.
2. Determine source array(s):
   - If `status === "closed"` → search `closed` array.
   - If `status === "open"` → search `open` array.
   - If `status` is a specific non-closed status → search `open` array.
   - If no status filter → search both arrays.
3. Apply filters in memory (assignee, tags, parentId).
4. Sort: priority ASC → impact score DESC → createdAt ASC (via id sort).
5. Return filtered entries.

**Note:** Impact score requires reading `dependencies.json` to count active `blocks` entries. If performance is a concern, this can be cached per operation.

### `view(id: IssueId): Promise<ViewResult>`

```typescript
type ViewResult =
  | ComputedIssue
  | TrackgenticError;
```

**Behavior:**
1. Binary search in index for issue. If not found → `NOT_FOUND`.
2. Read issue file. If missing → `ISSUE_MISSING`.
3. Replay all events to compute current state.
4. Return computed issue.

### `history(id: IssueId): Promise<HistoryResult>`

```typescript
type HistoryResult =
  | Event[]
  | TrackgenticError;
```

**Behavior:**
1. Binary search in index for issue. If not found → `NOT_FOUND`.
2. Read issue file. If missing → `ISSUE_MISSING`.
3. Return raw event array.

## 4. Comments

### `commentsAdd(id: IssueId, params: CommentAddParams): Promise<CommentAddResult>`

```typescript
interface CommentAddParams {
  content: string;
  author?: string;
}

type CommentAddResult =
  | { result: "OK"; commentId: CommentId }
  | TrackgenticError;
```

### `commentsUpdate(id: IssueId, commentId: CommentId, params: CommentUpdateParams): Promise<CommentUpdateResult>`

```typescript
interface CommentUpdateParams {
  content: string;
  author?: string;
}

type CommentUpdateResult =
  | { result: "OK" }
  | TrackgenticError;
```

**Validates:** Comment exists and is not deleted. Returns `COMMENT_NOT_FOUND` otherwise.

### `commentsDelete(id: IssueId, commentId: CommentId, params?: CommentDeleteParams): Promise<CommentDeleteResult>`

```typescript
interface CommentDeleteParams {
  author?: string;
}

type CommentDeleteResult =
  | { result: "OK" }
  | TrackgenticError;
```

**Validates:** Comment exists and is not already deleted. Returns `COMMENT_NOT_FOUND` otherwise.

### `commentsList(id: IssueId): Promise<CommentsListResult>`

```typescript
type CommentsListResult =
  | ComputedComment[]
  | TrackgenticError;
```

**Behavior:** Replay all comment events. `comment` creates, `comment-update` overrides content, `comment-delete` excludes. Returned in creation order.

## 5. Blockages

### `blockagesAdd(blockedId: IssueId, params: BlockagesAddParams): Promise<BlockagesAddResult>`

```typescript
interface BlockagesAddParams {
  blockerIds: IssueId[];  // one or more blockers
  author?: string;
}

type BlockagesAddResult =
  | { result: "OK" }
  | TrackgenticError;
```

**Behavior:**
1. Validate both `blockedId` and all `blockerIds` exist in index.
2. Copy dependency graph to memory.
3. For each blocker in order:
   - Add to projected graph.
   - Walk `blockedBy` transitively from this blocker. If `blockedId` is reached → cycle detected.
4. If any cycle found → reject entire batch, return error.
5. Write all entries to `dependencies.json` (both `blockedBy` and `blocks` maps).
6. Append `blockage-added` event to blocked issue's file for each blocker.

### `blockagesResolve(blockedId: IssueId, params: BlockagesResolveParams): Promise<BlockagesResolveResult>`

```typescript
interface BlockagesResolveParams {
  blockerIds: IssueId[];
  author?: string;
}

type BlockagesResolveResult =
  | { result: "OK" }
  | TrackgenticError;
```

### `blockagesDelete(blockedId: IssueId, params: BlockagesDeleteParams): Promise<BlockagesDeleteResult>`

```typescript
interface BlockagesDeleteParams {
  blockerIds: IssueId[];
  author?: string;
}

type BlockagesDeleteResult =
  | { result: "OK" }
  | TrackgenticError;
```

**Behavior:** Remove entries from both `blockedBy` and `blocks` maps. Append `blockage-deleted` event.

### `blockagesList(id: IssueId): Promise<BlockagesListResult>`

```typescript
type BlockagesListResult =
  | BlockageInfo
  | TrackgenticError;
```

## 6. Users

### `usersRegister(name: string): Promise<UsersRegisterResult>`

```typescript
type UsersRegisterResult =
  | { result: "OK"; name: string; token: string }
  | { result: "USER_ALREADY_EXISTS"; message: string };
```

- Name is lowercased. `"anonymous"` is reserved.
- Token format: `tk_` + 8 random alphanumeric chars.
- Does not require authentication (this is how users obtain tokens).

### `usersList(): Promise<UsersListResult>`

```typescript
type UsersListResult = UserInfo[];
```

- Tokens are **never** included in the output.

### `usersRevoke(name: string, callerToken: string): Promise<UsersRevokeResult>`

```typescript
type UsersRevokeResult =
  | { result: "OK" }
  | { result: "USER_NOT_FOUND"; message: string };
```

- Requires a valid `callerToken` (any registered user can revoke).

### `usersRegenerate(name: string, callerToken: string): Promise<UsersRegenerateResult>`

```typescript
type UsersRegenerateResult =
  | { result: "OK"; name: string; token: string }
  | { result: "USER_NOT_FOUND"; message: string }
  | { result: "INVALID_TOKEN"; message: string };
```

- `callerToken` must belong to the user being regenerated (self-service only).

## 7. Auth Resolution

The auth layer is internal — it is not called directly by consumers. It is invoked by Tracker methods before executing mutations.

```typescript
function resolveAuthor(options: {
  token?: string;         // from TRACKGENTIC_USER_TOKEN env var
  config: ConfigFile;
  users: UsersFile;
  requiresWrite: boolean; // true for mutations, false for reads
}): Promise<{ author: string } | TrackgenticError>;
```

**Logic:**

1. Resolve `token` from `process.env.TRACKGENTIC_USER_TOKEN`.
2. Check `config.auth.mode`:
   - `strict`: all commands require token. No token → `TOKEN_REQUIRED`.
   - `read-only`: if `requiresWrite` and no token → `TOKEN_REQUIRED`.
   - `open`: if no token → use `config.auth.defaultUser`. If `defaultUser` is missing → `DEFAULT_USER_MISSING`.
3. If token is provided, look up in `users.json`. Not found → `INVALID_TOKEN`.
4. Return resolved author name.

## 8. Error Types

All errors are instances of `TrackgenticError`, which extends `Error`.

```typescript
class TrackgenticError extends Error {
  constructor(
    public readonly result: string,   // error code
    public readonly message: string,  // human-readable
    public readonly exitCode: number  // non-zero for CLI
  );
}
```

### Error Codes

| Code | Exit Code | When |
|------|-----------|------|
| `NOT_INITIALIZED` | 1 | `.trackgentic/` not found |
| `ALREADY_INITIALIZED` | 0 | `init` when already exists (not really an error) |
| `TOKEN_REQUIRED` | 2 | Auth mode requires token but none provided |
| `INVALID_TOKEN` | 3 | Token doesn't match any user |
| `DEFAULT_USER_MISSING` | 4 | Open mode with no defaultUser |
| `NOT_FOUND` | 5 | Issue ID not in index |
| `ISSUE_MISSING` | 6 | Index entry exists but file is missing |
| `COMMENT_NOT_FOUND` | 7 | Comment ID not found or already deleted |
| `USER_ALREADY_EXISTS` | 8 | Registration with duplicate name |
| `USER_NOT_FOUND` | 9 | Revoke/regenerate for non-existent user |
| `INVALID_PARAMS` | 10 | Missing required flags/params |
| `BLOCKAGE_CYCLE` | 11 | Blockage would create a cycle |
| `HIERARCHY_CONSTRAINT` | 12 | Parent/child status constraint violated |

## 9. Public Exports

`src/index.ts` exports:

```typescript
// Main API
export { Tracker } from "./core/tracker";

// All response types
export type {
  InitResult,
  CreateParams, CreateResult,
  UpdateParams, UpdateResult,
  ListParams, ListResult,
  ViewResult,
  HistoryResult,
  CommentAddParams, CommentAddResult,
  CommentUpdateParams, CommentUpdateResult,
  CommentDeleteResult,
  CommentsListResult,
  BlockagesAddParams, BlockagesAddResult,
  BlockagesResolveParams, BlockagesResolveResult,
  BlockagesDeleteParams, BlockagesDeleteResult,
  BlockagesListResult,
  UsersRegisterResult,
  UsersListResult,
  UsersRevokeResult,
  UsersRegenerateResult,
} from "./types/api";

// All data types
export type {
  IssueId, CommentId, IssueStatus,
  IssueProperties, ComputedIssue,
  ComputedComment,
  IndexEntry, IndexFile,
  ConfigFile,
  DependenciesFile, BlockageEntry, BlockageInfo,
  UsersFile, UserEntry, UserInfo,
  Event, CreationEvent, UpdateEvent,
  CommentEvent, CommentUpdateEvent, CommentDeleteEvent,
  BlockageAddedEvent, BlockageResolvedEvent, BlockageDeletedEvent,
} from "./types";

// Error class
export { TrackgenticError } from "./core/errors";
```
