import { lineChangeCount } from './diff.mjs';

// A one-word or driveby "evidence" string defeats the point of an
// evidence-required ledger, so the review gate holds a slightly higher bar
// than the store's own "non-blank" check.
export const MIN_EVIDENCE_LENGTH = 10;

// "Small edits" per LON-63's scope line: cap both the absolute size of a
// change and its size relative to the current body, so neither a giant doc
// nor a one-line doc can be silently rewritten wholesale in one proposal.
export const DEFAULT_MAX_CHANGED_LINES = 40;
export const DEFAULT_MAX_CHANGE_RATIO = 0.6;

/**
 * Decide whether a proposed edit may be applied. Pure function — no I/O, no
 * store mutation — so it can be unit tested and reused by any caller
 * (a human approval flow, a CI gate, another harness) independent of how
 * the proposal or the store are implemented.
 *
 * Global-scope items get one extra requirement: a named `reviewer` distinct
 * from `actor`, since a global edit is organization-wide rather than
 * confined to one task — the local/global distinction has to mean
 * something at review time, not just at storage time.
 */
export function reviewProposal({
  currentBody,
  proposedBody,
  evidence,
  scope,
  actor,
  reviewer,
  forceApprove = false,
}, {
  maxChangedLines = DEFAULT_MAX_CHANGED_LINES,
  maxChangeRatio = DEFAULT_MAX_CHANGE_RATIO,
} = {}) {
  const reasons = [];

  if (typeof proposedBody !== 'string' || !proposedBody.trim()) {
    reasons.push('proposed body is empty');
  }
  if (!evidence || typeof evidence !== 'string' || evidence.trim().length < MIN_EVIDENCE_LENGTH) {
    reasons.push(`evidence must be at least ${MIN_EVIDENCE_LENGTH} characters (cite the observation, not a one-word note)`);
  }
  if (proposedBody === currentBody) {
    reasons.push('proposed body is identical to the current body — nothing to refine');
  }

  if (typeof proposedBody === 'string' && proposedBody !== currentBody) {
    const changed = lineChangeCount(currentBody, proposedBody);
    const baseline = Math.max(currentBody.split('\n').length, 1);
    const ratio = changed / baseline;
    if (changed > maxChangedLines && ratio > maxChangeRatio) {
      reasons.push(`edit touches ${changed} lines (${Math.round(ratio * 100)}% of current body) — exceeds the small-edit cap of ${maxChangedLines} lines / ${Math.round(maxChangeRatio * 100)}%; split into smaller proposals`);
    }
  }

  if (scope === 'global' && !forceApprove) {
    if (!reviewer || typeof reviewer !== 'string' || !reviewer.trim()) {
      reasons.push('global-scope edits require a named reviewer distinct from the proposing actor');
    } else if (actor && reviewer.trim() === actor.trim()) {
      reasons.push('global-scope edits require a reviewer distinct from the proposing actor (self-review is not sufficient at global scope)');
    }
  }

  return { approved: reasons.length === 0, reasons };
}
