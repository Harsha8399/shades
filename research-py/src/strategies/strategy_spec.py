"""
Loader for the canonical strategy specification.

The specification lives in ``shared/fixtures/strategy_spec.json`` and is the
single source of truth for every strategy parameter. This module exposes it
read-only; it does NOT become a second copy of the values.

Usage:
    from ..strategies.strategy_spec import get_spec, param

    spec = get_spec()
    spec.value('MIN_CONFLUENCE_FACTORS')   # -> 2
    spec.provenance('MIN_CONFLUENCE_FACTORS')  # -> 'book'
"""
import json
from pathlib import Path
from typing import Any, Dict, List, Optional

# shared/fixtures/strategy_spec.json
REPO_ROOT = Path(__file__).resolve().parent.parent.parent.parent
SPEC_PATH = REPO_ROOT / 'shared' / 'fixtures' / 'strategy_spec.json'

VALID_PROVENANCE = ('book', 'inferred', 'invented')


class StrategySpecError(ValueError):
    """Raised when the specification is missing, malformed or inconsistent."""
    pass


class StrategySpec:
    """
    Read-only view over the canonical strategy specification.

    Every parameter carries provenance, a range where applicable, the PDF
    citation for book-derived rules, and the list of engines that consume it.
    """

    def __init__(self, data: Dict[str, Any], path: Optional[Path] = None):
        self._data = data
        self._path = path
        self._params: Dict[str, Dict[str, Any]] = {
            p['id']: p for p in data.get('parameters', [])
        }
        self._validate()

    # -- construction ---------------------------------------------------

    @classmethod
    def load(cls, path: Optional[Path] = None) -> 'StrategySpec':
        """Load and validate the specification from disk."""
        spec_path = Path(path) if path else SPEC_PATH
        if not spec_path.exists():
            raise StrategySpecError(f"Strategy spec not found: {spec_path}")
        with open(spec_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
        return cls(data, spec_path)

    # -- validation ------------------------------------------------------

    def _validate(self) -> None:
        """Structural validation of the specification itself."""
        required_top = ['spec_id', 'spec_version', 'parameters', 'provenance_values']
        for key in required_top:
            if key not in self._data:
                raise StrategySpecError(f"Spec is missing required key: {key}")

        seen_ids = set()
        for p in self._data.get('parameters', []):
            for key in ('id', 'name', 'purpose', 'value', 'type', 'provenance',
                        'rationale', 'status', 'configurable', 'consumers', 'tests'):
                if key not in p:
                    raise StrategySpecError(
                        f"Parameter '{p.get('id', '<unknown>')}' is missing '{key}'"
                    )

            pid = p['id']
            if pid in seen_ids:
                raise StrategySpecError(f"Duplicate parameter id: {pid}")
            seen_ids.add(pid)

            prov = p['provenance']
            if prov not in VALID_PROVENANCE:
                raise StrategySpecError(
                    f"Parameter '{pid}' has invalid provenance '{prov}'. "
                    f"Expected one of {VALID_PROVENANCE}."
                )

            # A book-derived parameter MUST cite a page and a passage.
            if prov == 'book':
                if not p.get('pdf_page') or not p.get('pdf_passage'):
                    raise StrategySpecError(
                        f"Parameter '{pid}' is tagged 'book' but has no PDF page "
                        f"and/or passage."
                    )

            # An inferred parameter MUST have a rationale.
            if prov == 'inferred' and not p.get('rationale'):
                raise StrategySpecError(
                    f"Parameter '{pid}' is tagged 'inferred' but has no rationale."
                )

            # An invented parameter MUST have a rationale AND a status.
            if prov == 'invented' and not (p.get('rationale') and p.get('status')):
                raise StrategySpecError(
                    f"Parameter '{pid}' is tagged 'invented' but lacks a "
                    f"rationale and/or explicit status."
                )

        self._validate_divergences()
        self._validate_ambiguities()

    def _validate_divergences(self) -> None:
        """Every divergence must carry a valid status and name a real parameter."""
        valid = set(self._data.get('status_conventions', {})
                     .get('divergence_status', {}).keys())
        if not valid:
            valid = {'resolved', 'open', 'deferred'}

        seen = set()
        param_ids = {p['id'] for p in self._data.get('parameters', [])}

        for d in self._data.get('engine_divergences', []):
            did = d.get('id', '<unknown>')
            if did in seen:
                raise StrategySpecError(f"Duplicate divergence id: {did}")
            seen.add(did)

            status = d.get('status')
            if status not in valid:
                raise StrategySpecError(
                    f"Divergence '{did}' has invalid status '{status}'. "
                    f"Expected one of {sorted(valid)}."
                )

            if d.get('parameter') not in param_ids:
                raise StrategySpecError(
                    f"Divergence '{did}' names parameter "
                    f"'{d.get('parameter')}' which does not exist."
                )

    def _validate_ambiguities(self) -> None:
        """Every ambiguity must carry a valid status and name real parameters."""
        valid = set(self._data.get('status_conventions', {})
                     .get('ambiguity_status', {}).keys())
        if not valid:
            valid = {'open', 'resolved'}

        seen = set()
        param_ids = {p['id'] for p in self._data.get('parameters', [])}

        for a in self._data.get('ambiguities_in_the_book', []):
            aid = a.get('id', '<unknown>')
            if aid in seen:
                raise StrategySpecError(f"Duplicate ambiguity id: {aid}")
            seen.add(aid)

            status = a.get('status')
            if status not in valid:
                raise StrategySpecError(
                    f"Ambiguity '{aid}' has invalid status '{status}'. "
                    f"Expected one of {sorted(valid)}."
                )

            if not a.get('book_position') or not a.get('proposed_interpretation'):
                raise StrategySpecError(
                    f"Ambiguity '{aid}' must record both the book position and "
                    f"the proposed interpretation."
                )

            for affected in a.get('affects', []):
                if affected not in param_ids:
                    raise StrategySpecError(
                        f"Ambiguity '{aid}' names parameter '{affected}' which "
                        f"does not exist."
                    )

    # -- accessors -------------------------------------------------------

    def value(self, param_id: str) -> Any:
        """The canonical value of a parameter."""
        return self._require(param_id)['value']

    def provenance(self, param_id: str) -> str:
        """'book' | 'inferred' | 'invented'."""
        return self._require(param_id)['provenance']

    def pdf_page(self, param_id: str) -> Optional[int]:
        """Source PDF page for a book-derived parameter, else None."""
        return self._require(param_id).get('pdf_page')

    def pdf_passage(self, param_id: str) -> Optional[str]:
        """Supporting passage for a book-derived parameter, else None."""
        return self._require(param_id).get('pdf_passage')

    def status(self, param_id: str) -> str:
        """Open/closed status of the parameter."""
        return self._require(param_id)['status']

    def consumers(self, param_id: str) -> List[str]:
        """Which engine components consume the parameter."""
        return list(self._require(param_id)['consumers'])

    def parameter(self, param_id: str) -> Dict[str, Any]:
        """The full parameter record."""
        return dict(self._require(param_id))

    def parameters(self) -> Dict[str, Dict[str, Any]]:
        """All parameter records, keyed by id."""
        return {k: dict(v) for k, v in self._params.items()}

    def parameter_ids(self) -> List[str]:
        """All parameter ids, in specification order."""
        return [p['id'] for p in self._data.get('parameters', [])]

    def divergences(self) -> List[Dict[str, Any]]:
        """Recorded divergences between the two engines."""
        return list(self._data.get('engine_divergences', []))

    def ambiguities(self) -> List[Dict[str, Any]]:
        """Recorded ambiguities in the source methodology."""
        return list(self._data.get('ambiguities_in_the_book', []))

    def metadata(self) -> Dict[str, Any]:
        """Top-level specification metadata (ids, versions, authority)."""
        return {
            'spec_id': self._data['spec_id'],
            'spec_version': self._data['spec_version'],
            'schema_version': self._data.get('$schema_version'),
            'title': self._data.get('title'),
            'authority': self._data.get('authority', {}),
        }

    def _require(self, param_id: str) -> Dict[str, Any]:
        if param_id not in self._params:
            raise StrategySpecError(f"Unknown strategy parameter: {param_id}")
        return self._params[param_id]


# -- module-level singleton ------------------------------------------

_SPEC: Optional[StrategySpec] = None


def get_spec() -> StrategySpec:
    """Return the cached specification, loading it on first use."""
    global _SPEC
    if _SPEC is None:
        _SPEC = StrategySpec.load()
    return _SPEC


def param(param_id: str) -> Any:
    """Shorthand for ``get_spec().value(param_id)``."""
    return get_spec().value(param_id)
