import { TrackgenticError } from "../../core/errors";
import { Tracker } from "../../core/tracker";
import { writeStderr, writeStdout } from "../output";

/**
 * Handler for the `trackgentic blockages add <blockedId> --by <blockerId...>` command.
 */
export async function blockagesAddAction(
  blockedId: string,
  options: { by: string[] },
): Promise<void> {
  try {
    const tracker = new Tracker();
    const blockerIds = typeof options.by === "string" ? [options.by] : options.by;
    const result = await tracker.blockagesAdd(blockedId, { blockerIds });
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

/**
 * Handler for the `trackgentic blockages resolve <blockedId> --by <blockerId...>` command.
 */
export async function blockagesResolveAction(
  blockedId: string,
  options: { by: string[] },
): Promise<void> {
  try {
    const tracker = new Tracker();
    const blockerIds = typeof options.by === "string" ? [options.by] : options.by;
    const result = await tracker.blockagesResolve(blockedId, { blockerIds });
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

/**
 * Handler for the `trackgentic blockages delete <blockedId> --by <blockerId...>` command.
 */
export async function blockagesDeleteAction(
  blockedId: string,
  options: { by: string[] },
): Promise<void> {
  try {
    const tracker = new Tracker();
    const blockerIds = typeof options.by === "string" ? [options.by] : options.by;
    const result = await tracker.blockagesDelete(blockedId, { blockerIds });
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

/**
 * Handler for the `trackgentic blockages list <issueId>` command.
 */
export async function blockagesListAction(issueId: string): Promise<void> {
  try {
    const tracker = new Tracker();
    const result = await tracker.blockagesList(issueId);
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
