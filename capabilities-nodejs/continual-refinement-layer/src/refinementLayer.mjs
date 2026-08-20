import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { reviewProposal } from './review.mjs';

/**
 * Sits on top of a `HarnessStateStore` (LON-68) and adds the two things a
 * single-item CRUD ledger doesn't give you:
 *
 *  1. A review gate in front of `store.refine` — a proposal is only applied
 *     if it passes `reviewProposal` (evidence quality, small-edit size cap,
 *     global-scope reviewer requirement). A rejected proposal never
 *     touches the store.
 *  2. Multi-item snapshot/restore — `store.rollback` only ever restores one
 *     item to one prior revision. A snapshot here is a named, durable
 *     group of {itemId, revision} pairs across many items, so a batch of
 *     related refinements can be undone together.
 */
export class ContinualRefinementLayer {
  constructor({ store, snapshotDir, reviewOptions } = {}) {
    if (!store) throw new Error('store (a HarnessStateStore instance) is required');
    this.store = store;
    this.snapshotDir = snapshotDir ?? path.join(store.rootDir, 'snapshots');
    this.reviewOptions = reviewOptions ?? {};
  }

  /**
   * Review a proposed edit against the item's current body and, if
   * approved, commit it via `store.refine`. Returns
   * `{ applied: false, reasons }` on rejection (no store write) or
   * `{ applied: true, item }` on success.
   */
  async reviewAndApply({ itemId, body, evidence, rationale, actor, reviewer, forceApprove = false }) {
    const current = await this.store.get(itemId);
    const { approved, reasons } = reviewProposal(
      { currentBody: current.body, proposedBody: body, evidence, scope: current.scope, actor, reviewer, forceApprove },
      this.reviewOptions,
    );
    if (!approved) return { applied: false, reasons };
    const item = await this.store.refine(itemId, { body, evidence, actor, note: rationale });
    return { applied: true, item };
  }

  /** Review a proposed rollback the same way a forward edit is reviewed (evidence required, no size cap since the target body already existed). */
  async reviewAndRollback({ itemId, toRevision, evidence, actor, reviewer, forceApprove = false }) {
    const current = await this.store.get(itemId);
    const target = current.history.find((h) => h.revision === toRevision);
    if (!target) throw new Error(`no revision ${toRevision} for item ${itemId}`);
    const { approved, reasons } = reviewProposal(
      { currentBody: current.body, proposedBody: target.body, evidence, scope: current.scope, actor, reviewer, forceApprove },
      { ...this.reviewOptions, maxChangedLines: Infinity, maxChangeRatio: Infinity },
    );
    if (!approved) return { applied: false, reasons };
    const item = await this.store.rollback(itemId, toRevision, { evidence, actor });
    return { applied: true, item };
  }

  async _writeSnapshot(record) {
    await mkdir(this.snapshotDir, { recursive: true });
    await writeFile(path.join(this.snapshotDir, `${record.id}.json`), JSON.stringify(record, null, 2));
  }

  /**
   * Capture {itemId, revision} for every item matching the filter, as one
   * named, restorable group.
   */
  async snapshot({ scope, taskId, type, actor, note } = {}) {
    const items = await this.store.list({ scope, taskId, type });
    const record = {
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      actor: actor ?? null,
      note: note ?? null,
      filter: { scope: scope ?? null, taskId: taskId === undefined ? null : taskId, type: type ?? null },
      items: items.map((i) => ({ id: i.id, revision: i.currentRevision, type: i.type, scope: i.scope, taskId: i.taskId })),
    };
    await this._writeSnapshot(record);
    return record;
  }

  async getSnapshot(snapshotId) {
    const raw = await readFile(path.join(this.snapshotDir, `${snapshotId}.json`), 'utf8');
    return JSON.parse(raw);
  }

  /**
   * Restore every item captured in a snapshot back to its recorded
   * revision. Each restore is a `store.rollback` call (append-only —
   * history is never truncated), so "what happened" stays reconstructable
   * even after a group rollback.
   */
  async restoreSnapshot(snapshotId, { evidence, actor } = {}) {
    const record = await this.getSnapshot(snapshotId);
    const restored = [];
    for (const entry of record.items) {
      const item = await this.store.rollback(entry.id, entry.revision, {
        evidence,
        actor,
        note: `restore snapshot ${snapshotId}`,
      });
      restored.push({ id: entry.id, currentRevision: item.currentRevision });
    }
    return { snapshotId, restored };
  }
}
