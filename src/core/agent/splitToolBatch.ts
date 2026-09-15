/**
 * Parallel-prefix batch splitting (IMP-41-02-02).
 *
 * The legacy rule was all-or-nothing: `every(PARALLEL_SAFE)` or fully
 * sequential, so one write at the end of a batch serialized three
 * independent reads before it. This helper takes the MAXIMAL parallel-safe
 * prefix for concurrent execution and leaves the rest sequential in model
 * order. Only the prefix is split (no parallel islands): a read placed
 * AFTER a write may want to observe that write's effect, so the model's
 * ordering constraint is preserved for everything from the first
 * non-parallel-safe tool onwards.
 *
 * A single-element prefix stays sequential — Promise.all over one tool
 * buys nothing and would fragment the error-handling path.
 */

export function splitToolBatch<T extends { name: string }>(
    toolUses: readonly T[],
    parallelSafe: ReadonlySet<string>,
): { parallelPrefix: T[]; sequentialRest: T[] } {
    let prefixLen = 0;
    while (prefixLen < toolUses.length && parallelSafe.has(toolUses[prefixLen].name)) {
        prefixLen++;
    }
    if (prefixLen < 2) {
        return { parallelPrefix: [], sequentialRest: [...toolUses] };
    }
    return {
        parallelPrefix: toolUses.slice(0, prefixLen),
        sequentialRest: toolUses.slice(prefixLen),
    };
}


/** Read waves separated by exclusive barriers, with bounded fanout. */
export function groupToolBatch<T extends { name: string }>(
    toolUses: readonly T[], parallelSafe: ReadonlySet<string>, concurrency = 4,
): T[][] {
    const limit = Number.isFinite(concurrency) ? Math.max(1, Math.floor(concurrency)) : 4;
    const groups: T[][] = [];
    let reads: T[] = [];
    const flush = (): void => { if (reads.length) { groups.push(reads); reads = []; } };
    for (const tool of toolUses) {
        if (!parallelSafe.has(tool.name)) { flush(); groups.push([tool]); }
        else { reads.push(tool); if (reads.length >= limit) flush(); }
    }
    flush();
    return groups;
}
