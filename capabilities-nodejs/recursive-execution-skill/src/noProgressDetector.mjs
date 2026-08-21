// No-progress detection + escalation.
//
// "Continue until successful" is explicitly not an acceptable stop condition
// (research report §4.1 Safety). This tracks the evaluation score across
// iterations and trips after `patience` consecutive iterations that fail to
// beat the best score seen so far by more than `epsilon`.
export class NoProgressDetector {
  constructor({ patience = 2, epsilon = 0 } = {}) {
    if (!(Number.isInteger(patience) && patience >= 1)) {
      throw new Error('NoProgressDetector: patience must be a positive integer');
    }
    if (!(Number.isFinite(epsilon) && epsilon >= 0)) {
      throw new Error('NoProgressDetector: epsilon must be a non-negative finite number');
    }
    this.patience = patience;
    this.epsilon = epsilon;
    this.bestScore = -Infinity;
    this.streak = 0;
    this.history = [];
  }

  // score: higher is better (caller normalizes evaluation output to this).
  record(score) {
    this.history.push(score);
    if (score > this.bestScore + this.epsilon) {
      this.bestScore = score;
      this.streak = 0;
    } else {
      this.streak += 1;
    }
    return {
      noProgress: this.streak >= this.patience,
      streak: this.streak,
      bestScore: this.bestScore,
      history: [...this.history],
    };
  }
}
