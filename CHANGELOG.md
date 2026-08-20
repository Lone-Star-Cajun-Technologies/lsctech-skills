# Changelog

All notable changes to this repository are documented here. Format based
on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versions
correspond to `VERSION`.

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
