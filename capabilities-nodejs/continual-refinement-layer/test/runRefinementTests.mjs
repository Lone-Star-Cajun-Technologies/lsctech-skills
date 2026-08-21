import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { HarnessStateStore } from '../../harness-state-store/src/index.mjs';
import { ContinualRefinementLayer, proposeRefinement, reviewProposal } from '../src/index.mjs';

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

async function withStore(fn) {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'crl-test-'));
  const store = new HarnessStateStore({ rootDir });
  try {
    await fn(store, new ContinualRefinementLayer({ store }));
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
}

test('reviewProposal: rejects missing/weak evidence and identical-body no-ops', () => {
  const r1 = reviewProposal({ currentBody: 'a', proposedBody: 'b', evidence: '', scope: 'local' });
  assert.equal(r1.approved, false);
  assert.ok(r1.reasons.some((r) => r.includes('evidence')));

  const r2 = reviewProposal({ currentBody: 'a', proposedBody: 'a', evidence: 'plenty of evidence here', scope: 'local' });
  assert.equal(r2.approved, false);
  assert.ok(r2.reasons.some((r) => r.includes('identical')));
});

test('reviewProposal: rejects a full-rewrite as not a small edit', () => {
  const currentBody = Array.from({ length: 50 }, (_, i) => `line ${i}`).join('\n');
  const proposedBody = Array.from({ length: 50 }, (_, i) => `totally different ${i}`).join('\n');
  const r = reviewProposal({ currentBody, proposedBody, evidence: 'observed drift in prod logs', scope: 'local' });
  assert.equal(r.approved, false);
  assert.ok(r.reasons.some((reason) => reason.includes('small-edit cap')));
});

test('reviewProposal: approves a small, evidence-backed edit', () => {
  const currentBody = 'line 1\nline 2\nline 3';
  const proposedBody = 'line 1\nline 2 (updated)\nline 3';
  const r = reviewProposal({ currentBody, proposedBody, evidence: 'observed stale value in run log 2026-08-19', scope: 'local' });
  assert.equal(r.approved, true, JSON.stringify(r.reasons));
});

test('ContinualRefinementLayer.reviewAndApply: approved edit is applied and appends history', async () => {
  await withStore(async (store, layer) => {
    const item = await store.create({ type: 'prompt_note', scope: 'local', taskId: 'task-a', title: 'note', body: 'v1' });
    const result = await layer.reviewAndApply({
      itemId: item.id,
      body: 'v1 refined',
      evidence: 'evidence from a real trajectory review',
      rationale: 'tighten wording',
      actor: 'river',
    });
    assert.equal(result.applied, true);
    assert.equal(result.item.body, 'v1 refined');
    assert.equal(result.item.history.length, 2);
    assert.equal(result.item.history[1].action, 'refine');
  });
});

test('ContinualRefinementLayer.reviewAndApply: rejected edit never touches the store', async () => {
  await withStore(async (store, layer) => {
    const item = await store.create({ type: 'memory', scope: 'local', taskId: 'task-a', title: 'note', body: 'v1' });
    const result = await layer.reviewAndApply({ itemId: item.id, body: 'v2', evidence: 'x' });
    assert.equal(result.applied, false);
    const stored = await store.get(item.id);
    assert.equal(stored.body, 'v1');
    assert.equal(stored.history.length, 1);
  });
});

test('ContinualRefinementLayer.reviewAndApply: global-scope edit requires a distinct reviewer', async () => {
  await withStore(async (store, layer) => {
    const item = await store.create({ type: 'skill_description', scope: 'global', title: 'skill', body: 'do X' });

    const noReviewer = await layer.reviewAndApply({ itemId: item.id, body: 'do X carefully', evidence: 'org-wide incident review', actor: 'river' });
    assert.equal(noReviewer.applied, false);
    assert.ok(noReviewer.reasons.some((r) => r.includes('reviewer')));

    const selfReview = await layer.reviewAndApply({ itemId: item.id, body: 'do X carefully', evidence: 'org-wide incident review', actor: 'river', reviewer: 'river' });
    assert.equal(selfReview.applied, false);

    const approved = await layer.reviewAndApply({ itemId: item.id, body: 'do X carefully', evidence: 'org-wide incident review', actor: 'river', reviewer: 'cove' });
    assert.equal(approved.applied, true);
    assert.equal(approved.item.body, 'do X carefully');
  });
});

test('proposeRefinement: packages a caller-supplied candidate for review, harness-agnostic', async () => {
  await withStore(async (store, layer) => {
    const item = await store.create({ type: 'prompt_note', scope: 'local', taskId: 'task-b', title: 'note', body: 'always ask before deploying' });
    const proposal = await proposeRefinement({
      item,
      observation: 'trajectory review: agent deployed without asking twice this week',
      generateCandidate: async ({ item: current }) => ({
        body: `${current.body} — confirmed via two-strike trajectory review`,
        rationale: 'reinforce the ask-first rule after repeated misses',
      }),
    });
    assert.equal(proposal.itemId, item.id);
    assert.ok(proposal.body.includes('two-strike'));

    const result = await layer.reviewAndApply({ ...proposal, actor: 'river' });
    assert.equal(result.applied, true);
  });
});

test('snapshot + restoreSnapshot: restores a group of items to their captured revisions, history stays append-only', async () => {
  await withStore(async (store, layer) => {
    const a = await store.create({ type: 'memory', scope: 'local', taskId: 'task-c', title: 'a', body: 'a-v1' });
    const b = await store.create({ type: 'memory', scope: 'local', taskId: 'task-c', title: 'b', body: 'b-v1' });

    const snap = await layer.snapshot({ scope: 'local', taskId: 'task-c', actor: 'river', note: 'pre-refinement checkpoint' });
    assert.equal(snap.items.length, 2);

    await layer.reviewAndApply({ itemId: a.id, body: 'a-v2', evidence: 'evidence for a v2 refinement' });
    await layer.reviewAndApply({ itemId: b.id, body: 'b-v2', evidence: 'evidence for b v2 refinement' });

    const restore = await layer.restoreSnapshot(snap.id, { evidence: 'rolling back a bad batch refinement', actor: 'river' });
    assert.equal(restore.restored.length, 2);

    const restoredA = await store.get(a.id);
    const restoredB = await store.get(b.id);
    assert.equal(restoredA.body, 'a-v1');
    assert.equal(restoredB.body, 'b-v1');
    // append-only: create + refine + rollback = 3 entries each, not truncated back to 1
    assert.equal(restoredA.history.length, 3);
    assert.equal(restoredA.history[2].action, 'rollback');
  });
});

test('reviewAndRollback: a proposed rollback is also evidence-gated', async () => {
  await withStore(async (store, layer) => {
    const item = await store.create({ type: 'prompt_note', scope: 'local', taskId: 'task-d', title: 'note', body: 'v1' });
    await store.refine(item.id, { body: 'v2', evidence: 'v2 evidence' });

    const rejected = await layer.reviewAndRollback({ itemId: item.id, toRevision: 0, evidence: '' });
    assert.equal(rejected.applied, false);

    const approved = await layer.reviewAndRollback({ itemId: item.id, toRevision: 0, evidence: 'reverting a bad refine, confirmed in review' });
    assert.equal(approved.applied, true);
    assert.equal(approved.item.body, 'v1');
  });
});

let failures = 0;
for (const { name, fn } of tests) {
  try {
    await fn();
    console.log(`ok - ${name}`);
  } catch (err) {
    failures++;
    console.error(`not ok - ${name}`);
    console.error(err);
  }
}
console.log(`\n${tests.length - failures}/${tests.length} passing`);
if (failures > 0) process.exit(1);
