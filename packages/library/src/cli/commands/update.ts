import { TrackgenticError } from "../../core/errors";
import { Tracker } from "../../core/tracker";
import type { IssueStatus, UpdateParams } from "../../types";
import { writeStderr, writeStdout } from "../output";

interface UpdateOptions {
  title?: string;
  description?: string;
  status?: string;
  assignee?: string;
  tags?: string;
  priority?: string;
  parentId?: string;
}

/**
 * Handler for the `trackgentic update <issueId>` command.
 */
export async function updateAction(issueId: string, options: UpdateOptions): Promise<void> {
  try {
    // Build params — only include fields that were actually provided
    const params: UpdateParams = {};

    if (options.title !== undefined) params.title = options.title;
    if (options.description !== undefined) params.description = options.description;
    if (options.status !== undefined) params.status = options.status as IssueStatus;
    if (options.assignee !== undefined) params.assignee = options.assignee;
    if (options.tags !== undefined) {
      params.tags = options.tags.split(",").map((t) => t.trim());
    }
    if (options.priority !== undefined) {
      params.priority = Number.parseInt(options.priority, 10) as 1 | 2 | 3 | 4 | 5;
    }
    if (options.parentId !== undefined) {
      params.parentId = options.parentId === "null" ? null : options.parentId;
    }

    // Validate at least one flag provided
    if (Object.keys(params).length === 0) {
      writeStderr({
        result: "INVALID_PARAMS",
        message: "At least one field must be provided for update.",
      });
      process.exit(10);
    }

    const tracker = new Tracker();
    const result = await tracker.update(issueId, params);
    writeStdout(result);
    process.exit(0);
  } catch (err) {
    if (err instanceof TrackgenticError) {
      writeStderr({ result: err.result, message: err.message });
      process.exit(err.exitCode);
    }
    writeStderr({ result: "INTERNAL_ERROR", message: (err as Error).message });
    process.exit(1);
  }
}
