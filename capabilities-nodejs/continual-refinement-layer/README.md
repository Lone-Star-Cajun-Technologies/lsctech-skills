# Continual Refinement Layer

LON-63 ("Epic 2: Harness-Agnostic Continual Refinement Layer"). Builds on
top of `harness-state-store` (LON-68) rather than duplicating it — per
Cove's LON-75 reconciliation, LON-63 and LON-68 are genuinely distinct
("different runtime concerns"): LON-68 is the per-item ledger's apply/
rollback *mechanics*; LON-63 is the *review* gate in front of those
mechanics, plus multi-item snapshot/restore, which nothing else built.

## Scope covered

- **Typed state schema** — reused directly from `harness-state-store`
  (`prompt_note` / `memory` / `skill_description` / `subagent_spec`); not
  redefined here.
- **Refinement review (LLM proposes small edits with evidence)**:
  - `proposeRefinement({ item, observation, generateCandidate })`
    (`src/proposeRefinement.mjs`) packages a candidate edit into
    `{ itemId, body, evidence, rationale }`. `generateCandidate` is
    caller-supplied by design — this sandbox is subscription-billed, not
    API-key billed (see AGENTS.md), so this layer never calls a model API
    directly; in production the caller *is* the agent's own LLM turn, in
    tests it's a deterministic stub. That's the "harness-agnostic" part:
    any LLM/tool backend can plug in as long as it returns `{ body,
    rationale }`.
  - `reviewProposal(...)` (`src/review.mjs`) is the gate: rejects empty or
    identical-to-current bodies, rejects evidence shorter than 10
    characters, rejects edits that touch more than 40 lines *and* more
    than 60% of the current body (a "small edit" cap — split anything
    bigger into multiple proposals), and requires a named reviewer
    distinct from the proposing actor for global-scope items.
  - `ContinualRefinementLayer.reviewAndApply(...)` runs the gate and only
    calls `store.refine` on approval; a rejection never touches the store
    (`test/runRefinementTests.mjs`: "rejected edit never touches the
    store").
- **Snapshot/rollback**: `store.rollback` (LON-68) restores one item to one
  prior revision. `ContinualRefinementLayer.snapshot({ scope, taskId,
  type })` captures `{itemId, revision}` for every matching item as one
  named, durable group; `restoreSnapshot(snapshotId, { evidence, actor })`
  rolls every item in that group back together. Restores are still
  `store.rollback` calls underneath, so history stays append-only (a
  restored item's history length grows, it isn't truncated).
- **Local vs global scoping**: enforced at creation by `harness-state-store`
  (unchanged); this layer adds scope-aware review — global edits require a
  distinct reviewer, local edits don't — so the local/global distinction
  has teeth at refinement time, not just at storage time.

## Acceptance criteria

- "Refinement proposes evidence-backed edits" —
  `reviewAndApply` rejects any edit with evidence under 10 characters or
  missing entirely, before it ever reaches the store
  (`ContinualRefinementLayer.reviewAndApply: rejected edit never touches
  the store`).
- "rollback restores prior state" — both single-item
  (`reviewAndRollback`) and multi-item (`restoreSnapshot`) rollback are
  tested to restore the exact prior body while leaving history intact
  (`snapshot + restoreSnapshot: restores a group of items ... history
  stays append-only`).

## Layout

- `src/diff.mjs` — line-based LCS diff, used only to size a proposed edit.
- `src/review.mjs` — `reviewProposal`, the pure review gate.
- `src/proposeRefinement.mjs` — packages a caller-supplied LLM candidate.
- `src/refinementLayer.mjs` — `ContinualRefinementLayer`: review+apply,
  review+rollback, snapshot, restoreSnapshot.
- `test/runRefinementTests.mjs` — 9 tests, run with `node
  test/runRefinementTests.mjs`. Exercises against a real
  `HarnessStateStore` instance (temp dir per test), not a mock.

## Known gap

Same as every other workspace artifact under LON-61: lives in the agent
workspace, not a company repository — no repo has been designated for this
initiative yet and this sandbox has no `git`. Ready to move into a repo
verbatim once one is designated (see `harness-state-store/README.md`,
`polaris-worker-skill/README.md` for the same note).
