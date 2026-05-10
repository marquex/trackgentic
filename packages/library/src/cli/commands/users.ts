import { TrackgenticError } from "../../core/errors";
import { Tracker } from "../../core/tracker";
import { writeStderr, writeStdout } from "../output";

/**
 * Handler for the `trackgentic users register <name>` command.
 */
export async function usersRegisterAction(name: string): Promise<void> {
  try {
    const tracker = new Tracker();
    const result = await tracker.usersRegister(name);
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
 * Handler for the `trackgentic users list` command.
 */
export async function usersListAction(): Promise<void> {
  try {
    const tracker = new Tracker();
    const result = await tracker.usersList();
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
 * Handler for the `trackgentic users revoke <name>` command.
 */
export async function usersRevokeAction(name: string): Promise<void> {
  try {
    const tracker = new Tracker();
    const result = await tracker.usersRevoke(name);
    if (result instanceof TrackgenticError) {
      writeStderr({ result: result.result, message: result.message });
      process.exit(result.exitCode);
    }
    if ("result" in result && result.result !== "OK") {
      writeStderr(result);
      process.exit(1);
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
 * Handler for the `trackgentic users regenerate <name>` command.
 */
export async function usersRegenerateAction(name: string): Promise<void> {
  try {
    const tracker = new Tracker();
    const result = await tracker.usersRegenerate(name);
    if (result instanceof TrackgenticError) {
      writeStderr({ result: result.result, message: result.message });
      process.exit(result.exitCode);
    }
    if ("result" in result && result.result !== "OK") {
      writeStderr(result);
      if (result.result === "USER_NOT_FOUND") process.exit(9);
      if (result.result === "INVALID_TOKEN") process.exit(3);
      process.exit(1);
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
