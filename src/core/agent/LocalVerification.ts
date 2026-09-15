/** Deterministic checks. Expected values stay on the host when programs run. */
export const CHECK_KINDS = ['equals', 'contains', 'json_equals', 'grid_equals', 'coverage'] as const;
export type CheckKind = typeof CHECK_KINDS[number];
export interface CheckResult { status: 'passed' | 'failed'; detail: string }

/** Canonical JSON, bounded before traversing user supplied values. */
export function canonicalValue(value: unknown): string {
    const serialized = JSON.stringify(value);
    if (serialized === undefined || serialized.length > 65536) throw new Error('Expected bounded JSON value');
    const sort = (v: unknown, depth: number): unknown => {
        if (depth > 40) throw new Error('JSON nesting limit exceeded');
        if (v === null || typeof v === 'string' || typeof v === 'boolean') return v;
        if (typeof v === 'number' && Number.isFinite(v)) return v;
        if (Array.isArray(v)) return v.map(x => sort(x, depth + 1));
        if (typeof v !== 'object' || v === null) throw new Error('Expected JSON value');
        const prototype: unknown = Object.getPrototypeOf(v);
        if (prototype !== Object.prototype && prototype !== null) throw new Error('Expected plain JSON object');
        return Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, sort(x, depth + 1)]));
    };
    return JSON.stringify(sort(value, 0));
}

function isGrid(value: unknown): boolean {
    const first: unknown = Array.isArray(value) ? value[0] : undefined;
    const width = Array.isArray(first) ? first.length : 0;
    return Array.isArray(value) && value.length > 0 && value.length <= 30
        && Array.isArray(value[0]) && value[0].length > 0 && value[0].length <= 30
        && value.every(row => Array.isArray(row) && row.length === width
            && row.every(cell => Number.isInteger(cell) && cell >= 0 && cell <= 9));
}

function isStringArray(value: unknown): value is string[] {
    return Array.isArray(value) && value.every(x => typeof x === 'string');
}

export function checkValue(kind: CheckKind, actual: unknown, expected: unknown): CheckResult {
    try {
        let passed: boolean;
        let detail = '';
        const a = canonicalValue(actual);
        const e = canonicalValue(expected);
        switch (kind) {
            case 'equals': passed = actual === expected && (actual === null || typeof actual !== 'object'); break;
            case 'contains': passed = typeof actual === 'string' && typeof expected === 'string' && actual.includes(expected); break;
            case 'coverage': {
                if (!isStringArray(expected) || typeof actual !== 'string') {
                    passed = false; break;
                }
                const missing = expected.filter(x => !actual.includes(x));
                passed = missing.length === 0;
                detail = `Missing: ${JSON.stringify(missing).slice(0, 240)}`;
                break;
            }
            case 'json_equals': passed = a === e; break;
            case 'grid_equals': passed = isGrid(actual) && isGrid(expected) && a === e; break;
            default: return { status: 'failed', detail: 'Unknown check kind' };
        }
        return { status: passed ? 'passed' : 'failed', detail: passed ? 'Matched' : detail || `Expected ${e.slice(0, 120)}; received ${a.slice(0, 120)}` };
    } catch (error) {
        return { status: 'failed', detail: error instanceof Error ? error.message : 'Invalid value' };
    }
}

export interface Probe { id: string; cost: number; predictions: unknown[] }
/** Select a boundary case that separates hypotheses; no model or oracle calls. */
export function chooseProbe(probes: Probe[]): (Probe & { informationPerCost: number }) | undefined {
    if (probes.length > 32) throw new Error('At most 32 probes');
    let best: (Probe & { informationPerCost: number }) | undefined;
    for (const probe of probes) {
        if (!Number.isFinite(probe.cost) || probe.cost <= 0 || probe.predictions.length < 2 || probe.predictions.length > 32) continue;
        const counts = new Map<string, number>();
        for (const prediction of probe.predictions) {
            const key = canonicalValue(prediction);
            counts.set(key, (counts.get(key) ?? 0) + 1);
        }
        let entropy = 0;
        for (const count of counts.values()) {
            const p = count / probe.predictions.length;
            entropy -= p * Math.log2(p);
        }
        const score = entropy / probe.cost;
        if (score > 0 && (!best || score > best.informationPerCost)) best = { ...probe, informationPerCost: score };
    }
    return best;
}
