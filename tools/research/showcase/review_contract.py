#!/usr/bin/env python3
"""Canonical showcase acceptance contract: semantic fidelity vs 3D presentation.

`config/showcase-review-contract.json` is the single source of truth for the
review prompt, the acceptance predicates, the defect taxonomy, and the retry
policy.  `apps/showcase/server/review-contract.mjs` is the JavaScript mirror of
this module: both hash the same canonical body and must agree on every
conformance vector the contract carries.

Semantic acceptance answers "does this render show the requested scenario".
Presentation acceptance additionally answers "is this footage usable".  Every
rejection is attributable to a defect code, and evidence that cannot be
attributed is reported through `unsupportedReason` instead of silently passing.
"""
import hashlib
import json
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parents[3]
CONTRACT_PATH = ROOT / 'config' / 'showcase-review-contract.json'


def canonical_json(value):
    """Hashing form: keys sorted at every depth, no whitespace, ASCII escapes."""
    return json.dumps(value, sort_keys=True, separators=(',', ':'))


def sha256_text(text):
    return hashlib.sha256(text.encode('utf-8')).hexdigest()


def _integral_floats(node, trail='$'):
    """Floats that JSON.stringify and json.dumps render differently ('1' vs '1.0')."""
    if isinstance(node, dict):
        return [item for key, value in node.items() for item in _integral_floats(value, f'{trail}.{key}')]
    if isinstance(node, list):
        return [item for index, value in enumerate(node) for item in _integral_floats(value, f'{trail}[{index}]')]
    if isinstance(node, float) and node.is_integer():
        return [trail]
    return []


def _load():
    contract = json.loads(CONTRACT_PATH.read_text(encoding='utf-8'))
    body = {key: value for key, value in contract.items() if key != 'sha256'}
    offenders = _integral_floats(body)
    if offenders:
        raise ValueError('review contract holds integral floats that hash differently across '
                         'runtimes: %s' % ', '.join(offenders))
    computed = sha256_text(canonical_json(body))
    if contract.get('sha256') != computed:
        raise ValueError('review contract sha256 %s != canonical %s; refresh the frozen hash '
                         'deliberately' % (contract.get('sha256'), computed))
    return contract


CONTRACT = _load()
CONTRACT_VERSION = CONTRACT['version']
CONTRACT_SHA256 = CONTRACT['sha256']
REVIEW_VERSION = CONTRACT['reviewVersion']
PROMPT = CONTRACT['prompt']
PROMPT_SHA256 = sha256_text(PROMPT)

_SEMANTIC = CONTRACT['acceptance']['semantic']
_PRESENTATION = CONTRACT['acceptance']['presentation']
_UNSUPPORTED = CONTRACT['acceptance']['unsupported']
_DEFECTS = CONTRACT['defects']
_RETRY = CONTRACT['retry']

FALLBACK_CODE = _DEFECTS['fallbackCode']
CODES = tuple(_DEFECTS['codes'])
AXIS_CODES = _DEFECTS['axisCodes']
MAX_DEFECTS = _DEFECTS['maxDefects']
MAX_TEXT = _DEFECTS['maxTextLength']
FULL_TIER = '3d'
_TIER_AXES = tuple(_SEMANTIC['axes'])
_RULES = tuple((rule['code'], re.compile(rule['pattern'], re.IGNORECASE)) for rule in _DEFECTS['rules'])


def contract_identity():
    return {'version': CONTRACT_VERSION, 'sha256': CONTRACT_SHA256,
            'reviewVersion': REVIEW_VERSION, 'promptSha256': PROMPT_SHA256}


def classify_text(text):
    """First taxonomy rule whose pattern the raw defect text matches."""
    value = str(text or '')
    for prefix in _DEFECTS['legacyTextPrefixes']:
        if value.lower().startswith(prefix):
            value = value[len(prefix):]
    stripped = value.strip()
    legacy = _DEFECTS['legacyCodes'].get(stripped.lower())
    if legacy:
        return legacy
    if stripped in CODES:
        return stripped
    for code, pattern in _RULES:
        if pattern.search(stripped):
            return code
    return None


def attribute(declared, text):
    """-> (code, source) preferring the reviewer's own attribution."""
    if isinstance(declared, str) and declared.strip() in CODES:
        return declared.strip(), 'model'
    matched = classify_text(text)
    if matched:
        return matched, 'rules'
    return FALLBACK_CODE, 'unattributed'


def clamp_number(value, low, high, fallback=0.0):
    """Coerce model output into a bounded float without raising on junk."""
    try:
        number = float(value)
    except (TypeError, ValueError):
        return fallback
    if number != number:
        return fallback
    return max(low, min(high, number))


def _defect_records(review, confidence):
    raw = review.get('defects')
    if not isinstance(raw, (list, tuple)):
        return []
    records = []
    for item in list(raw)[:MAX_DEFECTS]:
        if isinstance(item, dict):
            text = str(item.get('text') or item.get('defect') or item.get('description') or '')[:MAX_TEXT]
            declared = item.get('code')
            item_confidence = item.get('confidence', confidence)
        else:
            text = str(item)[:MAX_TEXT]
            declared = None
            item_confidence = confidence
        code, source = attribute(declared, text)
        records.append({'code': code, 'text': text,
                        'confidence': clamp_number(item_confidence, 0.0, 1.0), 'source': source})
    return records


def _axis_record(axis, value, code):
    return {'code': code, 'text': f'{axis}={value}', 'confidence': None, 'source': 'axis'}


def _evidence_text(review, records):
    for key in ('explanation', 'mechanismObserved', 'description'):
        if str(review.get(key) or '').strip():
            return True
    return any(record['text'].strip() for record in records)


def evaluate(review, tier=None):
    """-> the shared acceptance contract for one reviewed cell.

    Keys: semanticAccepted, presentationAccepted, defectCodes, unsupportedReason
    plus the attributable evidence (`defects`, `axes`, `tier`) behind them.
    """
    result = {'tier': tier, 'semanticAccepted': False, 'presentationAccepted': False,
              'defectCodes': [], 'unsupportedReason': None, 'defects': [], 'axes': {}}
    if not isinstance(review, dict):
        result['unsupportedReason'] = 'no review evidence for this cell'
        result['defectCodes'] = [FALLBACK_CODE]
        result['defects'] = [{'code': FALLBACK_CODE, 'text': '', 'confidence': None, 'source': 'missing'}]
        return result

    declared_tier = str(review.get('tier') or '').lower()
    result['tier'] = tier or (declared_tier if declared_tier in _UNSUPPORTED['tiers']
                              else (FULL_TIER if any(axis in review for axis in _TIER_AXES) else '2d'))
    reasons = []
    records = []
    codes = set()

    error = review.get('error')
    if error:
        reasons.append('review error: %s' % str(error)[:MAX_TEXT])
    confidence = clamp_number(review.get('confidence'), 0.0, 1.0)
    records = _defect_records(review, confidence)
    for record in records:
        codes.add(record['code'])
        if record['source'] == 'unattributed':
            reasons.append('unattributable defect text: %s' % (record['text'] or '(empty)'))
        elif record['code'] == FALLBACK_CODE:
            reasons.append('reviewer reported an unattributable defect')

    if _UNSUPPORTED['requireEvidenceText'] and not _evidence_text(review, records):
        reasons.append('review returned no explanatory text')

    if result['tier'] != FULL_TIER:
        reasons.append(_UNSUPPORTED['blindTierReason'])
    elif not error:
        for axis, allowed in {**_SEMANTIC['axes'], **_PRESENTATION['axes']}.items():
            if axis not in review:
                reasons.append(f'review omitted the {axis} verdict')
                continue
            value = str(review.get(axis) or '').strip().lower()
            result['axes'][axis] = value
            if value not in allowed:
                code = AXIS_CODES[axis]
                codes.add(code)
                records.append(_axis_record(axis, value, code))
        if _SEMANTIC['requirePlausible']:
            if 'plausible' not in review:
                reasons.append('review omitted the plausible verdict')
            else:
                result['axes']['plausible'] = bool(review.get('plausible'))
                if not result['axes']['plausible']:
                    codes.add(AXIS_CODES['plausible'])
                    records.append(_axis_record('plausible', 'false', AXIS_CODES['plausible']))
        if 'realism' not in review:
            reasons.append('review omitted the realism score')
        else:
            realism = clamp_number(review.get('realism'), 0.0, 10.0)
            result['axes']['realism'] = realism
            if realism < _SEMANTIC['realismMin']:
                codes.add(AXIS_CODES['realism'])
                records.append(_axis_record('realism', f'{realism:g}', AXIS_CODES['realism']))
        if 'confidence' not in review:
            reasons.append('review omitted its confidence')
        else:
            result['axes']['confidence'] = confidence
            if confidence < _SEMANTIC['confidenceMin']:
                codes.add(AXIS_CODES['confidence'])
                records.append(_axis_record('confidence', f'{confidence:g}', AXIS_CODES['confidence']))
                reasons.append('review confidence %g is below the %g floor'
                               % (confidence, _SEMANTIC['confidenceMin']))

    for code in _UNSUPPORTED['blockingCodes']:
        if code in codes and not reasons:
            reasons.append(f'{code} defect blocks an attributable verdict')
    if reasons and not codes:
        codes.add(FALLBACK_CODE)
        records.append({'code': FALLBACK_CODE, 'text': reasons[0], 'confidence': None, 'source': 'unsupported'})

    result['defects'] = records
    result['defectCodes'] = sorted(codes)
    result['unsupportedReason'] = reasons[0] if reasons else None
    if not reasons and result['tier'] == FULL_TIER:
        result['semanticAccepted'] = not any(
            code.startswith(prefix) for code in codes for prefix in _SEMANTIC['blockingPrefixes'])
        result['presentationAccepted'] = (
            (result['semanticAccepted'] or not _PRESENTATION['requiresSemantic'])
            and not any(code.startswith(prefix) for code in codes
                        for prefix in _PRESENTATION['blockingPrefixes']))
    return result


def normalize_historical(review):
    """Re-derive attributable verdicts from a pre-split review emission.

    The verdict is honest about the evidence it had, and can never satisfy the
    current contract: `contract` stays None so stale artifacts are never current.
    """
    result = evaluate(review)
    result['normalizedFrom'] = str((review or {}).get('version') or '') or None
    result['contract'] = None
    return result


def retry_recommendation(codes, reviewed=None):
    """-> the cheapest retry that could fix the dominant defect, or None."""
    values = [code for code in (codes or []) if isinstance(code, str)]
    if reviewed is not None and int(reviewed) <= 0:
        return {'action': _RETRY['noEvidenceAction'], 'codes': sorted(set(values)),
                'reason': _RETRY['noEvidenceReason']}
    for prefix in _RETRY['priority']:
        matched = sorted({code for code in values if code.startswith(prefix)})
        if matched:
            return {'action': _RETRY['actions'][prefix], 'codes': matched,
                    'reason': f'dominant defect prefix {prefix}'}
    return None


def acceptance_fields(result):
    """The four shared-contract fields, flattened for artifact rows."""
    return {'semanticAccepted': result['semanticAccepted'],
            'presentationAccepted': result['presentationAccepted'],
            'defectCodes': list(result['defectCodes']),
            'unsupportedReason': result['unsupportedReason']}


if __name__ == '__main__':
    print(json.dumps({'contract': contract_identity(),
                      'conformance': len(CONTRACT['conformance'])}, indent=2))
