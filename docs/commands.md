# CLI commands

The library will provide a CLI command to interact with the issues, and it should be distributed as a npm package to be easy to use in any typescript project.

The commands will print the output as JSON to be easily parsed by other tools and agents. The output will be printed to stdout, and any errors will be printed to stderr with a non-zero exit code.

The format of the commands will be `trackgentic [subcommand] [arguments] [flags]`, where `subcommand` is the action to perform, `arguments` are the required parameters for the command, and `flags` are optional parameters that can modify the behavior of the command.

## Available subcommands

### `trackgentic init`

Initialize the issue tracker in the current directory by creating the necessary folders and files. This command should be run once when setting up the issue tracker for a repository.

**Returns:**
- `{ "result": "OK", path: "[path_to_trackgentic_directory]" }` if the initialization was successful
- `{ "result": "ALREADY_INITIALIZED", path: "[path_to_existing_trackgentic_directory]" }` if the issue tracker is already initialized in the current directory or any of its parent directories.

**Notes:**
* This method is idempotent, if the issue tracker is already initialized it will not overwrite the existing files and will return an error indicating that it is already initialized.

### `trackgentic create [title] [flags]`

Create a new issue with the given title and optional attributes specified by flags.

**Flags:**
* `--description [description]`: a detailed description of the issue
* `--assignee [assignee]`: the agent assigned to the issue
* `--tags [tags]`: a comma-separated list of tags associated with the issue
* `--status [status]`: the initial status of the issue (default: `idea`)
* `--priority [priority]`: a numeric priority from 1 (highest) to 5 (lowest). Default is `3`
* `--parentId [parentId]`: the id of the parent issue, if this issue is a sub-issue
* `--path [path]`: the path where the issue file will be created, if not provided it will be created in the default location `./trackgentic/issues/[issue_id].json`

**Returns:**
The id of the created issue: `{ "id": "[issue_id]" }`

**Example:**
```bash
> trackgentic create "Implement authentication" --description "We need to implement authentication for our app" --assignee "Alice" --tags "backend,security" --status "todo" --priority 2

# returns {"id": "123456a2es"}
```

**Events:**
* `{ "timestamp": "2024-06-01T12:00:00Z", "type": "creation", "author": "alice"}`
* `{ "timestamp": "2024-06-01T12:00:00Z", "type": "update", "author": "alice", "content": { "title": "Implement authentication", "description": "We need to implement authentication for our app", "assignee": "Alice", "tags": ["backend", "security"], "status": "todo", "priority": 2 }}`

**Notes:**
* The creation event is separate from the update event that sets the initial properties of the issue. This change we can reconstruct the state of the issue attributes just by looking at update events, and the creation event is just a marker that the issue was created at that time.
* Once the file is created, the issue will be added to the index file with the initial metadata (id, title, path, status, assignee, parentId, tags and priority) so it can be easily found when listing or searching for issues.

### `trackgentic update [issue_id] [flags]`

Update an existing issue by id with optional attributes specified by flags. At least one flag must be provided to update the issue.

**Flags:**
* `--title [title]`: a short description of the issue
* `--description [description]`: a detailed description of the issue
* `--status [status]`: the current status of the issue. Allowed values are `idea`, `todo`, `in-progress`, `done`, `closed`
* `--assignee [assignee]`: the agent assigned to the issue
* `--tags [tags]`: a comma-separated list of tags associated with the issue
* `--priority [priority]`: a numeric priority from 1 (highest) to 5 (lowest)
* `--parentId [parentId]`: the id of the parent issue, if this issue is a sub-issue.

**Returns:**
- `{ "result": "OK" }` if the update was successful
-  Can return issues errors (see Errors section below)

**Example:**
```bash
trackgentic update 123456a2es --status "in-progress" --assignee "Bob"

# returns {"result": "OK"}
```

**Events:**
* `{ "timestamp": "2024-06-01T12:00:00Z", "type": "update", "author": "bob", "content": { "status": "in-progress", "assignee": "Bob" }}`

**Notes:**
* update events accept multiple attributes at once, if we want to calculate the state of one attribute we can just go through the `update` events and look for `content.[attribute]` to see when it was updated and what value it was set to.
* Once the issue is updated, the computed state is calculated and the index file is updated with the new metadata (title, status, assignee, tags, priority and parentId) so it can be easily found when listing or searching for issues.

### `trackgentic list [flags]`

List issues based on optional filters specified by flags. If no flags are provided, all issues will be listed.

**Flags:**
* `--status [status]`: filter issues by status. Allowed values are `idea`, `todo`, `in-progress`, `done`, `closed` and `open` (which includes all statuses except `closed`)
* `--assignee [assignee]`: filter issues by assignee
* `--tags [tags]`: filter issues that have all the specified tags (comma-separated list)
* `--parentId [parentId]`: filter issues that have the specified parentId

**Returns:**
An array of issues that match the filters, each issue will include the following properties:
* `id`: the unique identifier of the issue
* `title`: the title of the issue
* `status`: the current status of the issue
* `assignee`: the agent assigned to the issue, if any.
* `tags`: an array of tags associated with the issue
* `parentId`: the id of the parent issue, if this issue is a sub-issue.
* `priority`: the numeric priority of the issue (1-5). Default is 3

**Example:**
```bash
trackgentic list --status "open" --assignee "Alice"
# returns [
#   { "id": "123456a2es",
#     "title": "Implement authentication",
#     "status": "in-progress",
#     "assignee": "Alice",
#     "tags": ["backend", "security"],
#     "parentId": null,
#     "priority": 3
#   }
# ]
```

**Notes:**
* The items in the list are obtained from the index file, so it's fast to retrieve
* The open status is a special filter, not a real status. It just means to search for the issues in the `open` array in the index file, which includes all the issues that are not closed.
* The items returned don't include the path to the issue file. Issue details must be retrieved with the `view` command.

### `trackgentic view [issue_id]`

Show the computed state of the issue with the given id.

**Returns:**
An object representing the computed state of the issue, including the following properties:

* `id`: the unique identifier of the issue
* `title`: the title of the issue
* `description`: the detailed description of the issue
* `status`: the current status of the issue
* `assignee`: the agent assigned to the issue, if any.
* `tags`: an array of tags associated with the issue
* `parentId`: the id of the parent issue, if this issue is a sub-issue.
* `priority`: the numeric priority of the issue (1-5)
* `createdAt`: the date and time when the issue was created
* `createdBy`: the name of the user that created the issue (from the `creation` event's `author` field)
* `updatedAt`: the date and time when the issue was last updated

**Example:**
```bash
trackgentic view 123456a2es
# returns {
#   "id": "123456a2es",
#   "title": "Implement authentication",
#   "description": "We need to implement authentication for our app",
#   "status": "in-progress",
#   "assignee": "Alice",
#   "tags": ["backend", "security"],
#   "parentId": null,
#   "priority": 3,
#   "createdAt": "2024-06-01T12:00:00Z",
#   "createdBy": "alice",
#   "updatedAt": "2024-06-01T12:00:00Z"
# }
```

**Notes:**
* This response is calculated from the fileTo compute the state of the issue, we need to read all the events in the issue file and apply them in order

### `trackgentic history [issue_id]`

Show the history of changes of the issue with the given id.

**Returns:**
The contents of the issue file, which is an array of events that describe the history of changes to the issue.

Can return issues errors (see Errors section below)

**Example:**

```bash
trackgentic history 123456a2es
# returns [
#   { "timestamp": "2024-06-01T12:00:00Z", "type": "creation"},
#   { "timestamp": "2024-06-01T12:00:00Z", "type": "update", "content": { "title": "Implement authentication", "description": "We need to implement authentication for our app", "assignee": "Alice", "tags": ["backend", "security"], "status": "todo" }},
#   { "timestamp": "2024-06-01T12:00:00Z", "type": "update", "content": { "status": "in-progress", "assignee": "Bob" }}
# ]
```



### `trackgentic comments add [issue_id] --content [content]`

Add a comment to an existing issue by id.

**Flags:**
* `--content [content]`: the content of the comment

**Returns:**
- `{ "result": "OK", "commentId": "[comment_id]" }` if the comment was created successfully
- `{ "result": "INVALID_PARAMS", "message": "The flag --content is required to add a comment" }` if the content flag is missing.
- Issues errors (see Errors section below)

**Example:**
```bash
trackgentic comments add 123456a2es --content "This is a comment"
# returns {"result": "OK"}
```

**Events:**
* `{ "timestamp": "2024-06-01T12:00:00Z", "type": "comment", "author": "alice", "content": { "id": "comment-id", "content": "This is a comment" }}`

**Notes:**
* The comment id is generated when the comment is created and returned in the response so the caller can use it to update or delete the comment later.


### `trackgentic comments update [issue_id] [comment_id] --content [content]`

Update the content of an existing comment by issue id and comment id.

**Flags:**
* `--content [content]`: the new content of the comment

**Returns:**
- `{ "result": "OK" }` if the update was successful
- `{ "result": "INVALID_PARAMS", "message": "The flag --content is required to update a comment" }` if the content flag is missing.
- Issues errors (see Errors section below)
- Comment errors (see Errors section below)

**Example:**
```bash
trackgentic comments update 123456a2es comment-id --content "Updated comment content"
# returns {"result": "OK"}
```

**Events:**
* `{ "timestamp": "2024-06-01T12:00:00Z", "type": "comment-update", "author": "alice", "content": { "id": "comment-id", "content": "Updated comment content" }}`

**Notes:**
* The original `comment` event is not modified. A new `comment-update` event is appended to the issue's event log.
* When computing the current state of comments (e.g., in `comments list`), the latest `comment-update` event for a given comment id overrides the original content.


### `trackgentic comments delete [issue_id] [comment_id]`

Delete an existing comment by issue id and comment id.

**Returns:**
- `{ "result": "OK" }` if the deletion was successful
- Issues errors (see Errors section below)
- Comment errors (see Errors section below)

**Example:**
```bash
trackgentic comments delete 123456a2es comment-id
# returns {"result": "OK"}
```

**Events:**
* `{ "timestamp": "2024-06-01T12:00:00Z", "type": "comment-delete", "author": "alice", "content": { "id": "comment-id" }}`

**Notes:**
* The original `comment` event is not removed from the event log. A `comment-delete` event is appended instead, preserving the full history.
* When computing the current state of comments (e.g., in `comments list`), comments with a `comment-delete` event are excluded from the results.
* Deleting an already-deleted comment returns `COMMENT_NOT_FOUND`.


### `trackgentic comments list [issue_id]`

List the comments of the issue with the given id.

**Returns:**
An array of comments representing the current computed state, each comment will have the following properties:
* `id`: the unique identifier of the comment
* `author`: the user who wrote the comment (from the event's `author` field)
* `content`: the content of the comment (reflects the latest edit, if any)
* `timestamp`: the date and time when the comment was added
* `editedAt`: the date and time when the comment was last edited, if it was edited

Can return issues errors (see Errors section below)

**Notes:**
* The list is computed by replaying the issue's event log: `comment` events create entries, `comment-update` events override their content, and `comment-delete` events exclude them from the results.

**Example:**
```bash
trackgentic comments list 123456a2es
# returns [
#   {
#     "id": "comment-id",
#     "author": "alice",
#     "content": "This is a comment",
#     "timestamp": "2024-06-01T12:00:00Z"
#   }
# ]
``` 

## Errors

When an error occurs, the command will print an object with the following properties to stderr and exit with a non-zero exit code.

```JSON
{
    "result": "[error_code]",
    "message": "[error_message]"
}
```

The message is optional and humar readable, while the error code is a fixed string that can be used to identify the type of error programmatically.


### Global errors

* `NOT_INITIALIZED`: The index file is missing, the user needs to initialize it by running `trackgentic init`
* `TOKEN_REQUIRED`: A command was called without a token and the auth mode requires one.
* `INVALID_TOKEN`: The provided token does not match any registered user.
* `DEFAULT_USER_MISSING`: The authentication system is open for writing but there is no default user defined in config.json to attribute unauthenticated changes.

## Issue errors

When trying to access an issue by id, the following errors can occur:

* `NOT_FOUND`: The issue with the given id does not exist in the index file.
* `ISSUE_MISSING`: The issue file is missing (e.g., it was deleted manually). This means that the issue is in an inconsistent state and it should be removed from the index file.

## Comment errors

When trying to access a comment by id, the following errors can occur:

* `COMMENT_NOT_FOUND`: The comment with the given id does not exist in the issue's event log, or it has already been deleted.


