---
name: harness-state
description: "Reach for this skill when the agent needs to inspect or surface the current harness/session state."
version: 0.1.0
author: LSCTech AI
license: MIT
platforms: [macos, linux]
metadata:
  hermes:
    tags: [capabilities, harness, state]
    related_capabilities: [capabilities.harness_state]
---

# Harness State

Use this skill when an agent needs to be aware of the run-time harness context.

## When to reach for the capability

- You need to report which issue, run, or task is currently active.
- You need to read or write durable session state without inventing a new storage scheme.
- You need to surface state to the user or to another agent.

## What it is not

- This skill does not implement control flow. It does not start, stop, or transition the harness. It only declares when to reach for `capabilities.harness_state`.
