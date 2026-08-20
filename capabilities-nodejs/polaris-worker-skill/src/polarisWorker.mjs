import { runRecursiveLoop, STOP_REASONS } from '../../recursive-execution-skill/src/index.mjs';

// Normalized exit reasons a Medic consumer can key off of, distinct from the
// underlying recursive-loop's generic STOP_REASONS. `repair_attempts_exhausted`
// is Epic 4's own concept (LON-70 scope: "self-repair up to N times before
// escalation") layered on top of the loop's generic `budget_exhausted` --
// this wrapper dedicates `budget.maxContinuations` to exactly that count, so
// the two collapse to one exit reason without adding a second cap dimension.
export const POLARIS_EXIT_REASONS = Object.freeze({
  VERIFIED: 'verified',
  REPAIR_ATTEMPTS_EXHAUSTED: 'repair_attempts_exhausted',
  BUDGET_EXHAUSTED: 'budget_exhausted',
  NO_PROGRESS: 'no_progress',
  DEPTH_LIMIT: 'depth_limit',
});

function normalizeExitReason(stopReason, exhaustedDimension) {
  if (stopReason === STOP_REASONS.EVALUATION_PASSED) return POLARIS_EXIT_REASONS.VERIFIED;
  if (stopReason === STOP_REASONS.BUDGET_EXHAUSTED) {
    // maxTurns and maxContinuations are both pinned to maxRepairAttempts
    // below, so either tripping is the repair cap, not a raw budget concern.
    return exhaustedDimension === 'turns' || exhaustedDimension === 'continuations'
      ? POLARIS_EXIT_REASONS.REPAIR_ATTEMPTS_EXHAUSTED
      : POLARIS_EXIT_REASONS.BUDGET_EXHAUSTED;
  }
  if (stopReason === STOP_REASONS.NO_PROGRESS) return POLARIS_EXIT_REASONS.NO_PROGRESS;
  return POLARIS_EXIT_REASONS.DEPTH_LIMIT;
}

// Runs every acceptance criterion's checker and folds the results into one
// evaluate() outcome: passed only if every criterion passes; score is the
// pass fraction, giving NoProgressDetector something to compare across
// repair attempts.
async function verifyAcceptanceCriteria(workProduct, criteria) {
  const results = [];
  for (const criterion of criteria) {
    const outcome = await criterion.check(workProduct);
    results.push({ id: criterion.id, description: criterion.description, ...outcome });
  }
  const passedCount = results.filter((r) => r.passed).length;
  return {
    passed: results.length > 0 && passedCount === results.length,
    score: results.length === 0 ? 0 : passedCount / results.length,
    results,
  };
}

/**
 * @typedef {Object} AcceptanceCriterion
 * @property {string} id
 * @property {string} description
 * @property {(workProduct: any) => Promise<{passed: boolean, notes?: string}>} check
 *
 * @typedef {Object} PolarisPacket
 * @property {string} objective what the implementation worker is trying to build
 * @property {AcceptanceCriterion[]} acceptanceCriteria quality gates -- self-verification checks the worker
 *   runs against its own work product before submitting
 * @property {number} maxRepairAttempts self-repair cap -- how many implement/verify cycles are allowed
 *   before escalation, distinct from raw budget exhaustion (Epic 4 scope)
 * @property {{maxTokens?: number, maxWallClockMs?: number}} [budget] optional overrides for the
 *   token/wall-clock dimensions; maxTurns and maxContinuations are always derived from
 *   maxRepairAttempts so the repair cap is the single source of truth for "how many tries"
 */

/**
 * Polaris packet-triggered implementation/validation loop (LON-70 / Epic 4,
 * architecture report §6). Builds directly on the standalone recursive
 * execution skill (LON-62/LON-67, Epic 1): this module supplies the
 * `evaluate()` gate (acceptance criteria as quality gates) and the
 * implement/verify/submit cycle; `runRecursiveLoop` supplies the bounded
 * iteration, budget enforcement, and no-progress escalation.
 *
 * Contract (mirrors LON-70's acceptance criteria verbatim): "An
 * implementation worker receives a Polaris packet, implements, self-verifies
 * against acceptance criteria, self-repairs if needed, and submits when
 * verified."
 *
 * @param {PolarisPacket} packet
 * @param {Object} hooks
 * @param {(state: {attempt: number, previousVerification: object|null, workProduct: any}) => Promise<any>} hooks.implement
 *   Produces or refines the work product. Called once per attempt, before verification.
 * @param {(workProduct: any) => Promise<void>} hooks.submit
 *   Called exactly once, only after every acceptance criterion passes.
 * @param {(reason: string, medicTrace: object) => Promise<void>} [hooks.onEscalate]
 *   Fires before a non-`verified` exit -- the self-repair budget ran out, no measurable
 *   progress was made across attempts, or the depth ceiling was already hit.
 * @param {number} [depth]
 * @param {number} [maxDepth]
 */
export async function runPolarisWorker(packet, hooks, { depth = 0, maxDepth = 1 } = {}) {
  const { objective, acceptanceCriteria, maxRepairAttempts } = packet;
  if (!objective) throw new Error('runPolarisWorker: packet.objective is required');
  if (!Array.isArray(acceptanceCriteria) || acceptanceCriteria.length === 0) {
    throw new Error('runPolarisWorker: packet.acceptanceCriteria must be a non-empty array');
  }
  if (!Number.isInteger(maxRepairAttempts) || maxRepairAttempts < 1) {
    throw new Error('runPolarisWorker: packet.maxRepairAttempts must be a positive integer');
  }
  if (typeof hooks?.implement !== 'function') throw new Error('runPolarisWorker: hooks.implement is required');
  if (typeof hooks?.submit !== 'function') throw new Error('runPolarisWorker: hooks.submit is required');

  let workProduct = null;
  let lastVerification = null;
  const medicIterations = [];

  const evaluate = async (state) => {
    workProduct = await hooks.implement({
      attempt: state.iteration,
      previousVerification: lastVerification,
      workProduct,
    });
    lastVerification = await verifyAcceptanceCriteria(workProduct, acceptanceCriteria);

    // Structured trace output for Medic logging (LON-70 scope item, LON-64
    // acceptance criteria: "logs each iteration's evaluation outcome, budget
    // consumption, and exit reason"). Captured per-iteration here since the
    // underlying loop only snapshots budget on demand via `state.budget`.
    medicIterations.push({
      attempt: state.iteration,
      evaluationOutcome: {
        passed: lastVerification.passed,
        score: lastVerification.score,
        criteria: lastVerification.results,
      },
      budgetConsumption: state.budget,
    });

    return { passed: lastVerification.passed, score: lastVerification.score };
  };

  const budget = {
    maxTokens: packet.budget?.maxTokens ?? 1_000_000,
    maxWallClockMs: packet.budget?.maxWallClockMs ?? 10 * 60 * 1000,
    // Repair attempts are the single source of truth for "how many tries":
    // one loop iteration = one implement/verify cycle = one continuation.
    maxTurns: maxRepairAttempts,
    maxContinuations: maxRepairAttempts,
  };

  const result = await runRecursiveLoop({
    objective,
    depth,
    maxDepth,
    budget,
    evaluate,
  });

  const exitReason = normalizeExitReason(result.stopReason, result.exhaustedDimension);
  const medicTrace = buildMedicTrace(packet, medicIterations, exitReason, result.budgetSnapshot);

  if (exitReason === POLARIS_EXIT_REASONS.VERIFIED) {
    await hooks.submit(workProduct);
  } else if (hooks.onEscalate) {
    // Escalation is defined at the Polaris-packet level -- any exit that
    // isn't "verified" (repair attempts exhausted, raw budget exhausted,
    // no measurable progress, or depth ceiling) -- not just the underlying
    // loop's narrower no-progress signal.
    await hooks.onEscalate(exitReason, medicTrace);
  }

  return {
    exitReason,
    submitted: exitReason === POLARIS_EXIT_REASONS.VERIFIED,
    attempts: medicIterations.length,
    workProduct,
    finalVerification: lastVerification,
    medicTrace,
  };
}

function buildMedicTrace(packet, medicIterations, exitReason, finalBudgetSnapshot) {
  return {
    objective: packet.objective,
    maxRepairAttempts: packet.maxRepairAttempts,
    exitReason,
    iterations: medicIterations,
    finalBudgetSnapshot,
  };
}
