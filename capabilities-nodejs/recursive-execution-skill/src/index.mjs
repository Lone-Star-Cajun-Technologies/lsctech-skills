export { runRecursiveLoop, STOP_REASONS } from './recursiveLoop.mjs';
export { BudgetTracker } from './budgetTracker.mjs';
export { ChildAgentRegistry } from './childRegistry.mjs';
export { NoProgressDetector } from './noProgressDetector.mjs';
export { compactIfNeeded, estimateTokens } from './compaction.mjs';
// paperclipSpawn is available from './adapters/paperclip/paperclipSpawn.mjs'
// but not exported from the public API to maintain harness-agnosticism.
