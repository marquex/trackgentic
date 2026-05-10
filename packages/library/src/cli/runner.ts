import { Command } from "commander";
import { initAction } from "./commands/init";

/**
 * Create and configure the Commander program.
 * Structured so future phases can easily add commands.
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

  return program;
}
