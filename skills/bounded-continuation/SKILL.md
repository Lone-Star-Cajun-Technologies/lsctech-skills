---
name: bounded-continuation
description: Sequential, bounded step-by-step execution where each step advances state without spawning children. Use when work is long but linear; use recursive-execution instead when the work genuinely needs to fan out.
version: 0.1.0
tags: [execution, continuation, prime-derived]
---

# Bounded Continuation

**Status: stub.** The underlying mechanics live in
`capabilities/recursive_execution/` and `capabilities/harness_state/`
(state persistence + resumability), neither of which is yet implemented —
this SKILL.md documents when an agent should reach for this pattern once
they land (LON-101 Epic 8/9). This file is instruction surface only; it
does not implement control flow itself.

## When to invoke

Work is long but sequential — each step advances state without spawning
children.

## Do NOT invoke when

Depth is actually needed. Use `recursive-execution` instead of forcing a
fan-out objective into a linear shape.

## What it provides once implemented

- Chain state persistence and resumability (resume at the last completed
  step rather than re-running from the start).
- The same mandatory budget and no-progress-detection requirements as
  `recursive-execution` (§4.3): every loop needs a budget, no loop is
  exempt from stagnation detection.

## Relationship to governance

Subordinate to Paperclip, the Wiki, and repository rules, same as every
other capability in this repository.
