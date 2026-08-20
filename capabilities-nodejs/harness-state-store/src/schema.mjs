// Typed state schema for the harness state ledger (LON-68 / LON-63).
// Four item kinds, per LON-60 architecture report §4.1 / §6 Epic 2 scope:
// prompt notes, memories, skill descriptions, subagent specs.

export const ITEM_TYPES = Object.freeze([
  'prompt_note',
  'memory',
  'skill_description',
  'subagent_spec',
]);

export const SCOPES = Object.freeze(['local', 'global']);

/**
 * Throws with a descriptive message if the create/refine/rollback input is
 * malformed. Kept as one function so every mutation path (create, refine,
 * rollback) runs the same checks — a ledger with an inconsistent validation
 * surface is worse than no validation.
 */
export function assertValidItemInput({ type, scope, taskId, title, body }) {
  if (!ITEM_TYPES.includes(type)) {
    throw new Error(`invalid item type ${JSON.stringify(type)}; must be one of ${ITEM_TYPES.join(', ')}`);
  }
  if (!SCOPES.includes(scope)) {
    throw new Error(`invalid scope ${JSON.stringify(scope)}; must be one of ${SCOPES.join(', ')}`);
  }
  if (scope === 'local' && !taskId) {
    throw new Error('local scope requires a taskId');
  }
  if (scope === 'global' && taskId) {
    throw new Error('global scope must not carry a taskId (organization-wide, not task-bound)');
  }
  if (!title || typeof title !== 'string') {
    throw new Error('title is required');
  }
  if (typeof body !== 'string') {
    throw new Error('body must be a string');
  }
}

/**
 * Refinement and rollback are both ledger mutations after creation, and both
 * must cite why — an unevidenced edit to organizational memory is exactly
 * the failure mode this ledger exists to prevent.
 */
export function assertEvidence(evidence) {
  if (!evidence || typeof evidence !== 'string' || !evidence.trim()) {
    throw new Error('evidence is required for refine/rollback (cite what observation justifies this change)');
  }
}
