import { BaseTool } from '../BaseTool';
import type { ToolDefinition, ToolExecutionContext } from '../types';
import type ObsidianAgentPlugin from '../../../main';
import type { EsbuildWasmManager } from '../../sandbox/EsbuildWasmManager';
import { parseCheckDefinition } from '../../agent/WorkJournal';
import { chooseProbe, type Probe } from '../../agent/LocalVerification';
import { createJournalVerification } from './JournalVerificationHost';

function jsonValue(raw: unknown): unknown {
    if (typeof raw !== 'string' || raw.length > 65536) throw new Error('Expected a JSON string of at most 65536 characters');
    return JSON.parse(raw) as unknown;
}

/** Deferred, model-neutral evidence tool. All operations are local. */
export class WorkJournalTool extends BaseTool<'work_journal'> {
    readonly name = 'work_journal' as const;
    readonly isWriteOperation = false;
    constructor(plugin: ObsidianAgentPlugin, private compiler?: EsbuildWasmManager) { super(plugin); }
    getDefinition(): ToolDefinition {
        return {
            name: this.name,
            description: 'Local task evidence and hypothesis branches, preserved through compaction/resume. '
                + 'Define immutable checks before testing. verify_file reads actual vault bytes; experiment runs a JS/TS function body '
                + 'with input only (no files, network or dependencies) and compares outputs on the host. '
                + 'Use counterexamples to change strategy. choose_probe ranks differing predictions per cost. '
                + 'inspect reads state on demand; fork selects an earlier event without losing alternatives. '
                + 'promote offers a skill candidate only after two distinct cases pass the same program. '
                + '32 local experiments/task; no model calls. Checks constrain completion but do not prove general truth.',
            input_schema: {
                type: 'object', properties: {
                    operation: { type: 'string', enum: ['inspect', 'note', 'define', 'verify_file', 'experiment', 'fork', 'choose_probe', 'promote'] },
                    kind: { type: 'string', enum: ['hypothesis', 'observation', 'decision'] },
                    text: { type: 'string', description: 'Concise observation, hypothesis or branch reason; max 1200 chars' },
                    sources: { type: 'array', items: { type: 'string' }, description: 'Up to 8 source anchors' },
                    check: { type: 'object', properties: {
                        id: { type: 'string' }, kind: { type: 'string', enum: ['equals', 'contains', 'json_equals', 'grid_equals', 'coverage'] },
                        expected_json: { type: 'string', description: 'JSON-encoded expected value; coverage: array of required strings; e.g. 4 or [[1,2]] or "text"' },
                        path: { type: 'string', description: 'Vault file to verify; omit for a program check' },
                    }, required: ['id', 'kind', 'expected_json'] },
                    check_id: { type: 'string', description: 'Check id for verify_file or inspecting its full expected value' },
                    artifact: { type: 'string', description: 'Program hash from inspect; retrieve preserved program and cases' },
                    offset: { type: 'integer', description: 'Character offset for reading an artifact or check, default 0' },
                    parent: { type: 'integer', description: 'Event id for fork; -1 starts another branch' },
                    program: { type: 'string', description: 'JS/TS function body using input and returning the result; max 12000 chars' },
                    cases: { type: 'array', items: { type: 'object', properties: { checkId: { type: 'string' }, input_json: { type: 'string', description: 'JSON-encoded input value' } }, required: ['checkId', 'input_json'] } },
                    probes: { type: 'array', items: { type: 'object', properties: {
                        id: { type: 'string' }, cost: { type: 'number' }, predictions: { type: 'array', items: { type: 'string', description: 'One prediction label per hypothesis' } },
                    }, required: ['id', 'cost', 'predictions'] } },
                }, required: ['operation'],
            },
        };
    }
    async execute(input: Record<string, unknown>, context: ToolExecutionContext): Promise<void> {
        try {
            if (!context.getWorkJournal) throw new Error('Work journal requires a running agent task');
            const journal = context.getWorkJournal();
            const verifier = createJournalVerification(this.plugin, journal, this.compiler);
            let result: unknown;
            switch (input.operation) {
                case 'inspect': result = typeof input.artifact === 'string'
                    ? journal.readArtifact(input.artifact, input.offset as number | undefined)
                    : typeof input.check_id === 'string' ? journal.readCheck(input.check_id, input.offset as number | undefined)
                        : journal.render(); break;
                case 'note': result = journal.note(input.kind as 'observation', input.text as string, (input.sources ?? []) as string[]); break;
                case 'define': {
                    const check = input.check as Record<string, unknown> | undefined;
                    journal.define(parseCheckDefinition({ ...check, expected: jsonValue(check?.expected_json) }));
                    result = 'Check defined'; break;
                }
                case 'verify_file': result = await verifier.verifyFile(String(input.check_id)); break;
                case 'fork': result = journal.fork(input.parent as number, input.text as string); break;
                case 'experiment': {
                    if (!Array.isArray(input.cases) || input.cases.length > 32) throw new Error('Expected at most 32 cases');
                    const cases = input.cases.map((value: unknown) => {
                        const c = value as Record<string, unknown> | null;
                        if (!c || typeof c.checkId !== 'string') throw new Error('Invalid case');
                        return { checkId: c.checkId, input: jsonValue(c.input_json) };
                    });
                    result = await verifier.experiment(input.program as string, cases, context.abortSignal); break;
                }
                case 'choose_probe': result = chooseProbe(input.probes as Probe[]) ?? 'No probe separates the supplied hypotheses'; break;
                case 'promote': result = await verifier.promotion(); break;
                default: throw new Error('Unknown journal operation');
            }
            const text = typeof result === 'string' ? result : JSON.stringify(result);
            context.callbacks.pushToolResult(this.formatUntrustedContent('task-evidence', text.slice(0, 2400))
                + (journal.guidance() ? `\n${journal.guidance()}` : ''));
        } catch (error) { context.callbacks.pushToolResult(this.formatError(error)); }
    }
}
