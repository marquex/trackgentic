import { TrackgenticError } from "../../core/errors";
import { Tracker } from "../../core/tracker";
import { writeStderr, writeStdout } from "../output";

/**
 * Handler for the `trackgentic view <issueId>` command.
 */
export async function viewAction(issueId: string): Promise<void> {
  try {
    const tracker = new Tracker();
    const result = await tracker.view(issueId);
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
