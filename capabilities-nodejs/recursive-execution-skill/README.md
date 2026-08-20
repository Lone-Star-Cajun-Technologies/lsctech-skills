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
- `src/paperclipSpawn.mjs` — Paperclip task-lifecycle integration.
- `test/runLoopTests.mjs` — acceptance-criteria test loop: exercises all
  four stop modes plus usage attribution and compaction. Run with
  `node test/runLoopTests.mjs`.
- `test/paperclipSpawnTests.mjs` — tests for Paperclip spawner integration.

## Paperclip task-lifecycle integration (`src/paperclipSpawn.mjs`)

LON-67's scope beyond LON-62: `createPaperclipSpawner()` implements
`spawn(taskSpec) -> handle` against the real Paperclip API
(`POST /api/issues/{id}/children`) instead of a mock, so children are real
child issues, attributed to the parent via `requestDepth` + `parentId`.
Because real Paperclip children run asynchronously across wakes (the
platform pauses/wakes the parent via `blockParentUntilDone`, not a
same-process blocking wait), this is a two-phase pattern rather than a
synchronous `spawnChild`: `spawn()` this wake, `collectResult()`/
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

## Known gap

This lives in the agent workspace, not a company repository — no
Polaris/Evo (or other) project/repo record exists in Paperclip yet for this
initiative, and this sandbox has no `git`. Per LON-61's stated boundary, a
project/repo record is a prerequisite for repository implementation; that
step is still open. This code is ready to move into a repo verbatim once
one is designated.
