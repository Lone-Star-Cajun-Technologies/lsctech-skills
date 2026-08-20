---
name: harness-state
description: Persistent, typed harness state (prompt/memory/skill/subagent items, local vs. global scope) for knowledge that must survive across tasks or sessions. Not for transient scratch data, and never inside a Polaris-governed repository.
version: 0.1.0
tags: [state, memory, prime-derived]
---

# Harness State

**Status: stub.** The underlying capability (`capabilities/harness_state/`)
is not yet implemented — this SKILL.md documents when an agent should
reach for it once it lands (LON-101 Epic 9). This file is instruction
surface only; it does not implement control flow itself.

## When to invoke

Knowledge must survive across tasks or sessions: reusable procedures,
corrections, or durable observations.

## Do NOT invoke when

- The data is transient scratch state for the current task.
- **You are working inside a Polaris-governed repository.** Polaris's
  Repository Memory Doctrine deliberately stores memory in repository
  artifacts, not model memory — do not introduce a competing state
  ledger there.

## What it provides once implemented

- Four typed item kinds: prompt, memory, skill, subagent.
- Local vs. global scope.
- Evidence-gated refine (proposal generation + review gate; see
  `continual-refinement`), append-only history, and rollback.

## Relationship to governance

Subordinate to Paperclip, the Wiki, and repository rules. Never a
substitute for any of them.
