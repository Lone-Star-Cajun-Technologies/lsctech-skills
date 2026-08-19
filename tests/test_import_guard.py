from pathlib import Path
import re

import pytest

ROOT = Path(__file__).resolve().parent.parent
CAPABILITIES = ROOT / "capabilities"
FORBIDDEN = re.compile(r"^\s*(?:from|import)\s+(?:polaris|evo)\b", re.MULTILINE)


def _py_files():
    return list(CAPABILITIES.rglob("*.py"))


def test_capabilities_python_files_exist():
    assert _py_files(), "No Python files found under capabilities/"


def test_no_polaris_or_evo_imports():
    failures = []
    for path in _py_files():
        text = path.read_text(encoding="utf-8")
        for lineno, line in enumerate(text.splitlines(), start=1):
            if FORBIDDEN.search(line):
                failures.append(f"{path}:{lineno}: {line.strip()}")
    assert not failures, "Forbidden polaris/evo imports found:\n" + "\n".join(failures)


def test_evolution_theory_not_flagged():
    sample = "import evolution_theory"
    assert FORBIDDEN.search(sample) is None
