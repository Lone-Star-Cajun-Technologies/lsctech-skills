---
name: continual-refinement
description: Evidence-gated proposal + review loop for improving a repeated procedure that demonstrably underperforms. Not for acting on a hunch, and not for rewriting doctrine — it proposes, management approves.
version: 0.1.0
tags: [refinement, review-gate, prime-derived]
---

# Continual Refinement

**Status: stub.** Depends on `capabilities/harness_state/` (evidence-gated
refine gate), which is not yet implemented — this SKILL.md documents when
an agent should reach for this pattern once it lands (LON-101 Epic 9).
This file is instruction surface only; it does not implement control flow
itself.

## When to invoke

A repeated procedure demonstrably underperforms and there is concrete
evidence pointing at a specific edit.

## Do NOT invoke when

- Acting on a hunch with no evidence.
- Rewriting doctrine — that requires management approval, not a
  self-directed edit.

## What it provides once implemented

- Small-edit cap on any single proposal.
- Reviewer-is-not-actor separation.
- Evidence floor before a proposal is even generated.
- Append-only history and rollback (via `harness-state`).

## Relationship to governance

The Coach (or equivalent) proposes; management approves. This capability
never grants an agent authority to unilaterally change a procedure that
Paperclip, the Wiki, or a repository already governs.
