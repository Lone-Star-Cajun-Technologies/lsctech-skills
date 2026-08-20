# Harness State Store

LON-68 (Epic 2 of LON-61, per LON-60 architecture report §4.1 / §6) and its
duplicate-track sibling LON-63 ("Harness-Agnostic Continual Refinement
Layer") — both scope the same deliverable: a durable, scoped, reviewable
ledger for organizational memory. Built once here, against both issues'
acceptance criteria: a second implementation on top of the same primitives
would just duplicate it. Flagged on LON-75 (open reconciliation issue) for
Cove to confirm.

## Interface

**Item kinds** (`ITEM_TYPES`, `src/schema.mjs`): `prompt_note`, `memory`,
`skill_description`, `subagent_spec` — the four kinds named in both
issues' scope lines.

**Scope** (`SCOPES`): `local` (task-scoped — requires a `taskId`, visible
only within that task) or `global` (organization-wide — persists across
every task, no `taskId`). Enforced at `create` time; the two are mutually
exclusive by construction, not by convention.

**`HarnessStateStore`** (`src/store.mjs`) — file-backed CRUD store:
- `create({ type, scope, taskId?, title, body, actor?, note? })` — new item
  at revision 0.
- `get(id)` — retrieve regardless of scope/task, by id alone.
- `list({ scope?, taskId?, type? })` — filtered listing.
- `refine(id, { body, evidence, actor?, note? })` — evidence-backed edit;
  **throws if `evidence` is missing or blank**. Appends a `refine` history
  entry and advances `currentRevision`; never overwrites prior history.
- `rollback(id, toRevision, { evidence, actor?, note? })` — restores an
  earlier revision's body. Also requires `evidence` (why you're reverting)
  and also appends rather than truncates, so the ledger's history stays a
  straight-line audit log even when its current state moves backward.
- `delete(id)` — hard delete (not history-preserving; distinct from
  rollback).

**Outputs** — every mutation returns the full item: `{id, type, scope,
taskId, title, body, currentRevision, createdAt, updatedAt, history[]}`,
where each `history[]` entry is `{revision, action, body, evidence, actor,
note, timestamp}`.

**Storage** (`rootDir`, caller-supplied) —
```text
global/<type>/<id>.json          organization-wide items
tasks/<taskId>/<type>/<id>.json  task-scoped items
index.json                       id -> {type, scope, taskId} routing table
```
Plain JSON files, no database — consistent with this sandbox having no
provisioned repo/DB for this initiative yet (see Known gap).

## Integration points (`src/integrations/hermes-memory/memoryBridge.mjs`)

- `exportGlobalMemoryToFile(item, memoryDir)` — projects a global
  `memory`-type ledger item into this agent's existing frontmatter-memory
  convention (a `<slug>.md` file plus a `MEMORY.md` index line, per
  AGENTS.md). Idempotent on the index line across repeated exports of the
  same item (e.g. after a `refine`). This is the "integration with
  existing memory tool" scope line: the ledger is authoritative and keeps
  history; the exported file is what an agent actually reads at wake time.
- `wikiReference(wikiPath, { hook, scope?, taskId? })` — builds a
  `prompt_note` payload that *cites* an SOP wiki doc rather than copying
  it, matching AGENTS.md's "LSCTech-Wiki is authoritative for operating
  doctrine." Pass the result straight to `store.create`.

## Layout

- `src/schema.mjs` — item-kind/scope constants and the shared validators
  used by every mutation path (`create`, `refine`, `rollback`).
- `src/store.mjs` — `HarnessStateStore` (CRUD + refine + rollback).
- `src/integrations/hermes-memory/memoryBridge.mjs` — the two integration
  touchpoints above.
- `test/runStoreTests.mjs` — 12 tests, run with `node
  test/runStoreTests.mjs`. Covers both issues' literal acceptance
  criteria directly: "create in task A, retrieve in task B, refine with
  evidence" is its own named test, and "rollback restores prior state" is
  verified against the full history array, not just the current body.

## Known gap

Same as `recursive-execution-skill`: this lives in the agent workspace,
not a company repository — no Polaris/Evo (or other) project/repo record
exists in Paperclip yet for this initiative, and this sandbox has no
`git`. Ready to move into a repo verbatim once one is designated.
