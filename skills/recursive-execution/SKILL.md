---
name: recursive-execution
description: "Reach for this skill when an agent should decompose a self-similar task into a recursive capability call."
version: 0.1.0
author: LSCTech AI
license: MIT
platforms: [macos, linux]
metadata:
  hermes:
    tags: [capabilities, recursive, execution]
    related_capabilities: [capabilities.recursive_execution]
---

# Recursive Execution

Use this skill when an agent is facing a task that can be split into the same kind of sub-task repeatedly.

## When to reach for the capability

- The current task can be expressed as a smaller instance of itself.
- A parent problem and one or more child problems share the same shape.
- The agent should not hand-roll the recursion; it should invoke the `capabilities.recursive_execution` stub and let the harness apply the real execution policy.

## What it is not

- This skill does not implement control flow. It does not define a loop, recursion depth limit, or termination condition. Those live in the harness.
