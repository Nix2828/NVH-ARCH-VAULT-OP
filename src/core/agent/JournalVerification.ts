import { WorkJournal } from './WorkJournal';
import { canonicalValue, checkValue, type CheckResult } from './LocalVerification';
import type { ISandboxExecutor } from '../sandbox/ISandboxExecutor';
import { AstValidator } from '../sandbox/AstValidator';
import { sha256Hex } from '../utils/sha256';

export interface VerificationPorts {
    /** The caller must enforce vault path and IgnoreService guards. */
    readFile(path: string): Promise<string>;
    compile?: (source: string) => Promise<string>;
    /** Must return a fresh, bridge-disabled sandbox. Never the shared executor. */
    createSandbox?: () => ISandboxExecutor;
}
export interface ExperimentCase { checkId: string; input: unknown }

export class JournalVerification {
    constructor(readonly journal: WorkJournal, private ports: VerificationPorts) {}
    async verifyFile(checkId: string): Promise<CheckResult> {
        const check = this.journal.data.checks.find(c => c.id === checkId);
        if (!check?.path) throw new Error('A file check requires a path');
        let result: CheckResult;
        let revision: string | undefined;
        try {
            const text = await this.ports.readFile(check.path);
            revision = sha256Hex(text);
            const actual: unknown = check.kind === 'json_equals' || check.kind === 'grid_equals' ? JSON.parse(text) : text;
            result = checkValue(check.kind, actual, check.expected);
        } catch {
            result = { status: 'failed', detail: 'File unavailable, denied, too large, or invalid JSON' };
        }
        // Identical checks need no second event. Still read the current bytes.
        const previous = this.journal.activeEvents().find(e => e.checkId === checkId);
        if (!previous || previous.revision !== revision || previous.status !== result.status
            || previous.fileGeneration !== this.journal.data.fileGeneration) this.journal.recordCheck(checkId, result, revision);
        return result;
    }
    async completionIssue(): Promise<string | undefined> {
        try {
            for (const check of this.journal.data.checks) if (check.path) await this.verifyFile(check.id);
            return this.journal.completionIssue();
        } catch { return 'Verification could not finish within the journal limits'; }
    }
    async experiment(program: string, cases: ExperimentCase[], signal?: AbortSignal): Promise<CheckResult[]> {
        if (!this.ports.compile || !this.ports.createSandbox) throw new Error('Local compiler/sandbox unavailable');
        if (typeof program !== 'string' || !program.trim() || program.length > 12000) throw new Error('Program must contain 1 to 12000 characters');
        if (!Array.isArray(cases) || cases.length < 1 || cases.length > 32) throw new Error('Expected 1 to 32 cases');
        canonicalValue(cases);
        if (new Set(cases.map(c => c.checkId)).size !== cases.length) throw new Error('Duplicate case check');
        const checks = cases.map(c => {
            const check = this.journal.data.checks.find(d => d.id === c.checkId);
            if (!check || check.path) throw new Error('Experiment needs a defined non-file check');
            canonicalValue(c.input);
            return check;
        });
        const validation = AstValidator.validate(program);
        if (!validation.valid) throw new Error(validation.errors.join('\n'));
        this.journal.reserveExperiment();
        const programHash = sha256Hex(program);
        // A function body, compiled without dependencies: no import/CDN loader.
        const compiled = await this.ports.compile(`export const definition = {name: '_verify'};
export async function execute(data) {
  const solve = async (input) => { ${program}\n };
  const outputs = [];
  for (const input of data.cases) outputs.push(await solve(input));
  return outputs;
}`);
        this.journal.saveArtifact(program, cases);
        const sandbox = this.ports.createSandbox();
        let outputs: unknown;
        let executionFailed = false;
        try {
            outputs = await sandbox.execute(compiled, { cases: cases.map(c => c.input) }, { abortSignal: signal });
            canonicalValue(outputs);
        } catch { executionFailed = true; }
        finally { sandbox.destroy(); }
        const results = checks.map((check, index) => {
            const result = executionFailed || !Array.isArray(outputs) || outputs.length !== checks.length
                ? { status: 'failed' as const, detail: 'Experiment failed, aborted, or returned invalid outputs' }
                : checkValue(check.kind, outputs.at(index), check.expected);
            // Program + input hash survive reload; no raw inputs in the prompt view.
            this.journal.recordCheck(check.id, result, `${programHash}:${sha256Hex(canonicalValue(cases.at(index)!.input))}`);
            return result;
        });
        return results;
    }
    async promotion(): Promise<string> {
        if (await this.completionIssue()) throw new Error('Reusable skill needs verified checks');
        const latest = new Map<string, string>();
        for (const event of this.journal.activeEvents()) {
            if (!event.checkId || latest.has(event.checkId)) continue;
            latest.set(event.checkId, event.status === 'passed' ? event.revision ?? '' : '');
        }
        const programs = new Map<string, Set<string>>();
        for (const revision of latest.values()) {
            if (!/^[a-f0-9]{64}:[a-f0-9]{64}$/.test(revision)) continue;
            const [program, input] = revision.split(':');
            if (!this.journal.data.artifacts?.some(a => a.hash === program)) continue;
            const inputs = programs.get(program) ?? new Set<string>();
            inputs.add(input); programs.set(program, inputs);
        }
        const verified = [...programs].filter(([, inputs]) => inputs.size >= 2);
        if (!verified.length) throw new Error('Reusable skill needs two distinct verified cases for the same program');
        return `Candidate only: ${verified.map(([hash, inputs]) => `${hash} (${inputs.size} distinct cases)`).join(', ')}. `
            + 'Use write_skill to save the matching program, assumptions, examples and limitations. These checks do not prove general correctness.';
    }
}
