import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { assertValidItemInput, assertEvidence } from './schema.mjs';

/**
 * File-backed CRUD store for the harness state ledger.
 *
 * Layout on disk (rooted at `rootDir`):
 *   global/<type>/<id>.json        — organization-wide items, visible to
 *                                     every task, forever.
 *   tasks/<taskId>/<type>/<id>.json — items scoped to one task; still
 *                                     durable across runs of that task, but
 *                                     not visible to other tasks.
 *   index.json                      — id -> {type, scope, taskId} routing
 *                                     table, so callers can get/refine/
 *                                     rollback/delete by id alone without
 *                                     knowing where the item lives.
 *
 * Every item after creation carries an append-only `history[]` of
 * {revision, action, body, evidence, actor, note, timestamp}. `refine` and
 * `rollback` both require `evidence` (see schema.mjs) and both append
 * rather than overwrite, so the full provenance of the current body is
 * always reconstructable.
 */
export class HarnessStateStore {
  constructor({ rootDir }) {
    if (!rootDir) throw new Error('rootDir is required');
    this.rootDir = rootDir;
    this.indexPath = path.join(rootDir, 'index.json');
  }

  async _readIndex() {
    try {
      const raw = await readFile(this.indexPath, 'utf8');
      return JSON.parse(raw);
    } catch (err) {
      if (err.code === 'ENOENT') return {};
      throw err;
    }
  }

  async _writeIndex(index) {
    await mkdir(this.rootDir, { recursive: true });
    await writeFile(this.indexPath, JSON.stringify(index, null, 2));
  }

  _itemDir(scope, type, taskId) {
    return scope === 'global'
      ? path.join(this.rootDir, 'global', type)
      : path.join(this.rootDir, 'tasks', taskId, type);
  }

  _itemPath(entry) {
    return path.join(this._itemDir(entry.scope, entry.type, entry.taskId), `${entry.id}.json`);
  }

  async _readItem(id) {
    const index = await this._readIndex();
    const entry = index[id];
    if (!entry) throw new Error(`no item with id ${id}`);
    const raw = await readFile(this._itemPath(entry), 'utf8');
    return { item: JSON.parse(raw), entry, index };
  }

  async _writeItem(item, entry) {
    const dir = this._itemDir(entry.scope, entry.type, entry.taskId);
    await mkdir(dir, { recursive: true });
    await writeFile(this._itemPath(entry), JSON.stringify(item, null, 2));
  }

  /** Create a new item at revision 0. Returns the stored item. */
  async create({ type, scope, taskId = null, title, body, actor, note }) {
    assertValidItemInput({ type, scope, taskId, title, body });
    const id = randomUUID();
    const now = new Date().toISOString();
    const item = {
      id,
      type,
      scope,
      taskId: scope === 'local' ? taskId : null,
      title,
      body,
      currentRevision: 0,
      createdAt: now,
      updatedAt: now,
      history: [{ revision: 0, action: 'create', body, evidence: null, actor: actor ?? null, note: note ?? null, timestamp: now }],
    };
    const entry = { id, type, scope, taskId: item.taskId };
    await this._writeItem(item, entry);
    const index = await this._readIndex();
    index[id] = entry;
    await this._writeIndex(index);
    return item;
  }

  /** Retrieve an item by id, regardless of which scope/task it lives under. */
  async get(id) {
    const { item } = await this._readItem(id);
    return item;
  }

  /** List items, optionally filtered by scope, taskId, and/or type. */
  async list({ scope, taskId, type } = {}) {
    const index = await this._readIndex();
    const entries = Object.values(index).filter((entry) => {
      if (scope && entry.scope !== scope) return false;
      if (taskId !== undefined && entry.taskId !== taskId) return false;
      if (type && entry.type !== type) return false;
      return true;
    });
    const items = await Promise.all(entries.map((entry) => readFile(this._itemPath(entry), 'utf8').then(JSON.parse)));
    return items.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  /**
   * Propose and apply an evidence-backed edit. Appends a `refine` history
   * entry and updates the current body; never mutates prior history entries.
   */
  async refine(id, { body, evidence, actor, note }) {
    assertEvidence(evidence);
    if (typeof body !== 'string') throw new Error('body must be a string');
    const { item, entry } = await this._readItem(id);
    const now = new Date().toISOString();
    const revision = item.currentRevision + 1;
    item.history.push({ revision, action: 'refine', body, evidence, actor: actor ?? null, note: note ?? null, timestamp: now });
    item.body = body;
    item.currentRevision = revision;
    item.updatedAt = now;
    await this._writeItem(item, entry);
    return item;
  }

  /**
   * Restore the body from an earlier revision. This does not truncate
   * history — it appends a new `rollback` entry whose body matches the
   * target revision, so "what happened" stays a straight-line log even
   * when the ledger's state moves backward.
   */
  async rollback(id, toRevision, { evidence, actor, note }) {
    assertEvidence(evidence);
    const { item, entry } = await this._readItem(id);
    const target = item.history.find((h) => h.revision === toRevision);
    if (!target) throw new Error(`no revision ${toRevision} for item ${id}`);
    const now = new Date().toISOString();
    const revision = item.currentRevision + 1;
    item.history.push({
      revision,
      action: 'rollback',
      body: target.body,
      evidence,
      actor: actor ?? null,
      note: note ?? `rollback to revision ${toRevision}`,
      timestamp: now,
    });
    item.body = target.body;
    item.currentRevision = revision;
    item.updatedAt = now;
    await this._writeItem(item, entry);
    return item;
  }

  /** Delete an item entirely (not a history-preserving operation). */
  async delete(id) {
    const { entry, index } = await this._readItem(id);
    await rm(this._itemPath(entry), { force: true });
    delete index[id];
    await this._writeIndex(index);
  }
}
