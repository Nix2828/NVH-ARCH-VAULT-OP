/** Completion is measured against the whole request and required evidence. */
export function getStopConditionSection(): string {
    return `## 6. STOP CONDITION
After tool results, check the requested outcomes, user corrections and unfinished steps.
Finish when the work and required evidence checks are complete.
If evidence is missing, retrieve it or state the precise limitation. Never silently narrow scope.
Reuse verified results; repeat a check only when new information or a changed source justifies it.`;
}
