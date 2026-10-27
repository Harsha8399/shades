"""
Cross-engine strategy specification consistency tests (Python side).

These assert that the Python engine's LIVE parameter values equal the
canonical specification's values, and that the specification itself is
well-formed. The TypeScript suite (``app-ts/tests/strategy-spec.test.ts``)
asserts the same spec from the other side, so neither engine can drift from
it silently.

The specification itself lives in ``shared/fixtures/strategy_spec.json``.
"""
import json

import pytest

from src.strategies.strategy_spec import (
    StrategySpec,
    StrategySpecError,
    get_spec,
    SPEC_PATH,
    REPO_ROOT,
    VALID_PROVENANCE,
)
from src.patterns.confluence_zone import ConfluenceZonePattern
from src.indicators.fibonacci import FIB_RATIOS
from src.backtesting.engine import BacktestConfig


@pytest.fixture(scope="module")
def spec():
    return get_spec()


@pytest.fixture(scope="module")
def raw_spec():
    return json.loads(SPEC_PATH.read_text())


class TestSpecStructure:
    """The specification file itself must be well-formed."""

    def test_loads_and_identifies_itself(self, spec):
        meta = spec.metadata()
        assert meta['spec_id'] == 'shades.confluence-zone'
        assert meta['spec_version']
        assert SPEC_PATH.exists()

    def test_every_parameter_has_all_required_fields(self, spec):
        required = [
            'id', 'name', 'purpose', 'value', 'type', 'provenance',
            'rationale', 'status', 'configurable', 'consumers', 'tests',
        ]
        for pid in spec.parameter_ids():
            p = spec.parameter(pid)
            for key in required:
                assert key in p, f"{pid} missing {key}"
                assert p[key] is not None, f"{pid}.{key} is None"

    def test_every_parameter_has_valid_provenance(self, spec):
        for pid in spec.parameter_ids():
            assert spec.provenance(pid) in VALID_PROVENANCE

    def test_book_parameters_cite_a_page_and_passage(self, spec):
        book_params = [
            pid for pid in spec.parameter_ids()
            if spec.provenance(pid) == 'book'
        ]
        assert len(book_params) > 0, "expected at least one book-derived parameter"
        for pid in book_params:
            assert spec.pdf_page(pid) > 0, f"{pid} has no PDF page"
            assert spec.pdf_passage(pid), f"{pid} has no PDF passage"

    def test_inferred_parameters_have_a_rationale(self, spec):
        for pid in spec.parameter_ids():
            if spec.provenance(pid) == 'inferred':
                assert len(spec.parameter(pid)['rationale']) > 20

    def test_invented_parameters_have_a_rationale_and_a_status(self, spec):
        for pid in spec.parameter_ids():
            if spec.provenance(pid) == 'invented':
                assert len(spec.parameter(pid)['rationale']) > 20
                assert spec.status(pid), f"{pid} has no status"

    def test_provenance_distribution_is_recorded(self, spec):
        """A sanity check that the spec is not dominated by one category."""
        counts = {}
        for pid in spec.parameter_ids():
            prov = spec.provenance(pid)
            counts[prov] = counts.get(prov, 0) + 1
        assert counts.get('book', 0) > 0
        assert counts.get('inferred', 0) > 0
        assert counts.get('invented', 0) > 0

    def test_rejects_a_book_parameter_without_a_citation(self, raw_spec):
        data = json.loads(json.dumps(raw_spec))
        data['parameters'][0]['provenance'] = 'book'
        data['parameters'][0]['pdf_page'] = None
        data['parameters'][0]['pdf_passage'] = None
        with pytest.raises(StrategySpecError, match='book'):
            StrategySpec(data)

    def test_rejects_an_unknown_provenance(self, raw_spec):
        data = json.loads(json.dumps(raw_spec))
        data['parameters'][0]['provenance'] = 'guess'
        with pytest.raises(StrategySpecError, match='invalid provenance'):
            StrategySpec(data)

    def test_rejects_a_duplicate_parameter_id(self, raw_spec):
        data = json.loads(json.dumps(raw_spec))
        data['parameters'].append(dict(data['parameters'][0]))
        with pytest.raises(StrategySpecError, match='Duplicate parameter id'):
            StrategySpec(data)

    def test_rejects_a_missing_required_field(self, raw_spec):
        data = json.loads(json.dumps(raw_spec))
        del data['parameters'][0]['status']
        with pytest.raises(StrategySpecError, match="missing 'status'"):
            StrategySpec(data)

    def test_rejects_an_unknown_parameter_lookup(self, spec):
        with pytest.raises(StrategySpecError, match='Unknown strategy parameter'):
            spec.value('NO_SUCH_PARAMETER')

    def test_every_divergence_names_a_real_parameter(self, spec):
        for div in spec.divergences():
            assert div['parameter'] in spec.parameter_ids()

    def test_every_ambiguity_names_real_parameters(self, spec):
        for amb in spec.ambiguities():
            assert len(amb['book_position']) > 20
            assert len(amb['proposed_interpretation']) > 20
            assert amb['resolution_stage'] >= 2
            for affected in amb['affects']:
                assert affected in spec.parameter_ids()


class TestDivergenceStatusConvention:
    """
    Every divergence must declare a status from a known vocabulary, and
    every ambiguity likewise. The convention is what lets a reader tell a
    closed difference from a deliberately deferred one.
    """

    VALID_DIVERGENCE_STATUS = {'resolved', 'open', 'deferred'}
    VALID_AMBIGUITY_STATUS = {'open', 'resolved'}

    def test_every_divergence_has_a_valid_status(self, spec):
        for div in spec.divergences():
            assert div.get('status') in self.VALID_DIVERGENCE_STATUS, (
                f"{div['id']} has status {div.get('status')!r}"
            )

    def test_every_ambiguity_has_a_valid_status(self, spec):
        for amb in spec.ambiguities():
            assert amb.get('status') in self.VALID_AMBIGUITY_STATUS, (
                f"{amb['id']} has status {amb.get('status')!r}"
            )

    def test_a_resolved_divergence_is_not_still_high_severity(self, spec):
        """
        A divergence whose engines now agree must not be recorded as an
        outstanding high-severity problem. This catches the stale DIV-13
        record, where the code was fixed but the spec still said 'high'.
        """
        for div in spec.divergences():
            if div.get('status') == 'resolved':
                assert div.get('severity') == 'resolved', (
                    f"{div['id']} is marked resolved but its severity is "
                    f"{div.get('severity')!r}"
                )

    def test_div_13_is_recorded_as_resolved(self, spec):
        """
        DIV-13 was fixed in Stage 2: the Python engine now consults every
        detected trendline, matching the TypeScript engine.
        """
        div = next(d for d in spec.divergences() if d['id'] == 'DIV-13')
        assert div['status'] == 'resolved'
        assert div['severity'] == 'resolved'
        assert 'RESOLVED' in div['python']

    def test_div_12_is_recorded_as_resolved(self, spec):
        """DIV-12: both engines now stamp trades with the candle's time."""
        div = next(d for d in spec.divergences() if d['id'] == 'DIV-12')
        assert div['status'] == 'resolved'
        assert div['severity'] == 'resolved'
        assert 'RESOLVED' in div['typescript']

    def test_div_11_is_recorded_as_resolved(self, spec):
        """
        DIV-11 was settled in the Stage 3 Phase 3 review: the book (p.16/p.17)
        makes the entry a touch event, so BOTH engines fill when price touches
        the entry with no candle-close confirmation (`ORDER_FILL_CONDITION =
        touch_only`), and the divergence record was closed.
        """
        div = next(d for d in spec.divergences() if d['id'] == 'DIV-11')
        assert div['status'] == 'resolved'
        assert div['severity'] == 'resolved'
        assert 'touch' in div['python'].lower()
        assert 'touch' in div['typescript'].lower()

    def test_amb_05_is_recorded_as_resolved(self, spec):
        """
        AMB-05 was settled in Stage 2 (keep min_touches = 2). It is retained
        for auditability but must not read as an open ambiguity.
        """
        amb = next(a for a in spec.ambiguities() if a['id'] == 'AMB-05')
        assert amb['status'] == 'resolved'
        assert 'Settled in Stage 2' in amb['resolution_note']

    def test_the_three_resolved_divergences_are_the_only_ones(self, spec):
        """
        Guard against a status being flipped without the underlying code
        actually changing. If another divergence is ever marked resolved, this
        test forces a review of that change.

        DIV-11 joined DIV-12/DIV-13 in the Stage 3 Phase 3 review: the book is
        explicit that the entry trigger is a touch event (p.16/p.17), both
        engines fill on touch (`ORDER_FILL_CONDITION = touch_only`), and the
        discriminating regression tests live in `test_backtest_engine.py`
        (Python) and `app-ts/tests/regression.test.ts` (TypeScript).
        """
        resolved = {d['id'] for d in spec.divergences() if d.get('status') == 'resolved'}
        assert resolved == {'DIV-11', 'DIV-12', 'DIV-13'}

    def test_rejects_an_unknown_divergence_status(self, raw_spec):
        data = json.loads(json.dumps(raw_spec))
        data['engine_divergences'][0]['status'] = 'maybe'
        with pytest.raises(StrategySpecError, match='invalid status'):
            StrategySpec(data)

    def test_rejects_a_divergence_naming_a_missing_parameter(self, raw_spec):
        data = json.loads(json.dumps(raw_spec))
        data['engine_divergences'][0]['parameter'] = 'NO_SUCH_PARAMETER'
        with pytest.raises(StrategySpecError, match='does not exist'):
            StrategySpec(data)

    def test_rejects_an_unknown_ambiguity_status(self, raw_spec):
        data = json.loads(json.dumps(raw_spec))
        data['ambiguities_in_the_book'][0]['status'] = 'maybe'
        with pytest.raises(StrategySpecError, match='invalid status'):
            StrategySpec(data)

    def test_rejects_a_duplicate_divergence_id(self, raw_spec):
        data = json.loads(json.dumps(raw_spec))
        data['engine_divergences'].append(dict(data['engine_divergences'][0]))
        with pytest.raises(StrategySpecError, match='Duplicate divergence id'):
            StrategySpec(data)


class TestPythonEngineAgreesWithSpec:
    """The Python engine's live values must equal the specification."""

    def test_confluence_pattern_parameters_match(self, spec):
        pattern = ConfluenceZonePattern()
        cfg = pattern.config

        assert cfg['min_confluence_factors'] == spec.value('MIN_CONFLUENCE_FACTORS')
        assert cfg['sr_zone_lookback'] == spec.value('SR_ZONE_LOOKBACK')
        assert cfg['zone_tolerance_atr'] == spec.value('SR_ZONE_TOLERANCE_ATR')
        assert cfg['min_rejection_wick_ratio'] == spec.value('MIN_REJECTION_WICK_RATIO')
        assert cfg['target_rr'] == spec.value('TARGET_RR')
        assert cfg['fib_levels'] == spec.value('FIB_CONFLUENCE_LEVELS')

    def test_fibonacci_ratio_list_matches(self, spec):
        assert list(FIB_RATIOS) == spec.value('FIB_RATIOS')

    def test_backtest_config_matches(self, spec):
        cfg = BacktestConfig()
        assert cfg.initial_capital == spec.value('INITIAL_CAPITAL')
        assert cfg.risk_per_trade == spec.value('RISK_PER_TRADE')
        assert cfg.max_open_trades == spec.value('MAX_OPEN_TRADES')
        assert cfg.commission == spec.value('COMMISSION_RATE')
        assert cfg.slippage == spec.value('SLIPPAGE_RATE')
        assert cfg.intrabar_policy == spec.value('INTRABAR_POLICY')
        assert cfg.fill_gaps_at_open == spec.value('GAP_FILL_AT_OPEN')
        assert cfg.close_open_positions_at_end == spec.value('CLOSE_AT_END_OF_DATA')

    def test_records_that_the_fib_levels_config_is_dead(self, spec):
        """
        The pattern configures `fib_levels` but the confluence check matches
        every computed level, so the configured subset has no effect.
        """
        param = spec.parameter('FIB_CONFLUENCE_LEVELS')
        assert 'DEAD CONFIGURATION' in param['status']
        assert all('NOT applied' in c for c in param['consumers'])

        configured = spec.value('FIB_CONFLUENCE_LEVELS')
        computed = spec.value('FIB_RATIOS')
        assert len(configured) < len(computed)
        for level in configured:
            assert level in computed

    def test_divergences_are_real(self, spec):
        """Each recorded divergence must reflect the engines' live values."""
        div = {d['id']: d for d in spec.divergences()}

        # DIV-01: risk per trade
        assert BacktestConfig().risk_per_trade == div['DIV-01']['python']

        # DIV-02: max open trades
        assert BacktestConfig().max_open_trades == div['DIV-02']['python']

        # DIV-03: slippage
        assert BacktestConfig().slippage == div['DIV-03']['python']

        # DIV-05: the research engine has no partial-exit support at all.
        assert div['DIV-05']['python'] == 'not implemented at all'
        import src.backtesting.engine as engine_module
        source = open(engine_module.__file__).read()
        assert 'partial' not in source.lower(), (
            "the research engine must still have no partial-exit support; "
            "if this changed, DIV-05 must be updated"
        )


class TestBookCitationVerification:
    """
    Every parameter tagged 'book' must cite a passage that actually EXISTS in
    the source PDF.

    Stage 3 found that PARTIAL_TAKE_PROFIT was tagged 'book' with a p.18
    citation whose passage is verbatim from this repository's own
    docs/techniques/ and does not appear anywhere in the 20-page PDF. That
    class of error -- a repo-authored summary mistaken for source text -- is
    silent and easy to reintroduce, so it is guarded here.

    The PDF is the authority. If it is absent from the checkout, the whole
    class is skipped rather than failed: the test must not make the suite
    depend on a large binary being present.
    """

    PDF_PATH = REPO_ROOT / 'data' / "The Trader's Playbook_TSOT.pdf"

    @pytest.fixture(scope="class")
    def pdf_pages(self):
        if not self.PDF_PATH.exists():
            pytest.skip(f"source PDF not present: {self.PDF_PATH}")
        try:
            from pypdf import PdfReader
        except ImportError:
            pytest.skip("pypdf not installed")
        reader = PdfReader(str(self.PDF_PATH))
        return [(p.extract_text() or '') for p in reader.pages]

    @staticmethod
    def _normalise(text: str) -> str:
        import re
        import unicodedata
        text = unicodedata.normalize('NFKD', text)
        for ch in ('\u2019', '\u2018'):
            text = text.replace(ch, "'")
        for ch in ('\u201c', '\u201d'):
            text = text.replace(ch, '"')
        for ch in ('\u2013', '\u2014'):
            text = text.replace(ch, '-')
        text = text.replace('\u00a0', ' ')
        return re.sub(r'\s+', ' ', text).lower().strip()

    def test_every_book_citation_exists_in_the_pdf(self, raw_spec, pdf_pages):
        """Each 'book' passage must be findable in the PDF's text."""
        normalised = self._normalise(' '.join(pdf_pages))

        for param in raw_spec['parameters']:
            if param.get('provenance') != 'book':
                continue

            pid = param['id']
            passage = param.get('pdf_passage')
            assert passage, f"{pid} is tagged 'book' but has no passage"

            tokens = self._normalise(passage).split()
            assert tokens, f"{pid} has an empty passage"

            # The longest contiguous run of tokens that appears verbatim
            # anywhere in the PDF. A genuine quotation has a long run; a
            # paraphrase or an invention has only short accidental matches.
            longest = 0
            for length in range(len(tokens), 2, -1):
                for start in range(0, len(tokens) - length + 1):
                    fragment = ' '.join(tokens[start:start + length])
                    if fragment in normalised:
                        longest = length
                        break
                if longest:
                    break

            assert longest >= 5, (
                f"{pid} is tagged 'book' but only {longest} consecutive token(s) "
                f"of its cited passage appear in the PDF. A 'book' citation must "
                f"quote the source, not paraphrase it. Either the passage is "
                f"wrong (and the parameter is not book-derived), or the "
                f"quotation is too loose. Passage was: {passage!r}"
            )

    def test_no_book_parameter_cites_the_repo_docs(self, raw_spec):
        """
        Guard the specific Stage 3 failure: a passage copied from this
        repository's own docs/techniques/ must never be tagged 'book'.
        """
        for param in raw_spec['parameters']:
            if param.get('provenance') != 'book':
                continue
            passage = (param.get('pdf_passage') or '').lower()
            assert 'docs/techniques' not in passage, (
                f"{param['id']} cites the repository's own docs as though it "
                f"were the source methodology"
            )
