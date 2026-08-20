// Child-agent registry + usage attribution.
//
// Research report §2.1 / §4.1: children are dispatched by an injected
// spawnChild(request) runtime dependency and return only via their result
// (message or file) -- never via shared mutable state. This registry is the
// parent-side bookkeeping of that contract: identity, status, and the usage
// each child folds back into the parent's budget.
let counter = 0;
function nextChildId() {
  counter += 1;
  return `child-${Date.now().toString(36)}-${counter}`;
}

export class ChildAgentRegistry {
  constructor() {
    this._children = new Map();
  }

  register({ name, parentId = null, depth }) {
    const id = nextChildId();
    const record = {
      id,
      name,
      parentId,
      depth,
      status: 'pending', // pending -> running -> succeeded|failed|cancelled
      result: null,
      usage: { tokens: 0, turns: 0 },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this._children.set(id, record);
    return record;
  }

  updateStatus(id, status, result = null) {
    const record = this._children.get(id);
    if (!record) throw new Error(`ChildAgentRegistry: unknown child id ${id}`);
    record.status = status;
    if (result !== null) record.result = result;
    record.updatedAt = Date.now();
    return record;
  }

  recordUsage(id, usage = {}) {
    const record = this._children.get(id);
    if (!record) throw new Error(`ChildAgentRegistry: unknown child id ${id}`);
    record.usage.tokens += usage.tokens ?? 0;
    record.usage.turns += usage.turns ?? 0;
    record.updatedAt = Date.now();
    return record;
  }

  get(id) {
    return this._children.get(id) ?? null;
  }

  list() {
    return [...this._children.values()];
  }

  // Total usage across all children, folded into the parent's ledger --
  // this is what the parent loop feeds into its own BudgetTracker.
  totalUsage() {
    let tokens = 0;
    let turns = 0;
    for (const child of this._children.values()) {
      tokens += child.usage.tokens;
      turns += child.usage.turns;
    }
    return { tokens, turns };
  }

  snapshot() {
    return this.list().map((c) => ({ ...c, usage: { ...c.usage } }));
  }
}
