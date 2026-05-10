import { Command } from "commander";
import {
  commentsAddAction,
  commentsDeleteAction,
  commentsListAction,
  commentsUpdateAction,
} from "./commands/comments";
import { createAction } from "./commands/create";
import { historyAction } from "./commands/history";
import { initAction } from "./commands/init";
import { listAction } from "./commands/list";
import { updateAction } from "./commands/update";
import {
  usersListAction,
  usersRegenerateAction,
  usersRegisterAction,
  usersRevokeAction,
} from "./commands/users";
import { viewAction } from "./commands/view";

/**
 * Create and configure the Commander program.
 */
export function createProgram(): Command {
  const program = new Command();

  program
    .name("trackgentic")
    .description("Issue tracker designed for AI agents — file-backed, event-sourced, git-friendly")
    .version("0.1.0");

  // ─── init ─────────────────────────────────────────────────────────
  program
    .command("init")
    .description("Initialize a new .trackgentic/ directory")
    .action(initAction);

  // ─── create ───────────────────────────────────────────────────────
  program
    .command("create <title>")
    .description("Create a new issue")
    .option("--description <string>", "Issue description")
    .option("--assignee <string>", "Assignee name")
    .option("--tags <comma-separated>", "Comma-separated tags")
    .option("--status <status>", 'Issue status (default: "idea")')
    .option("--priority <number>", "Priority 1-5 (default: 3)")
    .option("--parentId <id>", "Parent issue ID")
    .option("--path <string>", "Custom file path for the issue")
    .action(createAction);

  // ─── list ─────────────────────────────────────────────────────────
  program
    .command("list")
    .description("List issues")
    .option(
      "--status <status>",
      'Filter by status (use "open" for non-closed, "closed" for closed)',
    )
    .option("--assignee <string>", "Filter by assignee")
    .option("--tags <comma-separated>", "Comma-separated tags (AND filter)")
    .option("--parentId <id>", 'Filter by parent ID (use "null" for top-level)')
    .action(listAction);

  // ─── view ─────────────────────────────────────────────────────────
  program
    .command("view <issueId>")
    .description("View an issue's full computed state")
    .action(viewAction);

  // ─── update ───────────────────────────────────────────────────────
  program
    .command("update <issueId>")
    .description("Update an existing issue")
    .option("--title <string>", "New title")
    .option("--description <string>", "New description")
    .option("--status <status>", "New status")
    .option("--assignee <string>", "New assignee")
    .option("--tags <comma-separated>", "New tags (replaces existing)")
    .option("--priority <number>", "New priority (1-5)")
    .option("--parentId <id>", 'New parent ID (use "null" to detach)')
    .action(updateAction);

  // ─── history ──────────────────────────────────────────────────────
  program
    .command("history <issueId>")
    .description("View an issue's raw event history")
    .action(historyAction);

  // ─── comments ─────────────────────────────────────────────────────
  const commentsCmd = program.command("comments").description("Manage comments on issues");

  commentsCmd
    .command("add <issueId>")
    .description("Add a comment to an issue")
    .requiredOption("--content <content>", "Comment content")
    .action(commentsAddAction);

  commentsCmd
    .command("update <issueId> <commentId>")
    .description("Update an existing comment")
    .requiredOption("--content <content>", "New comment content")
    .action(commentsUpdateAction);

  commentsCmd
    .command("delete <issueId> <commentId>")
    .description("Delete a comment")
    .action(commentsDeleteAction);

  commentsCmd
    .command("list <issueId>")
    .description("List comments on an issue")
    .action(commentsListAction);

  // ─── users ────────────────────────────────────────────────────────
  const usersCmd = program.command("users").description("Manage users");

  usersCmd
    .command("register <name>")
    .description("Register a new user")
    .action(usersRegisterAction);

  usersCmd.command("list").description("List registered users").action(usersListAction);

  usersCmd.command("revoke <name>").description("Revoke (remove) a user").action(usersRevokeAction);

  usersCmd
    .command("regenerate <name>")
    .description("Regenerate a user's token (self-service only)")
    .action(usersRegenerateAction);

  return program;
}
