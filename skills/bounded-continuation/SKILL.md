---
name: bounded-continuation
description: "Reach for this skill when continuing an operation that must stay within defined bounds."
version: 0.1.0
author: LSCTech AI
license: MIT
platforms: [macos, linux]
metadata:
  hermes:
    tags: [capabilities, continuation, tests]
    related_capabilities: [capabilities.tests]
---

# Bounded Continuation

Use this skill when the agent should continue a process while ensuring it stays inside explicit limits.

## When to reach for the capability

- A long-running or multi-step activity needs a continuation point.
- You need to confirm that the next step still satisfies a budget, scope, or safety bound.
- The agent should reach for `capabilities.tests` to assert the bound before continuing.

## What it is not

- This skill does not implement the continuation logic or the bound check. It only declares when to reach for the `capabilities.tests` stub.
