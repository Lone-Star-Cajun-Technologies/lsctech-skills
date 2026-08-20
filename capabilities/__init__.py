"""LSCTech shared capability library.

Importable, unit-tested code only — no control flow belongs here that
should instead live in a ``skills/*/SKILL.md`` instruction surface, and
this package must depend on nothing else in LSCTech (LON-101 §7.2:
``capabilities`` depends on nothing). In particular, nothing under this
package may import Polaris or Evo; CI enforces this.
"""
