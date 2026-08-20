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
