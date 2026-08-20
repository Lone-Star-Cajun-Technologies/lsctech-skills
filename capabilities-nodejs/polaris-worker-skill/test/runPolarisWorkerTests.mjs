import assert from 'node:assert/strict';
import { runPolarisWorker, POLARIS_EXIT_REASONS } from '../src/index.mjs';

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

function criterion(id, checkFn) {
  return { id, description: id, check: checkFn };
}

// --- Acceptance criteria (LON-70): "receives a Polaris packet, implements,
// self-verifies against acceptance criteria, self-repairs if needed, and
// submits when verified." ---------------------------------------------------

test('verifies and submits on the first attempt when criteria already pass', async () => {
  let implementCalls = 0;
  let submitted = null;
  const result = await runPolarisWorker(
    {
      objective: 'add a function',
      acceptanceCriteria: [criterion('has-function', async (wp) => ({ passed: wp?.hasFunction === true }))],
      maxRepairAttempts: 3,
    },
    {
      implement: async () => {
        implementCalls += 1;
        return { hasFunction: true };
      },
      submit: async (wp) => {
        submitted = wp;
      },
    },
  );
  assert.equal(result.exitReason, POLARIS_EXIT_REASONS.VERIFIED);
  assert.equal(result.submitted, true);
  assert.equal(implementCalls, 1);
  assert.deepEqual(submitted, { hasFunction: true });
  assert.equal(result.medicTrace.iterations.length, 1);
  assert.equal(result.medicTrace.iterations[0].evaluationOutcome.passed, true);
});

test('self-repairs across attempts and submits once all criteria pass', async () => {
  let attempt = 0;
  const result = await runPolarisWorker(
    {
      objective: 'fix the bug',
      acceptanceCriteria: [
        criterion('no-off-by-one', async (wp) => ({ passed: wp.bugFixed })),
        criterion('has-test', async (wp) => ({ passed: wp.hasTest })),
      ],
      maxRepairAttempts: 5,
    },
    {
      implement: async ({ attempt: a, previousVerification }) => {
        attempt = a;
        // Fixes the bug on attempt 0, adds the test on attempt 1 -- a
        // realistic incremental self-repair sequence driven by feedback
        // from the previous verification.
        return {
          bugFixed: true,
          hasTest: previousVerification !== null,
        };
      },
      submit: async () => {},
    },
  );
  assert.equal(result.exitReason, POLARIS_EXIT_REASONS.VERIFIED);
  assert.equal(result.attempts, 2);
  assert.equal(attempt, 1);
});

test('escalates as repair_attempts_exhausted when the cap is hit without verifying, and never submits', async () => {
  let submitCalls = 0;
  let escalation = null;
  // Three criteria that unlock one at a time as attempts increase, but the
  // last one needs attempt > 2 (never reached within a 3-attempt cap) --
  // score strictly improves each attempt (0/3, 1/3, 2/3) so no-progress
  // never trips, isolating the repair-attempt cap as the dimension under test.
  const criteria = [0, 1, 2].map((i) => criterion(`c${i}`, async (wp) => ({ passed: wp.attempt > i })));
  const result = await runPolarisWorker(
    {
      objective: 'impossible task',
      acceptanceCriteria: criteria,
      maxRepairAttempts: 3,
    },
    {
      implement: async ({ attempt }) => ({ attempt }),
      submit: async () => {
        submitCalls += 1;
      },
      onEscalate: async (reason, medicTrace) => {
        escalation = { reason, medicTrace };
      },
    },
  );
  assert.equal(result.exitReason, POLARIS_EXIT_REASONS.REPAIR_ATTEMPTS_EXHAUSTED);
  assert.equal(result.submitted, false);
  assert.equal(submitCalls, 0);
  assert.equal(result.attempts, 3);
  assert.ok(escalation, 'onEscalate must fire when repair attempts run out');
  assert.equal(escalation.reason, POLARIS_EXIT_REASONS.REPAIR_ATTEMPTS_EXHAUSTED);
  assert.equal(escalation.medicTrace.iterations.length, 3);
});

test('escalates as no_progress when repeated repairs make no measurable improvement', async () => {
  let escalatedReason = null;
  const result = await runPolarisWorker(
    {
      objective: 'stuck task',
      acceptanceCriteria: [criterion('never-improves', async () => ({ passed: false }))],
      maxRepairAttempts: 10,
    },
    {
      implement: async () => ({}),
      submit: async () => {},
      onEscalate: async (reason) => {
        escalatedReason = reason;
      },
    },
  );
  assert.equal(result.exitReason, POLARIS_EXIT_REASONS.NO_PROGRESS);
  assert.equal(escalatedReason, POLARIS_EXIT_REASONS.NO_PROGRESS);
  assert.ok(result.attempts < 10, 'must escalate on stagnation well before exhausting the repair cap');
});

// --- Structured trace output for Medic logging (LON-70 scope item / LON-64
// acceptance criteria: "logs each iteration's evaluation outcome, budget
// consumption, and exit reason"). -------------------------------------------

test('medic trace records evaluation outcome and budget consumption per iteration, plus exit reason', async () => {
  const result = await runPolarisWorker(
    {
      objective: 'observed task',
      acceptanceCriteria: [criterion('c1', async (wp) => ({ passed: wp.ok === true }))],
      maxRepairAttempts: 4,
    },
    {
      implement: async ({ attempt }) => ({ ok: attempt >= 2 }),
      submit: async () => {},
    },
  );
  assert.equal(result.medicTrace.exitReason, POLARIS_EXIT_REASONS.VERIFIED);
  assert.equal(result.medicTrace.maxRepairAttempts, 4);
  assert.equal(result.medicTrace.iterations.length, 3);
  for (const iter of result.medicTrace.iterations) {
    assert.ok('evaluationOutcome' in iter);
    assert.ok('passed' in iter.evaluationOutcome);
    assert.ok('criteria' in iter.evaluationOutcome);
    assert.ok('budgetConsumption' in iter);
    assert.ok(Number.isFinite(iter.budgetConsumption.tokensUsed));
    assert.ok(Number.isFinite(iter.budgetConsumption.continuationsUsed));
  }
  assert.ok(result.medicTrace.finalBudgetSnapshot, 'final budget snapshot must be present for Medic logging');
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
