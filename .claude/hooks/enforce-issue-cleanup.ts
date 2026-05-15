#!/usr/bin/env bun
/**
 * enforce-issue-cleanup.ts
 *
 * Stop/SubagentStop hook that prevents an agent from stopping if it has
 * issues in "todo" or "in-progress" status with no active blockages
 * assigned to it. This ensures agents always update issue statuses before
 * finishing, so the runner doesn't re-assign the same issues on the next cycle.
 *
 * Decision logic:
 *   1. No agent_type → main agent, allow (exit 0)
 *   2. No agent file or no token found → allow (exit 0, fail open)
 *   3. List open issues assigned to the agent via trackgentic
 *   4. Filter for "todo" and "in-progress" status
 *   5. For each, check if blocked (blockages list returns non-empty blockedBy)
 *   6. If any unblocked issues in todo/in-progress remain → block the stop
 *
 * Run with Bun (https://bun.sh). Uses only Node-compatible APIs.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { execSync } from 'node:child_process';

// ---------- types ----------

interface HookInput {
  agent_type?: string;
  cwd?: string;
  hook_event_name?: string;
  stop_hook_active?: boolean;
}

interface TrackgenticIssue {
  id: string;
  title: string;
  status: string;
  assignee: string | null;
}

interface BlockagesInfo {
  issueId: string;
  blockedBy: string[];
  blocks: string[];
}

// ---------- helpers ----------

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c: string) => { data += c; });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
  });
}

function findAgentFile(agentType: string, cwd: string): string | null {
  const candidates = [
    path.join(cwd, '.claude', 'agents', `${agentType}.md`),
    path.join(os.homedir(), '.claude', 'agents', `${agentType}.md`),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

/**
 * Extract the trackgentic token from the agent file content.
 * Matches patterns like: trackgentic token is `tk_xxxx`
 */
function extractToken(agentContent: string): string | null {
  const match = agentContent.match(/trackgentic token is `(tk_\w+)`/);
  return match ? match[1]! : null;
}

function emit(output: unknown): never {
  process.stdout.write(JSON.stringify(output));
  process.exit(0);
}

// ---------- main ----------

async function main(): Promise<never> {
  let input: HookInput;
  try {
    input = JSON.parse(await readStdin()) as HookInput;
  } catch {
    // Malformed input — fail open
    process.exit(0);
  }

  // Only enforce for subagents (agent_type is present)
  const agentType = input.agent_type;
  if (!agentType) process.exit(0);

  const cwd = input.cwd || process.cwd();

  // Locate the agent file and extract the trackgentic token
  const agentFile = findAgentFile(agentType, cwd);
  if (!agentFile) process.exit(0);

  let agentContent: string;
  try {
    agentContent = fs.readFileSync(agentFile, 'utf8');
  } catch {
    process.exit(0);
  }

  const token = extractToken(agentContent);
  if (!token) process.exit(0);

  // List all open issues assigned to this agent
  let issuesJson: string;
  try {
    issuesJson = execSync(
      `TRACKGENTIC_TOKEN="${token}" trackgentic list --status "open" --assignee "${agentType}"`,
      { encoding: 'utf8', cwd, timeout: 10000 },
    );
  } catch {
    // trackgentic command failed — fail open
    process.exit(0);
  }

  let issues: TrackgenticIssue[];
  try {
    issues = JSON.parse(issuesJson);
    if (!Array.isArray(issues)) process.exit(0);
  } catch {
    process.exit(0);
  }

  // Filter for issues in active statuses that would cause re-assignment
  const activeIssues = issues.filter(
    (issue) => issue.status === 'todo' || issue.status === 'in-progress',
  );

  if (activeIssues.length === 0) process.exit(0);

  // Check blockages for each active issue — only block stop for unblocked ones
  const unblockedIssues: TrackgenticIssue[] = [];

  for (const issue of activeIssues) {
    try {
      const blockagesJson = execSync(
        `TRACKGENTIC_TOKEN="${token}" trackgentic blockages list ${issue.id}`,
        { encoding: 'utf8', cwd, timeout: 10000 },
      );
      const blockages: BlockagesInfo = JSON.parse(blockagesJson);
      if (!blockages.blockedBy || blockages.blockedBy.length === 0) {
        unblockedIssues.push(issue);
      }
    } catch {
      // Can't check blockages — assume unblocked to be safe
      unblockedIssues.push(issue);
    }
  }

  if (unblockedIssues.length === 0) process.exit(0);

  // Build the issue list for the message
  const issueList = unblockedIssues
    .map((issue) => `  - [${issue.status}] ${issue.id}: ${issue.title}`)
    .join('\n');

  const reason =
    `You have ${unblockedIssues.length} unblocked issue(s) still in active status:\n` +
    `${issueList}\n\n` +
    `Update their status before finishing: mark as 'done', reassign to another agent, or add blockages if blocked.`;

  const systemMessage =
    `IMPORTANT: You cannot stop yet. You have issues assigned to you that are still in 'todo' or 'in-progress' status ` +
    `with no blockages. The runner will immediately re-assign these to you on the next cycle.\n\n` +
    `Resolve each issue by doing one of:\n` +
    `1. Mark completed issues as 'done': trackgentic update <issue-id> --status "done"\n` +
    `2. Reassign issues you can't complete: trackgentic update <issue-id> --assignee <other-agent>\n` +
    `3. Add blockages if blocked: trackgentic blockages add <issue-id> --by <blocker-id>\n\n` +
    `Issues to resolve:\n${issueList}`;

  return emit({
    decision: 'block',
    reason,
    systemMessage,
  });
}

main().catch(() => process.exit(0));
