# Changelog

All notable changes to this repository are documented here. Format based
on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versions
correspond to `VERSION`.

## [0.4.0] - 2026-08-21

### Changed

- **LON-137 documentation revision:** updated `README.md` and
  `recursive-execution-skill/README.md` to reflect the LON-137
  capability-comparison disposition. The worker-side recursive self-repair
  loop (`polaris-worker-skill`) is explicitly rejected per POL-288. Four
  deterministic primitives are documented as Foreman-layer enhancements:
  continuation counter + wall-clock deadline, heartbeat-delta no-progress
  detection, telemetry compaction, and bounded Foreman re-dispatch policy.
  All are zero-token and role-safe. Token telemetry noted as an explicit
  open item. 38/38 tests passing.

## [0.3.0] - 2026-08-20

### Changed

- **Boundary cleanup (LON-64 PR #1 review):** removed `polaris-worker-skill/`
  from lsctech-skills — it is Polaris-specific integration/policy and
  violates the repo's core invariant. Paperclip adapter
  (`paperclipSpawn.mjs`) moved to
  `recursive-execution-skill/src/adapters/paperclip/` and removed from the
  public API surface. Hermes memory bridge (`memoryBridge.mjs`) moved to
  `harness-state-store/src/integrations/hermes-memory/` and removed from
  the public API surface. CI matrix and READMEs updated to match.
  38/38 tests passing (polaris-worker-skill removed, paperclip+loop split).

## [0.2.0] - 2026-08-20

### Added

- `capabilities-nodejs/` (LON-119): landed the four Prime-derived
  capability modules LON-101 finding F1 reported as lost —
  `recursive-execution-skill`, `harness-state-store`,
  `continual-refinement-layer`, `polaris-worker-skill`. Recovered from an
  un-pushed agent sandbox where they had been built and tested (43/43
  tests passing) but had no durable repository home. JavaScript/Node, not
  Python — see README.md's "Node.js capability implementations" section
  for why, and the open question this raises for Epic 8/9.
- `test-nodejs` CI matrix job running each module's test suite on every
  push/PR.

## [0.1.0] - 2026-08-19

### Added

- Initial repository skeleton (LON-103, LON-101 Epic 7): `capabilities/`
  and `skills/` directory structure per LON-101 §3.3.
- `README.md`, `VERSION`, `CHANGELOG.md`, `LICENSE`.
- Stub packages with package metadata for `capabilities/recursive_execution/`,
  `capabilities/harness_state/`, `capabilities/trajectory/`.
- `capabilities/tests/` with import-wiring smoke tests.
- `skills/recursive-execution/`, `skills/harness-state/`,
  `skills/continual-refinement/`, `skills/bounded-continuation/` —
  `SKILL.md` instruction surfaces.
- CI (`pytest` + import guard forbidding `capabilities/` from importing
  `polaris` or `evo`, per LON-101 §7.2).
