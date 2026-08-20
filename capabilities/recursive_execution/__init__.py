"""Bounded recursive execution: spawn -> child -> result -> parent continuation.

Stub package (LON-103 / LON-101 Epic 7). Real implementation —
``recursiveLoop``, ``budgetTracker``, ``childRegistry``,
``noProgressDetector``, ``compaction`` — lands in LON-101 Epic 8,
reconstructed against the LON-99 acceptance contract.

Hard safety requirements this module must satisfy once implemented
(LON-101 §4.3): explicit termination conditions, a mandatory budget
(tokens/turns/wall-clock/continuations), a hard depth ceiling, escalation
on exhaustion/stagnation instead of silent give-up, and per-iteration
auditability. No shared mutable state between parent and children.
"""

__all__: list[str] = []
