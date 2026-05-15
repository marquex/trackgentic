#!/usr/bin/env bun
/**
 * enforce-trackgentic-token.ts
 *
 * PreToolUse hook that ensures agents have a trackgentic token available
 * before calling the trackgentic CLI. Reads the token from the
 * TRACKGENTIC_USER_TOKEN environment variable. If not set, the call is
 * blocked. If set, strips any token the agent may have put in the command
 * and injects the correct one from the environment.
 *
 * Decision logic:
 *   1. No agent_type → main agent, allow
 *   2. Not a Bash command → allow
 *   3. Command doesn't contain "trackgentic" → allow (safety net)
 *   4. Check TRACKGENTIC_USER_TOKEN env var
 *   5. If not set → deny (agent cannot use trackgentic without a token)
 *   6. Strip any existing TRACKGENTIC_TOKEN / TRACKGENTIC_USER_TOKEN from command
 *   7. Inject the token from env via updatedInput → allow
 *
 * Run with Bun (https://bun.sh). Uses only Node-compatible APIs.
 */

// ---------- types ----------

interface HookEvent {
  agent_type?: string;
  cwd?: string;
  tool_name: string;
  tool_input?: Record<string, unknown>;
}

// ---------- decision helpers ----------

function decide(
  decision: 'allow' | 'deny',
  reason: string,
  updatedInput?: Record<string, unknown>,
): never {
  const output: Record<string, unknown> = {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: decision,
      permissionDecisionReason: reason,
    },
  };
  if (updatedInput && decision === 'allow') {
    output.hookSpecificOutput = {
      ...output.hookSpecificOutput as Record<string, unknown>,
      updatedInput,
    };
  }
  process.stdout.write(JSON.stringify(output));
  process.exit(0);
}

const allow = (reason: string, updatedInput?: Record<string, unknown>): never =>
  decide('allow', reason, updatedInput);
const deny  = (reason: string): never => decide('deny', reason);

// ---------- stdin ----------

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c: string) => { data += c; });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
  });
}

// ---------- helpers ----------

/**
 * Strip any existing TRACKGENTIC_TOKEN or TRACKGENTIC_USER_TOKEN assignment
 * from a command string, so we can inject the correct one.
 */
function stripExistingTokenEnv(cmd: string): string {
  return cmd
    .replace(/\bTRACKGENTIC_USER_TOKEN=\S+\s*/g, '')
    .replace(/\bTRACKGENTIC_TOKEN=\S+\s*/g, '')
    .trimStart();
}

// ---------- main ----------

async function main(): Promise<never> {
  let event: HookEvent;
  try {
    event = JSON.parse(await readStdin()) as HookEvent;
  } catch {
    process.exit(0);
  }

  const agentType = event.agent_type;
  if (!agentType) return allow('main agent, no token enforcement');

  const toolName = event.tool_name;
  if (toolName !== 'Bash') return allow('not a Bash command');

  const toolInput = event.tool_input ?? {};
  const cmd = (toolInput.command as string | undefined) ?? '';

  // Only enforce for trackgentic commands
  if (!cmd.includes('trackgentic')) return allow('not a trackgentic command');

  // Read the token from the environment variable
  const token = process.env['TRACKGENTIC_USER_TOKEN'];

  if (!token) {
    return deny(
      `enforce-trackgentic-token: agent '${agentType}' has no TRACKGENTIC_USER_TOKEN environment variable set. ` +
      `The agent runner must provide this variable when launching the agent.`
    );
  }

  // Strip any existing token env var the agent might have set, then inject the correct one
  const cleanCmd = stripExistingTokenEnv(cmd);
  const injectedCmd = `TRACKGENTIC_USER_TOKEN="${token}" ${cleanCmd}`;

  const updatedInput: Record<string, unknown> = { ...toolInput, command: injectedCmd };

  return allow(
    `enforce-trackgentic-token: injected token for agent '${agentType}'`,
    updatedInput,
  );
}

main().catch(() => process.exit(0));
