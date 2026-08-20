// Tracks the four hard resource limits every loop invocation must respect.
// A loop is never allowed to run without all four caps set (see recursiveLoop.mjs).
export class BudgetTracker {
  constructor(budget) {
    for (const key of ['maxTokens', 'maxTurns', 'maxWallClockMs', 'maxContinuations']) {
      if (!(Number.isFinite(budget?.[key]) && budget[key] > 0)) {
        throw new Error(`BudgetTracker: budget.${key} must be a positive finite number`);
      }
    }
    this.budget = { ...budget };
    this.tokensUsed = 0;
    this.turnsUsed = 0;
    this.continuationsUsed = 0;
    this.startedAt = Date.now();
  }

  consumeTokens(n) {
    this.tokensUsed += Math.max(0, n);
  }

  // Reconciles against a real, authoritative total (e.g. summed `usageJson`
  // read back from Paperclip's /api/issues/{id}/runs -- actual model token
  // consumption, not an estimate). That total is a point-in-time snapshot of
  // an issue's whole usage, not a delta, and callers may re-fetch it more
  // than once (e.g. once per wake) -- so this takes the max instead of
  // adding, which keeps repeated reconciliation idempotent instead of
  // double-counting.
  reconcileTokens(totalTokens) {
    if (Number.isFinite(totalTokens)) {
      this.tokensUsed = Math.max(this.tokensUsed, totalTokens);
    }
  }

  consumeTurn() {
    this.turnsUsed += 1;
  }

  consumeContinuation() {
    this.continuationsUsed += 1;
  }

  elapsedMs() {
    return Date.now() - this.startedAt;
  }

  // Returns the first-tripped limit, or null if still within budget.
  // Checking in a fixed order keeps stop reasons deterministic for tests/logs.
  exhausted() {
    if (this.tokensUsed >= this.budget.maxTokens) {
      return { exhausted: true, dimension: 'tokens', used: this.tokensUsed, cap: this.budget.maxTokens };
    }
    if (this.turnsUsed >= this.budget.maxTurns) {
      return { exhausted: true, dimension: 'turns', used: this.turnsUsed, cap: this.budget.maxTurns };
    }
    if (this.continuationsUsed >= this.budget.maxContinuations) {
      return { exhausted: true, dimension: 'continuations', used: this.continuationsUsed, cap: this.budget.maxContinuations };
    }
    const elapsed = this.elapsedMs();
    if (elapsed >= this.budget.maxWallClockMs) {
      return { exhausted: true, dimension: 'wallClockMs', used: elapsed, cap: this.budget.maxWallClockMs };
    }
    return { exhausted: false, dimension: null };
  }

  snapshot() {
    return {
      tokensUsed: this.tokensUsed,
      turnsUsed: this.turnsUsed,
      continuationsUsed: this.continuationsUsed,
      elapsedMs: this.elapsedMs(),
      budget: { ...this.budget },
    };
  }
}
