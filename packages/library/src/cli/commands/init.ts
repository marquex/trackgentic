import { Tracker } from "../../core/tracker";
import { TrackgenticError } from "../../core/errors";
import { writeStdout, writeStderr } from "../output";

/**
 * Handler for the `trackgentic init` command.
 * Creates a `.trackgentic/` directory in the current working directory.
 */
export async function initAction(): Promise<void> {
  try {
    const tracker = new Tracker();
    const result = await tracker.init();
    writeStdout(result);
    process.exit(0);
  } catch (err) {
    if (err instanceof TrackgenticError) {
      writeStderr({ result: err.result, message: err.message });
      process.exit(err.exitCode);
    }
    // Unexpected errors
    writeStderr({ result: "INTERNAL_ERROR", message: (err as Error).message });
    process.exit(1);
  }
}
