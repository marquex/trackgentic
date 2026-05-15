# Expert agents

Expert agents are custom AI agents that are specialized on one specific domain. These agents are designed to learn from what the have done and build up expertise in a specific area.

There are 2 main features that make expert agents different from regular agents:

* They have a long-term memory that allows them to remember what they have done and learn from it. This memory is persisted across sessions, so the agent can build up expertise over time and every time it is used it can leverage that expertise to perform better and be more efficient.
* They have restricted access to tools and files, so they can only read or write to specific files that are relevant to their domain. This allows them to focus on their area of expertise and avoid distractions from irrelevant information.


## Structure of an expert agent

They are created in the `.claude/agents/` as any other agent. If their file name is `expert-agent.md` we can say that {AGENT_NAME} is `expert-agent`. E.g if the file name is `code-expert.md` we can say that {AGENT_NAME} is `code-expert`.

Every expert agent has a folder to let them store their mental model and their long-term memory. This folder is located in `.agentic/expertise/{AGENT_NAME}/` and we should grant the agent read, write and delete access to this folder, so they own those files. We should avoid editing those files directly, we should let the agent manage them the best they can.

The expertise folder should always have an index file for the mental model `.agentic/expertise/{AGENT_NAME}/{AGENT_NAME}-index.yaml`. The agent must always read this file at the beginning of every session to load its mental model, and work based on their expertise. 

At the end of the session, the agent should update their expertise with any new thing they have learned.


### Agent Hierarchy

Agents are organized in a manager-subordinate hierarchy. Work flows through trackgentic issues — managers create and assign issues, subordinates pick them up and work on them.

- Every agent can have a **manager** (an agent that assigns work to it via trackgentic issues). Documented in the system prompt.
- Every agent can have **subordinates** (agents it can assign work to via trackgentic issues). Declared in the `subordinates` frontmatter field.
- An agent at the top has no manager. A leaf agent has no subordinates.
- The hierarchy can have many levels.

Use the `hire-expert` skill to create new agents with proper hierarchy integration. When an agent is created, its manager's file is automatically updated to include it as a subordinate, and its subordinates' files are updated to reference it as their manager.

### Agent File Template

The basic structure of the expert agent file follows the template below:

```md
---
name: expert-agent
description: A brief description of the expert agent's domain, purpose and when to use it
tools: Read, Grep, Glob
skills:
  - agent-expertise
  - worktask
  - trackgentic
  - trackgentic-subordinate
subordinates: []  # list of agent names this agent can assign work to (omit if none)
access:
  - path: .agentic/expertise/expert-agent/**
    permissions: [read, write, delete]
  - path: src/**
    permissions: [read]
hooks:
  PreToolUse:
    - matcher: "Read|Write|Edit|MultiEdit|Bash"
      hooks:
        - type: command
          command: "bun .claude/hooks/enforce-agent-access.ts"
  SessionStart:
    - hooks:
        - type: command
          command: "bun .claude/skills/agent-expertise/expertise.hook.ts"
  UserPromptSubmit:
    - hooks:
        - type: command
          command: "bun .claude/skills/agent-expertise/expertise.hook.ts"
  Stop:
    - hooks:
        - type: command
          command: "bun .claude/skills/agent-expertise/expertise.hook.ts"
---

[System prompt for the expert agent, its purposes and goals. It shouldn't include specific instructions, instead it needs to set the agent direction and the agent should learn how to achieve that goal by itself. Remark that the agent should build expertise on every session]

{If this agent has subordinates, include a Coordinating Work section:}

## Coordinating Work

You coordinate work by creating trackgentic issues and assigning them to your subordinate agents. The agent runner will automatically pick up the issues and launch the agents.

To assign work to a subordinate:
```bash
TRACKGENTIC_TOKEN="$TOKEN" trackgentic create "Task description" --assignee <agent-name> --status todo --priority 2
```

{If this agent has a manager, mention it:}

Your manager is `manager-name` — you receive assigned tasks from it.

## Using trackgentic as the issue tracker

You manage your work through trackgentic issues. Use the `trackgentic` skill to create, update, and monitor issues. Follow the issue flow outlined in the `trackgentic-subordinate` skill for best practices on how to pick up, execute, report, and hand back issues effectively.

IMPORTANT: Your trackgentic token is `<token-here>`.

## Restricted domain

You have only access to the following folders:

<!-- ACCESS_RULES -->

This restriction is to keep you focused on your domain and avoid distractions. DO NOT TRY TO BYPASS THESE RESTRICTIONS, if your task requires access to files outside of these folders, fail the task and explain that you don't have access to those files.

```

The frontmatter of an expert agent has some specific content:
- The `agent-expertise` skill teaches the agent how to build expertise and how to use its long-term memory on every session.
- The `worktask` skill teaches the agent how to pick up and work on trackgentic issues.
- The `trackgentic` skill provides the CLI reference for the issue tracker.
- The `trackgentic-subordinate` skill provides the issue flow for worker agents.
- The `trackgentic-manager` skill is included if the agent has subordinates — it provides the issue flow for manager agents.
- The `subordinates` field is a list of agent names that this agent can assign work to. Omit if the agent is a leaf agent.
- The `access` section grants the agent permissions to read, write and delete files. It should include at least the path to the agent's expertise folder with read, write and delete permissions, and it can also include other paths with read permissions if needed.
- The `hooks` section includes a PreToolUse hook that runs `enforce-agent-access.ts` before using any tool. This script enforces the access restrictions.
- The `<!-- ACCESS_RULES -->` placeholder in the system prompt is replaced by the PostToolUse hook `inject-agent-markers.ts` with the formatted list of access rules from the frontmatter. The replacement happens automatically when the agent file is written.

### Project-wide hooks

In addition to the agent-specific hooks in the frontmatter, two enforcement hooks are registered project-wide in `.claude/settings.json`:

- **`enforce-trackgentic-token.ts`** (PreToolUse) — Verifies that agents use their own trackgentic token when calling the CLI. Prevents token impersonation between agents so issue changes are always attributed to the correct author.
- **`enforce-issue-cleanup.ts`** (SubagentStop) — Prevents agents from stopping when they have unblocked issues in `todo` or `in-progress` status assigned to them. Forces agents to resolve their issues (mark done, reassign, or add blockages) before the session can end.


## Types of expert agents

Every AI agent is better by turning it into an expert agent, but the ones that benefit the most of this approach are the ones that are not developers. AI agents tends to explore the code and try to update it when they need to perform a task, but a project-manager agent or a CEO agent doesn't need to even know the code, they just need to have clear goals and build expertise on how to achieve them and can assign tasks to other developer agents through trackgentic issues.

Said so, for developer agents, building expertise and restricting their access to a certain area, makes them specialists that work better and faster on that area.

Ideally all agents that we create should be expert agents.
