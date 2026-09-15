/** Provider-owned Responses continuation (IMP-24-03-01, ADR-150).
 * Never interpreted as instructions, displayed, or replayed across provider scopes.
 */
import type { ProviderState } from '../types';
import type { LLMProvider } from '../../types/settings';
import { sha256Hex } from '../../core/utils/sha256';

export interface ResponsesReasoningItem {
    type: 'reasoning';
    id: string;
    encrypted_content: string;
    summary: Array<{ type: 'summary_text'; text: string }>;
}

export interface ResponsesContinuation {
    reasoning: ResponsesReasoningItem[];
    phase?: 'commentary' | 'final_answer';
}

const MAX_STATE_CHARS = 1_000_000;

export function responsesScope(config: LLMProvider): string {
    // Hash the endpoint as well: custom URLs may themselves contain credentials.
    return sha256Hex(JSON.stringify([config.type, config.baseUrl ?? '', config.model]));
}

export function readReasoningItem(raw: unknown): ResponsesReasoningItem | undefined {
    if (!raw || typeof raw !== 'object') return;
    const r = raw as Record<string, unknown>;
    if (r.type !== 'reasoning' || typeof r.id !== 'string' || !r.id
        || typeof r.encrypted_content !== 'string' || !r.encrypted_content
        || r.encrypted_content.length > MAX_STATE_CHARS || !Array.isArray(r.summary)) return;
    const summary: ResponsesReasoningItem['summary'] = [];
    for (const entry of r.summary) {
        if (!entry || typeof entry !== 'object') return;
        const s = entry as Record<string, unknown>;
        if (s.type !== 'summary_text' || typeof s.text !== 'string') return;
        summary.push({ type: 'summary_text', text: s.text });
    }
    const out: ResponsesReasoningItem = { type: 'reasoning', id: r.id, encrypted_content: r.encrypted_content, summary };
    return JSON.stringify(out).length <= MAX_STATE_CHARS ? out : undefined;
}

export function readResponsesContinuation(state: ProviderState | undefined, scope?: string): ResponsesContinuation | undefined {
    if (!scope || !state || state.format !== 'responses-v1' || state.scope !== scope
        || !state.value || typeof state.value !== 'object') return;
    const v = state.value as Record<string, unknown>;
    if (!Array.isArray(v.reasoning) || v.reasoning.length > 100) return;
    const reasoning: ResponsesReasoningItem[] = [];
    let size = 0;
    for (const raw of v.reasoning) {
        const item = readReasoningItem(raw);
        if (!item) return;
        size += JSON.stringify(item).length;
        if (size > MAX_STATE_CHARS) return;
        reasoning.push(item);
    }
    return { reasoning, ...(v.phase === 'commentary' || v.phase === 'final_answer' ? { phase: v.phase } : {}) };
}

/** Native usage is preferred; ciphertext length is only a conservative fallback. */
export function estimateResponsesContinuationTokens(state: ProviderState | undefined, scope: string): number {
    const value = readResponsesContinuation(state, scope);
    if (!value || value.reasoning.length === 0) return 0;
    const reported = state?.estimatedTokens;
    if (typeof reported === 'number' && Number.isFinite(reported) && reported >= 0 && reported <= 1_000_000) return Math.ceil(reported);
    return Math.ceil(JSON.stringify(value.reasoning).length / 4);
}
