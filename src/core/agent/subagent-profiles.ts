/**
 * Subagent profiles -- FEAT-24-04 / ADR-113.
 *
 * A profile is a lean alternative to the parent's mode + rules + skills
 * set for a `new_task`-spawned subagent. When the model calls
 * `new_task(profile='research', message='...')`, the subagent runs with
 * the profile's roleDefinition + a reduced tool allowlist, and the
 * Tier-4 justification (ADR-090) is skipped because the profile itself
 * is the explicit choice.
 *
 * Start small: one profile (`research`). Extending the registry is a
 * map addition; no new concept needed.
 */

import type { ToolName } from '../tools/types';
import type { ModelTier } from '../../types/settings';

export interface SubagentProfile {
    /** Short identifier used in `new_task({ profile })`. */
    name: string;
    /** Human-readable short description (shown in the new_task input schema). */
    description: string;
    /**
     * Tools the subagent may use. Subset of all registered tools. Profile-tools
     * replace the parent's mode tool set so the subagent's `tools` field stays
     * small (one of the goals of ADR-113).
     */
    allowedTools: ToolName[];
    /**
     * Lean role-definition that replaces `mode.roleDefinition` in the
     * subagent's system prompt. Keeps the profile prompt much shorter than
     * inheriting the parent's full mode definition.
     */
    roleDefinition: string;
    /**
     * EPIC-26 / ADR-120: pin the subagent to a tier on the active
     * provider instead of inheriting the parent's api handler. Used by
     * the research profile (fast tier, FEAT-24-04 cost story) and the
     * advisor profile (flagship tier, on-demand escalation).
     */
    tierOverride?: ModelTier;
    /**
     * EPIC-26 / ADR-120: hard cap on the subagent's visible output
     * tokens. Wins over the user's `advancedApi.subtaskTokenBudget`
     * setting so the advisor profile can guarantee a tight 3000-token
     * synthesis budget regardless of user config.
     */
    maxOutputTokens?: number;
}

const RESEARCH_PROFILE: SubagentProfile = {
    name: 'research',
    description: 'Read-only research subagent: searches and reads vault notes + web, returns a compact source-cited summary. No writes, no further subagents.',
    allowedTools: [
        'read_file',
        'read_document',
        'list_files',
        'search_files',
        'semantic_search',
        'search_history',
        'web_search',
        'web_fetch',
        'attempt_completion',
        'ask_followup_question',
    ],
    roleDefinition: `You are a focused read-only research subagent. Gather the information requested by your parent.
Rules:
- Do NOT write, edit, delete, or move vault content; do NOT switch modes or spawn further subagents.
- Aim for 3 to 7 tool calls within the existing budget.
- Your attempt_completion MUST contain the actual answer the parent asked for. It sees no intermediate tools.
- For N items with fields A and B, return all N items, with both fields. Compact means concise wording, NOT abbreviated content.
- Anchor findings to vault paths and heading/block/character offsets, or exact web URLs.
- Include checks performed and unresolved limits; distinguish observed evidence from inference.
- Anti-pattern: do NOT write "Found 5 notes" instead of the five notes and requested content.
- If evidence or budget is insufficient, return a useful partial answer naming the missing coverage. Ask only when missing information prevents progress.`,
    // EPIC-26: research stays on the fast tier so cost stays low; the
    // visible output budget keeps the user-configured subtaskTokenBudget.
    tierOverride: 'fast',
};

const ADVISOR_PROFILE: SubagentProfile = {
    name: 'advisor',
    description: 'Read-only advisor subagent on the flagship model. Used by consult_flagship for one-shot synthesis steps that need the strongest model. Hard 3000-token output cap.',
    allowedTools: [
        'read_file',
        'read_document',
        'search_files',
        'semantic_search',
        'web_fetch',
        'web_search',
        'attempt_completion',
    ],
    roleDefinition: `You are a read-only advisor subagent. Resolve ONE problem for your parent with a concrete, actionable answer.
- Do NOT write, edit, delete, or move vault content or spawn further subagents.
- Use a few targeted checks within the existing budget.
- Your attempt_completion MUST contain the actual decision or answer; the parent sees no intermediate tools.
- State the recommendation, supporting source anchors, checks performed and unresolved limits. Distinguish inference from observation.
- Hard output budget: 3000 tokens. Use concise wording.`,
    tierOverride: 'flagship',
    maxOutputTokens: 3000,
};

/**
 * FEAT-24-10 / ADR-159: the profile behind the dedicated `investigate`
 * tool. Differs from `research` in two deliberate ways: it runs on the
 * MID tier (quality over the fast tier -- the investigate results feed
 * the main conversation directly), and its completion contract demands
 * SOURCE ANCHORS so the parent can re-read exact passages instead of
 * trusting the summary blindly (fixes the IMP-24-04-01 class of
 * meta-acknowledgement answers).
 */
const INVESTIGATE_PROFILE: SubagentProfile = {
    name: 'investigate',
    description: 'Read-only investigation subagent (vault + web) on the mid tier. Returns the answer plus source anchors (path + heading + offset) so the parent can verify or re-read exact passages.',
    allowedTools: [
        'read_file',
        'read_document',
        'list_files',
        'search_files',
        'semantic_search',
        'search_history',
        'web_search',
        'web_fetch',
        'attempt_completion',
        'ask_followup_question',
    ],
    roleDefinition: `You are a read-only investigation subagent. Answer the parent's research question with verifiable source anchors.
- Do NOT write, edit, delete, or move vault content, switch modes or spawn further subagents.
- Your attempt_completion MUST contain the actual answer, never a meta-acknowledgement such as "found 5 notes"; return their requested content.
- End with Sources: one line per source. For vault sources use path="folder/note.md" heading="Section title" offset=NNN (character offset, or 0 for small files). For web sources use url="https://..." title="Page title".
- Anchor each substantive claim inline. Include checks performed and unresolved limits, separating inference from observation.
- If budget runs out, return an honest partial answer and name unchecked coverage. Ask only when missing information prevents progress.`,
    // ADR-159: mid tier -- investigation results feed the main thread
    // directly, so quality beats the fast tier; still far cheaper than
    // the parent's flagship-class model.
    tierOverride: 'mid',
};

const PROFILES: Record<string, SubagentProfile> = {
    [RESEARCH_PROFILE.name]: RESEARCH_PROFILE,
    [ADVISOR_PROFILE.name]: ADVISOR_PROFILE,
    [INVESTIGATE_PROFILE.name]: INVESTIGATE_PROFILE,
};

export function getSubagentProfile(name: string): SubagentProfile | undefined {
    if (!name) return undefined;
    return PROFILES[name];
}

export function listSubagentProfileNames(): string[] {
    return Object.keys(PROFILES).sort();
}
