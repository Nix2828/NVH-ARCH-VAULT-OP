# Vault Operator — Fork & Skills Feasibility Analysis

**Baseline:** `Nix2828/NVH-ARCH-VAULT-OP` @ `5f92516` — **v3.8.2** (upstream snapshot 2026-09-15)
**Upstream:** `pssah4/vault-operator`
**Question:** How easy is it to use this as the baseline for our own Obsidian vault operator,
delivered as a set of skills on a plugin?

> **Revision note (2026-09-17).** This analysis was first written against v3.2.0 in a fork that
> has since been deleted and replaced with a current one. The headline conclusion was re-verified
> directly against 3.8.2 and **stands unchanged**. Sections 6.5, 6.6 and 10 describe cold-start
> problems that 3.8.2 has since **fixed** — they are kept as resolved history, flagged inline,
> because they show what the project's own audit trail looks like. Section 11 covers what changed
> between the two versions.

---

## TL;DR

**Very easy — if you take the right route.** The skills layer is already Anthropic-canonical and
designed to be extended without touching TypeScript. Forking the plugin itself is a much bigger
commitment than it looks.

| Route | What it is | Effort | Merge debt |
|---|---|---|---|
| **A — Skills only** | Drop `SKILL.md` folders into the vault. No fork, no build. | **Hours** | None |
| **B — Fork + own bundled skill set** | Replace `bundled-skills/`, rebrand, rebuild. | **1–3 days** | Forever |
| **C — Own operator on this base** | 185k LOC, 878 files, 75 tools, 46 subsystems. | **Weeks–months** | Forever |

**Recommendation: start at A.** Graduate to B only when A hits a real wall.

---

## 1. Licence — clean

Apache-2.0. Permissive, commercial use fine, no copyleft.

Obligations if we fork: keep `LICENSE`, keep and extend `NOTICE`, state our changes, don't use
their trademarks. That's it.

`NOTICE` already chains the lineage: Cline → Roo Code → Kilo Code → Continue Dev, plus OpenClaw
(MIT) for the agent identity system. We add one line and we're compliant.

Derived components per NOTICE: `src/api/`, `src/core/`, `src/ui/`.

---

## 2. The skills architecture is already the shape we want

This is the headline finding. The author explicitly built for Anthropic portability.

From `src/core/skills/SkillFrontmatterValidator.ts`:

> "Mirrors the Anthropic canonical skill-creator validation so a skill created here is portable
> across Claude Code, claude.ai, and other Anthropic-compliant runtimes."

### Validation rules (identical to Anthropic's)
- `name`: kebab-case, ≤64 chars, no double hyphens, reserved words `anthropic`/`claude` blocked
- `description`: required, ≤1024 chars, no angle brackets
- Everything else is tolerated-with-warning, including `allowed-tools`, `version`, `author`,
  `keywords`, `when-to-use`, `argument-hint`, `tags`

### Progressive disclosure — done properly
`src/core/prompts/sections/skillDirectory.ts` puts **only name + description** in the cached
system-prompt prefix (above the cache breakpoint, so it doesn't invalidate KV cache between turns).
The model then calls `read_skill({ name })` to pull the body in as a tool result, where it falls
under microcompaction like any other tool output.

This is ADR-116 / FEAT-24-09. The old per-message keyword classifier was deliberately removed.

### Folder layout — same as Anthropic skills
```
{skill-name}/
  SKILL.md          # required: frontmatter + body
  scripts/          # JS/TS, executable via run_skill_script
  references/       # loaded on demand
  assets/           # templates, binaries
  {role}.skill.md   # sub-roles, for type: coordinator skills
```

### Composability — the orchestration primitive we need
`invoke_skill` runs another skill as a **fresh subtask** (own conversation history, own
`attempt_completion`), returning its result as a tool result.

- `allowedTools` in the child's frontmatter narrows its tool schema — collapses ~9000 tokens of
  schema down to just what it needs
- `max_iterations` caps the child loop budget (default 12, hard cap 25) so a runaway sub-skill
  can't quietly multiply parent cost
- `type: coordinator` + sibling `*.skill.md` files gives multi-role skills

**This maps directly onto NVH-MASTER-WORKFLOW → UNDERSTANDING → BRAINSTORMING → RESEARCHING →
PLANNING → SCAFFOLDING → EVALUATE-ITERATE-ANNOTATE → EXPORTS.** Master skill as coordinator,
each stage as an invoked sub-skill with its own narrow toolset.

### There is already a skill for importing our skills
`bundled-skills/skill-translator/` — ports Anthropic skills (including Python scripts) into
native Vault Operator skills. Dry-run pass classifies every Python import against a mapping
table; partial/unmappable cases trigger a user-confirmation modal before anything is written.
Binary formats (PDF/PPTX/DOCX/XLSX) route to built-in tools rather than being translated.

And `bundled-skills/skill-creator/` is the authoring guide, with `init_skill.js` and
`quick_validate.js` scripts.

---

## 3. Route A — skills only, no fork (recommended start)

Skills live in the vault, not the plugin:

```
.vault-operator/data/skills/{name}/SKILL.md   # ours
.vault-operator/data/skills/plugin/{name}/    # auto-generated from installed plugins
```

- Hot-reload via Obsidian vault events (`setupWatcher()` in `SelfAuthoredSkillLoader.ts`)
- **User skills win over bundled ones.** `BuiltinSkillMaterializer` skips any skill whose existing
  `SKILL.md` has `source: user` or `source: {plugin-id}`. Plugin updates won't clobber our work.
- Zero build toolchain, zero TypeScript, zero merge debt

**Effort: an afternoon for the first skill, much less thereafter.**

---

## 4. Route B — fork with our own bundled skills

Genuinely easy, because the build is already wired for it.

`esbuild.config.mjs:141-157` walks `bundled-skills/`, reads every folder, and generates
`BUNDLED_SKILLS: Record<string, Record<string, string>>`. Binary files get a `__b64__` suffix.
`BuiltinSkillMaterializer` writes them into the vault on plugin load, wiping the previous builtin
folder so removed skills disappear cleanly.

**To swap in our own skill set: empty `bundled-skills/`, drop our folders in, rebuild.
No code changes.**

`deploy-local.sh` handles the dev loop (point `PLUGIN_DIR` at a vault via `.env`, run
`npm run deploy`, reload Obsidian).

### Rebranding surface
| Token | Files |
|---|---|
| `vault-operator` (ids, paths) | 89 |
| `Vault Operator` (display) | 70 |
| `obsilo` (legacy name) | 82 |

Plus `manifest.json` (`id`, `name`, `author`, `authorUrl`), `DEFAULT_AGENT_FOLDER` and
`LEGACY_AGENT_FOLDERS` in `src/core/utils/agentFolder.ts`.

Mechanical, but do it in one pass with care — the agent folder constants carry migration logic.

---

## 5. The sleeper feature: it's already an MCP server

`src/mcp/McpBridge.ts` hosts an MCP Streamable-HTTP endpoint on **localhost:27182**. Claude
Desktop / ChatGPT / Perplexity connect by URL. There's also a Cloudflare relay
(`relay/`, `CloudflareDeployer.ts`) for remote access.

Tools exposed (`src/mcp/tools/`):
`searchVault`, `readNotes`, `writeVault`, `executeVaultOp`, `getContext`, `getVaultGraph`,
`recallMemory`, `saveToMemory`, `updateMemory`, `searchHistory`, `saveConversation`,
`closeConversation`, `syncSession`.

**Strategic implication:** this is a far richer surface than the current Obsidian MCP on 27123
(which is essentially REST CRUD). It means Archie-in-Claude-Desktop and the in-vault agent read
and write the *same* memory and history. One persistent collaborator, actually wired up rather
than aspirational.

---

## 6. Friction and gaps — read before committing

### 6.1 This is a public mirror with the design history stripped
Commit `4276a79` ("chore: strip internal files for public mirror") removed **843 files /
140,792 lines**:
- all of `_devprocess/` — ADRs, ~40 audit reports, epic/feature templates
- `CLAUDE.md`
- `.github/agents/` — architect, business-analyst, requirements-engineer, security-auditor agent definitions
- CodeQL config, security-audit and perf-budget workflows

Meanwhile `src/` contains **1,052 `ADR-NNN` references** pointing at documents that don't exist
in this repo. Expect to read code with dangling citations. Not fatal — the code comments are
unusually good — but it's the single biggest comprehension tax.

### 6.2 German-language content
8 of 13 bundled skills have German bodies and bilingual regex triggers. One prompt file
(`src/core/prompts/sections/responseFormat.ts`) too. UI i18n is English-only
(`src/i18n/locales/en.ts`, 1,668 lines).

Annoying, but it's concentrated in exactly the layer we'd be replacing.

### 6.3 `trigger:` regex is vestigial
The frontmatter validator tolerates `trigger` but marks it "read but ignored by the trigger
pipeline". The keyword classifier was deleted in IMP-24-09-01. **Don't write skills that depend
on regex triggers** — selection is model-driven off the `description` now. Put the trigger
language *in the description*.

### 6.4 Heavy dependency tree
`@aws-sdk/client-bedrock*`, `@huggingface/transformers`, `pdfjs-dist`, `exceljs`, `pptxgenjs`,
`sql.js`, `isomorphic-git`, `docx`, `jszip`. Built `main.js` is **5.2 MB**. Install is slow.

### 6.5 ~~Lockfile points at a private corporate registry~~ — **RESOLVED in 3.8.2**

> Fixed upstream by an audit dated 2026-07-26. `.npmrc` now pins `registry=https://registry.npmjs.org/`
> and the lockfile carries 0 private-host references. Verified in this repo. Kept for the record:

All **938** `resolved` URLs in `package-lock.json` point at
`https://nexus.enbw.com/repository/npm/` — a private Nexus mirror belonging to the original
author's employer. Every one returns **403** from outside that network, so a clean
`npm install` dies part-way through with a wall of fetch errors.

Verified: the packages themselves (including the unusual-looking `@agentic-stigmergy/*`) all
exist on public npm. The Nexus was only ever a proxy, so nothing is actually missing.

**Fix (preserves exact pinned versions *and* integrity hashes — integrity is content-based,
so rewriting the host is safe):**

```bash
sed -i 's|https://nexus\.enbw\.com/repository/npm/|https://registry.npmjs.org/|g' package-lock.json
npm install
```

Do this in the first commit of any fork, or every contributor loses an afternoon to it.
(Avoid `rm package-lock.json && npm install` — that silently drifts off the pinned versions
this project's integrity-hash tooling depends on.)

### 6.6 ~~`npm run build` fails on a clean clone (build-order bug)~~ — **RESOLVED in 3.8.2**

> Fixed upstream: `"build": "node esbuild.config.mjs production"`, with `typecheck` split into its
> own script. The `omit=optional` trap is gone too, with a comment noting it "breaks `npm run build`
> in every clean environment". Verified in this repo. Kept for the record:

```json
"build": "tsc -noEmit -skipLibCheck && node esbuild.config.mjs production"
```

`tsc` runs **first**, but 9 source files import from `src/_generated/*` — a gitignored directory
(`.gitignore:54`) that only the **second** step creates. On a cold clone the typecheck gate fails
before the generator ever runs:

```
src/main.ts(110,32): error TS2307: Cannot find module './_generated/bundled-skills'
... 9 errors, all TS2307, all _generated/*
EXIT=2
```

Invisible to anyone whose working tree has been warm since before the gate was added.

**Fix:** run the generator once first, then the build works forever after.
Or reorder the script to `node esbuild.config.mjs production && tsc -noEmit -skipLibCheck`.

### 6.7 Desktop only
`"isDesktopOnly": true`. No mobile Obsidian. Node APIs, child_process, local HTTP server.

---

## 7. Quality signals — this is a well-run project

- **329 test files** (vitest), tests colocated in `__tests__/` throughout
- ESLint with `security`, `no-unsanitized`, `obsidianmd` plugins; CodeQL scripts in package.json
- `REVIEWER_NOTES.md` — 22 KB threat model: actors and trust levels, trust boundaries, hard root
  allowlist in `safeFs.ts`, binary allowlist in `spawnAllowlist.ts`, dual sandbox (Chromium iframe
  + Node `vm.runInNewContext`), SHA-256 integrity pinning for CDN packages
- LLM output treated as adversarial input throughout; no path from chat output to `fs.*` or
  `child_process.spawn`
- 418 commits, proper gitflow (`release/*`, `dev`, `feature/*`)
- `ARCHITECTURE.md` is written *for the agent* so it can safely self-modify its own source

Governance worth inheriting: fail-closed approvals, per-category auto-approve toggles,
`.obsidian-agentignore`, git shadow-repo checkpoints with one-click undo.

---

## 8. Codebase map (for Route C estimation)

| Metric | Value |
|---|---|
| TypeScript files | 878 |
| Lines of TS | 185,241 |
| Tool implementations | 75 |
| `src/core/` subsystems | 46 |
| Largest file | `src/ui/AgentSidebarView.ts` (5,396 lines) |
| Entry point | `src/main.ts` (4,474 lines) |

Agent loop: `src/core/AgentTask.ts` (2,583 lines).
Tool governance: `src/core/tool-execution/ToolExecutionPipeline.ts`.
Providers: Anthropic, OpenAI, Google, Bedrock, Ollama, LM Studio, OpenRouter, Azure,
GitHub Copilot, ChatGPT OAuth, Kilo Gateway.

---

## 9. Recommended path

1. **This week — Route A.** Author our skill set as `SKILL.md` folders in a live vault.
   Install the plugin from Obsidian Community Plugins (no fork), port the existing skills,
   test them against real work. Hot-reload means the feedback loop is seconds, not minutes.
2. **Wire the MCP bridge.** Point Claude Desktop at localhost:27182 alongside the existing
   27123 server. Shared memory between Archie and the in-vault agent is the real unlock.
3. **Only then consider Route B** — and only if we need our own bundled defaults, our own
   branding, or a tool the plugin doesn't have. At that point it's copying folders into
   `bundled-skills/` and a rebrand pass. An afternoon, not a project.

**The trap:** forking 185k lines of TypeScript in order to change a folder of Markdown files.
The skills layer was explicitly designed to be extended from the vault. Use it that way first.

---

## 10. Build verification — **performed against v3.2.0, 2026-09-16**

> The cold-start sequence below was needed for 3.2.0 only. In 3.8.2 all three workarounds are
> unnecessary: `npm install && npm run build` should work directly. The compile results
> (0 type errors, clean bundle) are the durable finding here.

Everything below was actually run in this container, not inferred.

### Cold-start sequence a fork needs

```bash
# 1. Repoint the lockfile at public npm (see 6.5)
sed -i 's|https://nexus\.enbw\.com/repository/npm/|https://registry.npmjs.org/|g' package-lock.json

# 2. Install. If onnxruntime-node's postinstall stalls, skip scripts and
#    restore esbuild's native binary by hand (.npmrc omit=optional strips
#    @esbuild/linux-x64, and esbuild's postinstall is the fallback that
#    rescues it -- kill scripts and you lose both).
npm install                            # or: npm install --ignore-scripts
node node_modules/esbuild/install.js   # only needed after --ignore-scripts

# 3. Generate src/_generated/ BEFORE the typecheck gate (see 6.6)
node esbuild.config.mjs production

# 4. Now the normal build passes
npm run build
```

### Results

| Check | Result |
|---|---|
| `npm install` (public npm, no lockfile) | 608 packages, 1.1 GB |
| `tsc -noEmit -skipLibCheck` *before* generator | 9 errors — all `TS2307` on `_generated/*` |
| `tsc -noEmit -skipLibCheck` *after* generator | **0 errors, exit 0** |
| `node esbuild.config.mjs production` | **main.js 5.1 MB, done in 490 ms** |

**Zero genuine type errors across 878 files / 185,241 lines**, under `strictNullChecks` and
`noImplicitAny`. That is a strong quality signal.

Generated bundle contents confirm the skills pipeline works as documented:

```
src/_generated/bundled-skills.ts       265 KB   <- from bundled-skills/
src/_generated/bundled-templates.ts     34 KB
src/_generated/bundled-wasm.ts         988 KB
src/_generated/bundled-workers.ts        8 KB
```

`bundled-skills.ts` is generated verbatim from the `bundled-skills/` directory. Confirms Route B:
**swapping the bundled skill set is a folder swap plus a rebuild, no code changes.**

### Caveat on these numbers

This build used `--no-package-lock`, so dependency versions drifted from the lockfile's pins
(`onnxruntime-node` resolved 1.30.0 against a pinned 1.24.3). It proves the source compiles and
bundles; it is **not** a reproducible release build. Do the `sed` fix and install from the
corrected lockfile for anything shippable. The rebuilt `main.js` was deliberately reverted rather
than committed for this reason.

### Pattern worth noting

Three separate environment landmines — private registry in the lockfile, a required native-binary
postinstall, and a build-order bug — all of which are invisible from a warm working tree. The
project is high quality, but the **fork path has not been walked by an outsider recently**. Budget
a day for cold-start friction on Route B, and expect one or two more of these.

---

## 11. What changed between v3.2.0 and v3.8.2

The original analysis ran against a fork pinned at v3.2.0 (2026-07-06). That fork has been
replaced by `NVH-ARCH-VAULT-OP`, which tracks **v3.8.2**. The delta is six minor versions.

### Does the drift invalidate the analysis?

**The core conclusion holds, verified against 3.8.2 directly.** The skills architecture is intact
and still explicitly Anthropic-portable — `SkillFrontmatterValidator.ts` carries the same
"Mirrors the Anthropic canonical skill-creator validation" docblock. Route A remains right.

### All three cold-start landmines are fixed upstream

Every environment problem found in section 6 was real, and the author hit and fixed each one
independently, three weeks after the fork point:

| Landmine | Status in 3.8.2 |
|---|---|
| Private registry in lockfile (6.5) | **Fixed.** 0 `nexus.enbw.com` refs. `.npmrc` now pins `registry=https://registry.npmjs.org/` |
| Build-order bug (6.6) | **Fixed.** `"build": "node esbuild.config.mjs production"` — the `tsc &&` prefix is gone, `typecheck` is its own script |
| `omit=optional` breaking esbuild | **Fixed.** Removed, with a comment explaining it "breaks `npm run build` in every clean environment" |

The upstream `.npmrc` comment is worth quoting, because it confirms the diagnosis exactly:

> AUDIT 2026-07-26: a global `~/.npmrc` may point npm at a private company mirror. Pinning here
> keeps any such host (and its resolved URLs) out of this repo's package-lock.json and out of CI
> builds. The comment used to name the specific internal mirror, in a file that ships to the
> public repo — the leak filter never covered `.npmrc`.

**Consequence: Route B is meaningfully cheaper than section 6 estimated — but only from 3.8.2.**
Forking the 3.2.0 snapshot means inheriting all three, already solved, for free.

### What changed that DOES affect the plan

**1. There is now a public skill registry.** `src/core/skills/SkillRegistryClient.ts` (FEAT-31-02)
fetches a catalogue from
`https://raw.githubusercontent.com/pssah4/vault-operator-skill-registry/main`, SHA-256 pinned,
size-capped, installed on explicit user click only (nothing fetched on plugin load). Installed
skills land as `source: registry` — a *managed* provenance tier, not a trusted one; they still
run the full approval chain. New supporting modules: `SkillProvenanceStore.ts`,
`skillToggleGate.ts`, `descriptionCaps.ts`.

The base URL is a plain constant but **injectable via the client's constructor**
(`constructor(plugin, baseUrl = REGISTRY_BASE_URL)`), so a fork can point it at its own catalogue
with a one-line change. That is a genuinely attractive Route B benefit that did not exist at 3.2.0:
**we could host our own skill registry.**

**2. Eleven skills were unbundled into a paid "Pro" catalogue** (3.3.x):

> Pro skills are no longer bundled with the plugin. The eleven Pro workflow skills (ingest,
> ingest-deep, knowledge-ingest, knowledge-batch-ingest, knowledge-rename, meeting-summary,
> office-workflow, presentation-design, humanizer, skill-creator-pro, skill-translator) move to a
> separate catalog and will be delivered through the marketplace on demand. Copies you already
> installed keep working and are not removed.

Only `sandbox-environment`, `vault-operator-guide` and `vault-health-batch` remain in
`bundled-skills/` upstream (the changelog also names `skill-creator`, but it is not in the
directory at 3.8.2).

This matters because **`skill-translator` — the Anthropic-skill importer highlighted in section 2
— is now a Pro skill.** The plugin code stays Apache-2.0; the monetisation is on skill *content*,
not on the engine. There is no entitlement or subscription machinery in the source
(`src/core/auth/` is only ChatGPT OAuth for using an existing subscription as a model provider).

Note: those eleven skills were published under Apache-2.0 in the 3.2.0 tree, and an Apache-2.0
grant on a distributed version is irrevocable — so the copies in this fork are legitimately
licensed. The author's clear present intent is nonetheless to sell them, so treat them as
reference material for authoring our own, not as a free supply to redistribute.

### The surprise: this fork is richer than current upstream in one respect

| | Nic's fork 3.2.0 | Upstream 3.8.2 |
|---|---|---|
| Production TS (non-test) | 131,368 LOC | **172,972 LOC** |
| Test files | **329** | **0** |

The public snapshots stopped shipping tests. Upstream's mirror is now generated as
`chore: public snapshot for <sha>`, and it strips `__tests__/` the same way the earlier strip
removed `_devprocess/`. Section 7 cited 329 test files as a quality signal — that signal is real,
but it is only observable **in this fork**, not in the repo a new cloner gets today.

So the fork is behind on features and ahead on test visibility. Keep it; do not delete and re-fork.

### Consequence for the plan

**Route A is unchanged and still the recommendation.**

**Route B is cheaper than section 6 estimated** — all three cold-start blockers are already fixed
in this baseline.

**A third route now exists that did not at 3.2.0: host our own skill registry.** The catalogue URL
is constructor-injectable, so a fork can serve its own skills over the same SHA-256-pinned,
click-to-install channel the plugin already ships. That is a better delivery mechanism for a
personal skill set than either hand-copying folders (A) or maintaining a bundled fork (B), and it
deserves its own evaluation.

**One thing was lost with the old fork:** it carried 329 test files at 3.2.0. Upstream's public
snapshots no longer ship tests, so this baseline has none. Not recoverable from the public repo,
and not a blocker — just be aware the quality signal in section 7 is no longer independently
checkable here.

