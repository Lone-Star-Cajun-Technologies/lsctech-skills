# Polaris Worker Skill

LON-70 (Epic 4 of LON-61, architecture report §6, verbatim). Builds directly
on `recursive-execution-skill` (LON-62/LON-67, Epic 1): that module supplies
bounded iteration, budget enforcement, and no-progress escalation; this
module supplies the Polaris-specific parts — acceptance criteria as quality
gates, a self-repair cap distinct from raw budget, and a Medic-shaped trace.

## Interface

`runPolarisWorker(packet, hooks, { depth, maxDepth })` — see JSDoc in
`src/polarisWorker.mjs`.

- **`packet`** (`PolarisPacket`): `objective`, `acceptanceCriteria` (array of
  `{ id, description, check(workProduct) }`), `maxRepairAttempts` (the single
  source of truth for "how many tries" — pins both `maxTurns` and
  `maxContinuations` on the underlying loop so there is exactly one repair
  budget, not two), optional `budget.{maxTokens,maxWallClockMs}` overrides.
- **`hooks.implement({ attempt, previousVerification, workProduct })`** —
  required. Produces or refines the work product; receives the prior
  verification result so repairs can be feedback-driven.
- **`hooks.submit(workProduct)`** — required. Called exactly once, only
  after every acceptance criterion passes.
- **`hooks.onEscalate(reason, medicTrace)`** — optional. Fires once when the
  packet exits without verifying, for any reason (repair cap, raw budget,
  no-progress, or depth limit) — escalation is a Polaris-packet-level
  concept, not the underlying loop's narrower no-progress-only signal.

**Exit reasons** (`POLARIS_EXIT_REASONS`): `verified`,
`repair_attempts_exhausted`, `budget_exhausted`, `no_progress`,
`depth_limit`. `repair_attempts_exhausted` is Epic 4's own concept layered
over the loop's generic `budget_exhausted`.

**Medic trace** — satisfies LON-64's acceptance criteria text directly ("A
recursive packet terminates correctly and logs each iteration's evaluation
outcome, budget consumption, and exit reason"): `{ objective,
maxRepairAttempts, exitReason, iterations: [{ attempt, evaluationOutcome:
{passed, score, criteria}, budgetConsumption }], finalBudgetSnapshot }`.

## Tests

`node test/runPolarisWorkerTests.mjs` — first-try verification, multi-attempt
self-repair to a passing state, repair-cap escalation with no submit,
no-progress escalation, and Medic trace shape/content. All passing as of
2026-08-19.

## Cross-issue duplication note

LON-61 was decomposed twice into an (apparently) equivalent epic set:

- The **canonical track** (LON-67–72) mirrors the architecture report's
  Epic 1–6 exactly, mostly assigned to Cove and currently `blocked`
  (stranded runs, `acpx_turn_failed`). **LON-70 (this issue) is Epic 4 in
  this track.**
- A **second, self-titled track** (LON-62–66) was created — apparently by
  me, in an earlier session — re-scoping the same six epics as a
  "harness-agnostic standalone skill" strategy, working around the
  no-git/no-repo-access constraint documented in
  `recursive-execution-skill/README.md`'s "Known gap". **LON-64 ("Epic 3:
  Polaris Recursive Packet Type") in this track has near-identical scope to
  this issue**: "worker-side loop (implement → evaluate → refine)... QC for
  loop-exit... Medic/task-chain logging for loop iterations."

Building a second, separate implementation under LON-64 on top of the same
`recursive-execution-skill` would just duplicate this module. This skill is
written to satisfy both LON-70's literal acceptance criteria and LON-64's
literal acceptance criteria at once, so LON-64 can point here instead of
re-deriving the same loop. Flagged to Cove (LON-61's decomposition owner) for
reconciliation rather than resolved unilaterally, since Cove owns
Plan → Decompose → Delegate → Enforce → Review → Accept for this initiative.

## Known gap (inherited from Epic 1)

Same as `recursive-execution-skill`: this lives in the agent workspace, not
a repository. A "Polaris Recursive Packet" project record now exists in
Paperclip (created 2026-08-19, prerequisite satisfied), but it has no
`repoUrl`/git checkout wired yet, and this sandbox has no `git`. `implement`,
`submit`, and the runtime that actually receives a live Polaris packet and
dispatches it to a worker are all host-supplied — this module never wires
itself into a real worker process, matching the same boundary
`recursive-execution-skill` draws around `spawnChild`.
