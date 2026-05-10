import { join } from "node:path";
import type { BlockageEntry, DependenciesFile, IssueId } from "../types";
import { atomicWriteJSON, readJSON } from "./file-io";

const DEPS_FILE = "dependencies.json";

/**
 * Read dependencies.json from the tracker directory.
 */
export async function readDependencies(trackerDir: string): Promise<DependenciesFile> {
  return readJSON<DependenciesFile>(join(trackerDir, DEPS_FILE));
}

/**
 * Write dependencies.json atomically.
 */
export async function writeDependencies(
  trackerDir: string,
  deps: DependenciesFile,
): Promise<void> {
  await atomicWriteJSON(join(trackerDir, DEPS_FILE), deps);
}

/**
 * Add a blockage entry to BOTH maps (blockedBy and blocks).
 * Creates entries with status "active".
 * Idempotent: if an identical active entry already exists, no duplicate is added.
 */
export function addBlockage(
  deps: DependenciesFile,
  blockedId: IssueId,
  blockerId: IssueId,
): DependenciesFile {
  const entry: BlockageEntry = { blockerId, blockedId, status: "active" };

  // Check for duplicate active entry in blockedBy
  const existingBlockedBy = deps.blockedBy[blockedId] ?? [];
  const alreadyExists =
    existingBlockedBy.some(
      (e) => e.blockerId === blockerId && e.blockedId === blockedId && e.status === "active",
    ) &&
    (deps.blocks[blockerId] ?? []).some(
      (e) => e.blockerId === blockerId && e.blockedId === blockedId && e.status === "active",
    );

  if (alreadyExists) {
    return deps;
  }

  const newBlockedBy = {
    ...deps.blockedBy,
    [blockedId]: [...existingBlockedBy, entry],
  };

  const existingBlocks = deps.blocks[blockerId] ?? [];
  const newBlocks = {
    ...deps.blocks,
    [blockerId]: [...existingBlocks, entry],
  };

  return { blockedBy: newBlockedBy, blocks: newBlocks };
}

/**
 * Mark a blockage as resolved in both maps.
 * Idempotent: if entry is already resolved or doesn't exist, no error.
 */
export function resolveBlockage(
  deps: DependenciesFile,
  blockedId: IssueId,
  blockerId: IssueId,
): DependenciesFile {
  // Resolve in blockedBy map
  const blockedByEntries = deps.blockedBy[blockedId];
  let newBlockedBy = { ...deps.blockedBy };
  if (blockedByEntries) {
    newBlockedBy = {
      ...deps.blockedBy,
      [blockedId]: blockedByEntries.map((e) =>
        e.blockerId === blockerId && e.blockedId === blockedId ? { ...e, status: "resolved" } : e,
      ),
    };
  }

  // Resolve in blocks map
  const blocksEntries = deps.blocks[blockerId];
  let newBlocks = { ...deps.blocks };
  if (blocksEntries) {
    newBlocks = {
      ...deps.blocks,
      [blockerId]: blocksEntries.map((e) =>
        e.blockerId === blockerId && e.blockedId === blockedId ? { ...e, status: "resolved" } : e,
      ),
    };
  }

  return { blockedBy: newBlockedBy, blocks: newBlocks };
}

/**
 * Remove a blockage entry entirely from both maps.
 * Idempotent: if entry doesn't exist, no error.
 */
export function deleteBlockage(
  deps: DependenciesFile,
  blockedId: IssueId,
  blockerId: IssueId,
): DependenciesFile {
  // Remove from blockedBy map
  let newBlockedBy = { ...deps.blockedBy };
  const blockedByEntries = deps.blockedBy[blockedId];
  if (blockedByEntries) {
    const filtered = blockedByEntries.filter(
      (e) => !(e.blockerId === blockerId && e.blockedId === blockedId),
    );
    if (filtered.length === 0) {
      const { [blockedId]: _, ...rest } = newBlockedBy;
      newBlockedBy = rest;
    } else {
      newBlockedBy = { ...deps.blockedBy, [blockedId]: filtered };
    }
  }

  // Remove from blocks map
  let newBlocks = { ...deps.blocks };
  const blocksEntries = deps.blocks[blockerId];
  if (blocksEntries) {
    const filtered = blocksEntries.filter(
      (e) => !(e.blockerId === blockerId && e.blockedId === blockedId),
    );
    if (filtered.length === 0) {
      const { [blockerId]: _, ...rest } = newBlocks;
      newBlocks = rest;
    } else {
      newBlocks = { ...deps.blocks, [blockerId]: filtered };
    }
  }

  return { blockedBy: newBlockedBy, blocks: newBlocks };
}

/**
 * Count active entries in blocks[issueId] — used for impact score.
 */
export function getImpactScore(deps: DependenciesFile, issueId: IssueId): number {
  const blocks = deps.blocks[issueId];
  if (!blocks) return 0;
  return blocks.filter((entry) => entry.status === "active").length;
}

/**
 * Detect if adding blockedId→blockerId would create a cycle.
 * Walk blockedBy graph transitively from blockerId.
 * If blockedId is reached at any point → cycle detected.
 * Only considers entries with status === "active".
 */
export function detectCycle(
  deps: DependenciesFile,
  blockedId: IssueId,
  blockerId: IssueId,
): boolean {
  const visited = new Set<IssueId>();
  const queue: IssueId[] = [blockerId];

  while (queue.length > 0) {
    const current = queue.shift()!;

    if (current === blockedId) return true;
    if (visited.has(current)) continue;
    visited.add(current);

    const blockedByCurrent = deps.blockedBy[current] ?? [];
    for (const entry of blockedByCurrent) {
      if (entry.status === "active") {
        queue.push(entry.blockerId);
      }
    }
  }

  return false;
}
