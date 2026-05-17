---
name: issue
description: "Manager skill — analyze a user request, create a technical spec, break it into trackable issues with reviews AND implementation tasks, assign to workers, and set blockages so work flows automatically from review to implementation to quality validation. Receives the request as a prompt argument."
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
  --assignee "cto"
```

The parent issue represents the overall goal. It stays assigned to the CTO throughout the lifecycle.

### 4. Create Review Tasks

Create child issues for subordinates to **review the draft spec**:

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

### 5. Create Implementation Tasks

Now create the actual work items. These are blocked by the review tasks, so they only become actionable after reviews complete.

**IMPORTANT:** Implementation agents will read both the spec AND the review comments. Review comments contain the key feedback that improves the implementation. The spec stays as DRAFT — the combined spec + review comments give workers everything they need.

```bash
trackgentic create "Implement: <title>" \
  --description "Spec: .agentic/specs/<slug>-spec.md\n\nRead the spec AND the review comments on issues <dev-review-id> and <quality-review-id> before starting. The reviews contain critical feedback about feasibility, edge cases, and test impact.\n\n<what to implement>" \
  --parentId <parent-id> \
  --status "todo" \
  --assignee "library-developer" \
  --priority <same-as-parent> \
  --tags "<relevant,tags>"
```

```bash
trackgentic create "Validate: <title>" \
  --description "Spec: .agentic/specs/<slug>-spec.md\n\nValidate the implementation done by library-developer. Run quality gates, check test coverage on changed code, verify spec compliance.\n\n<what to validate>" \
  --parentId <parent-id> \
  --status "todo" \
  --assignee "library-quality" \
  --priority <same-as-parent> \
  --tags "<relevant,tags>"
```

### 6. Set Up Blockages

Reviews block implementation. Implementation blocks quality validation:

```bash
trackgentic blockages add <implementation-id> --by <dev-review-id> <quality-review-id>
trackgentic blockages add <validation-id> --by <implementation-id>
```

### 7. Add Context Comments

For each implementation issue, add a comment with context beyond what's in the spec:

```bash
trackgentic comments add <implementation-id> \
  --content "<context, links to relevant code areas, acceptance criteria summary, gotchas from reviews>"
```

### 8. Promote Parent

Once all tasks are created and blockages set:

```bash
trackgentic update <parent-id> --status "in-progress"
```

The parent stays `in-progress` (assigned to CTO) until all children complete.

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

- **Split** if: different agents own different parts, work can be parallelized, or the task has natural phases (review → implement → validate)
- **Single issue** if: it's small enough for one agent in one session and doesn't need review from another agent

### When NOT to create a spec

- Bug fixes with obvious cause and fix — just describe in the issue description
- Simple config/dependency changes — issue description is enough
- Tasks where the acceptance criteria fit in a single paragraph

### When to skip reviews

For trivial changes (one-line fix, config update), skip the review phase. Create only implementation + validation tasks, with no review blockages.

## Output

When done, summarize what was created:

```
Created:
  - Spec: .agentic/specs/<slug>-spec.md
  - Parent: <parent-id> "<title>" (assigned to cto)
    - Review: <dev-review-id> "Review spec: <slug>" → library-developer
    - Review: <quality-review-id> "Review spec: <slug>" → library-quality
    - Implement: <impl-id> "Implement: <title>" → library-developer (blocked by reviews)
    - Validate: <val-id> "Validate: <title>" → library-quality (blocked by implementation)
```
