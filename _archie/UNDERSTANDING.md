# NVH-ARCH Vault Operator — Understanding Phase

**Status:** DRAFT — in progress, awaiting Nic's correction
**Date:** 2026-09-17
**Phase:** Understanding (1 of: understand → brainstorm → research → scaffold → annotate/iterate → finalise → output → export)

---

## What this is NOT

Not an AI that lives inside a vault doing daily work. That was tried on the NVH-ARCH vault
and it failed — not because Obsidian is bad or the plugin is bad, but because **a resident
operator adds configuration work forever.** Every property, every link, every setting became
another thing to keep current. The plugin wasn't the cure. It was another patient.

## What this IS

**A factory.** The thing that *births* NVH-ARCH environments as Obsidian vaults — correctly
structured, correctly configured, from second one.

The configuration happens **once, at birth, properly** — not continuously, forever, by hand.

## Where the vault-operator repo fits

It is a **quarry, not a foundation.** We mine patterns out of it. We do not adopt it, maintain
it, or build on top of it. "Adapt and adopt" — take the bits that are right, rewrite them to
work forwards instead of backwards.

## The layer model

Three layers stack on Nic's Claude:

1. **Global custom instructions** — Archie. The meta-agent. *This is where we are now.*
2. **Local `.claude/CLAUDE.md`** — local config, architecture, local skills and plugins
3. **Project `CLAUDE.md`** — stacked on top of both

Right now only layer 1 exists for this work. There is no project layer.

**Archie's job as meta-agent: build the environments that others work inside.** That means
constructing layer 2 — the thing a new environment gets handed — before any real work can start.

## Why the admin/HR framing matters

Claude's built-in skills assume you work somewhere that already has an admin function, an HR
function, existing data, existing reports, existing internal comms. Nic has none of that —
**she is the admin and HR function.** So the built-ins have nothing to bite on. There is no
data to summarise because the research that produces the data hasn't happened yet.

This is why the stage sequence is load-bearing and not ceremony: there is genuinely nothing
upstream to draw on. It has to be created first.

## The real deliverable

**The key.** What you hand a new environment's `.claude` so it knows, from second one:

> "Here is how your vault works. Here are your tools. Here are the skills that keep you running."

## The success test

> Stop working **on** environments. Start working **in** them.

Anything that does not move toward that is out of scope.

---

## Design constraints (Archie's read — correct these)

### C1. The factory must not become its own upkeep burden
We are building this to *end* maintenance work. If the factory itself needs maintaining, we
have moved the problem up a floor and added a floor. This argues hard for **a spec plus
templates plus a small number of skills**, over **a plugin**. The plugin may turn out to be
the smallest part of this.

### C2. "Three seconds" and "nothing works out of the box" pull against each other
Fast spin-up requires accepting defaults. Nic cannot use defaults — everything ships
"backwards" to her. These reconcile exactly one way: **the defaults have to be hers, decided
once, deliberately, now.** That is not a contradiction in the plan; it is the entire reason
this phase exists. Every hour spent here buys back the three seconds later.

### C3. The map comes before the journey
Going A→B without first understanding the rules of getting from A to B produces a tangle.
This is a processing requirement, not a preference. Research output is therefore a
**deliverable**, not overhead.

---

## Open questions — blocking

**Q1. Where does the factory live?**
`NVH-MASTER-ENV` (private, last pushed 2026-08-26) may already be its home. Do not propose a
new repo until this is answered — starting fresh over an existing unfinished plan is the
documented failure mode.

**Q2. What is already built?**
Other repos that may hold prior work on this: `NVH-CDX`, `gods-eye-view-nvh-slim`,
`NVH-archify`, `NVH-MASTER-ENV`.

**Q3. What does a "correct" NVH-ARCH vault actually look like?**
The spec. This is the admin/HR layer, and it does not exist yet. It is probably the real
project.

---

## Proposed repo strategy (pending Q1)

**`NVH-ARCH-VAULT-OP` = the quarry.**

- `main` keeps tracking upstream. Free intelligence: we see what Sebastian fixes and changes.
- **Do not rewrite `main`.** Rewriting it means owning 185k lines we specifically do not want
  to own, and losing the reference we are mining.
- Research happens on branches here — one per element we want to understand.
  Each branch produces a written finding, not code.
- Findings feed the factory, wherever it lives.

**The factory = elsewhere.** Different job, different repo, clean history, no inherited
licence obligations unless we actually take code.

---

## PARKED — not to be solved yet

Captured 2026-09-17 so it stops occupying working memory. **Do not solve this until Nic
opens it.** Noted here verbatim-ish, not evaluated.

### P1. Where do protocols live for global + web work?

**The problem.** The desktop setup says: write the lot into the CLAUDE.md on the interface,
including the rules as displayed. Fine for desktop. But:

- Web sessions get the **index** of the @-imports, not their contents. Archie-on-web can see
  `@rules/03-working-style.md` is listed. He cannot see a single line of it.
- There are no custom instructions for an individual web thread.
- So protocols that are neither project-specific nor desktop-only — the ones that apply at
  **global and web level, like right now** — currently have nowhere to live.

**Rejected already (Nic's call, not up for re-litigation):**
- "Just make them skills." Means remembering every protocol that's already a desktop rule,
  and remembering to add it to web environments only. Too much overhead without a plan.

**Floated, not decided:**
- An `NVH-ARCH-Protocols` repo, installed as a plugin.

**Status.** Open. Named, not solved. Needs a plan before anything gets built.

### P2. Repo naming — Claude and Codex kept apart

`NVH-MASTER-ENV` → `NVH-ARCH-MASTER-ENV`, so it reads as Claude-only. Codex environments stay
separate and separately named. This is a cognitive-load decision, deliberately taken, and is
**not** an invitation to propose shared branches or worktrees.

### Related finding (from this session)

**The @-imports do not travel.** Every session outside the desktop starts with Nic's operating
instructions missing — index present, contents absent. Whatever the factory produces has to
carry the rules, working style and memory *with* it, not by reference to files that exist only
on one laptop. This is the same layer gap the project exists to close, showing up in the tooling
we are using to build it.
