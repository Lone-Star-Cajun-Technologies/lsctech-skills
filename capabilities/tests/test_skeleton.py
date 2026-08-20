"""Skeleton smoke tests (LON-103).

These prove the repo skeleton and CI wiring work end to end. They are
intentionally not the LON-99 acceptance contract — that suite lands with
the real implementation in LON-101 Epic 8 and is expected to go from
skipped to GREEN there, not here.
"""

import importlib


def test_capabilities_package_is_importable():
    importlib.import_module("capabilities")


def test_recursive_execution_stub_is_importable():
    module = importlib.import_module("capabilities.recursive_execution")
    assert module.__all__ == []


def test_harness_state_stub_is_importable():
    module = importlib.import_module("capabilities.harness_state")
    assert module.__all__ == []


def test_trajectory_stub_is_importable():
    module = importlib.import_module("capabilities.trajectory")
    assert module.__all__ == []
