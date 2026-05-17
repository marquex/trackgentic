# Agent Orchestration Protocol

## Core Principle: Assignment = "Who Must Act Next"

- **Status** = state of the WORK itself
- **Assignee** = who holds the ball RIGHT NOW

The combination `(status, assignee)` is the full state machine. Reassigning IS the notification — no mention system needed.

---

## Status Semantics

| Status | Meaning | Who can be assignee |
|--------|---------|---------------------|
| `idea` | Proposed, not committed | Manager |
| `todo` | Approved, ready for execution | Worker |
| `in-progress` | Actively being worked on | Worker OR Manager (if escalated) |
| `done` | Work VERIFIED complete | Manager (for final closure) |
| `closed` | Fully resolved | Nobody |

**Critical rule: `done` means the work SUCCEEDED.** Never set `done` on failed/partial work. This protects downstream blockages from resolving prematurely.

---

## Agent Protocols

### Worker Protocol (library-developer, library-quality)

```
PICK UP:
  Poll: assigned to me AND status = todo
  → Move to in-progress, start working

SUCCESS:
  → Comment: "Done. <what was delivered, how tested>"
  → Status: done
  → Assignee: <manager>

BLOCKED (needs something from another agent/issue):
  → Comment: "Blocked: <what I need and from whom>"
  → Assignee: <manager>              ← ball goes to manager
  → Status stays: in-progress        ← work is NOT done
  (optionally create the blocker issue and add blockage)

FAILED (can't do it, wrong approach, out of scope):
  → Comment: "Cannot complete: <reason, what I tried, what remains>"
  → Assignee: <manager>
  → Status: todo                     ← reverts to "needs re-planning"
```

### Manager Protocol (CTO)

The manager doesn't work on a single issue — it processes a **queue** of issues that need attention:

```
POLL: all issues assigned to me, any open status

FOR EACH ISSUE, dispatch on (status):

  status = idea:
    → Evaluate, break down, promote to todo + assign worker
    → OR close as won't-do

  status = todo (handed back by worker):
    → Read comments to understand why
    → Re-plan: reassign, split, change scope, close

  status = in-progress (escalated by worker):
    → Worker is stuck. Read comments.
    → Resolve: create missing work, remove blockage, reassign, provide guidance via comment
    → Reassign back to worker when unblocked

  status = done (worker finished):
    → Review the work
    → If acceptable: close (or delegate review to quality agent first)
    → If needs changes: comment with feedback, status → todo, assign worker
```

---

## Runner Architecture: Two Loops

```
┌─────────────────────────────────────────────────────┐
│                   AGENT RUNNER                        │
├──────────────────────┬──────────────────────────────┤
│   WORKER LOOP        │   MANAGER LOOP               │
│   (every 30s)        │   (every 2-5 min)            │
│                      │                              │
│   For each idle      │   Poll: issues assigned      │
│   worker:            │   to CTO with status ≠       │
│                      │   closed                     │
│   list --assignee X  │                              │
│     --status todo    │   If any exist:              │
│                      │   spawn CTO with             │
│   If found:          │   /orchestrate               │
│   spawn worker with  │                              │
│   /worktask <id>     │   CTO processes entire       │
│                      │   queue in one session        │
└──────────────────────┴──────────────────────────────┘
```

Key difference: workers get **one issue at a time**; the manager gets **its entire queue** and handles them all in one session.

---

## Example Flow

Task: "Update `next` subcommand to only return issues with status `todo`"

```
1. CTO receives task (from user or its own triage)
   → Creates parent issue "Update next to filter todo only" (status: idea, assignee: cto)
   → Analyzes, creates spec
   → Creates child: "Implement filter" (status: todo, assignee: library-developer)
   → Creates child: "Tests & docs" (status: todo, assignee: library-quality)
   → Adds blockage: "Tests" blocked-by "Implement"

2. Worker loop picks up "Implement" for library-developer
   → Developer works, succeeds
   → Status: done, assignee: cto
   → Blockage on "Tests" auto-resolves (blocker reached done)

3. Manager loop fires, CTO sees "Implement" in done
   → Reviews, approves → status: closed
   → Checks children: "Tests" is now unblocked and assigned to quality

4. Worker loop picks up "Tests" for library-quality
   → Quality writes tests, reviews code
   → Finds a bug → Comment: "Bug: edge case when no issues exist"
   → Creates child issue: "Fix edge case" (assignee: cto, status: todo)
   → Adds blockage: "Tests" blocked-by "Fix edge case"
   → Reassigns "Tests" to cto: "Blocked on bug fix"

5. Manager loop fires, CTO sees "Fix edge case" + blocked "Tests"
   → Assigns "Fix edge case" to library-developer, status: todo

6. Developer fixes, marks done, CTO reviews, closes
   → Blockage resolves, CTO reassigns "Tests" back to quality
   → Quality finishes, done → CTO closes → parent closes
```

---

## Blockage Resolution

Blockages auto-resolve when the blocker reaches `done`. This means:

- Workers mark `done` only when work genuinely succeeds
- Downstream issues become unblocked but still need their assignee to pick them up (status must be `todo`)
- The CTO review on `done` → `closed` is for architectural alignment, not gating downstream work
- If quality finds bugs after auto-unblock, it creates NEW blocking issues — that's the feedback loop

---

## Design Decisions

| Problem | Solution |
|---|---|
| Worker fails → shouldn't unblock downstream | `done` is NEVER used for failure. Blocked/failed = reassign to manager, status stays `in-progress` or reverts to `todo` |
| CTO needs different loop than workers | Manager loop polls ALL assigned issues, spawns CTO with `/orchestrate` (batch). Workers get single-issue `/worktask` |
| No mention/notification system needed | Reassignment IS the notification. "Assigned to you" = "your turn to act" |
| Blockage safety | Blockages only auto-resolve on `done`. Only workers who verified their work set `done` |
| Review cycles | CTO can delegate review (assign to quality with comment) or review directly |
| Scalability | New workers just need the worker protocol. New managers just need the manager protocol. Runner config determines roles |
