/**
 * Packages an LLM-generated candidate edit into the shape the review gate
 * and store expect. `generateCandidate` is caller-supplied on purpose: this
 * layer is harness-agnostic and must not hardcode a call to any specific
 * model API (and this sandbox is subscription-billed, not API-key billed —
 * see AGENTS.md). In production `generateCandidate` is the calling agent's
 * own LLM turn (it already read `item` and `observation` to get here); in
 * tests it's a deterministic stub. Either way the contract is the same:
 * `({ item, observation }) => { body, rationale }`.
 */
export async function proposeRefinement({ item, observation, generateCandidate }) {
  if (!item || !item.id) throw new Error('item (the current ledger item) is required');
  if (!observation || typeof observation !== 'string' || !observation.trim()) {
    throw new Error('observation is required — the evidence this proposal will be reviewed against');
  }
  if (typeof generateCandidate !== 'function') {
    throw new Error('generateCandidate is required: ({ item, observation }) => { body, rationale }');
  }

  const candidate = await generateCandidate({ item, observation });
  if (!candidate || typeof candidate.body !== 'string' || !candidate.body.trim()) {
    throw new Error('generateCandidate must return a non-empty { body }');
  }

  return {
    itemId: item.id,
    body: candidate.body,
    evidence: observation,
    rationale: candidate.rationale ?? null,
  };
}
