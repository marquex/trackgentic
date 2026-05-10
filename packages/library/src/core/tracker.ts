import { existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import type { ConfigFile, DependenciesFile, IndexFile, InitResult, UsersFile } from "../types";
import { atomicWriteJSON } from "./file-io";

const TRACKGENTIC_DIR = ".trackgentic";

/**
 * Default config.json contents.
 */
const DEFAULT_CONFIG: ConfigFile = {
  auth: {
    mode: "read-only",
    defaultUser: "anonymous",
  },
};

/**
 * Default index.json contents.
 */
const DEFAULT_INDEX: IndexFile = {
  open: [],
  closed: [],
  childrenOf: {},
};

/**
 * Default dependencies.json contents.
 */
const DEFAULT_DEPENDENCIES: DependenciesFile = {
  blockedBy: {},
  blocks: {},
};

/**
 * Default users.json contents.
 */
const DEFAULT_USERS: UsersFile = {
  users: [],
};

/**
 * Tracker — the main programmatic API for trackgentic.
 *
 * The constructor accepts a `cwd` parameter (defaults to `process.cwd()`).
 * It does NOT validate that `.trackgentic/` exists — resolution happens on each method call.
 */
export class Tracker {
  private cwd: string;

  constructor(cwd?: string) {
    this.cwd = cwd ?? process.cwd();
  }

  /**
   * Initialize a new `.trackgentic/` directory in `cwd`.
   *
   * Creates the directory with:
   * - config.json — default auth config
   * - index.json — empty open/closed arrays, empty childrenOf map
   * - dependencies.json — empty blockedBy/blocks maps
   * - users.json — empty users array
   * - issues/ — empty directory
   *
   * Idempotent: if `.trackgentic/` already exists, returns ALREADY_INITIALIZED
   * without overwriting any files.
   */
  async init(): Promise<InitResult> {
    const trackerDir = join(this.cwd, TRACKGENTIC_DIR);

    if (existsSync(trackerDir)) {
      return { result: "ALREADY_INITIALIZED", path: resolve(trackerDir) };
    }

    // Create the main directory
    mkdirSync(trackerDir, { recursive: true });

    // Create issues subdirectory
    mkdirSync(join(trackerDir, "issues"), { recursive: true });

    // Write initial files
    await atomicWriteJSON(join(trackerDir, "config.json"), DEFAULT_CONFIG);
    await atomicWriteJSON(join(trackerDir, "index.json"), DEFAULT_INDEX);
    await atomicWriteJSON(join(trackerDir, "dependencies.json"), DEFAULT_DEPENDENCIES);
    await atomicWriteJSON(join(trackerDir, "users.json"), DEFAULT_USERS);

    return { result: "OK", path: resolve(trackerDir) };
  }
}
