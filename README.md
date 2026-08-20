# lsctech-skills

Shared, version-controlled home for LSCTech's reusable agent capabilities
and their agent-facing instruction surfaces.

Created under [LON-103](../../issues/LON-103) (LON-101 Epic 7) per gate
decision D1, approved by Phil 2026-08-19. Full architecture and rationale:
LON-101 issue document `lon101-architecture-proposal`, §3.

## What this is

- **`capabilities/`** — importable, unit-tested Python libraries. Pure
  functions and classes with host-supplied callbacks; no framework, no
  network calls, no ambient state.
- **`skills/`** — thin `SKILL.md` instruction surfaces. Each one tells an
  agent *when* to reach for a capability. They do not implement control
  flow themselves — the logic lives in `capabilities/`.

Two layers, deliberately: expressing capability interdependence as library
imports keeps this an ordinary software library. Expressing it as
skill-to-skill invocation would build a second orchestration system, which
is explicitly out of scope (see below).

Distribution is native to the Hermes skill loader: add this repo's path to
`skills.external_dirs` in `config.yaml` and `skills/` is discovered
directly (no packaging system, no registry — `git pull` is the deploy).
Paperclip-hosted agents reference the relevant capability from their own
`AGENTS.md` instead of reading `SKILL.md` — see LON-101 §3.5. Polaris
vendors/pins specific capabilities into `.polaris/` for determinism
(LON-101 §5.4) rather than depending on this repo live. Evo/Alice imports
`capabilities/` directly as a library.

## What this is NOT

- **Not a product**, not an orchestration system, not a runtime.
- **Does not govern work.** Paperclip is the system of record for
  organizational work state.
- **Does not supply doctrine.** The LSCTech Wiki is authoritative for
  operating doctrine and SOPs.
- **Does not govern repositories.** Each repository's own rules
  (`AGENTS.md`/`CLAUDE.md`/`.hermes.md`, or `POLARIS_RULES.md` where
  Polaris-governed) take precedence over anything here.
- **Not a second Polaris.** No implementation packets, no task chains, no
  acceptance-criteria enforcement, no QC roles. Polaris remains LSCTech's
  deterministic, repeatable software-development execution system and
  owns all of those concepts.

See LON-101 §3.6 for the full non-goals list and §7.2 for the dependency
rules this repo must respect (`capabilities/` depends on nothing in
LSCTech; nothing here may import Polaris or Evo — enforced in CI).

## Structure

```
lsctech-skills/
  README.md
  VERSION                       # repo-level release marker (semver)
  CHANGELOG.md
  LICENSE
  pyproject.toml
  capabilities/
    recursive_execution/        # budget ledger, child registry, no-progress, compaction
    harness_state/              # typed item store, evidence-gated refine, rollback
    trajectory/                 # neutral trajectory schema (Polaris/Evo boundary)
    tests/                      # the real regression suite
  skills/
    recursive-execution/SKILL.md
    harness-state/SKILL.md
    continual-refinement/SKILL.md
    bounded-continuation/SKILL.md
```


## Node.js capability implementations (`capabilities-nodejs/`, landed LON-119)

The three Prime-derived modules LON-101 finding F1 reported as lost
(`recursive-execution-skill`, `harness-state-store`,
`continual-refinement-layer`) were not lost — they were stranded in an
un-pushed agent sandbox. LON-119 recovered and landed them here as-is.

Note: `polaris-worker-skill` was initially landed in this repo during
LON-119 as well, but was removed in the LON-64 cleanup. It is
Polaris-specific integration/policy — not generic — and violates the
lsctech-skills core invariant.

They are **JavaScript/Node (`.mjs`, zero external dependencies)**, not
Python, and live in `capabilities-nodejs/` rather than inside the
`capabilities/` package above. This is a deliberate divergence, not an
oversight: `capabilities/` was scaffolded in LON-103 assuming a *future*
Python reimplementation under Epic 8/9 (pytest-only CI gate, `__all__ == []`
stub tests). These modules are already implemented and independently
tested (43/43 tests passing across all four at landing time). LON-101 §8
requires preserving existing tested implementations rather than rewriting
them without a concrete reason — porting working, tested code to Python
solely to fit the stub layout would be exactly that.

**Open question for Epic 8/9 (Cove/Phil to resolve, not decided here):**
should this Node.js code become the canonical Epic 8/9 implementation
(retiring the Python stub plan and updating `pyproject.toml`/CI framing
accordingly), or should the Python `capabilities/` stubs still get their
own real implementation alongside this one? See the LON-119 issue thread.

Modules landed, each with its own `README.md`/`src/`/`test/`:

- `capabilities-nodejs/recursive-execution-skill/` — bounded
  spawn → child → result → parent-continuation loop: budget tracking, depth
  ceiling, no-progress detection, compaction. Paperclip integration adapter
  at `src/adapters/paperclip/paperclipSpawn.mjs`. 17/17 tests passing.
- `capabilities-nodejs/harness-state-store/` — typed, scoped
  (local/global), evidence-gated memory ledger with append-only history and
  rollback. Hermes memory integration at
  `src/integrations/hermes-memory/memoryBridge.mjs`. 12/12 tests passing.
- `capabilities-nodejs/continual-refinement-layer/` — evidence-gated
  proposal + review gate, plus multi-item snapshot/restore, built on top of
  `harness-state-store`. 9/9 tests passing.

CI runs every module's test suite on each push/PR via the `test-nodejs`
matrix job in `.github/workflows/ci.yml`.

As of this revision, every `capabilities/*` module is a stub (package
metadata + docstring only, no behavior). Real implementations land under
Epic 8 (recursive execution) and Epic 9 (harness state) — see LON-101 §10.

## Versioning

`VERSION` + `CHANGELOG.md` are the unit of release; per-skill
`version:` frontmatter may also be present but the repo tag is
authoritative. Consumers pin by git tag/commit, not by tracking `main`.
Every change must keep `capabilities/tests/` green — CI is the gate.

## Ownership

Per LON-101 §9.1 (Open choice, recommended Option B): River / Engineering
owns the capability implementations in this repo. Cove / Architecture
owns the skill surfaces and cross-agent rollout.

## CI

CI runs on every push/PR:

1. `pytest` over `capabilities/tests/`.
2. An import guard: `capabilities/` must not import `polaris` or `evo`
   (LON-101 §7.2 forbidden edges). This is a hard architectural
   constraint, not a style preference — see `.github/workflows/ci.yml`.
