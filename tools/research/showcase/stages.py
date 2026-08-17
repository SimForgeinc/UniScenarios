#!/usr/bin/env python3
"""Thin, JSON-speaking adapters for the showcase pipeline.

The protected research implementations remain the source of truth.  This file
only adapts their callable functions to one-brief / one-job invocations.
"""

import argparse
import contextlib
import io
import json
import os
import pathlib
import shutil
import sys
import tempfile
import time

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parents[2]
GATES = ROOT / 'tools' / 'gates'
VISTA2 = ROOT / 'tools' / 'research' / 'vista2'
FOOTAGE = ROOT / 'tools' / 'research' / 'footage'
sys.path.insert(0, str(GATES))

PRODUCT_REVIEW_VERSION = 'showcase-3d-product-review-v1'
PRODUCT_REVIEW_PROMPT = """You are the final acceptance reviewer for a generated autonomous-driving scenario.
You receive the user's exact requested edge case followed by time-ordered frames from the REAL 3D render.
Reject aggressively: this is training-data QA, not a creativity exercise.

Check all of the following independently:
1. mechanismFidelity: Does the visible scene implement the exact requested causal mechanism, actors, road
   structure, and event sequence? A generic near-miss or route-around is "no", even if physically critical.
2. visualGrounding: Are every vehicle and actor correctly resting on the visible road/ground, without
   sinking, floating, clipping through geometry, or occupying an impossible surface?
3. actorFidelity: Are the requested actor types visibly present (for example motorcycle vs car, SUV vs sedan)?
4. eventSequence: Across the frames, does the requested reveal/conflict/reaction actually occur in order?
5. realism/plausibility: Could this exact scene exist and behave this way in real traffic?

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


def author(args):
    # author_llm reads these at import time through its unchanged vlm module.
    os.environ['VISTA_MODEL'] = args.model
    os.environ['VISTA_EFFORT'] = args.effort
    import author_llm as module

    brief = load(args.brief)
    out = pathlib.Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    captured = io.StringIO()
    started = time.monotonic()
    with contextlib.redirect_stdout(captured), contextlib.redirect_stderr(captured):
        row = module.author_brief(
            brief,
            probe_draws=args.probe_draws,
            final_draws=args.draws,
            max_sites=args.max_sites,
            concurrency=args.concurrency,
            log_dir=None,
        )
    transcript = {
        'implementation': 'tools/gates/author_llm.py:author_brief',
        'model': args.model,
        'effort': args.effort,
        'wallS': round(time.monotonic() - started, 3),
        'brief': brief,
        'result': row,
        'log': captured.getvalue()[-20000:],
    }
    atomic_json(out / 'transcript.json', transcript)
    template = row.get('template')
    if not template or not os.path.isfile(template):
        raise RuntimeError('compiler produced no reusable template: %s' % row.get('error', 'unknown error'))
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

    brief = load(args.brief)
    out = pathlib.Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    guide = pathlib.Path('/tmp/tgr-vista-main1/GUIDE.md')
    guide_out = out / 'GUIDE.md'
    if guide.is_file():
        shutil.copyfile(guide, guide_out)
    else:
        guide_out.write_text('', encoding='utf-8')
    run_vista2.preflight(args.model, args.effort)
    llm_log = out / 'llm.jsonl'
    llm = vagent.LLM(args.model, args.effort, str(llm_log))
    episode = vagent.Episode(brief, str(out), llm, str(guide_out),
                             budget=args.budget, wall_cap_s=args.wall_cap)
    started = time.monotonic()
    row = episode.run()
    row['wallSAdapter'] = round(time.monotonic() - started, 3)
    row['implementation'] = 'tools/research/vista2/vagent.py:Episode'
    atomic_json(out / 'transcript.json', row)
    result = episode.emit_result or {}
    template = result.get('template')
    if not template or not os.path.isfile(template):
        raise RuntimeError('vista2 episode produced no emitted template')
    atomic_copy(template, out / 'template.json')
    clip_seconds = enforce_minimum_clip(out / 'template.json')
    emit({'template': str(out / 'template.json'), 'transcript': str(out / 'transcript.json'),
          'admitted': bool(row.get('admitted')), 'actions': row.get('actions'),
          'clipSeconds': clip_seconds})


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
    candidates = [render / 'frame.png', *sorted((render / 'frames').glob('*.png'))]
    frames = []
    seen = set()
    for frame in candidates:
        if frame.is_file() and frame.resolve() not in seen:
            seen.add(frame.resolve())
            frames.append(frame)
    if not frames:
        raise RuntimeError(f'no 3D review frames in {render}')
    if len(frames) > 4:
        frames = [frames[round(index * (len(frames) - 1) / 3)] for index in range(4)]
    prompt = f'{PRODUCT_REVIEW_PROMPT}\n\nUSER REQUEST:\n{brief["brief"]}'
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




def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='command', required=True)

    cmd = sub.add_parser('precheck')
    cmd.add_argument('--brief', required=True)
    cmd.set_defaults(func=precheck)

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
    cmd.add_argument('--model', default='gpt-5.6-sol')
    cmd.add_argument('--effort', default='medium')
    cmd.set_defaults(func=review_3d)

    args = parser.parse_args()
    args.func(args)


if __name__ == '__main__':
    main()
