# Phase 3 Specification: Auth System & Users

**Status:** Ready for implementation
**Phase:** 3 of 7
**Depends on:** Phase 2 (complete — event engine, CRUD, CLI)
**Responsible agent:** library-developer

## Goal

User management and token-based auth enforcement. After this phase, all mutating operations require auth (depending on mode), and every event includes the correct author.

## Context

Phase 2 is complete with 122 tests, 742 assertions, 99.11% coverage. The following stubs/files exist:
- `src/core/auth.ts` — stub, needs full implementation
- `src/types/user.ts` — types defined (UsersFile, UserEntry, UserInfo)
- `src/types/config.ts` — types defined (ConfigFile with auth mode)
- `src/core/tracker.ts` — CRUD methods exist, author currently defaults to `"anonymous"`
- `src/cli/runner.ts` — commander setup with existing commands registered
- `src/types/api.ts` — user method response types may need verification

## Tasks

### Task 1: Implement `src/core/auth.ts`

Replace the stub with the full auth module.

**Export this function:**

```typescript
export function resolveAuthor(options: {
  token?: string;
  config: ConfigFile;
  users: UsersFile;
  requiresWrite: boolean;
}): { author: string } | TrackgenticError;
```

**Logic (synchronous — no need for async):**

1. Resolve `token` from `process.env.TRACKGENTIC_USER_TOKEN` if `options.token` is not provided.
2. Check `config.auth.mode`:
   - **`strict`**: all operations require token. No token → `TOKEN_REQUIRED` (exit code 2).
   - **`read-only`**: if `requiresWrite === true` and no token → `TOKEN_REQUIRED` (exit code 2).
   - **`open`**: if no token → use `config.auth.defaultUser`. If `defaultUser` is missing → `DEFAULT_USER_MISSING` (exit code 4).
3. If token is provided, look up in `users.users` array (find entry where `entry.token === token`). Not found → `INVALID_TOKEN` (exit code 3).
4. Return `{ author: entry.name }` or `{ author: config.auth.defaultUser }`.

**Error codes to use (from `src/core/errors.ts`):**
- `TOKEN_REQUIRED` — exit code 2
- `INVALID_TOKEN` — exit code 3
- `DEFAULT_USER_MISSING` — exit code 4

Make sure these error codes exist in `errors.ts`. If not, add them.

### Task 2: Implement user management in Tracker

Add these four methods to `src/core/tracker.ts`:

#### `usersRegister(name: string): Promise<UsersRegisterResult>`

1. Read `users.json` via file-io.
2. Lowercase the name: `name = name.toLowerCase()`.
3. Validate: reject `"anonymous"` as a reserved name → `USER_ALREADY_EXISTS`.
4. Check uniqueness: if `users.users.find(u => u.name === name)` exists → `USER_ALREADY_EXISTS` (exit code 8).
5. Generate token: `"tk_" + generateRandomAlphaNumeric(8)`. Use `Math.random().toString(36).slice(2, 10)` or similar.
6. Create `UserEntry { name, token, registeredAt: new Date().toISOString() }`.
7. Append to `users.users`.
8. Write `users.json` via `atomicWriteJSON`.
9. Return `{ result: "OK", name, token }`.

**Does NOT require auth** — this is the bootstrap mechanism.

#### `usersList(): Promise<UsersListResult>`

1. Read `users.json`.
2. Map to `UserInfo[]` (strip tokens): `users.users.map(u => ({ name: u.name, registeredAt: u.registeredAt }))`.
3. Return the array.

**Auth:** Depends on mode (read operation). Use `resolveAuthor` with `requiresWrite: false`.

#### `usersRevoke(name: string, callerToken: string): Promise<UsersRevokeResult>`

1. Validate caller token via `resolveAuthor` (requires write). The caller must be any registered user.
2. Read `users.json`.
3. Find user by name (lowercase). If not found → `USER_NOT_FOUND` (exit code 9).
4. Remove from `users.users`.
5. Write `users.json`.
6. Return `{ result: "OK" }`.

#### `usersRegenerate(name: string, callerToken: string): Promise<UsersRegenerateResult>`

1. Validate caller token via `resolveAuthor` (requires write).
2. Read `users.json`.
3. Find user by name (lowercase). If not found → `USER_NOT_FOUND` (exit code 9).
4. Validate that `callerToken` belongs to the user being regenerated (self-service only): the resolved author name must equal `name`. If not → `INVALID_TOKEN` (exit code 3).
5. Generate new token (same format as register).
6. Update the user entry.
7. Write `users.json`.
8. Return `{ result: "OK", name, token: newToken }`.

### Task 3: Integrate auth into existing Tracker methods

This is the most critical task. Every mutating Tracker method must call `resolveAuthor` before executing.

**Methods to update (all in `tracker.ts`):**

1. **`create(params)`**: Call `resolveAuthor({ config, users, requiresWrite: true, token: params.author })`. Use resolved author for events. If `params.author` is provided, it should be treated as a token override (not the literal author name). Actually — **simplify**: the CLI passes the env var token, the programmatic API also uses token. The `author` field in params should be removed or repurposed. **Decision**: `params.author` is removed from the public API. Author is always resolved via auth.

   Actually, let me reconsider. Looking at the spec, `CreateParams` has `author?: string`. For the programmatic API, the user can pass an explicit author. For the CLI, it comes from the token. Let me keep the current signature but change the semantics:
   - If `params.author` is provided, it's used directly (for programmatic API convenience in `open` mode).
   - If not provided, `resolveAuthor` is called and its result is used.

   **No — let's stay true to the architecture.** The spec says "resolved by auth layer if not provided". Let's make it simple: always call `resolveAuthor`. The `author` field in params was a placeholder that is now replaced by the auth system. **Remove `author` from `CreateParams`, `UpdateParams`, `CommentAddParams`, `CommentUpdateParams`, `CommentDeleteParams`, `BlockagesAddParams`, `BlockagesResolveParams`, `BlockagesDeleteParams`.**

   Wait — this would be a breaking change to the existing API types. Let me check the current state...

   The safest approach: Keep `author?` in params but ignore it during auth resolution. The auth system always resolves the author. If `author` is in params, it's overridden by auth resolution. This preserves backward compatibility while enforcing the auth contract.

   **Final decision:** Keep `author?: string` in all params types. Auth resolution always happens. The resolved author is what gets written into events. The `author` field in params is ignored when auth is in place. This avoids a type-breaking change and keeps the transition clean.

   Actually, let's be cleaner. The architecture says the `author` field in params is "resolved by auth layer if not provided." This means:
   - If `author` is provided in params → use it (for programmatic API)
   - If not → resolve via auth system

   But that defeats the purpose of auth enforcement. In strict mode, even if you pass `author: "admin"`, the token should be required and the author should come from the token, not from the param.

   **Cleanest approach:**
   - Always call `resolveAuthor` for mutations.
   - The resolved author is what gets written into events.
   - `author` in params is ignored — it only existed as a placeholder during Phase 2.
   - We can remove it from the types in a future cleanup, but for now just don't use it.

   **Implementation:** In each mutating method, read config and users, call `resolveAuthor`, use the result. Ignore `params.author`.

2. **Read methods** (`list`, `view`, `history`): Call `resolveAuthor` with `requiresWrite: false`. This means:
   - `open` mode: always allowed
   - `read-only` mode: always allowed
   - `strict` mode: requires token

3. **`init`**: No auth. This is the bootstrap.

4. **User methods**: See Task 2 above.

**Pattern for integrating auth in a mutating method:**

```typescript
async create(params: CreateParams): Promise<CreateResult> {
  const trackerDir = resolveTrackerDir(this.cwd);
  if (!trackerDir) {
    return new TrackgenticError("NOT_INITIALIZED", "...", 1);
  }

  const config = await readJSON<ConfigFile>(join(trackerDir, "config.json"));
  const users = await readJSON<UsersFile>(join(trackerDir, "users.json"));
  const authResult = resolveAuthor({ config, users, requiresWrite: true });
  if (authResult instanceof TrackgenticError) return authResult;
  const author = authResult.author;

  // ... rest of existing create logic, using `author` in events
}
```

**Pattern for read methods:**

```typescript
async list(params?: ListParams): Promise<ListResult> {
  const trackerDir = resolveTrackerDir(this.cwd);
  if (!trackerDir) {
    return new TrackgenticError("NOT_INITIALIZED", "...", 1);
  }

  const config = await readJSON<ConfigFile>(join(trackerDir, "config.json"));
  const users = await readJSON<UsersFile>(join(trackerDir, "users.json"));
  const authResult = resolveAuthor({ config, users, requiresWrite: false });
  if (authResult instanceof TrackgenticError) return authResult;

  // ... rest of existing list logic
}
```

**Important:** The default config on init is `{ auth: { mode: "read-only", defaultUser: "anonymous" } }`. This means by default, reads are free and writes require a token. Phase 2 tests were written with `author: "anonymous"` — the tests will need to be updated to either:
- Change the config mode to `"open"` in test setup, OR
- Register a user and pass the token in tests

**Recommendation:** Update the test helper `fixtures.ts` to include a convenience function that creates a tracker with `open` auth mode for unit tests, and add auth-specific tests that use `read-only` and `strict` modes.

### Task 4: Wire CLI commands for users

Create `src/cli/commands/users.ts` with four subcommands:

```
trackgentic users register <name>
trackgentic users list
trackgentic users revoke <name>
trackgentic users regenerate <name>
```

Follow the same pattern as existing commands (see `create.ts`, `list.ts`, etc.). Each command:
1. Resolves `.trackgentic/` directory
2. Reads `TRACKGENTIC_USER_TOKEN` from env
3. Calls the corresponding Tracker method
4. Prints result to stdout (JSON) or error to stderr

Register the `users` command with subcommands in `src/cli/runner.ts`.

**Note:** The `users register` command does NOT require auth. The `users list` is a read. `users revoke` and `users regenerate` require a token.

### Task 5: Update existing CLI commands to pass auth token

In each existing CLI command file (`create.ts`, `update.ts`, `list.ts`, `view.ts`, `history.ts`), add token reading:

```typescript
const token = process.env.TRACKGENTIC_USER_TOKEN;
```

Pass this token to the Tracker method. The Tracker method will use it for auth resolution.

**How to pass the token:** The Tracker methods need to accept a token. The cleanest approach is to add an `authToken?: string` field to the params of each method that needs auth, OR add it as a constructor parameter, OR pass it as a separate argument.

**Recommended approach:** Add a `token?: string` parameter to each Tracker method that needs auth. The method passes it to `resolveAuthor`. This keeps the Tracker stateless with respect to auth.

```typescript
// Updated signatures:
async create(params: CreateParams, authToken?: string): Promise<CreateResult>
async update(id: IssueId, params: UpdateParams, authToken?: string): Promise<UpdateResult>
async list(params: ListParams, authToken?: string): Promise<ListResult>
async view(id: IssueId, authToken?: string): Promise<ViewResult>
async history(id: IssueId, authToken?: string): Promise<HistoryResult>
```

The `resolveAuthor` function receives `token: authToken` (or reads from env if not provided).

Actually — simpler approach that's more aligned with the architecture spec: `resolveAuthor` reads from `process.env.TRACKGENTIC_USER_TOKEN` automatically. The CLI sets this env var. The programmatic API can also set it. No need to pass tokens through method signatures.

**Final decision:** `resolveAuthor` reads `process.env.TRACKGENTIC_USER_TOKEN` if no token is explicitly passed. CLI commands don't need to change — the env var is already set by the user's shell. Tracker methods don't need a token parameter.

This means: `resolveAuthor` is called inside Tracker methods with `token: process.env.TRACKGENTIC_USER_TOKEN`. The `options.token` parameter in `resolveAuthor` is optional — if not provided, it reads from env.

**No changes needed to CLI command files for auth token passing.** The env var is read by `resolveAuthor` internally. But the CLI commands DO need to be updated if the Tracker method signatures changed. Since we're not changing signatures, they stay the same.

## Files to Create

- `src/cli/commands/users.ts` — CLI commands for user management

## Files to Modify

- `src/core/auth.ts` — Replace stub with full implementation
- `src/core/tracker.ts` — Add user methods, integrate auth into existing methods
- `src/core/errors.ts` — Add missing error codes if not present (TOKEN_REQUIRED, INVALID_TOKEN, DEFAULT_USER_MISSING, USER_ALREADY_EXISTS, USER_NOT_FOUND)
- `src/cli/runner.ts` — Register users command
- `src/types/api.ts` — Verify/update user method types

## Files NOT to Modify

- `src/types/user.ts` — Types are already defined correctly
- `src/types/config.ts` — Types are already defined correctly
- `src/types/event.ts` — Event types are correct
- `src/cli/commands/init.ts` — Init doesn't require auth

## Testing Requirements

### Unit Tests: `tests/core/auth.test.ts` (new file)

Test `resolveAuthor` in all modes:

1. **Open mode, no token:** Returns `{ author: defaultUser }`
2. **Open mode, no token, no defaultUser:** Returns `DEFAULT_USER_MISSING` error
3. **Open mode, with token:** Looks up token in users, returns author
4. **Open mode, invalid token:** Returns `INVALID_TOKEN` error
5. **Read-only mode, no token, read op:** Returns default user author
6. **Read-only mode, no token, write op:** Returns `TOKEN_REQUIRED` error
7. **Read-only mode, with token, write op:** Looks up and returns author
8. **Strict mode, no token, read op:** Returns `TOKEN_REQUIRED` error
9. **Strict mode, no token, write op:** Returns `TOKEN_REQUIRED` error
10. **Strict mode, with token, read op:** Returns author
11. **Strict mode, with token, write op:** Returns author

### Unit Tests: `tests/core/tracker.test.ts` (extend existing)

Add tests for user methods:

1. `usersRegister`: creates user, returns token, name is lowercased
2. `usersRegister`: rejects duplicate name with `USER_ALREADY_EXISTS`
3. `usersRegister`: rejects "anonymous" with `USER_ALREADY_EXISTS`
4. `usersList`: returns users without tokens
5. `usersRevoke`: removes user with valid token
6. `usersRevoke`: rejects with `USER_NOT_FOUND`
7. `usersRegenerate`: generates new token, validates self-only
8. `usersRegenerate`: rejects when caller is not the target user with `INVALID_TOKEN`

### Integration Tests: Auth + CRUD

Add tests verifying auth enforcement on existing methods:

1. **Open mode:** Create without token → uses defaultUser as author
2. **Read-only mode:** Create without token → `TOKEN_REQUIRED`
3. **Read-only mode:** List without token → OK
4. **Strict mode:** List without token → `TOKEN_REQUIRED`
5. **Token provided:** Create with valid token → author from token
6. **Invalid token:** Create with invalid token → `INVALID_TOKEN`
7. **Author in events:** Verify that events have the resolved author, not "anonymous"

### CLI Tests: `tests/cli/commands.test.ts` (extend existing)

Add tests for users CLI commands:

1. `trackgentic users register alice` → returns token
2. `trackgentic users list` → shows alice without token
3. `trackgentic users revoke alice` with token → OK
4. `trackgentic users regenerate alice` with alice's token → new token

## Quality Gates

Before marking Phase 3 complete, all quality gates must pass:

- [ ] `bun run typecheck` — zero errors
- [ ] `bun run lint` — zero errors, zero warnings
- [ ] `bun test` — all tests pass (existing + new)
- [ ] Coverage >= 95% for `src/core/auth.ts`
- [ ] Coverage >= 90% for `src/core/tracker.ts` (user methods)
- [ ] `bun run docs:check` — TypeDoc parses cleanly

## Exit Criteria

1. `trackgentic users register alice` creates a user and returns a token
2. `trackgentic users list` shows registered users (no tokens)
3. `trackgentic users revoke alice` (with token) removes the user
4. `trackgentic users regenerate alice` (with own token) issues new token
5. All mutating commands respect auth mode (read-only by default)
6. Read commands respect strict mode
7. All events contain the resolved author (not "anonymous" when auth is configured)
8. All existing tests continue to pass
9. All new tests pass
10. All quality gates pass

## Implementation Notes

- `resolveAuthor` should be synchronous — it only does in-memory lookups
- Token format: `tk_` + 8 random alphanumeric chars (use `Math.random().toString(36).slice(2, 10)`)
- User names are always stored lowercase
- `"anonymous"` is a reserved name — cannot be registered
- The default auth mode on `init` is `"read-only"` with `defaultUser: "anonymous"`
- In `"open"` mode, the default user is used for author attribution without requiring registration
- `users.json` is written with `atomicWriteJSON` (not append — it's rewritten each time)
- `usersRegister` is the only operation that doesn't require auth (bootstrap mechanism)
