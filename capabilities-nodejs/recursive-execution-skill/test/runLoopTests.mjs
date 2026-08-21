import assert from 'node:assert/strict';
import { runRecursiveLoop, STOP_REASONS, BudgetTracker } from '../src/index.mjs';

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

// --- Acceptance criteria: "a test loop that reliably stops under various
// failure modes (budget exhausted, no progress, depth limit, evaluation
// passes)" -----------------------------------------------------------------

test('stops with evaluation_passed once the gate is satisfied', async () => {
  let calls = 0;
  const result = await runRecursiveLoop({
    objective: 'reach score 3',
    maxDepth: 1,
    budget: { maxTokens: 100_000, maxTurns: 20, maxWallClockMs: 10_000, maxContinuations: 20 },
    evaluate: async () => {
      calls += 1;
      return { passed: calls >= 3, score: calls };
    },
  });
  assert.equal(result.stopReason, STOP_REASONS.EVALUATION_PASSED);
  assert.equal(result.iterations, 3);
  assert.equal(result.finalEvaluation.passed, true);
});

test('stops with budget_exhausted when turns run out before the gate passes', async () => {
  const result = await runRecursiveLoop({
    objective: 'never actually succeed',
    maxDepth: 1,
    budget: { maxTokens: 100_000, maxTurns: 3, maxWallClockMs: 10_000, maxContinuations: 100 },
    noProgressPatience: 1000, // effectively disabled so budget is the dimension under test
    evaluate: async (state) => ({ passed: false, score: state.iteration }), // keeps "improving" so no-progress never trips
  });
  assert.equal(result.stopReason, STOP_REASONS.BUDGET_EXHAUSTED);
  assert.equal(result.exhaustedDimension, 'turns');
  assert.equal(result.budgetSnapshot.turnsUsed, 3);
});

test('stops with no_progress and fires escalation when the score stalls', async () => {
  let escalated = null;
  const result = await runRecursiveLoop({
    objective: 'stuck objective',
    maxDepth: 1,
    budget: { maxTokens: 100_000, maxTurns: 50, maxWallClockMs: 10_000, maxContinuations: 50 },
    noProgressPatience: 2,
    evaluate: async () => ({ passed: false, score: 5 }), // constant score -> never improves
    onEscalate: async (reason, state) => {
      escalated = { reason, iteration: state.iteration };
    },
  });
  assert.equal(result.stopReason, STOP_REASONS.NO_PROGRESS);
  assert.ok(result.budgetSnapshot.turnsUsed < 50, 'must stop well before the turn budget, on stagnation alone');
  assert.ok(escalated, 'onEscalate must be called');
  assert.equal(escalated.reason, STOP_REASONS.NO_PROGRESS);
});

test('stops with depth_limit immediately when invoked at the depth ceiling', async () => {
  let evaluateCalls = 0;
  const result = await runRecursiveLoop({
    objective: 'grandchild work',
    depth: 2,
    maxDepth: 2,
    budget: { maxTokens: 1000, maxTurns: 5, maxWallClockMs: 5000, maxContinuations: 5 },
    evaluate: async () => {
      evaluateCalls += 1;
      return { passed: false, score: 0 };
    },
  });
  assert.equal(result.stopReason, STOP_REASONS.DEPTH_LIMIT);
  assert.equal(result.iterations, 0);
  assert.equal(evaluateCalls, 0, 'evaluate must never run once the depth ceiling is already hit');
});

// --- Child-agent registry + usage attribution -------------------------------

test('folds child usage into the parent budget and registry', async () => {
  const spawnedRequests = [];
  const result = await runRecursiveLoop({
    objective: 'delegate one subtask then succeed',
    maxDepth: 2,
    maxChildrenPerTurn: 1,
    budget: { maxTokens: 100_000, maxTurns: 10, maxWallClockMs: 10_000, maxContinuations: 10 },
    evaluate: async (state) => ({ passed: state.iteration >= 1, score: state.iteration }),
    planChildren: async () => [{ name: 'sub-task-a' }],
    spawnChild: async (request, depth) => {
      spawnedRequests.push({ request, depth });
      return { result: { ok: true }, usage: { tokens: 250, turns: 1 } };
    },
  });
  assert.equal(spawnedRequests.length, 1);
  assert.equal(spawnedRequests[0].depth, 1);
  assert.equal(result.registrySnapshot.length, 1);
  assert.equal(result.registrySnapshot[0].status, 'succeeded');
  assert.equal(result.registrySnapshot[0].usage.tokens, 250);
  assert.ok(result.budgetSnapshot.tokensUsed >= 250, 'child token usage must be folded into the parent budget');
});

test('prefers real usage.totalTokens over the estimated/mock usage.tokens when folding child usage', async () => {
  const result = await runRecursiveLoop({
    objective: 'delegate one subtask then succeed',
    maxDepth: 2,
    maxChildrenPerTurn: 1,
    budget: { maxTokens: 100_000, maxTurns: 10, maxWallClockMs: 10_000, maxContinuations: 10 },
    evaluate: async (state) => ({ passed: state.iteration >= 1, score: state.iteration }),
    planChildren: async () => [{ name: 'sub-task-a' }],
    spawnChild: async () => ({
      result: { ok: true },
      // real usage (e.g. paperclipSpawn.fetchIssueTokenUsage) alongside a
      // stale/allocated `tokens` figure -- the real number must win.
      usage: { tokens: 999_999, totalTokens: 550, turns: 1 },
    }),
  });
  assert.ok(result.budgetSnapshot.tokensUsed < 999_999, 'must be charged the real usage, not the inflated placeholder');
  assert.ok(result.budgetSnapshot.tokensUsed >= 550, 'the real 550-token usage must still be charged');
});

test('evaluate() reporting real usage.totalTokens is charged instead of the character-count estimate', async () => {
  const result = await runRecursiveLoop({
    objective: 'reach score 1',
    maxDepth: 1,
    budget: { maxTokens: 100_000, maxTurns: 5, maxWallClockMs: 10_000, maxContinuations: 5 },
    evaluate: async () => ({ passed: true, score: 1, usage: { totalTokens: 12_345 } }),
  });
  assert.equal(result.budgetSnapshot.tokensUsed, 12_345, 'real evaluate() usage must be charged verbatim, not re-estimated');
});

// --- BudgetTracker.reconcileTokens (real-usage reconciliation) --------------

test('reconcileTokens takes the max of tracked vs. real usage, staying idempotent across repeated reconciliation', () => {
  const tracker = new BudgetTracker({ maxTokens: 100_000, maxTurns: 10, maxWallClockMs: 10_000, maxContinuations: 10 });
  tracker.consumeTokens(100);
  tracker.reconcileTokens(500); // real usage ahead of the tracked estimate -> adopt it
  assert.equal(tracker.tokensUsed, 500);
  tracker.reconcileTokens(500); // re-fetching the same real total again must not double-count
  assert.equal(tracker.tokensUsed, 500);
  tracker.reconcileTokens(200); // a stale/lower read must never move usage backwards
  assert.equal(tracker.tokensUsed, 500);
});

// --- Compaction --------------------------------------------------------------

test('compacts older trace entries once the token threshold is crossed', async () => {
  let calls = 0;
  const result = await runRecursiveLoop({
    objective: 'run long enough to force compaction',
    maxDepth: 1,
    budget: { maxTokens: 1_000_000, maxTurns: 40, maxWallClockMs: 10_000, maxContinuations: 40 },
    noProgressPatience: 1000,
    compaction: { thresholdTokens: 300, keepRecentTokens: 150 },
    evaluate: async () => {
      calls += 1;
      return { passed: calls >= 40, score: calls, notes: 'x'.repeat(200) }; // padding forces token growth
    },
  });
  const summaries = result.trace.filter((e) => e.type === 'compactionSummary');
  assert.ok(summaries.length >= 1, 'expected at least one compaction pass over a long-running loop');
  assert.ok(result.trace.length < calls, 'compacted trace must be materially shorter than the raw iteration count');
});

// --- Runner ------------------------------------------------------------------

let failures = 0;
for (const { name, fn } of tests) {
  try {
    await fn();
    console.log(`ok   - ${name}`);
  } catch (err) {
    failures += 1;
    console.error(`FAIL - ${name}`);
    console.error(err);
  }
}

console.log(`\n${tests.length - failures}/${tests.length} passed`);
if (failures > 0) process.exit(1);
