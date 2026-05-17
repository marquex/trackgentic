---
name: issue
description: "Manager skill — analyze a user request, create a technical spec, break it into trackable issues, assign to workers, and set blockages so work can begin. Receives the request as a prompt argument."
argument-hint: "<description of the change or feature>"
---

# Issue — Manager Planning Skill

This skill is invoked when a manager receives a request to plan and delegate work. The prompt argument contains the user's description of the desired change or feature.

## Workflow

### 1. Analyze the Request

Read the prompt argument carefully. Before creating anything, check for overlaps:

```bash
trackgentic list --status open
```

You do NOT read source code — you are an expert who knows the project's architecture, patterns, and conventions from your own expertise. Use that knowledge to reason about:

- What needs to change and why
- Which areas of the project are affected (files, modules, APIs)
- What the acceptance criteria should be
- Whether this overlaps with or depends on existing issues

### 2. Draft the Spec

Create an initial technical specification in `.agentic/specs/` based on your architectural expertise:

```
.agentic/specs/<slug>-spec.md
```

The draft spec must include:

- **Summary** — one paragraph explaining what and why
- **Requirements** — precise, testable acceptance criteria
- **API/interface changes** — method signatures, CLI flags, type definitions (your best design)
- **Implementation notes** — guidance on approach, relevant files, constraints
- **Out of scope** — what this does NOT cover
- **Status: DRAFT** — mark clearly that this is awaiting feedback

This is your best architectural sketch. It may have gaps or assumptions about current code — that's fine. The point is to give subordinates something concrete to react to.

### 3. Create the Parent Issue

```bash
trackgentic create "<concise title>" \
  --description "Spec: .agentic/specs/<slug>-spec.md\n\n<brief summary of the goal>" \
  --status "todo" \
  --priority <1-5> \
  --tags "<relevant,tags>" \
  --assignee "<your-own-name>"
```

The parent issue represents the overall goal. It starts as `todo` assigned to you. You will block it by the review tasks so it re-enters your queue only when reviews are complete.

### 4. Create Review Tasks and Block Parent

Before any implementation, create child issues for subordinates to **review the draft spec** and provide feedback:

```bash
trackgentic create "Review spec: <slug>" \
  --description "Review the draft spec at .agentic/specs/<slug>-spec.md\n\nAnalyze viability against the actual codebase. Comment with:\n- Feasibility issues\n- Missing edge cases\n- Suggested API changes\n- Implementation concerns\n\nDo NOT implement — only analyze and comment." \
  --parentId <parent-id> \
  --status "todo" \
  --assignee "library-developer" \
  --priority <same-as-parent> \
  --tags "review,spec"

trackgentic create "Review spec: <slug> (quality perspective)" \
  --description "Review the draft spec at .agentic/specs/<slug>-spec.md\n\nAnalyze from a testability and quality perspective. Comment with:\n- Testability concerns\n- Missing acceptance criteria\n- Documentation requirements\n- Edge cases that need coverage\n\nDo NOT implement — only analyze and comment." \
  --parentId <parent-id> \
  --status "todo" \
  --assignee "library-quality" \
  --priority <same-as-parent> \
  --tags "review,spec"
```

Now block the parent by both review tasks. This keeps the parent out of your actionable queue until reviews complete:

```bash
trackgentic blockages add <parent-id> --by <dev-review-id> <quality-review-id>
```

When both reviews reach `done`, the blockages auto-resolve, and the parent issue (still `todo`, assigned to you, now unblocked) re-enters your queue. This is the trigger for the next phase.

### 5. Finalize Spec (triggered when parent unblocks)

When the parent reappears in your queue (`todo`, assigned to you, unblocked), it means reviews are done. Read the feedback:

```bash
trackgentic comments list <dev-review-id>
trackgentic comments list <quality-review-id>
```

Incorporate feedback into the spec — update `.agentic/specs/<slug>-spec.md`:

- Resolve feasibility issues raised by the developer
- Add missing edge cases and acceptance criteria from quality
- Adjust API design based on what's actually possible in the codebase
- Change status from **DRAFT** to **FINAL**

If disagreements exist, make the call — you own the architectural decision. Comment on the review issue explaining your reasoning.

Close the review issues:

```bash
trackgentic update <dev-review-id> --status "closed"
trackgentic update <quality-review-id> --status "closed"
```

### 6. Create Implementation Tasks

Now that the spec is agreed upon, create the real work items:

```bash
trackgentic create "<implementation title>" \
  --description "Spec: .agentic/specs/<slug>-spec.md\n\n<what to implement>" \
  --parentId <parent-id> \
  --status "todo" \
  --assignee "library-developer" \
  --priority <same-as-parent> \
  --tags "<relevant,tags>"

trackgentic create "<tests & docs title>" \
  --description "Spec: .agentic/specs/<slug>-spec.md\n\n<what to test and document>" \
  --parentId <parent-id> \
  --status "todo" \
  --assignee "library-quality" \
  --priority <same-as-parent> \
  --tags "<relevant,tags>"
```

### 7. Set Blockages

If work must happen in order (e.g., tests can't be written until implementation exists):

```bash
trackgentic blockages add <tests-issue-id> --by <implementation-issue-id>
```

### 8. Add Context Comments

For each implementation issue, add a comment with anything the worker needs beyond the spec — constraints, related issues, gotchas:

```bash
trackgentic comments add <child-id> \
  --content "<context, links to spec sections, acceptance criteria summary>"
```

### 9. Promote Parent

Once all implementation children are created and assigned:

```bash
trackgentic update <parent-id> --status "in-progress"
```

The parent stays `in-progress` (assigned to you) until all children complete.

## Decision Guidelines

### Priority

| Priority | When to use |
|----------|-------------|
| 1 | Critical — blocks other work or users |
| 2 | Important — core functionality |
| 3 | Normal — standard feature/fix |
| 4 | Low — nice to have |
| 5 | Trivial — cosmetic or exploratory |

### When to split vs. single issue

- **Split** if: different agents own different parts, work can be parallelized, or the task has natural phases (implement → test)
- **Single issue** if: it's small enough for one agent in one session and doesn't need review from another agent

### When NOT to create a spec

- Bug fixes with obvious cause and fix — just describe in the issue description
- Simple config/dependency changes — issue description is enough
- Tasks where the acceptance criteria fit in a single paragraph

## Output

When done, summarize what was created:

```
Created:
  - Spec: .agentic/specs/<slug>-spec.md
  - Parent: <parent-id> "<title>"
    - Child: <child-id> "<title>" → assigned to <agent> [blocked by <id>]
    - Child: <child-id> "<title>" → assigned to <agent>
```
