# Trackgentic Library — Data Model & Types

All types are defined in `src/types/`. This document specifies every type, interface, and file format.

## 1. Issue Status

```typescript
type IssueStatus = "idea" | "todo" | "in-progress" | "done" | "closed";
```

Status progression: `idea -> todo -> in-progress -> done -> closed`

The special filter value `"open"` is **not** a real status — it means "all statuses except `closed`".

## 2. Issue ID

```typescript
type IssueId = string; // 10 chars: 6 from timestamp base36 + 4 random base36
```

Generation: `Date.now().toString(36).slice(0, 6) + Math.random().toString(36).slice(-4)`

IDs are sortable by creation time.

## 3. Comment ID

```typescript
type CommentId = string; // Same format as IssueId: 10-char base36
```

Generated with the same algorithm as issue IDs.

## 4. Event Types

### Event (base shape)

```typescript
interface BaseEvent {
  timestamp: string; // ISO 8601
  author: string;    // resolved user name or "system"
}
```

### Typed events

```typescript
type Event =
  | CreationEvent
  | UpdateEvent
  | CommentEvent
  | CommentUpdateEvent
  | CommentDeleteEvent
  | BlockageAddedEvent
  | BlockageResolvedEvent
  | BlockageDeletedEvent;

interface CreationEvent extends BaseEvent {
  type: "creation";
  // No content — creation is just a marker
}

interface UpdateEvent extends BaseEvent {
  type: "update";
  content: Partial<Pick<IssueProperties, "title" | "description" | "status" | "assignee" | "tags" | "priority" | "parentId">> & {
    reason?: string; // for system auto-promotion events
  };
}

interface CommentEvent extends BaseEvent {
  type: "comment";
  content: {
    id: CommentId;
    content: string;
  };
}

interface CommentUpdateEvent extends BaseEvent {
  type: "comment-update";
  content: {
    id: CommentId;
    content: string;
  };
}

interface CommentDeleteEvent extends BaseEvent {
  type: "comment-delete";
  content: {
    id: CommentId;
  };
}

interface BlockageAddedEvent extends BaseEvent {
  type: "blockage-added";
  content: {
    blockerId: IssueId;
  };
}

interface BlockageResolvedEvent extends BaseEvent {
  type: "blockage-resolved";
  content: {
    blockerId: IssueId;
  };
}

interface BlockageDeletedEvent extends BaseEvent {
  type: "blockage-deleted";
  content: {
    blockerId: IssueId;
  };
}
```

## 5. Issue Properties

These are the mutable properties of an issue, reconstructed by replaying events.

```typescript
interface IssueProperties {
  id: IssueId;
  title: string;
  description: string;
  status: IssueStatus;
  assignee: string | null;
  parentId: IssueId | null;
  tags: string[];
  priority: 1 | 2 | 3 | 4 | 5;
}
```

## 6. Computed Issue (view output)

The full computed state of an issue, including computed fields.

```typescript
interface ComputedIssue extends IssueProperties {
  createdAt: string;   // ISO 8601 — timestamp of creation event
  createdBy: string;   // author of creation event
  updatedAt: string;   // ISO 8601 — timestamp of last event
}
```

## 7. Comment (computed)

```typescript
interface ComputedComment {
  id: CommentId;
  author: string;
  content: string;
  timestamp: string;    // ISO 8601 — when the comment was created
  editedAt: string | null; // ISO 8601 — when last comment-update was applied, or null
}
```

## 8. Index File (`index.json`)

```typescript
interface IndexFile {
  open: IndexEntry[];       // Issues with status !== "closed", sorted by id
  closed: IndexEntry[];     // Issues with status === "closed", sorted by id
  childrenOf: Record<IssueId, IssueId[]>; // parentId -> child IDs
}

interface IndexEntry {
  id: IssueId;
  title: string;
  path: string;             // relative path to issue file
  status: IssueStatus;
  assignee: string | null;
  parentId: IssueId | null;
  tags: string[];
  priority: 1 | 2 | 3 | 4 | 5;
}
```

### Invariants

- Both arrays are **sorted by issue id** (which is time-sortable).
- `open` contains entries where `status !== "closed"`.
- `closed` contains entries where `status === "closed"`.
- When status changes to/from `closed`, the entry moves between arrays.
- `childrenOf` keys only exist for issues that have children. Absent key = no children.

## 9. Config File (`config.json`)

```typescript
interface ConfigFile {
  auth: {
    mode: "open" | "read-only" | "strict";
    defaultUser: string;
  };
}
```

Defaults on `init`:
```json
{
  "auth": {
    "mode": "read-only",
    "defaultUser": "anonymous"
  }
}
```

## 10. Dependencies File (`dependencies.json`)

```typescript
interface DependenciesFile {
  blockedBy: Record<IssueId, BlockageEntry[]>; // what blocks me
  blocks: Record<IssueId, BlockageEntry[]>;    // what I block
}

interface BlockageEntry {
  blockerId: IssueId;
  blockedId: IssueId;
  status: "active" | "resolved";
}
```

### Invariant

Both maps are **always in sync**. Every mutation writes both sides atomically.

## 11. Users File (`users.json`)

```typescript
interface UsersFile {
  users: UserEntry[];
}

interface UserEntry {
  name: string;           // stored lowercase
  token: string;          // format: tk_ + 8 random alphanumeric chars
  registeredAt: string;   // ISO 8601
}
```

## 12. Issue Event File (`issues/[id].json`)

```typescript
type IssueEventFile = Event[]; // append-only array of events
```

## 13. Initial File Contents on `init`

### `index.json`
```json
{
  "open": [],
  "closed": [],
  "childrenOf": {}
}
```

### `dependencies.json`
```json
{
  "blockedBy": {},
  "blocks": {}
}
```

### `users.json`
```json
{
  "users": []
}
```

## 14. Blockage Info (view output)

```typescript
interface BlockageInfo {
  issueId: IssueId;
  blockedBy: BlockageEntry[];
  blocks: BlockageEntry[];
}
```

## 15. User Info (list output)

```typescript
interface UserInfo {
  name: string;
  registeredAt: string;
}
```
