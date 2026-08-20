import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { HarnessStateStore, exportGlobalMemoryToFile, wikiReference } from '../src/index.mjs';

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

async function freshStore() {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'harness-state-store-test-'));
  return { store: new HarnessStateStore({ rootDir }), rootDir };
}

// --- Acceptance criteria (LON-68): "An agent can create a persistent note
// during one task, retrieve it in a later task, and refine it with
// evidence." -----------------------------------------------------------

test('create in task A, retrieve in task B, refine with evidence', async () => {
  const { store } = await freshStore();

  // Task A creates a global note — global scope is what makes it visible
  // beyond the task that created it.
  const created = await store.create({
    type: 'memory',
    scope: 'global',
    title: 'deploy window policy',
    body: 'Freeze merges Fridays after 3pm.',
    actor: 'task-a-run',
  });
  assert.equal(created.currentRevision, 0);
  assert.equal(created.history.length, 1);

  // A different task (task B) retrieves it purely by id — no shared
  // in-memory state, only the on-disk ledger.
  const { store: storeInTaskB } = { store }; // same store instance stands in for "a later task" against the same rootDir
  const retrieved = await storeInTaskB.get(created.id);
  assert.equal(retrieved.body, 'Freeze merges Fridays after 3pm.');

  // Task B refines it, citing evidence.
  const refined = await store.refine(created.id, {
    body: 'Freeze merges Fri 3pm-Mon 9am; hotfixes exempt with on-call sign-off.',
    evidence: 'Incident LON-90: Friday-evening deploy caused a weekend outage with no on-call coverage.',
    actor: 'task-b-run',
  });
  assert.equal(refined.currentRevision, 1);
  assert.equal(refined.history.length, 2);
  assert.equal(refined.history[1].action, 'refine');
  assert.equal(refined.history[1].evidence, 'Incident LON-90: Friday-evening deploy caused a weekend outage with no on-call coverage.');
  assert.equal(refined.body, 'Freeze merges Fri 3pm-Mon 9am; hotfixes exempt with on-call sign-off.');
});

test('refine without evidence is rejected', async () => {
  const { store } = await freshStore();
  const item = await store.create({ type: 'prompt_note', scope: 'global', title: 'x', body: 'y' });
  await assert.rejects(() => store.refine(item.id, { body: 'z', evidence: '' }), /evidence is required/);
});

// --- Local vs global scope -----------------------------------------------

test('local items are scoped to their task and excluded from global listing', async () => {
  const { store } = await freshStore();
  await store.create({ type: 'prompt_note', scope: 'local', taskId: 'task-1', title: 'scratch note', body: 'wip' });
  await store.create({ type: 'prompt_note', scope: 'global', title: 'org note', body: 'stable' });

  const globalOnly = await store.list({ scope: 'global' });
  assert.equal(globalOnly.length, 1);
  assert.equal(globalOnly[0].title, 'org note');

  const task1Only = await store.list({ scope: 'local', taskId: 'task-1' });
  assert.equal(task1Only.length, 1);
  assert.equal(task1Only[0].title, 'scratch note');

  const task2Only = await store.list({ scope: 'local', taskId: 'task-2' });
  assert.equal(task2Only.length, 0, 'a different task must not see task-1\'s local items');
});

test('local scope without a taskId is rejected; global scope with a taskId is rejected', async () => {
  const { store } = await freshStore();
  await assert.rejects(() => store.create({ type: 'memory', scope: 'local', title: 'x', body: 'y' }), /local scope requires a nonempty taskId/);
  await assert.rejects(
    () => store.create({ type: 'memory', scope: 'global', taskId: 'task-1', title: 'x', body: 'y' }),
    /global scope must not carry a taskId/,
  );
});

// --- Refinement history + rollback ----------------------------------------

test('rollback restores a prior revision\'s body and appends (not truncates) history', async () => {
  const { store } = await freshStore();
  const item = await store.create({ type: 'skill_description', scope: 'global', title: 'triage skill', body: 'v0 behavior' });
  await store.refine(item.id, { body: 'v1 behavior', evidence: 'evidence for v1' });
  const v2 = await store.refine(item.id, { body: 'v2 behavior — regressed', evidence: 'evidence for v2' });
  assert.equal(v2.currentRevision, 2);

  const rolledBack = await store.rollback(item.id, 0, { evidence: 'v2 caused triage misroutes; reverting to v0 pending fix' });
  assert.equal(rolledBack.body, 'v0 behavior');
  assert.equal(rolledBack.currentRevision, 3, 'rollback is a new revision, not a truncation');
  assert.equal(rolledBack.history.length, 4, 'create + 2 refines + 1 rollback, all still present');
  assert.equal(rolledBack.history[3].action, 'rollback');
  assert.equal(rolledBack.history[1].body, 'v1 behavior', 'prior history entries are untouched by rollback');
});

test('rollback without evidence is rejected', async () => {
  const { store } = await freshStore();
  const item = await store.create({ type: 'subagent_spec', scope: 'global', title: 'x', body: 'y' });
  await store.refine(item.id, { body: 'z', evidence: 'because' });
  await assert.rejects(() => store.rollback(item.id, 0, {}), /evidence is required/);
});

test('rollback to a nonexistent revision fails clearly', async () => {
  const { store } = await freshStore();
  const item = await store.create({ type: 'memory', scope: 'global', title: 'x', body: 'y' });
  await assert.rejects(() => store.rollback(item.id, 99, { evidence: 'e' }), /no revision 99/);
});

// --- CRUD completeness ------------------------------------------------------

test('delete removes the item from both storage and the index', async () => {
  const { store } = await freshStore();
  const item = await store.create({ type: 'memory', scope: 'global', title: 'x', body: 'y' });
  await store.delete(item.id);
  await assert.rejects(() => store.get(item.id), /no item with id/);
  assert.equal((await store.list({})).length, 0);
});

test('invalid item type and scope are both rejected at create time', async () => {
  const { store } = await freshStore();
  await assert.rejects(() => store.create({ type: 'not_a_type', scope: 'global', title: 'x', body: 'y' }), /invalid item type/);
  await assert.rejects(() => store.create({ type: 'memory', scope: 'not_a_scope', title: 'x', body: 'y' }), /invalid scope/);
});

// --- Integration with existing memory tool + SOP wiki -----------------------

test('exportGlobalMemoryToFile projects a global memory item into the MEMORY.md convention', async () => {
  const { store } = await freshStore();
  const item = await store.create({
    type: 'memory',
    scope: 'global',
    title: 'LON-68 harness state store',
    body: 'The ledger lives at harness-state-store/; see README for interface.',
  });
  const memoryDir = await mkdtemp(path.join(os.tmpdir(), 'memory-dir-test-'));
  const result = await exportGlobalMemoryToFile(item, memoryDir);
  assert.equal(result.indexUpdated, true);

  const { readFile } = await import('node:fs/promises');
  const fileBody = await readFile(path.join(memoryDir, result.fileName), 'utf8');
  assert.match(fileBody, /name: lon-68-harness-state-store/);
  assert.match(fileBody, /The ledger lives at harness-state-store/);

  const index = await readFile(path.join(memoryDir, 'MEMORY.md'), 'utf8');
  assert.match(index, /LON-68 harness state store/);

  // Re-export after a refine must not duplicate the index line.
  const refined = await store.refine(item.id, { body: 'updated body', evidence: 'doc updated' });
  const second = await exportGlobalMemoryToFile(refined, memoryDir);
  assert.equal(second.indexUpdated, false, 're-exporting the same item must not add a second index line');
  const indexAfter = await readFile(path.join(memoryDir, 'MEMORY.md'), 'utf8');
  assert.equal(indexAfter.split('\n').filter((l) => l.includes('LON-68 harness state store')).length, 1);
});

test('exportGlobalMemoryToFile refuses non-memory or non-global items', async () => {
  const { store } = await freshStore();
  const localItem = await store.create({ type: 'memory', scope: 'local', taskId: 't1', title: 'x', body: 'y' });
  await assert.rejects(() => exportGlobalMemoryToFile(localItem, '/tmp/whatever'), /scope 'global'/);

  const wrongType = await store.create({ type: 'prompt_note', scope: 'global', title: 'x', body: 'y' });
  await assert.rejects(() => exportGlobalMemoryToFile(wrongType, '/tmp/whatever'), /expects a 'memory' item/);
});

test('wikiReference builds a prompt_note payload citing the wiki doc, not copying it', async () => {
  const { store } = await freshStore();
  const payload = wikiReference('lsctech-wiki/sop/agent-operating-standard.md', { hook: 'checked before acting on LON-68' });
  const item = await store.create(payload);
  assert.equal(item.type, 'prompt_note');
  assert.equal(item.scope, 'global');
  assert.match(item.body, /lsctech-wiki\/sop\/agent-operating-standard\.md/);
  assert.match(item.body, /checked before acting on LON-68/);
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
