import { join } from "node:path";
import type { IndexEntry, IndexFile, IssueId } from "../types";
import { atomicWriteJSON, readJSON } from "./file-io";

const INDEX_FILE = "index.json";

/**
 * Read the index file from the tracker directory.
 */
export async function readIndex(trackerDir: string): Promise<IndexFile> {
  return readJSON<IndexFile>(join(trackerDir, INDEX_FILE));
}

/**
 * Write the index file to the tracker directory atomically.
 */
export async function writeIndex(trackerDir: string, index: IndexFile): Promise<void> {
  await atomicWriteJSON(join(trackerDir, INDEX_FILE), index);
}

/**
 * Binary search for an entry by id in a sorted array.
 * Returns the index of the entry, or -1 if not found.
 */
function binarySearchIndex(entries: IndexEntry[], id: IssueId): number {
  let lo = 0;
  let hi = entries.length - 1;

  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    const midEntry = entries[mid];
    if (!midEntry) break; // Safety check for noUncheckedIndexedAccess
    const cmp = midEntry.id.localeCompare(id);
    if (cmp === 0) return mid;
    if (cmp < 0) lo = mid + 1;
    else hi = mid - 1;
  }

  return -1;
}

/**
 * Insert entry into the correct array (open or closed) maintaining sort by id.
 * Returns a new IndexFile (immutable — original is not mutated).
 */
export function insertEntry(index: IndexFile, entry: IndexEntry): IndexFile {
  const isOpen = entry.status !== "closed";
  const arr = isOpen ? index.open : index.closed;

  // Find insertion point via binary search
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    const midEntry = arr[mid];
    if (midEntry && midEntry.id.localeCompare(entry.id) < 0) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }

  const newArr = [...arr.slice(0, lo), entry, ...arr.slice(lo)];

  // Update childrenOf if entry has a parentId
  const childrenOf = { ...index.childrenOf };
  if (entry.parentId) {
    const existing = childrenOf[entry.parentId] ?? [];
    childrenOf[entry.parentId] = [...existing, entry.id];
  }

  return isOpen ? { ...index, open: newArr, childrenOf } : { ...index, closed: newArr, childrenOf };
}

/**
 * Update an existing entry (find by id, replace).
 * Handles open <-> closed array moves if status changed.
 * Returns a new IndexFile (immutable — original is not mutated).
 */
export function updateEntry(
  index: IndexFile,
  id: IssueId,
  updates: Partial<IndexEntry>,
): IndexFile {
  // Try to find in open array
  const openIdx = binarySearchIndex(index.open, id);
  if (openIdx !== -1) {
    const oldEntry = index.open[openIdx];
    if (!oldEntry) return index;
    const newEntry: IndexEntry = { ...oldEntry, ...updates };

    // If status changed to closed, move to closed array
    if (newEntry.status === "closed") {
      const newOpen = [...index.open.slice(0, openIdx), ...index.open.slice(openIdx + 1)];
      return insertEntry({ ...index, open: newOpen }, newEntry);
    }

    // Stay in open — update in place
    const newOpen = [...index.open];
    newOpen[openIdx] = newEntry;
    return { ...index, open: newOpen };
  }

  // Try to find in closed array
  const closedIdx = binarySearchIndex(index.closed, id);
  if (closedIdx !== -1) {
    const oldEntry = index.closed[closedIdx];
    if (!oldEntry) return index;
    const newEntry: IndexEntry = { ...oldEntry, ...updates };

    // If status changed from closed to open, move to open array
    if (newEntry.status !== "closed") {
      const newClosed = [...index.closed.slice(0, closedIdx), ...index.closed.slice(closedIdx + 1)];
      return insertEntry({ ...index, closed: newClosed }, newEntry);
    }

    // Stay in closed — update in place
    const newClosed = [...index.closed];
    newClosed[closedIdx] = newEntry;
    return { ...index, closed: newClosed };
  }

  // Entry not found — return unchanged
  return index;
}

/**
 * Binary search by id in both open and closed arrays.
 * Returns null if not found.
 */
export function findEntry(index: IndexFile, id: IssueId): IndexEntry | null {
  const openIdx = binarySearchIndex(index.open, id);
  if (openIdx !== -1) return index.open[openIdx] ?? null;

  const closedIdx = binarySearchIndex(index.closed, id);
  if (closedIdx !== -1) return index.closed[closedIdx] ?? null;

  return null;
}

/**
 * Add childId to parentId's children array in childrenOf map.
 * If the key doesn't exist, creates it. Ignores duplicates.
 * Returns a new IndexFile (immutable — original is not mutated).
 */
export function addChild(index: IndexFile, parentId: IssueId, childId: IssueId): IndexFile {
  const existing = index.childrenOf[parentId];
  if (existing && existing.includes(childId)) {
    return index; // Already present — no change
  }
  const childrenOf = { ...index.childrenOf };
  childrenOf[parentId] = existing ? [...existing, childId] : [childId];
  return { ...index, childrenOf };
}

/**
 * Remove childId from parentId's children array in childrenOf map.
 * Deletes the key from the map if the resulting array is empty.
 * Returns a new IndexFile (immutable — original is not mutated).
 */
export function removeChild(index: IndexFile, parentId: IssueId, childId: IssueId): IndexFile {
  const existing = index.childrenOf[parentId];
  if (!existing) return index;
  const filtered = existing.filter((id) => id !== childId);
  if (filtered.length === existing.length) return index; // Not found — no change
  const childrenOf = { ...index.childrenOf };
  if (filtered.length === 0) {
    delete childrenOf[parentId];
  } else {
    childrenOf[parentId] = filtered;
  }
  return { ...index, childrenOf };
}

/**
 * Get all child IDs for a given parent. Returns empty array if no children.
 */
export function getChildren(index: IndexFile, parentId: IssueId): IssueId[] {
  return index.childrenOf[parentId] ?? [];
}

/**
 * Remove entry from whichever array it's in.
 * Returns unchanged index if not found.
 * Returns a new IndexFile (immutable — original is not mutated).
 */
export function removeEntry(index: IndexFile, id: IssueId): IndexFile {
  const openIdx = binarySearchIndex(index.open, id);
  if (openIdx !== -1) {
    return { ...index, open: [...index.open.slice(0, openIdx), ...index.open.slice(openIdx + 1)] };
  }

  const closedIdx = binarySearchIndex(index.closed, id);
  if (closedIdx !== -1) {
    return {
      ...index,
      closed: [...index.closed.slice(0, closedIdx), ...index.closed.slice(closedIdx + 1)],
    };
  }

  return index;
}
