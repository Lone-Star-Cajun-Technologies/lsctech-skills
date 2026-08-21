# Standalone Recursive Execution Skill

LON-62 (Epic 1 of LON-61, per LON-59 research report §4.1 / §6). A
harness-agnostic implementation of Prime Agent's recursive dispatch loop,
reimplemented rather than ported — no IPython/Jupyter, no Python kernel, no
daemon/worker/supervisor process tree. See the research report's
classification: recursive dispatch, budget tracking, no-progress detection,
and compaction are all "Reimplementable"; only the coding-specific transport
was left out.

## Interface

**Inputs** (`LoopConfig`, see JSDoc in `src/recursiveLoop.mjs`):
- `objective` (string) — what this invocation is trying to accomplish.
- `depth` / `maxDepth` (int) — current and maximum recursion depth.
- `maxChildrenPerTurn` (int) — how many children one iteration may spawn.
- `budget` — `{ maxTokens, maxTurns, maxWallClockMs, maxContinuations }`,
  all required and positive. `BudgetTracker` throws at construction if any
  is missing — a loop cannot run unbounded by omission.
- `evaluate(state)` — required. The evaluation/gate mechanism. The skill
  never judges its own success; the caller supplies the gate.
- `planChildren(state)` / `spawnChild(request, depth)` — optional runtime
  dependency. This module never spawns a real child agent itself; the host
  wires `spawnChild` to whatever dispatch mechanism it has (Paperclip child
  issues, a direct agent call, or a mock for tests). Without a `spawnChild`,
  the loop runs as a flat retry/refine loop with no delegation.
- `noProgressPatience` / `noProgressEpsilon` — stagnation tolerance.
- `onEscalate(reason, state)` — called before a `no_progress` stop.
- `compaction` — `{ thresholdTokens, keepRecentTokens }`.

**Outputs** — `{ stopReason, iterations, trace, budgetSnapshot,
registrySnapshot, noProgressSnapshot, finalEvaluation, exhaustedDimension }`.

**State** — held only in the call's locals (`BudgetTracker`,
`ChildAgentRegistry`, `NoProgressDetector`, an append-only `trace[]`).
Nothing is shared mutable state between a parent and its children; children
report back only through their `spawnChild` result, matching the
"no shared mutable state" constraint identified in the research report.

**Stop conditions** (exactly one fires per run):
1. `evaluation_passed` — `evaluate()` returns `passed: true`.
2. `budget_exhausted` — any one of tokens / turns / wall-clock /
   continuations trips (`exhaustedDimension` names which).
3. `no_progress` — evaluation score fails to improve for
   `noProgressPatience` consecutive iterations; `onEscalate` fires first.
4. `depth_limit` — the call was entered at `depth >= maxDepth`; it returns
   immediately without evaluating or iterating.

`"continue until successful"` is deliberately not a valid stop condition —
every loop is constructed with all four budget dimensions set, so a loop
that reaches its turn cap always halts even if nothing else fires.

**Evaluation mechanism** — caller-supplied `evaluate(state) => {passed,
score, notes}`, an external verifier or LLM-as-judge. Not part of this
skill.

**Runtime dependencies** — a child-agent runtime factory (`spawnChild`) is
the only true external dependency; everything else (budget tracking,
registry, no-progress detection, compaction) is self-contained.

## Layout

- `src/budgetTracker.mjs` — the four hard resource caps.
- `src/childRegistry.mjs` — child identity, status, usage attribution.
- `src/noProgressDetector.mjs` — stagnation detection.
- `src/compaction.mjs` — token-threshold trace summarization, keeping a
  recent window verbatim.
- `src/recursiveLoop.mjs` — orchestrator (`runRecursiveLoop`).
- `src/adapters/paperclip/paperclipSpawn.mjs` — Paperclip task-lifecycle
  integration (consumer-specific adapter, not part of the public API).
- `test/runLoopTests.mjs` — acceptance-criteria test loop: exercises all
  four stop modes plus usage attribution and compaction. Run with
  `node test/runLoopTests.mjs`.
- `test/adapters/paperclip/paperclipSpawnTests.mjs` — tests for Paperclip
  spawner integration.

## Paperclip task-lifecycle integration (`src/adapters/paperclip/paperclipSpawn.mjs`)

LON-67's scope beyond LON-62: `createPaperclipSpawner()` implements
`spawn(taskSpec) -> handle` against the real Paperclip API
(`POST /api/issues/{id}/children`) instead of a mock, so children are real
child issues, attributed to the parent via `requestDepth` + `parentId`.
Because real Paperclip children run asynchronously across wakes (the
platform pauses/wakes the parent via `blockParentUntilDone`, not a
same-process blocking wait), this is a two-phase pattern rather than a
synchronous `spawnChild`: `spawn()` this wake, `collectResult()` /
`requireResult()` a later wake once the child is terminal. See the file's
header comment for the full contract.

Live-verified against the real Paperclip API this session (three throwaway
child issues created and cancelled under LON-67 as smoke tests):
- `POST /api/issues/{id}/children` correctly attributes `parentId` and
  `requestDepth` on the created child.
- `executionPolicy.monitor` (the natural place to put a timeout) is
  **board-user-only** — an agent caller gets `403 Only the assignee agent
  or a board user can manage issue monitors`. The agent-accessible timeout
  primitive is the `watchdog` field (`{agentId, instructions}`); the
  spawning agent registers itself as its own child's watchdog, carrying the
  budget deadline in the instructions text.
- Explicit success/failure signal maps from the child's terminal Paperclip
  `status` (`done` -> passed, `blocked`/`cancelled` -> failed); non-terminal
  statuses deliberately return `signal: null` rather than guessing.
- Child result delivery (the `agent_message` analog) reads the child
  issue's most recent non-deleted agent comment.

## Runtime token accounting (LON-100)

Without a real usage source, `maxTokens` could only be enforced against a
crude `chars/4` estimate of `evaluate()`'s return value, plus whatever a
`spawnChild` implementation chose to self-report -- for real Paperclip
children that was nothing, since `collectResult` never read it back. Budget
was effectively pre-allocated by assumption, not measured.

`paperclipSpawn.mjs` now closes that gap against a real source: Paperclip's
`GET /api/issues/{id}/runs` returns each run attempt with a `usageJson`
field populated from the actual model adapter response
(`{inputTokens, outputTokens}`) once the run finishes -- verified live this
session.

- `fetchIssueTokenUsage({apiBase, apiKey, issueId, fetchImpl})` sums real
  `usageJson` across every run of an issue (covers retries) into
  `{inputTokens, outputTokens, totalTokens, runCount, pendingRunCount}`.
- `collectResult`/`requireResult` call it once a child is terminal and
  return it as `usage`, so a caller folding a child's result into its own
  ledger gets real consumption, not an estimate.
- `spawner.fetchOwnTokenUsage()` does the same for the spawner's own
  `parentIssueId`, for a long-running loop reconciling its own spend across
  wakes.
- `BudgetTracker.reconcileTokens(totalTokens)` takes `max(tracked, real)`
  rather than adding, since a re-fetched real total is a point-in-time
  snapshot, not a delta -- safe to call repeatedly without double-counting.
- `runRecursiveLoop`'s in-process fold (child `usage.totalTokens`, and
  `evaluate()`'s own `usage.totalTokens`) now prefers real numbers over the
  character-count estimate whenever a caller supplies them; the estimate
  remains only as a fallback for callers that can't report real usage.

## Foreman-Boundary Primitives for Polaris Integration (LON-137)

LON-137 (Prime vs Polaris capability comparison) concluded that the
worker-side recursive self-repair loop must be rejected — it violates
Worker/Medic/Foreman separation (POL-288). However, four deterministic
primitives from this skill are suitable for Polaris integration at the
**Foreman layer**:

| Primitive | Source module | Foreman home | Token impact |
|---|---|---|---|
| Continuation counter + wall-clock deadline | `budgetTracker.mjs` | Foreman dispatch logic | 0 |
| Heartbeat-delta no-progress detection | `noProgressDetector.mjs` | Foreman staleness detection | 0 |
| Telemetry compaction | `compaction.mjs` | Telemetry writer | 0 |
| Bounded Foreman re-dispatch policy | `recursiveLoop.mjs` | Foreman dispatch loop | 0 |

All four are deterministic — no new model calls. All four are
role-neutral: they measure state without making dispatch decisions that
belong to Worker or Medic.

### 1. Continuation Counter + Wall-Clock Deadline

**Prime behavior:** `BudgetTracker` tracks `continuationsUsed` against
`maxContinuations` and `elapsedMs()` against `maxWallClockMs`. A loop
is never allowed to run without all four caps set — the constructor
throws if any budget dimension is missing.

**Foreman home:** Foreman dispatch logic. Before each dispatch, check
`dispatched_continuations < maxContinuations` AND `now() < wallclock_deadline`.

**Why Foreman:** Foreman owns dispatch decisions. A continuation counter
counts re-dispatches (not just first-level children), closing a gap in
Polaris's flat `max_children` model. A wall-clock deadline stops
dispatching after a configured time, independent of heartbeat.

**Trigger/threshold:** `continuationsUsed >= maxContinuations` OR
`elapsedMs() >= maxWallClockMs`. Either one trips the stop condition.

**Failure/escalation:** When either threshold is hit, the loop returns
`budget_exhausted` with `exhaustedDimension` naming which limit was
reached. Foreman escalates instead of re-dispatching.

**Token impact:** Zero — integer increment and timestamp comparison.

**Tests:** `runLoopTests.mjs` — "stops with budget_exhausted when turns
run out before the gate passes" (turns dimension), "reconcileTokens takes
the max of tracked vs. real usage" (wall-clock + token tracking).

### 2. Heartbeat-Delta No-Progress Detection

**Prime behavior:** `NoProgressDetector` tracks evaluation score across
iterations and trips after `patience` consecutive iterations that fail
to beat the best score by more than `epsilon`. This detects spin loops
that a binary staleness threshold misses.

**Foreman home:** Foreman staleness logic. Compare consecutive heartbeat
telemetry: if `current_step_id` and `last_output_ref` are unchanged
across N consecutive heartbeats (configurable, default 3), declare
stagnation.

**Why Foreman:** Foreman already owns staleness detection (current
Polaris: 120s binary threshold). This adds detection of "heartbeat
present but no forward progress" — a worker spinning in a loop still
emits heartbeats, so the binary threshold never fires. The
Prime-derived detector compares observable output deltas.

**Trigger/threshold:** `streak >= patience` (default 2) consecutive
non-improving iterations. `epsilon` sets the minimum improvement to
reset the streak.

**Failure/escalation:** When stagnation is detected, the loop calls
`onEscalate(reason, state)` before returning `no_progress`. Foreman
escalates to Medic or halts.

**Token impact:** Zero — pure numeric comparison of evaluation scores.

**Tests:** `runLoopTests.mjs` — "stops with no_progress and fires
escalation when the score stalls".

### 3. Telemetry Compaction

**Prime behavior:** `compactIfNeeded` summarizes older trace entries
once estimated token size crosses `thresholdTokens`, keeping the most
recent entries verbatim (within `keepRecentTokens`). Only the free-text
trace is compacted — never the structured state (budget ledger, child
registry).

**Foreman home:** Telemetry writer (append path). When telemetry JSONL
exceeds a configured event count (default 1000) or byte size (default
1MB), summarize older events and retain the last 100 verbatim.

**Why Foreman:** Telemetry is a Foreman-owned output stream. Compaction
prevents unbounded JSONL growth without losing recent context. Polaris's
resume model is `current-state.json` (mutable snapshot), not telemetry
replay — so unbounded telemetry only affects audit storage, not
correctness. Compaction keeps audit storage bounded.

**Trigger/threshold:** `totalTokens > thresholdTokens` (default 8000).

**Failure/escalation:** N/A — compaction is a storage optimization, not
a control decision. No escalation path.

**Token impact:** Zero — deterministic summarization.

**Tests:** `runLoopTests.mjs` — "compacts older trace entries once the
token threshold is crossed".

### 4. Bounded Foreman Re-Dispatch Policy

**Prime behavior:** `runRecursiveLoop` iterates with bounded budget,
stopping on exactly one of: `evaluation_passed`, `budget_exhausted`,
`no_progress`, or `depth_limit`. "Continue until successful" is
deliberately not a valid stop condition — every loop is constructed
with all four budget dimensions set.

**Foreman home:** Foreman dispatch loop. When a Worker seals a
CompactReturn with `blockers[]` AND `exit_code=1`, AND budget remains,
AND no-progress has not been detected, Foreman re-dispatches with
modified scope (from Medic treatment packet, if Medic was involved).

**Why Foreman:** This is the ONLY form of iteration Polaris gains — and
it's at the Foreman level, not the Worker level. Worker never dispatches.
Worker never self-repairs. Foreman orchestrates. This preserves all five
role boundaries from POL-288.

**Trigger/threshold:** CompactReturn has blockers + exit_code=1 +
`dispatched_continuations < maxContinuations` + no stagnation detected.

**Failure/escalation:** When budget is exhausted (`maxContinuations`
reached) or stagnation detected, Foreman escalates instead of
re-dispatching.

**Token impact:** Zero — deterministic bookkeeping.

**Tests:** `runLoopTests.mjs` — all four stop conditions exercised:
"stops with evaluation_passed", "stops with budget_exhausted", "stops
with no_progress", "stops with depth_limit".

### Token Telemetry (Open Item)

Token-level usage telemetry remains an explicit open item. Paperclip
owns hard session limits. Polaris may benefit from token usage as an
observability/efficiency signal (accepted-work-per-token, wasted-token
detection). This skill preserves the possibility of consuming usage
telemetry later via `BudgetTracker.reconcileTokens()` and
`paperclipSpawn.fetchIssueTokenUsage()`, but does NOT make Polaris
enforce provider budgets. This is a deliberate open item, not an
oversight.

## Known gap

This lives in the agent workspace, not a company repository — no
Polaris/Evo (or other) project/repo record exists in Paperclip yet for this
initiative, and this sandbox has no `git`. Per LON-61's stated boundary, a
project/repo record is a prerequisite for repository implementation; that
step is still open. This code is ready to move into a repo verbatim once
one is designated.
