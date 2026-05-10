---
name: claude-developing
description: Develop and maintain Claude Code extensions — skills, hooks, subagents, plugins, MCP servers, and Agent SDK apps. Use when creating, modifying, or debugging any Claude Code sources or when working on the .claude directory.
allowed-tools: Bash(curl *) Bash(mkdir *) Bash(cat *) Bash(date *) Bash(chmod *) Bash(find *) Bash(wc *)
---

# Claude Developing

In order to develop for claude code you need to understand the different extension points that you can use to extend the capabilities of claude code, and the best practices to create useful and efficient agents, skills, hooks and plugins.

You have access to the original claude-code documentation, which explains the different extension points and how to use them. You also have access to custom documentation where we explain our own best practices, conventions and preferences when developing for claude code.

* The original documentation is cached in `.claude/skills/claude-developing/docs/original/`. You can update the cache by running the update script explained in the "Updating the docs" section below.
* The custom documentation is in `.claude/skills/claude-developing/docs/custom/`. You can update it whenever you want with any information you consider useful to keep for future reference

## How to approach claude code development

Before starting to work on a task:

* Read `.claude/skills/claude-developing/docs/original/features-overview.md` to understand what are the different extension points in claude code.
* Read `.claude/skills/claude-developing/docs/custom/SUMMARY.md` to know about our conventions when developing for claude code.
* Analyze the task to decide which claude code extension points are relevant to it.
* Then read the specific documentation for those extension points to understand how to use them and what are the best practices to create efficient and useful extensions.
* If after reading the documentation you still have doubts on how to approach the task, there might be that it's related to some topic no covered from the features overview document. Only in this situation, read `.claude/skills/claude-developing/docs/original/llms.txt` where you can find a list with all the documents available for claude code development, and read the ones that are relevant for your task.

Once you have a clear understanding of the tasks and how to approach it, you can start working on it. Remember to follow the best practices and conventions explained in the documentation to make your extensions as useful and efficient as possible.

## Documentation Status

To know when the docs where last updated read `.claude/skills/claude-developing/docs/original/.last-update`.

## Updating the docs


To update the documentation, you can run the following command:

```bash
bun run ".claude/skills/claude-developing/scripts/update-docs.ts"
```

That command won't update the docs if they were updated less than 30 days ago, so you can run it safely without worrying about overwriting recent changes. If you want to force the update, you can add the `--force` flag:

```bash
bun run ".claude/skills/claude-developing/scripts/update-docs.ts" --force
``` 