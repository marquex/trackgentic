#!/usr/bin/env bun
/**
 * Agent runner — manages a team of Claude agents pulling issues from trackgentic.
 *
 * Reads agent names from .trackgentic/users.json, polls every 60s for available work,
 * and spawns `claude --agent <name> -p "/worktask <issueId>"` child processes.
 *
 * Displays a live TUI showing each agent's status.
 */

import { readFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { spawn, type Subprocess } from "bun";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface UserEntry {
  name: string;
  token: string;
  registeredAt: string;
}

interface UsersFile {
  users: UserEntry[];
}

interface AgentState {
  name: string;
  token: string;
  status: "free" | "busy";
  issueId: string | null;
  sessionId: string | null;
  startedAt: number | null;
  process: Subprocess | null;
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const POLL_INTERVAL_MS = 60_000; // 1 minute
const ROOT = resolve(import.meta.dir, "..");
const USERS_PATH = resolve(ROOT, ".trackgentic/users.json");
const SESSIONS_DIR = resolve(ROOT, ".agentic/session");

// Ensure sessions directory exists
mkdirSync(SESSIONS_DIR, { recursive: true });

// ---------------------------------------------------------------------------
// Load users
// ---------------------------------------------------------------------------

function loadUsers(): UserEntry[] {
  const raw = readFileSync(USERS_PATH, "utf-8");
  const data: UsersFile = JSON.parse(raw);
  return data.users;
}

// ---------------------------------------------------------------------------
// Get next issue for an agent via CLI
// ---------------------------------------------------------------------------

async function getNextIssue(agentName: string, token: string): Promise<string | null> {
  const proc = spawn(["trackgentic", "next", agentName], {
    cwd: ROOT,
    env: { ...process.env, TRACKGENTIC_TOKEN: token },
    stdout: "pipe",
    stderr: "pipe",
  });

  const text = await new Response(proc.stdout).text();
  await proc.exited;

  if (proc.exitCode !== 0) return null;

  try {
    const result = JSON.parse(text.trim());
    // NextResult is either a ComputedIssue (has .id) or { result: "NO_ISSUES_AVAILABLE" }
    if (result.result === "NO_ISSUES_AVAILABLE") return null;
    if (result.id) return result.id as string;
    return null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Launch agent process
// ---------------------------------------------------------------------------

function generateSessionId(): string {
  return Date.now().toString(36);
}

function launchAgent(agent: AgentState, issueId: string): void {
  const sessionId = generateSessionId();
  const logPath = resolve(SESSIONS_DIR, `${sessionId}.jsonl`);
  const logFile = Bun.file(logPath).writer();

  agent.status = "busy";
  agent.issueId = issueId;
  agent.sessionId = sessionId;
  agent.startedAt = Date.now();

  const proc = spawn(
    [
      "claude",
      "--agent", agent.name,
      "-p", `/worktask ${issueId}`,
      "--output-format", "stream-json",
      "--verbose",
    ],
    {
      cwd: ROOT,
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, AGENT_SESSION_ID: sessionId },
    },
  );

  agent.process = proc;

  // Pipe stdout to the session log file
  (async () => {
    const reader = proc.stdout.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      logFile.write(value);
    }
    logFile.flush();
    logFile.end();
  })();

  // When the process exits, mark the agent as free
  proc.exited.then(() => {
    agent.status = "free";
    agent.issueId = null;
    agent.sessionId = null;
    agent.startedAt = null;
    agent.process = null;
    render();
  });
}

// ---------------------------------------------------------------------------
// TUI rendering
// ---------------------------------------------------------------------------

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}h ${m % 60}m ${s % 60}s`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

function render(): void {
  // Clear entire screen and move cursor to top-left
  process.stdout.write("\x1b[2J\x1b[H");

  const now = Date.now();
  const header = "  TRACKGENTIC AGENT RUNNER";
  const sep = "  " + "─".repeat(60);

  const lines: string[] = [
    "",
    header,
    sep,
    "",
    `  ${"Agent".padEnd(22)} ${"Status".padEnd(10)} ${"Issue".padEnd(14)} ${"Session".padEnd(14)} Duration`,
    `  ${"─".repeat(22)} ${"─".repeat(10)} ${"─".repeat(14)} ${"─".repeat(14)} ${"─".repeat(10)}`,
  ];

  for (const agent of agents) {
    const name = agent.name.padEnd(22);
    const statusColor = agent.status === "busy" ? "\x1b[33m" : "\x1b[32m";
    const status = `${statusColor}${agent.status.padEnd(10)}\x1b[0m`;
    const issue = (agent.issueId ?? "—").padEnd(14);
    const session = (agent.sessionId ?? "—").padEnd(14);
    const duration = agent.startedAt ? formatDuration(now - agent.startedAt) : "—";
    lines.push(`  ${name} ${status} ${issue} ${session} ${duration}`);
  }

  lines.push("");
  lines.push(sep);
  lines.push(`  Next poll in ${Math.max(0, Math.ceil((nextPollAt - now) / 1000))}s  |  Ctrl+C to stop`);
  lines.push("");

  process.stdout.write(lines.join("\n"));
}

// ---------------------------------------------------------------------------
// Poll loop
// ---------------------------------------------------------------------------

let nextPollAt = Date.now();

async function poll(): Promise<void> {
  for (const agent of agents) {
    if (agent.status === "busy") continue;

    const issueId = await getNextIssue(agent.name, agent.token);
    if (issueId) {
      launchAgent(agent, issueId);
      render();
    }
  }

  nextPollAt = Date.now() + POLL_INTERVAL_MS;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const users = loadUsers();
if (users.length === 0) {
  console.error("No users found in .trackgentic/users.json");
  process.exit(1);
}

const agents: AgentState[] = users.map((u) => ({
  name: u.name,
  token: u.token,
  status: "free",
  issueId: null,
  sessionId: null,
  startedAt: null,
  process: null,
}));

// Hide cursor
process.stdout.write("\x1b[?25l");

// Show cursor on exit
process.on("SIGINT", () => {
  process.stdout.write("\x1b[?25h\n");
  // Kill any running agent processes
  for (const agent of agents) {
    if (agent.process) {
      agent.process.kill();
    }
  }
  process.exit(0);
});

// Initial poll
await poll();
render();

// Re-render every second (for duration counter updates)
setInterval(render, 1000);

// Poll for new work every POLL_INTERVAL_MS
setInterval(poll, POLL_INTERVAL_MS);
