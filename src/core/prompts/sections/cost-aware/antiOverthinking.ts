/** Scope-aware economy, shared by legacy prompt configurations. */
export function getAntiOverthinkingSection(): string {
    return `## 3. TASK DEPTH
Use a direct read/edit path for a bounded change with known inputs.
Summarization, translation and short wording do not establish that a task is simple.
Deep ingest, source verification and multi-source synthesis require the requested coverage.
Avoid unrelated exploration; resolve uncertainty that changes the result.
Delegate only independent bounded work with a clear benefit after helper costs.`;
}
