import { BudgetTracker } from './budgetTracker.mjs';
import { ChildAgentRegistry } from './childRegistry.mjs';
import { NoProgressDetector } from './noProgressDetector.mjs';
import { compactIfNeeded, estimateTokens } from './compaction.mjs';

export const STOP_REASONS = Object.freeze({
  EVALUATION_PASSED: 'evaluation_passed',
  BUDGET_EXHAUSTED: 'budget_exhausted',
  NO_PROGRESS: 'no_progress',
  DEPTH_LIMIT: 'depth_limit',
});

/**
 * Standalone recursive execution loop (LON-62 / research report §4.1).
 *
 * Interface contract:
 *  - Inputs: `objective` plus the LoopConfig described below.
 *  - Outputs: { stopReason, iterations, trace, budgetSnapshot,
 *               registrySnapshot, noProgressSnapshot, finalEvaluation }.
 *  - State: held entirely in this call's locals (BudgetTracker,
 *    ChildAgentRegistry, NoProgressDetector, trace[]) -- nothing persists
 *    outside the returned result, so there is no shared mutable state
 *    between a parent loop and its children (research report §3.3/§4.1).
 *  - Stop conditions: evaluation passes, budget exhausted (tokens / turns /
 *    wall-clock / continuations -- any one trips it), no-progress streak,
 *    or depth limit already reached at entry. "Continue until successful"
 *    is deliberately not a valid stop condition.
 *  - Evaluation mechanism: caller-supplied `evaluate(state)` gate --
 *    this skill does not itself judge task success.
 *  - Runtime dependencies: a `spawnChild(request, depth)` factory able to
 *    produce a real child result (message/file, per research report
 *    §3.3 -- no shared mutable state). This module never spawns real
 *    agents itself; callers wire it to whatever dispatch mechanism their
 *    host provides (e.g. Paperclip child issues), or to a mock for tests.
 *
 * @typedef {Object} LoopBudget
 * @property {number} maxTokens
 * @property {number} maxTurns
 * @property {number} maxWallClockMs
 * @property {number} maxContinuations
 *
 * @typedef {Object} LoopConfig
 * @property {string} objective
 * @property {number} [depth=0] current recursion depth of this invocation
 * @property {number} maxDepth maximum recursion depth allowed
 * @property {number} [maxChildrenPerTurn=1]
 * @property {LoopBudget} budget
 * @property {(state: object) => Promise<{passed: boolean, score?: number, notes?: string, usage?: {totalTokens?: number}}>} evaluate
 *   `usage.totalTokens`, when supplied, is real model usage (e.g. an LLM
 *   judge's own response.usage) and takes priority over the built-in
 *   character-count estimate for that iteration's budget consumption.
 * @property {(state: object) => Promise<Array<object>>} [planChildren] returns spawn requests for this iteration
 * @property {(request: object, depth: number) => Promise<{result: any, usage?: {tokens?: number, totalTokens?: number, turns?: number}}>} [spawnChild]
 *   `usage.totalTokens` (real, e.g. from `paperclipSpawn.fetchIssueTokenUsage`)
 *   takes priority over `usage.tokens` (the harness-agnostic/mock shape).
 * @property {number} [noProgressPatience=2]
 * @property {number} [noProgressEpsilon=0]
 * @property {(reason: string, state: object) => Promise<void>} [onEscalate]
 * @property {{thresholdTokens: number, keepRecentTokens: number}} [compaction]
 *
 * @param {LoopConfig} config
 */
export async function runRecursiveLoop(config) {
  const {
    objective,
    depth = 0,
    maxDepth,
    maxChildrenPerTurn = 1,
    budget,
    evaluate,
    planChildren = async () => [],
    spawnChild = null,
    noProgressPatience = 2,
    noProgressEpsilon = 0,
    onEscalate = async () => {},
    compaction = { thresholdTokens: 8000, keepRecentTokens: 2000 },
  } = config;

  if (!objective) throw new Error('runRecursiveLoop: objective is required');
  if (!Number.isInteger(maxDepth) || maxDepth < 0) {
    throw new Error('runRecursiveLoop: maxDepth must be a non-negative integer');
  }
  if (typeof evaluate !== 'function') {
    throw new Error('runRecursiveLoop: evaluate(state) is required');
  }

  const budgetTracker = new BudgetTracker(budget);
  const registry = new ChildAgentRegistry();
  const progress = new NoProgressDetector({ patience: noProgressPatience, epsilon: noProgressEpsilon });
  let trace = [];

  const pushTrace = (entry) => {
    trace.push({ id: `t-${trace.length}`, parentId: trace.length ? trace[trace.length - 1].id : null, ...entry });
    const result = compactIfNeeded(trace, compaction);
    trace = result.entries;
  };

  // Depth ceiling is checked at entry: an invocation made at maxDepth
  // represents a child that has already hit the recursion ceiling, so it
  // must not iterate at all -- distinct from simply declining to spawn
  // further children mid-loop.
  if (depth >= maxDepth) {
    return {
      stopReason: STOP_REASONS.DEPTH_LIMIT,
      iterations: 0,
      trace,
      budgetSnapshot: budgetTracker.snapshot(),
      registrySnapshot: registry.snapshot(),
      noProgressSnapshot: null,
      finalEvaluation: null,
    };
  }

  let iterations = 0;
  for (;;) {
    const exhausted = budgetTracker.exhausted();
    if (exhausted.exhausted) {
      return {
        stopReason: STOP_REASONS.BUDGET_EXHAUSTED,
        iterations,
        trace,
        budgetSnapshot: budgetTracker.snapshot(),
        registrySnapshot: registry.snapshot(),
        noProgressSnapshot: null,
        finalEvaluation: null,
        exhaustedDimension: exhausted.dimension,
      };
    }

    const state = {
      objective,
      depth,
      iteration: iterations,
      trace,
      budget: budgetTracker.snapshot(),
      registry: registry.snapshot(),
    };

    const evaluation = await evaluate(state);
    // `evaluate` is an external verifier/LLM-as-judge (per the module
    // contract above) and may report its own real token usage from the
    // model call it made; prefer that over the character-count estimate,
    // which is only a fallback for callers that can't report real numbers.
    budgetTracker.consumeTokens(evaluation.usage?.totalTokens ?? estimateTokens(JSON.stringify(evaluation)));
    if (evaluation.passed) {
      pushTrace({ type: 'assistant', detail: { evaluation, note: 'evaluation passed' } });
      return {
        stopReason: STOP_REASONS.EVALUATION_PASSED,
        iterations: iterations + 1,
        trace,
        budgetSnapshot: budgetTracker.snapshot(),
        registrySnapshot: registry.snapshot(),
        noProgressSnapshot: progress.record(evaluation.score ?? 0),
        finalEvaluation: evaluation,
      };
    }

    const progressResult = progress.record(evaluation.score ?? 0);
    if (progressResult.noProgress) {
      await onEscalate(STOP_REASONS.NO_PROGRESS, state);
      pushTrace({ type: 'custom', detail: { note: 'escalated: no progress', progressResult } });
      return {
        stopReason: STOP_REASONS.NO_PROGRESS,
        iterations: iterations + 1,
        trace,
        budgetSnapshot: budgetTracker.snapshot(),
        registrySnapshot: registry.snapshot(),
        noProgressSnapshot: progressResult,
        finalEvaluation: evaluation,
      };
    }

    // Spawn bounded children for this iteration, if the loop wants to and
    // there is depth budget left to give them.
    if (spawnChild && depth + 1 < maxDepth) {
      const requests = (await planChildren(state)).slice(0, maxChildrenPerTurn);
      for (const request of requests) {
        const child = registry.register({ name: request.name, parentId: null, depth: depth + 1 });
        registry.updateStatus(child.id, 'running');
        try {
          const { result, usage = {} } = await spawnChild(request, depth + 1);
          registry.updateStatus(child.id, 'succeeded', result);
          registry.recordUsage(child.id, usage);
          // Real usage (e.g. paperclipSpawn's `fetchIssueTokenUsage`, summed
          // from actual model adapter usageJson) reports `totalTokens`;
          // harness-agnostic/mock spawnChild implementations report the
          // simpler `tokens` -- prefer the real figure when both exist.
          budgetTracker.consumeTokens(usage.totalTokens ?? usage.tokens ?? 0);
        } catch (err) {
          registry.updateStatus(child.id, 'failed', { error: String(err?.message ?? err) });
        }
      }
    }

    pushTrace({ type: 'toolResult', detail: { evaluation, note: 'iteration complete' } });
    budgetTracker.consumeTurn();
    budgetTracker.consumeContinuation();
    iterations += 1;
  }
}
