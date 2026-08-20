import assert from 'node:assert/strict';
import { createPaperclipSpawner, ChildNotResolvedError, fetchIssueTokenUsage } from '../../../src/adapters/paperclip/paperclipSpawn.mjs';

const results = [];
function test(name, fn) {
  results.push({ name, fn });
}

function mockFetch(routes) {
  const calls = [];
  const fetchImpl = async (url, opts = {}) => {
    calls.push({ url, opts });
    const key = `${opts.method ?? 'GET'} ${url.replace(/^https?:\/\/[^/]+/, '')}`;
    const route = routes[key];
    if (!route) throw new Error(`mockFetch: no route for ${key}`);
    const payload = typeof route === 'function' ? route(opts) : route;
    return {
      ok: payload.status < 400,
      status: payload.status,
      text: async () => JSON.stringify(payload.body),
      json: async () => payload.body,
    };
  };
  fetchImpl.calls = calls;
  return fetchImpl;
}

test('spawn posts to /children with parent attribution, depth, and watchdog timeout', async () => {
  const fetchImpl = mockFetch({
    'POST /api/issues/parent-1/children': (opts) => {
      const body = JSON.parse(opts.body);
      assert.equal(body.title, 'Do the subtask');
      assert.equal(body.requestDepth, 1, 'child depth = parentDepth + 1');
      assert.equal(body.blockParentUntilDone, true, 'defaults to blocking so the platform owns waiting');
      assert.equal(body.watchdog?.agentId, 'agent-me', 'maxWallClockMs budget registers the spawner as watchdog (executionPolicy.monitor is board-only, 403 for agents -- verified live)');
      assert.ok(body.watchdog.instructions.includes('60000'), 'watchdog instructions carry the deadline/budget');
      return { status: 201, body: { id: 'child-1', identifier: 'LON-100' } };
    },
  });
  const spawner = createPaperclipSpawner({
    apiBase: 'https://paperclip.test',
    apiKey: 'k',
    parentIssueId: 'parent-1',
    parentDepth: 0,
    maxDepth: 3,
    spawningAgentId: 'agent-me',
    fetchImpl,
  });
  const handle = await spawner.spawn({ title: 'Do the subtask', budget: { maxWallClockMs: 60_000 } });
  assert.equal(handle.childIssueId, 'child-1');
  assert.equal(handle.identifier, 'LON-100');
  assert.equal(handle.depth, 1);
});

test('spawn refuses to exceed maxDepth (bounded recursion, no network call)', async () => {
  const fetchImpl = mockFetch({});
  const spawner = createPaperclipSpawner({
    apiBase: 'https://paperclip.test',
    apiKey: 'k',
    parentIssueId: 'parent-1',
    parentDepth: 2,
    maxDepth: 3,
    fetchImpl,
  });
  await assert.rejects(() => spawner.spawn({ title: 'too deep' }), /depth_limit/);
  assert.equal(fetchImpl.calls.length, 0, 'depth check happens before any request is made');
});

test('collectResult maps terminal Paperclip status to an explicit pass/fail signal', async () => {
  const fetchImpl = mockFetch({
    'GET /api/issues/child-1': { status: 200, body: { id: 'child-1', status: 'done' } },
    'GET /api/issues/child-1/comments': {
      status: 200,
      body: [
        { authorType: 'user', body: 'go do it', deletedAt: null },
        { authorType: 'agent', body: 'first update', deletedAt: null },
        { authorType: 'agent', body: 'final result: 42', deletedAt: null },
      ],
    },
    'GET /api/issues/child-1/runs': {
      status: 200,
      body: [
        { status: 'succeeded', finishedAt: '2026-08-19T00:00:00Z', usageJson: { inputTokens: 1000, outputTokens: 200 } },
      ],
    },
  });
  const spawner = createPaperclipSpawner({
    apiBase: 'https://paperclip.test', apiKey: 'k', parentIssueId: 'p', parentDepth: 0, maxDepth: 3, fetchImpl,
  });
  const outcome = await spawner.collectResult({ childIssueId: 'child-1' });
  assert.equal(outcome.signal, 'passed');
  assert.equal(outcome.message, 'final result: 42', 'delivers the most recent agent comment as the result message');
  assert.equal(outcome.usage.totalTokens, 1200, 'reads back real token usage, not an estimate or allocation');
});

test('collectResult returns signal:null (never guesses) while the child is non-terminal', async () => {
  const fetchImpl = mockFetch({
    'GET /api/issues/child-1': { status: 200, body: { id: 'child-1', status: 'in_progress' } },
  });
  const spawner = createPaperclipSpawner({
    apiBase: 'https://paperclip.test', apiKey: 'k', parentIssueId: 'p', parentDepth: 0, maxDepth: 3, fetchImpl,
  });
  const outcome = await spawner.collectResult({ childIssueId: 'child-1' });
  assert.equal(outcome.signal, null);
});

test('collectResult maps blocked/cancelled to failed', async () => {
  for (const status of ['blocked', 'cancelled']) {
    const fetchImpl = mockFetch({
      'GET /api/issues/child-1': { status: 200, body: { id: 'child-1', status } },
      'GET /api/issues/child-1/comments': { status: 200, body: [] },
      'GET /api/issues/child-1/runs': { status: 200, body: [] },
    });
    const spawner = createPaperclipSpawner({
      apiBase: 'https://paperclip.test', apiKey: 'k', parentIssueId: 'p', parentDepth: 0, maxDepth: 3, fetchImpl,
    });
    const outcome = await spawner.collectResult({ childIssueId: 'child-1' });
    assert.equal(outcome.signal, 'failed', `status ${status} should map to failed`);
  }
});

test('requireResult throws ChildNotResolvedError instead of returning a guessed signal', async () => {
  const fetchImpl = mockFetch({
    'GET /api/issues/child-1': { status: 200, body: { id: 'child-1', status: 'in_progress' } },
  });
  const spawner = createPaperclipSpawner({
    apiBase: 'https://paperclip.test', apiKey: 'k', parentIssueId: 'p', parentDepth: 0, maxDepth: 3, fetchImpl,
  });
  await assert.rejects(() => spawner.requireResult({ childIssueId: 'child-1' }), ChildNotResolvedError);
});

test('fetchIssueTokenUsage sums real usageJson across all runs (retries included) and flags pending runs', async () => {
  const fetchImpl = mockFetch({
    'GET /api/issues/issue-1/runs': {
      status: 200,
      body: [
        { status: 'timed_out', finishedAt: '2026-08-19T00:00:00Z', usageJson: null }, // failed attempt, no usage reported
        { status: 'succeeded', finishedAt: '2026-08-19T00:10:00Z', usageJson: { input_tokens: 500, output_tokens: 50 } }, // snake_case adapter shape
        { status: 'running', finishedAt: null, usageJson: null }, // still in flight
      ],
    },
  });
  const usage = await fetchIssueTokenUsage({ apiBase: 'https://paperclip.test', apiKey: 'k', issueId: 'issue-1', fetchImpl });
  assert.equal(usage.inputTokens, 500);
  assert.equal(usage.outputTokens, 50);
  assert.equal(usage.totalTokens, 550);
  assert.equal(usage.runCount, 3);
  assert.equal(usage.pendingRunCount, 1, 'only the still-running run (finishedAt: null) counts as pending');
});

test('fetchOwnTokenUsage reconciles the spawner\'s own parentIssueId against real usage', async () => {
  const fetchImpl = mockFetch({
    'GET /api/issues/parent-1/runs': {
      status: 200,
      body: [{ status: 'succeeded', finishedAt: '2026-08-19T00:00:00Z', usageJson: { inputTokens: 300, outputTokens: 25 } }],
    },
  });
  const spawner = createPaperclipSpawner({
    apiBase: 'https://paperclip.test', apiKey: 'k', parentIssueId: 'parent-1', parentDepth: 0, maxDepth: 3, fetchImpl,
  });
  const usage = await spawner.fetchOwnTokenUsage();
  assert.equal(usage.totalTokens, 325);
});

let passed = 0;
for (const { name, fn } of results) {
  try {
    await fn();
    console.log(`ok   - ${name}`);
    passed += 1;
  } catch (err) {
    console.log(`FAIL - ${name}`);
    console.error(err);
  }
}
console.log(`${passed}/${results.length} passed`);
if (passed !== results.length) process.exit(1);
