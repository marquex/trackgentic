import type { Event, IndexEntry, IndexFile, IssueId, IssueStatus } from "../types";

/**
 * Status progression order — used to compare status positions.
 */
const STATUS_ORDER: IssueStatus[] = ["idea", "todo", "in-progress", "done", "closed"];

/**
 * Check if childStatus is strictly after parentStatus in the progression.
 * Progression: idea -> todo -> in-progress -> done -> closed
 */
export function isStatusAfter(childStatus: IssueStatus, parentStatus: IssueStatus): boolean {
  return STATUS_ORDER.indexOf(childStatus) > STATUS_ORDER.indexOf(parentStatus);
}

/**
 * Validate that a parent can accept a new child.
 * Returns an error message if the parent is closed, null otherwise.
 */
export function validateNewChild(parentEntry: IndexEntry | null): string | null {
  if (!parentEntry) return null; // No parent — no constraint
  if (parentEntry.status === "closed") {
    return "Cannot add child to closed parent.";
  }
  return null;
}

/**
 * Validate that a parent can transition to the target status.
 * Returns an error message if downward constraints are violated, null otherwise.
 * Rule: parent cannot move to done/closed if any child has status before done/closed.
 */
export function validateParentStatusChange(
  index: IndexFile,
  childEntries: IndexEntry[],
  targetStatus: IssueStatus,
): string | null {
  // Only done/closed have downward constraints
  if (targetStatus !== "done" && targetStatus !== "closed") return null;

  for (const child of childEntries) {
    if (!isStatusAfter(child.status, "done") && child.status !== "done") {
      return `Cannot set parent to \`${targetStatus}\`: child \`${child.id}\` has status '${child.status}'.`;
    }
  }

  return null;
}

/**
 * Determine which children need to be auto-closed when parent closes.
 * Returns entries that are done (they can be auto-closed).
 * Does NOT return non-done children (those BLOCK the closure — caller handles that).
 */
export function getClosableChildren(childEntries: IndexEntry[]): IndexEntry[] {
  return childEntries.filter((entry) => entry.status === "done");
}

/**
 * Auto-promote parent to at most `in-progress` if child's new status is past parent's status.
 * Parents are never auto-promoted to `done` or `closed` — those transitions must be explicit.
 * Returns update events to apply to parents (walks up recursively).
 * Each event has author: "system" and a reason field explaining the promotion.
 *
 * @param index - current index
 * @param parentEntry - the direct parent's index entry
 * @param childStatus - the child's new status
 * @param findEntry - lookup function to find entries by id across both arrays
 * @returns array of { issueId, event } for system-authored promotions
 */
export function computeUpwardPromotions(
  index: IndexFile,
  parentEntry: IndexEntry,
  childStatus: IssueStatus,
  findEntry: (id: IssueId) => IndexEntry | null,
): Array<{ issueId: IssueId; event: Event }> {
  const promotions: Array<{ issueId: IssueId; event: Event }> = [];

  // Cap promoted status at in-progress — parents are never auto-promoted to done/closed
  const capIndex = STATUS_ORDER.indexOf("in-progress");
  const childIndex = STATUS_ORDER.indexOf(childStatus);
  const promotedStatus: IssueStatus = childIndex <= capIndex ? childStatus : "in-progress";

  let currentParentEntry: IndexEntry | null = parentEntry;

  while (currentParentEntry) {
    // If promoted status is not after parent's status, no promotion needed
    if (!isStatusAfter(promotedStatus, currentParentEntry.status)) {
      break;
    }

    const now = new Date().toISOString();
    const event: Event = {
      type: "update",
      timestamp: now,
      author: "system",
      content: {
        status: promotedStatus,
        reason: `auto-promoted to '${promotedStatus}': child advanced to '${childStatus}'`,
      },
    };

    promotions.push({ issueId: currentParentEntry.id, event });

    // Check if this parent itself has a parent
    if (!currentParentEntry.parentId) break;
    const grandParentEntry = findEntry(currentParentEntry.parentId);
    currentParentEntry = grandParentEntry;
  }

  return promotions;
}
