import {existsSync, mkdirSync, readFileSync, rmSync, writeFileSync} from 'fs';
import {tmpdir} from 'os';
import {join} from 'path';

interface HookInput {
    session_id?: string;
    hook_event_name?: string;
    agent_type?: string;
}

const projectDir = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();

function expertiseIndexPath(agentType: string): string {
    return join(
        projectDir,
        '.agentic',
        'expertise',
        agentType,
        `${agentType}-index.yaml`
    );
}

function flagPath(sessionId: string, agentType: string): string {
    const dir = join(tmpdir(), 'claude-expertise-hook');
    mkdirSync(dir, {recursive: true});
    return join(dir, `${sessionId}-${agentType}.flag`);
}

function emit(output: unknown): void {
    process.stdout.write(JSON.stringify(output));
    process.exit(0);
}

async function readStdin(): Promise<HookInput | null> {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    try {
        return JSON.parse(Buffer.concat(chunks).toString()) as HookInput;
    } catch {
        return null;
    }
}

function injectExpertise(eventName: string, agentType: string, sessionId: string): void {
    const indexPath = expertiseIndexPath(agentType);
    if (!existsSync(indexPath)) process.exit(0);

    const indexContent = readFileSync(indexPath, 'utf8');

    writeFileSync(flagPath(sessionId, agentType), '1');

    emit({
        hookSpecificOutput: {
            hookEventName: eventName,
            additionalContext: `You are an expert agent that learns with every task you complete. This is what you know at the moment (${indexPath}):\n${indexContent}`,
        },
    });
}

function handleSessionStart(input: HookInput): void {
    const {agent_type, session_id} = input;
    if (!agent_type || !session_id) process.exit(0);

    // Dedup: if both settings.json and agent frontmatter define this hook,
    // the second invocation finds the flag already set and skips injection.
    if (existsSync(flagPath(session_id, agent_type))) process.exit(0);

    injectExpertise('SessionStart', agent_type, session_id);
}

function handleUserPromptSubmit(input: HookInput): void {
    const {agent_type, session_id} = input;
    if (!agent_type || !session_id) process.exit(0);

    // Skip if already injected at SessionStart (avoids duplication in -p mode
    // and interactive sessions where both events fire)
    if (existsSync(flagPath(session_id, agent_type))) process.exit(0);

    injectExpertise('UserPromptSubmit', agent_type, session_id);
}

function handleStop(input: HookInput, _eventName: string): void {
    const {agent_type, session_id} = input;
    if (!agent_type || !session_id) process.exit(0);

    const indexPath = expertiseIndexPath(agent_type);
    if (!existsSync(indexPath)) process.exit(0);

    const flag = flagPath(session_id, agent_type);
    if (!existsSync(flag)) process.exit(0);

    rmSync(flag, {force: true});

    emit({
        decision: 'block',
        reason: 'Check updating your expertise',
        systemMessage:
            'Check if you need to update your expertise with what you have learned in this session. Load the `agent-expertise` skill to update it following the best practices and conventions.',
    });
}

async function main(): Promise<void> {
    const input = await readStdin();
    if (!input) process.exit(0);

    switch (input.hook_event_name) {
        case 'SessionStart':
            return handleSessionStart(input);
        case 'UserPromptSubmit':
            return handleUserPromptSubmit(input);
        case 'Stop':
        case 'SubagentStop':
            return handleStop(input, input.hook_event_name);
        default:
            process.exit(0);
    }
}

main();