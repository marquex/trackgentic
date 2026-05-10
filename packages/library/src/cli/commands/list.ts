import { TrackgenticError } from "../../core/errors";
import { Tracker } from "../../core/tracker";
import type { IssueStatus, ListParams } from "../../types";
import { writeStderr, writeStdout } from "../output";

interface ListOptions {
  status?: string;
  assignee?: string;
  tags?: string;
  parentId?: string;
}

/**
 * Handler for the `trackgentic list` command.
 */
export async function listAction(options: ListOptions): Promise<void> {
  try {
    const tracker = new Tracker();
    const params: ListParams = {};

    if (options.status !== undefined) {
      params.status = options.status as IssueStatus | "open";
    }
    if (options.assignee !== undefined) params.assignee = options.assignee;
    if (options.tags !== undefined) {
      params.tags = options.tags.split(",").map((t) => t.trim());
    }
    if (options.parentId !== undefined) {
      params.parentId = options.parentId === "null" ? null : options.parentId;
    }

    const result = await tracker.list(params);
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
