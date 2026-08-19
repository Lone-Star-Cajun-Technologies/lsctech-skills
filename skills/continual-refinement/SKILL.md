---
name: continual-refinement
description: "Reach for this skill when an artifact should be improved iteratively with feedback."
version: 0.1.0
author: LSCTech AI
license: MIT
platforms: [macos, linux]
metadata:
  hermes:
    tags: [capabilities, refinement, trajectory]
    related_capabilities: [capabilities.trajectory]
---

# Continual Refinement

Use this skill when an existing draft or artifact is close but needs another pass.

## When to reach for the capability

- A document, plan, or code snippet has been produced and now needs targeted improvement.
- The improvement can be guided by a clear delta or review comment.
- The agent should record the trajectory of changes in `capabilities.trajectory` before applying the next refinement.

## What it is not

- This skill does not implement the refinement loop or approval gate. It only tells the agent when to reach for the `capabilities.trajectory` stub.
