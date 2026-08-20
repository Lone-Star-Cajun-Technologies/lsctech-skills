"""Neutral trajectory schema — the only sanctioned cross-boundary format between Polaris and Evo.

Stub package (LON-103 / LON-101 Epic 7). Real schema lands in LON-101
Epic 13 (Polaris trajectory adapter), consumed as a library by Evo.

Dependency direction is one-way: Polaris (or a Polaris-owned adapter)
projects its heartbeat/CompactReturn/MedicChart state into this schema;
Evo reads only the neutral schema and must never import a Polaris type
(LON-101 §6.2, §7.2 rule 6).
"""

__all__: list[str] = []
