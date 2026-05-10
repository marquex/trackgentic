import { TrackgenticError } from "../../core/errors";
import { Tracker } from "../../core/tracker";
import type { CreateParams, IssueStatus } from "../../types";
import { writeStderr, writeStdout } from "../output";

interface CreateOptions {
  description?: string;
  assignee?: string;
  tags?: string;
  status?: string;
  priority?: string;
  parentId?: string;
  path?: string;
}

/**
 * Handler for the `trackgentic create <title>` command.
 */
export async function createAction(title: string, options: CreateOptions): Promise<void> {
  try {
    const tracker = new Tracker();
    const params: CreateParams = { title };

    if (options.description !== undefined) params.description = options.description;
    if (options.assignee !== undefined) params.assignee = options.assignee;
    if (options.tags !== undefined) {
      params.tags = options.tags.split(",").map((t) => t.trim());
    }
    if (options.status !== undefined) params.status = options.status as IssueStatus;
    if (options.priority !== undefined) {
      params.priority = Number.parseInt(options.priority, 10) as 1 | 2 | 3 | 4 | 5;
    }
    if (options.parentId !== undefined) params.parentId = options.parentId;
    if (options.path !== undefined) params.path = options.path;

    const result = await tracker.create(params);
    if (result instanceof TrackgenticError) {
      writeStderr({ result: result.result, message: result.message });
      process.exit(result.exitCode);
    }
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
