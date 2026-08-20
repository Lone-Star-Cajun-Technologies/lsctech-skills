---
name: recursive-execution
description: Bounded spawn-child-continue execution for objectives that genuinely decompose into independently completable sub-objectives whose results feed the parent. Use when a single delegation would not do; never invoke "just in case".
version: 0.1.0
tags: [execution, recursion, prime-derived]
---

# Recursive Execution

**Status: stub.** The underlying capability (`capabilities/recursive_execution/`)
is not yet implemented — this SKILL.md documents when an agent should
reach for it once it lands (LON-101 Epic 8). This file is instruction
surface only; it does not implement control flow itself, per the
two-layer split described in the repository README.

## When to invoke

The objective genuinely exceeds one turn **and** decomposes into
independently completable sub-objectives whose results feed the parent
(e.g. multi-source research fan-out).

## Do NOT invoke when

- The work is linear, or a single delegation would do.
- You are reaching for it "just in case" — that is exactly the
  over-engineering this pattern exists to avoid.

## Hard requirements when this capability is used

- **Termination**: declare stop conditions up front. "Continue until
  successful" is not a stop condition.
- **Budget**: tokens, turns, wall-clock, and continuations — all
  required and positive at construction. No loop without a budget.
- **Depth**: a hard ceiling, inherited by children, never re-expanded.
- **No-progress detection**: always paired with the loop.
- **Escalation**: budget exhaustion or stagnation escalates to the
  managing agent/human and is recorded in Paperclip. Silent give-up is a
  defect.
- **No shared mutable state**: children return results by message or
  file only.

## Relationship to governance

This capability improves *how* an agent executes; it never overrides a
Paperclip assignment, an SOP, or a repository rule. If this pattern's
suggested procedure conflicts with governing instructions, the governing
instruction wins and the conflict is reported.
