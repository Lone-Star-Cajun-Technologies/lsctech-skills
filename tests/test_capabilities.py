import importlib
import pytest

CAPABILITIES = [
    "capabilities",
    "capabilities.recursive_execution",
    "capabilities.harness_state",
    "capabilities.trajectory",
    "capabilities.tests",
]


@pytest.mark.parametrize("name", CAPABILITIES)
def test_capability_is_importable(name):
    mod = importlib.import_module(name)
    assert hasattr(mod, "__version__")
    assert hasattr(mod, "__description__")
