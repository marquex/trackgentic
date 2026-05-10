# Trackgentic

We want to create a typescript library that is an issue tracker easy to use for agents. It should be based on events and backed only by files, so it can be commited to git without generating conflicts.

The library will provide a CLI command to interact with the issues, and it should be distributed as a npm package to be easy to use in any typescript project.

## File structure

The library will be backed 100% by files, and the structure will be simple:

* An JSON index file that will contain pointers to all issues with minimal metadata to help with searching and filtering.
* A JSON file for each issue, with an array of events that describe the history of changes to the issue.


## The index file

The index will be a JSON file that contains 2 arrays of objects: one for open issues and one for closed issues. Each object will contain the following properties:

* `id`: a unique identifier for the issue, generated as a UUID.
* `title`: a short title for the issue.
* `path`: the file path to the issue's JSON file.
* `status`: the current status of the issue
* `assignee`: the agent assigned to the issue, if any.
* `parentId`: the id of the parent issue, if this issue is a sub-issue.
* `tags`: an array of tags associated with the issue, for easier searching and filtering.
* `priority`: a numeric priority for the issue (1 = highest, 5 = lowest, default 3).

With that information we can easily parse the index file and find the issues we are looking for without having to read all the issue files.

## The issue file

Each issue will be represented by a JSON file that contains an array of events. Each event will have the following properties:

* `timestamp`: the date and time when the event occurred.
* `type`: the type of event (e.g., "creation", "update", "comment", ...)
* `author`: the name of the user that performed the action (resolved from their token).
* `content`: the content of the event, which can be a string or an object depending on the type of event.

To know the current state of the issue, we need to read all the events in the issue file and apply them in order. This way we can reconstruct the history of the issue and understand how it evolved over time.

## Issue properties

The issue will have the following properties:

* `id`: a unique identifier for the issue, a mix of a timestamp and a random string to ensure uniqueness. We can implement it by `Date.now().toString(36).slice(0,6) + Math.random().toString(36).slice(-4)`, which gives us a 10-character string that is sortable by creation time and has enough randomness to avoid collisions in normal usage.
* `title`: a short description of the issue.
* `description`: a detailed description of the issue.
* `status`: `idea`, `todo`, `in-progress`, `done`, `closed`
* `assignee`: the agent assigned to the issue, if any.
* `parentId`: issues will have a hierarchical structure, so they can have a parent issue. This allows us to create sub-issues and organize them in a tree structure.
* `tags`: an array of custom tags associated with the issue, for easier classifying, searching and filtering.
* `priority`: a numeric value from 1 (highest) to 5 (lowest) indicating the priority of the issue. Default is 3.
* `comments`: an array of comments added to the issue, each comment will have a `timestamp` and `content`

## CLI commands

The way of interacting with the issue tracker will be through a CLI command that will allow agents quickly query and update issues. The main command will be `trackgentic` and it will have the following subcommands:

* `init`: to initialize the issue tracker in a repository, creating the necessary folders and files.
* `create`: to create a new issue
* `update`: to update an existing issue
* `list`: to list issues based on filters
* `view`: to view the details of an issue
* `history`: to view the history of changes of an issue
* `comments`: to manage comments of an issue
* `blockages`: to manage blockages between issues

See the [commands documentation](commands.md) for more details on the available commands and their usage.

## Configuration

The library needs to locate the index file to work. That file will live in `./trackgentic/index.json` inside of the repository so it can be tracked.

The resolution of the index file depends on where the command is executed from. The library will look for the index file in the current working directory and if it doesn't find it, it will look in the parent directory, and so on until it reaches the root of the filesystem.

If the index file is not found, any command will return an error indicating that the index file is missing and that the user needs to initialize it by running `trackgentic init` where the `.trackgentic` folder with the index file will be created.

It's possible to have multiple `.trackgentic` folders in different parts of the repository, allowing to have different issue trackers for different subdirectories. This can be useful for monorepos or projects with different components that want to have their own issue tracker.

The `.trackgentic` folder will also contain the default folder for the issues. If when creating an issue the path is not specified, the issue file will be created in the resolved `.trackgentic` folder, inside of the issues directory.

The structure of the `.trackgentic` folder will be as follows:

```
.trackgentic/
  config.json
  index.json
  dependencies.json
  users.json
  issues/
    [issue_id].json
```

## Prioritization

With agents creating and updating issues all the time, it's important to have a way to prioritize issues.

Each issue has a numeric `priority` field ranging from 1 (highest) to 5 (lowest), with a default of 3. Priority is stored as a regular issue property, set and changed via `update` events just like any other attribute. It is also mirrored in the index file so that `list` can sort and filter without reading individual issue files.

When listing issues, the default sort order is priority ascending (most important first), then `createdAt` ascending (oldest first). This allows agents to wake up, query for their open issues, and immediately know what to work on next.


## Comments

Issues support comments as part of their event log. Comments can be added, edited, and deleted — each action appends a new event (`comment`, `comment-update`, `comment-delete`) rather than mutating the original, preserving the full history. When listing comments, the current state is computed by replaying these events. See the [commands documentation](commands.md) for the full details on comment management.

## Blockages and dependencies

Issues can be blocked by other issues, creating dependencies that affect prioritization and scheduling. To manage this, we maintain a separate dependency index in `dependencies.json` that tracks which issues are blocked by which others. See [blockages documentation](issue-blockages.md) for the full details on how blockages work, how they are stored, and how they affect issue prioritization.

## User authentication

Trackgentic is designed to be used by multiple actors — AI agents, humans, or automated systems. To attribute actions to the correct user, a lightweight token-based authentication system is used. Users register themselves to obtain a token, and provide that token when executing commands. The auth mode is configurable: the system can require tokens for all commands, only for writes, or allow unauthenticated access with a default user. See the [user authentication documentation](user-auth.md) for full details.
