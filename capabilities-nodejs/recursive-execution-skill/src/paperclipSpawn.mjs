// Paperclip task-lifecycle integration for the recursive execution core
// (LON-67's scope beyond LON-62's harness-agnostic loop: "Integrate with
// Paperclip task lifecycle -- child work attributed to parent task").
//
// Real Paperclip child issues are asynchronous across wakes: a spawn call
// returns immediately, and the *platform* (via `blockParentUntilDone`)
// pauses/wakes the parent run when the child resolves -- there is no
// same-process blocking wait, and this module deliberately does not poll
// (per LSCTech doctrine: use child issues for delegated work instead of
// polling agents/sessions/processes). That makes this a two-phase,
// resumable pattern, not a synchronous spawnChild(...) call:
//
// Verified live against the real API (POST /api/issues/{id}/children):
// `requestDepth` and the implicit parentId attribute the child correctly,
// and confirmed `executionPolicy.monitor` is board-user-only ("Only the
// assignee agent or a board user can manage issue monitors", 403 for an
// agent caller) -- so timeouts here are expressed via the `watchdog` field
// instead, with the spawning agent as its own child's watchdog. That's the
// agent-accessible primitive; it worked in the same live check.
//
//   1. spawn(taskSpec)      -- this wake: create the child, return a handle.
//   2. collectResult(handle) -- a later wake (after the platform resumes
//                                this issue): read the terminal signal and
//                                delivered message, then act on it.
//
// `runRecursiveLoop` (./recursiveLoop.mjs) still owns the synchronous,
// same-tick loop shape for harness-agnostic/mock children; this module is
// for when a "child" is a real Paperclip agent run.

export class ChildNotResolvedError extends Error {
  constructor(handle) {
    super(`child issue ${handle.identifier ?? handle.childIssueId} has not reached a terminal status yet`);
    this.name = 'ChildNotResolvedError';
    this.handle = handle;
  }
}

// Paperclip issue status -> explicit success/failure signal. Non-terminal
// statuses map to `null` ("still running"), never to a guessed pass/fail.
const STATUS_TO_SIGNAL = Object.freeze({
  done: 'passed',
  blocked: 'failed',
  cancelled: 'failed',
});

async function paperclipRequest(fetchImpl, apiBase, apiKey, path, opts = {}) {
  const res = await fetchImpl(`${apiBase}${path}`, {
    ...opts,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`paperclip ${opts.method ?? 'GET'} ${path} -> ${res.status}: ${body.slice(0, 300)}`);
  }
  return res.status === 204 ? null : res.json();
}

/**
 * Real, authoritative model token consumption for one Paperclip issue --
 * verified live this session against `GET /api/issues/{id}/runs`, which
 * returns every run attempt for that issue with a `usageJson` field
 * (`{inputTokens, outputTokens, ...}`) populated once the run's adapter
 * reports it (null while a run is still in flight). Summing across all runs
 * covers retried/continued issues, not just the latest attempt. This is the
 * actual-usage source `BudgetTracker.reconcileTokens()` is meant to consume
 * -- for a child issue after `collectResult`, or for the calling agent's own
 * issue when it wants to reconcile its own budget against what it has
 * really spent so far.
 *
 * @param {Object} opts
 * @param {string} opts.apiBase
 * @param {string} opts.apiKey
 * @param {string} opts.issueId
 * @param {typeof fetch} [opts.fetchImpl]
 * @returns {Promise<{inputTokens: number, outputTokens: number, totalTokens: number, runCount: number, pendingRunCount: number}>}
 */
export async function fetchIssueTokenUsage({ apiBase, apiKey, issueId, fetchImpl = fetch }) {
  const runsResp = await paperclipRequest(fetchImpl, apiBase, apiKey, `/api/issues/${issueId}/runs`);
  const runs = Array.isArray(runsResp) ? runsResp : (runsResp?.runs ?? []);
  let inputTokens = 0;
  let outputTokens = 0;
  let pendingRunCount = 0;
  for (const run of runs) {
    const usage = run?.usageJson;
    if (!usage) {
      if (run?.finishedAt == null) pendingRunCount += 1;
      continue;
    }
    inputTokens += usage.inputTokens ?? usage.input_tokens ?? 0;
    outputTokens += usage.outputTokens ?? usage.output_tokens ?? 0;
  }
  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    runCount: runs.length,
    pendingRunCount,
  };
}

/**
 * @param {Object} opts
 * @param {string} opts.apiBase e.g. process.env.PAPERCLIP_API_URL, normalized
 * @param {string} opts.apiKey
 * @param {string} opts.parentIssueId the current (parent) issue's id
 * @param {number} opts.parentDepth current recursion depth (parent's requestDepth)
 * @param {number} opts.maxDepth recursion ceiling -- spawn() refuses beyond this
 * @param {string} [opts.spawningAgentId] this agent's id; default watchdog when a budget deadline is set
 * @param {typeof fetch} [opts.fetchImpl]
 */
export function createPaperclipSpawner({
  apiBase,
  apiKey,
  parentIssueId,
  parentDepth,
  maxDepth,
  spawningAgentId = null,
  fetchImpl = fetch,
}) {
  if (!apiBase || !apiKey || !parentIssueId) {
    throw new Error('createPaperclipSpawner requires apiBase, apiKey, and parentIssueId');
  }
  if (!Number.isInteger(maxDepth) || maxDepth < 0) {
    throw new Error('createPaperclipSpawner requires a non-negative integer maxDepth');
  }
  const call = (path, opts) => paperclipRequest(fetchImpl, apiBase, apiKey, path, opts);

  /**
   * spawn(task_spec) -> handle. Non-blocking: creates a real child issue
   * attributed to the parent via `requestDepth` (native Paperclip
   * recursion-depth tracking) and the implicit parentId from the
   * `/children` route. Budget's `maxWallClockMs`, if present, registers
   * the spawning agent as the child's `watchdog` with a timeout deadline
   * in its instructions -- `executionPolicy.monitor` is board-user-only
   * and rejects agent callers with 403, confirmed live. `acceptanceCriteria`
   * carries the explicit success gate onto the platform's own
   * review/verification path.
   *
   * @param {Object} taskSpec
   * @param {string} taskSpec.title
   * @param {string} [taskSpec.description]
   * @param {string} [taskSpec.priority] critical|high|medium|low
   * @param {string} [taskSpec.assigneeAgentId]
   * @param {string[]} [taskSpec.acceptanceCriteria]
   * @param {{maxWallClockMs?: number}} [taskSpec.budget]
   * @param {boolean} [taskSpec.blockParentUntilDone=true]
   * @param {string} [taskSpec.watchdogAgentId] defaults to the spawning agent itself
   * @returns {Promise<{childIssueId: string, identifier: string, depth: number, spawnedAt: string}>}
   */
  async function spawn(taskSpec) {
    if (!taskSpec || !taskSpec.title) {
      throw new Error('spawn: taskSpec.title is required');
    }
    const depth = parentDepth + 1;
    if (depth >= maxDepth) {
      throw new Error(`depth_limit: spawning a child at depth ${depth} would meet/exceed maxDepth ${maxDepth}`);
    }

    const deadline = taskSpec.budget?.maxWallClockMs
      ? new Date(Date.now() + taskSpec.budget.maxWallClockMs).toISOString()
      : null;
    const watchdogAgentId = taskSpec.watchdogAgentId ?? (deadline ? spawningAgentId : null);

    const body = {
      title: taskSpec.title,
      description: taskSpec.description ?? null,
      status: 'todo',
      priority: taskSpec.priority ?? 'medium',
      requestDepth: depth,
      assigneeAgentId: taskSpec.assigneeAgentId ?? null,
      blockParentUntilDone: taskSpec.blockParentUntilDone ?? true,
      ...(taskSpec.acceptanceCriteria ? { acceptanceCriteria: taskSpec.acceptanceCriteria } : {}),
      ...(watchdogAgentId
        ? {
            watchdog: {
              agentId: watchdogAgentId,
              instructions: deadline
                ? `Recursive-execution budget timeout: escalate/resolve if this issue is still open past ${deadline} (maxWallClockMs=${taskSpec.budget.maxWallClockMs}).`
                : 'Recursive-execution child watchdog (no wall-clock deadline set).',
            },
          }
        : {}),
    };

    const created = await call(`/api/issues/${parentIssueId}/children`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
    const child = Array.isArray(created) ? created[0] : (created?.issues?.[0] ?? created?.issue ?? created);
    if (!child?.id) {
      throw new Error(`spawn: unexpected response shape from /children: ${JSON.stringify(created).slice(0, 300)}`);
    }
    return {
      childIssueId: child.id,
      identifier: child.identifier ?? null,
      depth,
      spawnedAt: new Date().toISOString(),
    };
  }

  /**
   * collectResult(handle) -> explicit signal + delivered message, read from
   * the child issue's current status and its most recent non-deleted agent
   * comment (the agent_message analog). Returns `signal: null` if the
   * child has not reached a terminal status -- callers must not guess.
   *
   * Once the child is terminal, also reads back its real token consumption
   * (see `fetchIssueTokenUsage`) as `usage` -- this is what a caller folds
   * into `ChildAgentRegistry.recordUsage()` / `BudgetTracker.consumeTokens()`
   * so the parent's budget reflects what the child actually spent, not an
   * allocated/estimated figure.
   *
   * @param {{childIssueId: string}} handle
   */
  async function collectResult(handle) {
    const issue = await call(`/api/issues/${handle.childIssueId}`);
    const signal = STATUS_TO_SIGNAL[issue.status] ?? null;
    let message = null;
    let usage = null;
    if (signal) {
      const commentsResp = await call(`/api/issues/${handle.childIssueId}/comments`);
      const comments = Array.isArray(commentsResp) ? commentsResp : (commentsResp?.comments ?? []);
      const agentComments = comments.filter((c) => c.authorType === 'agent' && !c.deletedAt);
      message = agentComments.length ? agentComments[agentComments.length - 1].body : null;
      usage = await fetchIssueTokenUsage({ apiBase, apiKey, issueId: handle.childIssueId, fetchImpl });
    }
    return { status: issue.status, signal, message, issue, usage };
  }

  /**
   * requireResult(handle) -- like collectResult, but throws
   * ChildNotResolvedError instead of returning signal:null. Intended for
   * the resume half of the two-phase pattern, where the caller only runs
   * this after being woken because the child is expected to be terminal.
   */
  async function requireResult(handle) {
    const outcome = await collectResult(handle);
    if (!outcome.signal) throw new ChildNotResolvedError({ ...handle, ...outcome });
    return outcome;
  }

  /**
   * fetchOwnTokenUsage() -- real token consumption for the *parent* issue
   * itself (this spawner's `parentIssueId`), so a long-running loop can
   * reconcile its own `BudgetTracker` against what it has actually spent
   * across wakes, the same way it does for children via `collectResult`.
   */
  function fetchOwnTokenUsage() {
    return fetchIssueTokenUsage({ apiBase, apiKey, issueId: parentIssueId, fetchImpl });
  }

  return { spawn, collectResult, requireResult, fetchOwnTokenUsage };
}
