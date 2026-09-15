/** Bounded, branch-aware task evidence. Stored outside the model transcript. */
import { canonicalValue, CHECK_KINDS, type CheckKind, type CheckResult } from './LocalVerification';
import { sha256Hex } from '../utils/sha256';

export interface CheckDefinition { id: string; kind: CheckKind; expected: unknown; path?: string }
export interface JournalEvent {
    id: number;
    parent: number;
    kind: 'hypothesis' | 'observation' | 'decision' | 'check' | 'fork';
    text: string;
    sources: string[];
    checkId?: string;
    status?: CheckResult['status'];
    revision?: string;
    fileGeneration?: number;
}
export interface WorkJournalData {
    version: 1;
    checks: CheckDefinition[];
    events: JournalEvent[];
    head: number;
    experiments: number;
    fileGeneration: number;
    artifacts?: Array<{ hash: string; program: string; cases: Array<{ checkId: string; input: unknown }> }>;
}
const MAX_EVENTS = 256;
const MAX_CHECKS = 32;
export function createWorkJournal(): WorkJournalData {
    return { version: 1, checks: [], events: [], head: -1, experiments: 0, fileGeneration: 0, artifacts: [] };
}
function record(value: unknown): Record<string, unknown> {
    if (typeof value !== 'object' || !value || Array.isArray(value)) throw new Error('Invalid journal object');
    return value as Record<string, unknown>;
}
function integer(value: unknown, min: number, max: number): number {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) throw new Error('Invalid journal counter');
    return value;
}
function boundedText(value: unknown, max = 1200): string {
    if (typeof value !== 'string' || value.length > max) throw new Error('Invalid journal text');
    return value;
}
export function parseCheckDefinition(value: unknown): CheckDefinition {
    const raw = record(value);
    const id = boundedText(raw.id, 80);
    if (!/^[a-zA-Z0-9_:./-]+$/.test(id) || !CHECK_KINDS.includes(raw.kind as CheckKind)) throw new Error('Invalid check definition');
    canonicalValue(raw.expected);
    return { id, kind: raw.kind as CheckKind, expected: JSON.parse(JSON.stringify(raw.expected)) as unknown,
        ...(raw.path === undefined ? {} : { path: boundedText(raw.path, 512) }) };
}

/** Reject the whole journal on invalid data, never silently turn failures into success. */
export function parseWorkJournal(value: unknown): WorkJournalData | undefined {
    if (value === undefined) return undefined;
    if (JSON.stringify(value).length > 262144) throw new Error('Journal size limit exceeded');
    const raw = record(value);
    if (raw.version !== 1 || !Array.isArray(raw.checks) || !Array.isArray(raw.events)
        || raw.checks.length > MAX_CHECKS || raw.events.length > MAX_EVENTS) throw new Error('Invalid journal');
    const checks = raw.checks.map(parseCheckDefinition);
    if (new Set(checks.map(c => c.id)).size !== checks.length) throw new Error('Duplicate check id');
    const events: JournalEvent[] = raw.events.map((value, index) => {
        const e = record(value);
        if (e.id !== index || !['hypothesis', 'observation', 'decision', 'check', 'fork'].includes(String(e.kind))) throw new Error('Invalid journal event');
        const parent = integer(e.parent, -1, index - 1);
        if (!Array.isArray(e.sources) || e.sources.length > 8) throw new Error('Invalid sources');
        const event: JournalEvent = { id: index, parent, kind: e.kind as JournalEvent['kind'], text: boundedText(e.text), sources: e.sources.map(s => boundedText(s, 240)) };
        if (event.kind === 'check') {
            const checkId = boundedText(e.checkId, 80);
            if (!checks.some(c => c.id === checkId) || (e.status !== 'passed' && e.status !== 'failed')) throw new Error('Invalid check result');
            event.checkId = checkId;
            event.status = e.status;
            if (e.revision !== undefined) event.revision = boundedText(e.revision, 240);
            if (e.fileGeneration !== undefined) event.fileGeneration = integer(e.fileGeneration, 0, Number.MAX_SAFE_INTEGER);
        }
        return event;
    });
    const artifacts: NonNullable<WorkJournalData['artifacts']> = [];
    if (raw.artifacts !== undefined) {
        if (!Array.isArray(raw.artifacts) || raw.artifacts.length > 32) throw new Error('Invalid journal artifacts');
        for (const value of raw.artifacts) {
            const artifact = record(value);
            const program = boundedText(artifact.program, 12000);
            const hash = sha256Hex(program);
            if (artifact.hash !== hash || !Array.isArray(artifact.cases) || artifact.cases.length > 32) throw new Error('Invalid program artifact');
            const cases = artifact.cases.map(value => {
                const c = record(value);
                const checkId = boundedText(c.checkId, 80);
                if (!checks.some(check => check.id === checkId)) throw new Error('Unknown artifact check');
                canonicalValue(c.input);
                return { checkId, input: JSON.parse(JSON.stringify(c.input)) as unknown };
            });
            artifacts.push({ hash, program, cases });
        }
    }
    return { version: 1, checks, events, artifacts, head: integer(raw.head, -1, events.length - 1),
        experiments: integer(raw.experiments, 0, 32), fileGeneration: integer(raw.fileGeneration, 0, Number.MAX_SAFE_INTEGER) };
}

export class WorkJournal {
    constructor(readonly data: WorkJournalData) {}
    private append(event: Omit<JournalEvent, 'id' | 'parent'>, parent = this.data.head): number {
        if (this.data.events.length >= MAX_EVENTS) throw new Error('Journal event budget exhausted; inspect existing evidence');
        const id = this.data.events.length;
        const next = { ...event, id, parent };
        if (JSON.stringify({ ...this.data, events: [...this.data.events, next] }).length > 262144) throw new Error('Journal storage budget exhausted');
        this.data.events.push(next);
        this.data.head = id;
        return id;
    }
    define(value: CheckDefinition): void {
        const check = parseCheckDefinition(value);
        const existing = this.data.checks.find(c => c.id === check.id);
        if (existing) {
            if (canonicalValue(existing) !== canonicalValue(check)) throw new Error('Check definitions are immutable; add a new check id');
            return;
        }
        if (this.data.checks.length >= MAX_CHECKS || JSON.stringify([...this.data.checks, check]).length > 65536) throw new Error('Check definition budget exhausted');
        this.data.checks.push(check);
    }
    note(kind: 'hypothesis' | 'observation' | 'decision', text: string, sources: string[]): number {
        if (!['hypothesis', 'observation', 'decision'].includes(kind) || sources.length > 8) throw new Error('Invalid note');
        return this.append({ kind, text: boundedText(text), sources: sources.map(s => boundedText(s, 240)) });
    }
    fork(parent: number, reason: string): number {
        integer(parent, -1, this.data.events.length - 1);
        return this.append({ kind: 'fork', text: boundedText(reason), sources: [] }, parent);
    }
    recordCheck(checkId: string, result: CheckResult, revision?: string): void {
        const check = this.data.checks.find(c => c.id === checkId);
        if (!check) throw new Error(`Unknown check: ${checkId}`);
        this.append({ kind: 'check', checkId, status: result.status, text: boundedText(result.detail), sources: [],
            ...(revision === undefined ? {} : { revision: boundedText(revision, 240) }),
            ...(check.path ? { fileGeneration: this.data.fileGeneration } : {}) });
    }
    invalidateFiles(): void { this.data.fileGeneration++; }
    reserveExperiment(): void {
        if (this.data.experiments >= 32) throw new Error('Local experiment budget exhausted');
        this.data.experiments++;
    }
    saveArtifact(program: string, cases: Array<{ checkId: string; input: unknown }>): void {
        const hash = sha256Hex(program);
        const artifacts = this.data.artifacts ?? [];
        const previous = artifacts.find(a => a.hash === hash);
        const combined = new Map((previous?.cases ?? []).map(c => [canonicalValue(c), c]));
        for (const c of cases) combined.set(canonicalValue(c), c);
        if (combined.size > 32) throw new Error('Program artifact case budget exhausted');
        const artifact = { hash, program, cases: [...combined.values()] };
        const next = [...artifacts.filter(a => a.hash !== hash), artifact];
        // Leave room for results and further observations under the overall 256 KiB cap.
        if (JSON.stringify({ ...this.data, artifacts: next }).length > 196608) throw new Error('Program artifact storage budget exhausted');
        this.data.artifacts = JSON.parse(JSON.stringify(next)) as typeof next;
    }
    readArtifact(hash: string, offset = 0, maxChars = 1600): string {
        integer(offset, 0, 262144);
        const artifact = this.data.artifacts?.find(a => a.hash === hash);
        if (!artifact) throw new Error('Unknown program artifact');
        const text = JSON.stringify(artifact);
        const end = Math.min(text.length, offset + Math.max(1, Math.min(1600, maxChars)));
        return `Artifact ${hash}, chars ${offset}..${end}/${text.length}:\n${text.slice(offset, end)}`;
    }
    readCheck(id: string, offset = 0): string {
        integer(offset, 0, 65536);
        const check = this.data.checks.find(c => c.id === id);
        if (!check) throw new Error('Unknown check');
        const text = JSON.stringify(check);
        const end = Math.min(text.length, offset + 1600);
        return `Check ${id}, chars ${offset}..${end}/${text.length}:\n${text.slice(offset, end)}`;
    }
    activeEvents(): JournalEvent[] {
        const out: JournalEvent[] = [];
        for (let id = this.data.head; id >= 0; id = this.data.events.at(id)!.parent) out.push(this.data.events.at(id)!);
        return out;
    }
    completionIssue(): string | undefined {
        const events = this.activeEvents();
        const missing = this.data.checks.filter(check => {
            const latest = events.find(e => e.checkId === check.id);
            return !latest || latest.status !== 'passed' || (check.path && latest.fileGeneration !== this.data.fileGeneration);
        });
        return missing.length ? `Unverified checks: ${missing.map(c => c.id).join(', ')}. Inspect evidence; test a different hypothesis if stalled.` : undefined;
    }
    guidance(): string | undefined {
        const failures = this.activeEvents().filter(e => e.kind === 'check').slice(0, 2);
        if (failures.length === 2 && failures.every(e => e.status === 'failed') && failures[0].checkId === failures[1].checkId && failures[0].text === failures[1].text) {
            return 'No progress: choose a different hypothesis or a probe with differing predictions. Keep the existing model and budget.';
        }
        return undefined;
    }
    render(maxChars = 1200): string {
        const summary = { head: this.data.head, experimentsLeft: 32 - this.data.experiments,
            issue: this.completionIssue(), guidance: this.guidance(), checks: this.data.checks.map(({ id, kind, path }) => ({ id, kind, path })),
            artifacts: this.data.artifacts?.map(a => a.hash), recent: this.activeEvents().slice(0, 6) };
        return JSON.stringify(summary).slice(0, Math.max(0, Math.min(4000, maxChars)));
    }
}
