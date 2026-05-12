---
description: "Delegate a task to another agent. Use when you need another specialized agent to handle a subtask, when you want to isolate work in a separate context, or when a task falls outside your domain expertise."
argument-hint: "<agent-name> <prompt>"
---

# Delegate Task

Use this skill to delegate a task to another agent by name.

## How to Use

Run the delegate script via Bash, providing the target agent name and the prompt:

```bash
bun .claude/skills/delegate/scripts/delegate.ts <agent-name> "<prompt>"
```

For example, to delegate a research task to an agent named `researcher`:

```bash
bun .claude/skills/delegate/scripts/delegate.ts researcher "Analyze the current BTC market trends and provide a summary"
```

Delegation can take a long time to complete depending on the complexity of the prompt and the target agent's processing time. Run them in the background when possible and wake up when the response is ready.

## Important Notes

- The target agent must be defined in `.claude/agents/<agent-name>.md`.
- The target agent must be listed in the calling agent's `subordinates` frontmatter field. Delegation is enforced at two levels: (1) the `enforce-agent-access` PreToolUse hook denies Bash commands that call `delegate.ts` with an unauthorized target, and (2) the `delegate.ts` script itself checks the calling agent's frontmatter before spawning the child process.
- Launch the delegation script as a background process when possible to avoid blocking the parent agent's execution while waiting for the child agent's response.
- The child agent's response is printed to stdout, which you will see in your context.
