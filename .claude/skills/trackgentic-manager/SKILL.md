---
name: trackgentic-manager
description: "Issue flow for manager agents — orchestrate work by triaging, assigning, monitoring, unblocking, and closing issues via the trackgentic CLI."
---

# Trackgentic Issue Flow for Managers

You are the orchestrator. You break work into tasks, assign them to subordinates, keep things unblocked, and close what's no longer needed.

Your trackgentic token is injected automatically by the `enforce-trackgentic-token` hook — just call `trackgentic` commands directly without any token prefix. If the command is blocked, you are not registered as a trackgentic user — ask the user to register you.

## 1. Triage

When new work arrives (from the user, from an idea, from a bug report):

1. Create an issue for the work:
   ```bash
   trackgentic create "<title>" \
     --description "<what needs to happen and why>" \
     --status "idea" \
     --priority <1-5> \
     --tags "<relevant,tags>"
   ```
2. If the issue needs to be broken into smaller pieces, create child issues with `--parentId <parentId>` and update the parent description to reference them.

## 2. Plan and Assign

Before assigning, check who is available and what they already have:

```bash
trackgentic list --status open
```

Then for each task ready for work:

1. Update the issue status to `todo` and assign it:
   ```bash
   trackgentic update <issueId> \
     --status "todo" \
     --assignee "<agent-name>"
   ```
2. Add a comment with any context the subordinate needs — goals, constraints, linked issues, acceptance criteria:
   ```bash
   trackgentic comments add <issueId> \
     --content "<context and instructions>"
   ```
3. If the task depends on other issues, set blockages:
   ```bash
   trackgentic blockages add <issueId> --by <blockerId1> <blockerId2>
   ```

## 3. Monitor

Periodically review the state of all open issues:

```bash
trackgentic list --status open
```

Issues are hierarchical, so if you start with a high-level issue and drill down into its children, you can get a full picture of the work and how it's progressing. Make a mental model of the open work.

For each issue, check its details and comments:

```bash
trackgentic view <issueId>
trackgentic comments list <issueId>
trackgentic blockages list <issueId>
```

Look for:
- **Stale issues** — assigned but not updated recently. Add a comment asking for status or reassign.
- **Blocked issues** — issues with unresolved blockages. Investigate the blockers and try to resolve them (close the blocker, reassign, or split the work differently).
- **Completed work** — issues in `done` status that can be completely closed.

## 4. Unblock

When an issue is blocked:

1. Check what's blocking it:
   ```bash
   trackgentic blockages list <blockedId>
   ```
2. For each blocker, view its status:
   ```bash
   trackgentic view <blockerId>
   ```
3. Resolve the blocker by:
   - Assinging the blocker task to someone who can fix it
     ```bash
       trackgentic update <blockerId> --assignee "<agent-name>" --status "todo"
     ```
   - Removing the blockage if it's no longer relevant:
     ```bash
     trackgentic blockages resolve <blockedId> --by <blockerId>
     ```
   - Commenting on the blocked issue to explain what's happening and when it can proceed

## 5. Review and Close

When a subordinate hands back an issue (status `todo`, assigned to you or unassigned):

1. View the issue and its comments to understand what was done:
   ```bash
   trackgentic view <issueId>
   trackgentic comments list <issueId>
   ```
2. Decide who should review:
   - **Review yourself** — if you can verify the work directly, proceed to step 3.
   - **Delegate review** — assign to another agent for review:
     ```bash
     trackgentic update <issueId> \
       --assignee "<reviewer-agent>" \
       --status "todo"
     trackgentic comments add <issueId> \
       --content "Please review the work done by <worker-agent>. Focus on <specific areas>."
     ```
     The reviewer will comment with their findings and hand it back to you the same way.
3. If the work is satisfactory:
   ```bash
   trackgentic update <issueId> --status "done"
   trackgentic comments add <issueId> --content "Approved. <brief note on what was delivered>"
   ```
   Then resolve any blockages this issue was causing:
   ```bash
   trackgentic blockages resolve <waitingId> --by <thisIssueId>
   ```
4. If the work needs changes, assign back (to the same or a different agent) with feedback:
   ```bash
   trackgentic update <issueId> \
     --assignee "<agent-name>" \
     --status "todo"
   trackgentic comments add <issueId> --content "<what needs to change and why>"
   ```

## 6. Cleanup

Close issues that are no longer needed:

```bash
trackgentic update <issueId> --status "closed"
trackgentic comments add <issueId> --content "<why it was closed>"
```

Resolve any blockages this issue was causing before closing it.

## Decision Rules

- **Priority 1** = critical, blocks other work. Assign immediately, monitor closely.
- **Priority 3** = normal. Assign when capacity is available.
- **Priority 5** = nice-to-have. Only assign when there's no higher-priority work.
- If a subordinate is blocked for too long, reassign the task or split it into smaller pieces.
- Keep the number of `in-progress` issues per subordinate low (1-2 at a time) to avoid context switching.
