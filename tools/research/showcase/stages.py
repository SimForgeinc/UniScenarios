#!/usr/bin/env python3
"""Thin, JSON-speaking adapters for the showcase pipeline.

The protected research implementations remain the source of truth.  This file
only adapts their callable functions to one-brief / one-job invocations.
"""

import argparse
import contextlib
import io
import gzip
import json
import os
import pathlib
import shutil
import sys
import subprocess
import tempfile
import time

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parents[2]
GATES = ROOT / 'tools' / 'gates'
VISTA2 = ROOT / 'tools' / 'research' / 'vista2'
FOOTAGE = ROOT / 'tools' / 'research' / 'footage'
sys.path.insert(0, str(GATES))
import semantic_contract as semantic

PRODUCT_REVIEW_VERSION = 'showcase-3d-product-review-v4'
PRODUCT_REVIEW_PROMPT = """You are the final acceptance reviewer for a generated autonomous-driving scenario.
You receive the user's exact requested edge case followed by time-ordered frames from the REAL 3D render.
Reject aggressively: this is training-data QA, not a creativity exercise.

Check all of the following independently:
1. mechanismFidelity: Does the visible scene implement the exact requested causal mechanism, actors, road
   structure, and event sequence? A generic near-miss or route-around is "no", even if physically critical.
2. visualGrounding: Are every vehicle and actor correctly resting on the visible road/ground, without
   sinking, floating, clipping through geometry, or occupying an impossible surface?
3. actorFidelity: Are the requested actor types visibly present (for example motorcycle vs car, SUV vs sedan)?
4. eventSequence: Across the frames, does the requested event onset (or reveal when requested), conflict,
   and reaction actually occur in order?
5. realism/plausibility: Could this exact scene exist and behave this way in real traffic?

The frames use an external incident camera, not the ego driver's eye point. A target visible to this
camera can still be occluded from the ego. Use the supplied trace-grounded ego line-of-sight facts
to interpret that distinction, but never let metadata excuse a visibly impossible scene.

Answer STRICT JSON only:
{"mechanismFidelity":"yes|partial|no","visualGrounding":"pass|fail",
"actorFidelity":"pass|fail","eventSequence":"pass|fail","plausible":true,
"realism":0,"defects":["short visible defect"],"confidence":0.0,"explanation":"2-5 sentences"}"""


def emit(value):
    print(json.dumps(value, separators=(',', ':')))


def load(path):
    with open(path, encoding='utf-8') as handle:
        return json.load(handle)


def atomic_json(path, value):
    path = pathlib.Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_name('.%s.%d.tmp' % (path.name, os.getpid()))
    with open(temp, 'w', encoding='utf-8') as handle:
        json.dump(value, handle, indent=2)
        handle.write('\n')
    os.replace(temp, path)


def atomic_copy(source, target):
    target = pathlib.Path(target)
    target.parent.mkdir(parents=True, exist_ok=True)
    temp = target.with_name('.%s.%d.tmp' % (target.name, os.getpid()))
    shutil.copyfile(source, temp)
    os.replace(temp, target)


def enforce_minimum_clip(path, minimum_seconds=20.0):
    template = load(path)
    choreography = template.setdefault('choreography', {})
    authored = float(choreography.get('clipSeconds', minimum_seconds))
    choreography['clipSeconds'] = max(minimum_seconds, authored)
    atomic_json(path, template)
    return choreography['clipSeconds']



def precheck(args):
    import precheck_briefs as module

    brief = load(args.brief)
    inventory = load(module.INVENTORY) if os.path.exists(module.INVENTORY) else module.measure_inventory()
    result = module.precheck(brief, inventory)
    result['inventoryFile'] = os.path.relpath(module.INVENTORY, ROOT)
    result['implementation'] = 'tools/gates/precheck_briefs.py:precheck'
    emit(result)

def contract(args):
    import precheck_briefs as module

    brief = load(args.brief)
    emit(semantic.derive_contract(brief, module.required_structures(brief)))


def validate_contract(args):
    template, added_invariants = semantic.complete_template(load(args.template))
    if added_invariants:
        atomic_json(pathlib.Path(args.template), template)
    failures = semantic.validate_template(template, load(args.contract))
    emit({'valid': not failures, 'failures': failures,
          'representationDefaults': {'invariants': added_invariants}})





def author(args):
    # author_llm reads these at import time through its unchanged vlm module.
    os.environ['VISTA_MODEL'] = args.model
    os.environ['VISTA_EFFORT'] = args.effort
    import author_llm as module
    import httpx

    brief = load(args.brief)
    out = pathlib.Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    captured = io.StringIO()
    usage = {'calls': 0, 'input_tokens': 0, 'output_tokens': 0,
             'reasoning_tokens': 0, 'wallS': 0.0}
    original_post = httpx.post

    def observed_post(url, **kwargs):
        call_started = time.monotonic()
        response = original_post(url, **kwargs)
        usage['calls'] += 1
        usage['wallS'] += time.monotonic() - call_started
        try:
            provider = response.json().get('usage') or {}
        except Exception:  # noqa: BLE001
            provider = {}
        usage['input_tokens'] += provider.get('input_tokens') or 0
        usage['output_tokens'] += provider.get('output_tokens') or 0
        usage['reasoning_tokens'] += (
            (provider.get('output_tokens_details') or {}).get('reasoning_tokens') or 0)
        return response

    started = time.monotonic()
    httpx.post = observed_post
    try:
        with contextlib.redirect_stdout(captured), contextlib.redirect_stderr(captured):
            row = module.author_brief(
                brief,
                probe_draws=args.probe_draws,
                final_draws=args.draws,
                max_sites=args.max_sites,
                concurrency=args.concurrency,
                log_dir=None,
            )
    finally:
        httpx.post = original_post
    usage['wallS'] = round(usage['wallS'], 3)
    transcript = {
        'implementation': 'tools/gates/author_llm.py:author_brief',
        'model': args.model,
        'effort': args.effort,
        'wallS': round(time.monotonic() - started, 3),
        'usage': usage,
        'brief': brief,
        'result': row,
        'log': captured.getvalue()[-20000:],
    }
    atomic_json(out / 'transcript.json', transcript)
    template = row.get('template')
    if not template or not os.path.isfile(template):
        reason = row.get('detail') or row.get('error', 'unknown error')
        raise RuntimeError('compiler produced no reusable template: %s' % reason)
    atomic_copy(template, out / 'template.json')
    clip_seconds = enforce_minimum_clip(out / 'template.json')
    emit({'template': str(out / 'template.json'), 'transcript': str(out / 'transcript.json'),
          'admitted': bool(row.get('admitted')), 'family': row.get('family'),
          'clipSeconds': clip_seconds})


def vista_author(args):
    os.environ.setdefault('OPENAI_BASE_URL', 'http://127.0.0.1:4141/v1')
    os.environ.setdefault('OPENAI_API_KEY', 'x')
    sys.path.insert(0, str(VISTA2))
    import run_vista2
    import vagent

    original_brief = load(args.brief)
    author_contract = load(args.contract)
    out = pathlib.Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    guide_source = pathlib.Path('/tmp/tgr-vista-main1/GUIDE.md')
    attempts = []
    failures = []
    final_row = None
    final_template = None
    proven = semantic.build_proven_product_variant(author_contract, original_brief, ROOT)
    proven_failures = semantic.validate_template(proven, author_contract) if proven else []
    if proven and not proven_failures:
        final_template = out / 'proven-product.template.json'
        atomic_json(final_template, proven)
        final_row = {
            'admitted': False,
            'actions': 0,
            'implementation': 'semantic_contract.build_proven_product_variant',
            'reason': 'recognized product mechanism specialized from a frozen-gate-proven recipe; downstream gate and product review remain authoritative',
        }
        attempts.append({
            'attempt': 'proven-product',
            'briefId': original_brief['id'],
            'row': final_row,
            'contractFailures': [],
            'template': str(final_template),
        })
        atomic_json(out / 'contract-attempts.json', {
            'contract': author_contract,
            'attempts': attempts,
            'acceptedAttempt': 'proven-product',
        })
    else:
        run_vista2.preflight(args.model, args.effort)

    for attempt_index in range(args.retries + 1) if final_template is None else ():
        attempt_dir = out / f'attempt-{attempt_index + 1:02d}'
        attempt_dir.mkdir(parents=True, exist_ok=True)
        guide_out = attempt_dir / 'GUIDE.md'
        if guide_source.is_file():
            shutil.copyfile(guide_source, guide_out)
        else:
            guide_out.write_text('', encoding='utf-8')
        brief = json.loads(json.dumps(original_brief))
        brief['showcaseContract'] = author_contract
        brief['id'] = f'{original_brief["id"]}-attempt-{attempt_index + 1:02d}'
        brief['brief'] = original_brief['brief'] + '\n\n' + semantic.repair_prompt(author_contract, failures)
        llm = vagent.LLM(args.model, args.effort, str(attempt_dir / 'llm.jsonl'))
        episode = vagent.Episode(brief, str(attempt_dir), llm, str(guide_out),
                                 budget=args.budget, wall_cap_s=args.wall_cap)
        started = time.monotonic()
        row = episode.run()
        row['wallSAdapter'] = round(time.monotonic() - started, 3)
        row['implementation'] = 'tools/research/vista2/vagent.py:Episode'
        result = episode.emit_result or {}
        template_source = result.get('template')
        failures = []
        if not template_source or not os.path.isfile(template_source):
            failures = [{'kind': 'missing_template', 'reason': 'vista2 episode produced no emitted template'}]
        else:
            candidate = attempt_dir / 'candidate.template.json'
            atomic_copy(template_source, candidate)
            enforce_minimum_clip(candidate)
            candidate_template, _ = semantic.complete_template(load(candidate))
            atomic_json(candidate, candidate_template)
            failures = semantic.validate_template(candidate_template, author_contract)
            if not row.get('admitted'):
                failures.append({
                    'kind': 'frozen_gate_admission',
                    'reason': 'author emitted a structurally complete template but no cell passed the frozen gate',
                })
            if not failures:
                final_row = row
                final_template = candidate
        attempts.append({
            'attempt': attempt_index + 1,
            'briefId': brief['id'],
            'row': row,
            'contractFailures': failures,
            'template': str(template_source) if template_source else None,
        })
        atomic_json(out / 'contract-attempts.json', {
            'contract': author_contract,
            'attempts': attempts,
            'acceptedAttempt': attempt_index + 1 if final_template else None,
        })
        if final_template:
            break

    if final_template is None:
        fallback = semantic.build_proven_ltap_variant(author_contract, original_brief, ROOT)
        fallback_failures = semantic.validate_template(fallback, author_contract) if fallback else failures
        if fallback and not fallback_failures:
            final_template = out / 'proven-ltap-fallback.template.json'
            atomic_json(final_template, fallback)
            final_row = {
                'admitted': False,
                'actions': 0,
                'implementation': 'semantic_contract.build_proven_ltap_variant',
                'reason': 'visual author exhausted; specialized the proven LTAP recipe before downstream gate evaluation',
            }
            attempts.append({
                'attempt': 'proven-ltap-fallback',
                'briefId': original_brief['id'],
                'row': final_row,
                'contractFailures': [],
                'template': str(final_template),
            })
            atomic_json(out / 'contract-attempts.json', {
                'contract': author_contract,
                'attempts': attempts,
                'acceptedAttempt': 'proven-ltap-fallback',
            })
        else:
            raise RuntimeError('vista2 exhausted semantic-contract repairs: %s' % json.dumps(fallback_failures))
    atomic_copy(final_template, out / 'template.json')
    atomic_json(out / 'transcript.json', {
        'contract': author_contract,
        'attempts': attempts,
        'acceptedAttempt': len(attempts),
        'result': final_row,
    })
    emit({'template': str(out / 'template.json'), 'transcript': str(out / 'transcript.json'),
          'contractAttempts': str(out / 'contract-attempts.json'),
          'admitted': bool(final_row.get('admitted')), 'actions': final_row.get('actions'),
          'clipSeconds': load(out / 'template.json')['choreography']['clipSeconds']})


def gate(args):
    import tg_gate

    request = load(args.request)
    rows = []
    for cell in request['cells']:
        trace = cell.get('traceFile')
        if not trace or not os.path.isfile(trace):
            rows.append({'cellId': cell['cellId'], 'pass': False, 'firstFailure': 'NOTRACE',
                         'error': 'trace missing'})
            continue
        verdict = cell.get('verdict')
        band = cell.get('band')
        result = tg_gate.gate_cell(trace, verdict=verdict, band=band,
                                   brief=request.get('brief'), version=2)
        result['cellId'] = cell['cellId']
        result['mapId'] = cell.get('mapId')
        result['siteId'] = cell.get('siteId')
        result['drawIndex'] = cell.get('drawIndex')
        result['firstFailure'] = tg_gate.first_failure(result)
        rows.append(result)
    emit({'implementation': 'tools/gates/tg_gate.py:gate_cell', 'version': 2, 'cells': rows})


def judge(args):
    sys.path.insert(0, str(FOOTAGE))
    import judge as module

    cell = pathlib.Path(args.cell)
    render = pathlib.Path(args.render)
    with tempfile.TemporaryDirectory(prefix='showcase-judge-') as tmp:
        staged = pathlib.Path(tmp)
        shutil.copyfile(cell / 'meta.json', staged / 'meta.json')
        os.symlink(render, staged / 'render', target_is_directory=True)
        result = module.judge_cell(str(staged), args.model, args.effort, args.strategy,
                                   require_redacted=True)
    emit(result)

def review_3d(args):
    sys.path.insert(0, str(FOOTAGE))
    import futil

    futil.assert_vision_session(args.model)
    brief = load(args.brief)
    render = pathlib.Path(args.render)
    manifest = load(render / 'manifest.json')
    video_records = manifest.get('videoSequence', {}).get('frames', [])
    phase_times = [row.get('t') for row in manifest.get('frames', [])
                   if isinstance(row.get('t'), (int, float))]
    candidates = []
    review_tmp = None
    if video_records and phase_times and (render / 'video.mp4').is_file():
        start_t, end_t = min(phase_times), max(phase_times)
        targets = [start_t + (end_t - start_t) * index / 7 for index in range(8)]
        selected = []
        for target in targets:
            record = min(video_records, key=lambda row: abs(row.get('t', target) - target))
            if record.get('sequenceIndex') not in [row.get('sequenceIndex') for row in selected]:
                selected.append(record)
        review_tmp = tempfile.TemporaryDirectory(prefix='.review-frames-', dir=render)
        try:
            for ordinal, record in enumerate(selected):
                retained = render / 'video-frames' / f'frame-{record["sequenceIndex"]:05d}.png'
                if retained.is_file():
                    candidates.append(retained)
                    continue
                frame = pathlib.Path(review_tmp.name) / f'frame-{ordinal:02d}.png'
                subprocess.run([
                    'ffmpeg', '-y', '-hide_banner', '-loglevel', 'error',
                    '-ss', str(record['t']), '-i', str(render / 'video.mp4'),
                    '-frames:v', '1', str(frame),
                ], check=True)
                candidates.append(frame)
        except (OSError, subprocess.CalledProcessError, KeyError):
            candidates = []
    if not candidates:
        candidates = [
            render / 'frames' / 'frame-000.png',
            render / 'frames' / 'frame-001.png',
            render / 'frame.png',
            render / 'frames' / 'frame-003.png',
        ]
    frames = []
    seen = set()
    for frame in candidates:
        if frame.is_file() and frame.resolve() not in seen:
            seen.add(frame.resolve())
            frames.append(frame)
    if not frames:
        raise RuntimeError(f'no 3D review frames in {render}')
    instance = load(render / 'source' / 'instance.json')
    authored_ids = [actor['id'] for actor in instance.get('input', {}).get('actors', [])
                    if not actor.get('id', '').startswith('ambient:')]
    frame_context = []
    for record in manifest.get('frames', []):
        visible = []
        for actor in record.get('composition', {}).get('actors', []):
            if actor.get('id') in authored_ids:
                visible.append({'id': actor['id'], 'pixel': actor.get('pixel')})
        frame_context.append({'phase': record.get('phase'), 't': record.get('t'), 'actors': visible})
    trace_context = {}
    trace_path = render / 'source' / 'trace.json.gz'
    if trace_path.is_file():
        with gzip.open(trace_path, 'rt', encoding='utf-8') as handle:
            trace = json.load(handle)
        metrics = trace.get('metrics', {})
        trace_context = {
            'declaredOcclusion': metrics.get('declaredOcclusion', []),
            'collisions': metrics.get('collisions', []),
            'events': [
                event for event in trace.get('events', [])
                if event.get('actorId') in authored_ids and event.get('kind') in
                ('trigger_fired', 'trigger_skipped', 'released')
            ],
        }
    evidence = {
        'authoredActors': [
            {'id': actor['id'], 'kind': actor.get('kind'), 'catalogId': actor.get('catalogId')}
            for actor in instance.get('input', {}).get('actors', [])
            if actor.get('id') in authored_ids
        ],
        'frameOrder': frame_context,
        'traceFacts': trace_context,
    }
    request_text = args.request_text or brief['brief']
    prompt = (f'{PRODUCT_REVIEW_PROMPT}\n\nUSER REQUEST:\n{request_text}'
              f'\n\nGROUND-TRUTH EVIDENCE:\n{json.dumps(evidence, separators=(",", ":"))}')
    content = [{'type': 'input_text', 'text': prompt}]
    content.extend({'type': 'input_image', 'image_url': futil.png_data_url(str(frame))}
                   for frame in frames)
    body = {
        'model': args.model,
        'reasoning': {'effort': args.effort},
        'max_output_tokens': 4000,
        'input': [{'role': 'user', 'content': content}],
    }
    response, raw, wall = futil.responses_call(body, timeout=420)
    parsed = futil.parse_json_block(futil.output_text(response))
    mechanism = str(parsed.get('mechanismFidelity', 'no')).lower()
    grounding = str(parsed.get('visualGrounding', 'fail')).lower()
    actors = str(parsed.get('actorFidelity', 'fail')).lower()
    sequence = str(parsed.get('eventSequence', 'fail')).lower()
    realism = max(0.0, min(10.0, float(parsed.get('realism', 0))))
    confidence = max(0.0, min(1.0, float(parsed.get('confidence', 0))))
    defects = [str(value)[:240] for value in parsed.get('defects', [])][:16]
    accepted = (
        mechanism == 'yes' and grounding == 'pass' and actors == 'pass'
        and sequence == 'pass' and bool(parsed.get('plausible'))
        and realism >= 6 and confidence >= 0.6 and not defects
    )
    usage = response.get('usage') or {}
    emit({
        'cellId': args.cell_id,
        'version': PRODUCT_REVIEW_VERSION,
        'model': args.model,
        'effort': args.effort,
        'visionAsserted': True,
        'mechanismFidelity': mechanism,
        'visualGrounding': grounding,
        'actorFidelity': actors,
        'eventSequence': sequence,
        'plausible': bool(parsed.get('plausible')),
        'realism': realism,
        'defects': defects,
        'confidence': confidence,
        'explanation': str(parsed.get('explanation', ''))[:3000],
        'accepted': accepted,
        'framesUsed': [str(frame.relative_to(render)) for frame in frames],
        'latencyS': round(wall, 2),
        'tokens': {
            'in': usage.get('input_tokens'),
            'out': usage.get('output_tokens'),
            'reasoning': (usage.get('output_tokens_details') or {}).get('reasoning_tokens'),
        },
        'rawResponseSha256': futil.sha256_text(raw),
    })
    if review_tmp is not None:
        review_tmp.cleanup()




def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='command', required=True)

    cmd = sub.add_parser('precheck')
    cmd.add_argument('--brief', required=True)
    cmd.set_defaults(func=precheck)

    cmd = sub.add_parser('contract')
    cmd.add_argument('--brief', required=True)
    cmd.set_defaults(func=contract)

    cmd = sub.add_parser('validate-contract')
    cmd.add_argument('--template', required=True)
    cmd.add_argument('--contract', required=True)
    cmd.set_defaults(func=validate_contract)

    cmd = sub.add_parser('author')
    cmd.add_argument('--brief', required=True)
    cmd.add_argument('--out', required=True)
    cmd.add_argument('--model', default='gpt-5.6-sol')
    cmd.add_argument('--effort', default='medium')
    cmd.add_argument('--probe-draws', type=int, default=1)
    cmd.add_argument('--draws', type=int, default=1)
    cmd.add_argument('--max-sites', type=int, default=3)
    cmd.add_argument('--concurrency', type=int, default=2)
    cmd.set_defaults(func=author)

    cmd = sub.add_parser('vista-author')
    cmd.add_argument('--brief', required=True)
    cmd.add_argument('--out', required=True)
    cmd.add_argument('--model', default='gpt-5.6-sol')
    cmd.add_argument('--contract', required=True)
    cmd.add_argument('--retries', type=int, default=2)
    cmd.add_argument('--effort', default='medium')
    cmd.add_argument('--budget', type=int, default=40)
    cmd.add_argument('--wall-cap', type=int, default=2400)
    cmd.set_defaults(func=vista_author)

    cmd = sub.add_parser('gate')
    cmd.add_argument('--request', required=True)
    cmd.set_defaults(func=gate)

    cmd = sub.add_parser('judge')
    cmd.add_argument('--cell', required=True)
    cmd.add_argument('--render', required=True)
    cmd.add_argument('--model', default='gpt-5.6-sol')
    cmd.add_argument('--effort', default='medium')
    cmd.add_argument('--strategy', default='spread8')
    cmd.set_defaults(func=judge)

    cmd = sub.add_parser('review3d')
    cmd.add_argument('--brief', required=True)
    cmd.add_argument('--render', required=True)
    cmd.add_argument('--cell-id', required=True)
    cmd.add_argument('--request-text')
    cmd.add_argument('--model', default='gpt-5.6-sol')
    cmd.add_argument('--effort', default='medium')
    cmd.set_defaults(func=review_3d)

    args = parser.parse_args()
    args.func(args)


if __name__ == '__main__':
    main()
