# lsctech-skills

Capability library and skill index for LSCTech agent workflows.

## What this is

- A minimal, versioned collection of **capabilities**: importable Python stub packages that declare what an agent system can do.
- A set of **skills**: Hermes-compatible `SKILL.md` files that tell an agent _when to reach for_ a capability.
- A CI import guard that blocks any `polaris` or `evo` imports from landing under `capabilities/`.

## What this is not

- This is **not** a product, task tracker, or workflow engine.
- This does **not** contain packets, task chains, acceptance-criteria enforcement, or QC role logic.
- This does **not** implement control flow inside skill files.

## Layout

- `capabilities/` — importable stub packages for `recursive_execution`, `harness_state`, `trajectory`, and `tests`.
- `skills/` — `SKILL.md` files for `recursive-execution`, `harness-state`, `continual-refinement`, and `bounded-continuation`.
- `tests/` — `pytest` suite including the import-guard and package import tests.

## Version

See `VERSION` and `CHANGELOG.md`.
