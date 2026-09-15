---
title: Quality gates and cost awareness
description: How Vault Operator validates its own output and keeps the agent loop honest about token spend.
---

# Quality gates and cost awareness

Vault Operator has two overlapping systems for keeping the agent honest. **Quality gates** are self-check lists that ship with artifact-producing tools, so the agent verifies its own output before declaring a task done. **Cost awareness** is a set of design choices and visible counters that make token spend tangible and bias the agent toward cheaper paths first.

## Quality gates

Tools that produce real artifacts (PPTX, DOCX, XLSX, Canvas, Excalidraw) carry a checklist. After the tool runs, the checklist is appended to the tool result. The agent reads it on the next turn and decides whether the output passes or whether it needs a second pass.

The mechanism is free: no extra API call, no separate validation pipeline. The check rides on the tool result the model is already reading.

Examples:

- `create_pptx` ships with about 15 checks: action titles per slide, word count per shape, color consistency, canvas bounds, required-shape coverage.
- `create_docx` ships with a smaller list: headings present, sections balanced, tables well-formed.
- `generate_canvas` checks bounds and node spacing.

Tools opt in via a `qualityGate` flag in `src/core/tools/toolMetadata.ts`, and the checklist text lives next to the flag as `qualityGateChecklist`. The agent loop (`src/core/agent/AgentLoopEngine.ts`) appends the checklist to every successful result of a gated tool.

Quality gates catch many shape errors but not subjective ones. A visually correct slide deck can still miss the point. They are a safety net, not a quality guarantee.

## Work journal and local verification

For tasks that need explicit evidence, the agent can load `work_journal` to record hypotheses, artifacts, checks and experiment results. The journal survives context compression and task recovery. File, JSON and grid checks run locally; experiments use an isolated sandbox. These checks do not call a second model.

When a registered check is open or failed, the host prevents the task from being marked successfully complete. It reports the missing evidence without automatically starting another model turn. The agent still has to choose useful checks, and passing them proves only the properties they cover.

## Cost awareness

ADR-90 outlines a multi-lever approach to keep agent cost predictable. Three of the levers are visible to you:

**Live counters.** The sidebar footer shows running token counts (input, output) and the EUR cost so far for the active conversation. The price registry covers every supported model. Switching models updates the cost projection in real time.

**A small initial tool catalog.** The prompt exposes core tools and short guidance for discovering specialized tools when needed. This reduces the definitions sent repeatedly to the model.

**Sub-agent justification.** `new_task` is restricted to three categories (parallel work, specialist mode, escalation). The agent has to name the category in the call, which discourages spawning sub-agents out of habit.

Less visible but equally important:

- Errors are re-framed as "try a simpler path" cues in the system prompt, not as "escalate" triggers.
- A telemetry service logs token count, cost, tool sequence, and outcome per task to `<vault>/.vault-operator/data/telemetry/tasks.jsonl` so before / after experiments are measurable.
- Stage 3 vault-health checks (see [Vault health](./vault-health.md)) carry a weekly USD budget and notify at 80% spend.

## How the two systems interact

A quality gate failure pushes the agent into a corrective turn, which costs tokens. A cost-aware agent should still take that corrective turn rather than ship a broken artifact: the cost of one extra turn is dwarfed by the cost of you having to fix the deck by hand. The two systems are aligned in practice.

## Limits

- Quality gates are static. A new tool needs an explicit checklist; there is no automatic gate inference.
- Cost displays depend on the price registry. Stale prices mean stale numbers.
- The 80% budget warning fires once per week. If you keep spending after seeing it, you do not get a second warning before the hard cap.
- Cost awareness in regular chat is presentational, not enforced. The hard budget cap applies only to Stage 3 background work.

## Related decisions

- ADR-90: cost-aware heuristics, the 10 levers
- ADR-105: Stage 3 budget enforcement
- ADR-106: severity tiers for health findings (overlaps with the budget gate)

See also: [Token optimization](./token-optimization.md), [Choosing a model](/guides/choosing-a-model).

Latest release: [3.8.2: harness improvements](../releases/v3.8.md).
