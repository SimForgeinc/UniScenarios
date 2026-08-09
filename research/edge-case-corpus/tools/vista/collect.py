"""Collect every admitted scenario into a portable corpus, and verify portability."""
import os, json, glob, shutil, argparse, re

PORT_BAD = re.compile(r'"(roadId|laneRsl|siteId|mapId|x|z|easting|northing)"\s*:', re.I)


def portability_check(tpl):
    """The non-negotiable rule: no coordinates, no road ids, no map names in the emitted template."""
    bad = []
    s = json.dumps(tpl)
    if tpl.get('anchor', {}).get('pin'):
        bad.append('anchor.pin present (pins the scenario to one map/site)')
    if tpl.get('sourceMap'):
        bad.append('sourceMap present')
    for m in ('yale-street', 'belmont-research-center', 'el-camino-road',
              'easterbrook-discovery-school', 'richmond-field-station'):
        if m in s:
            bad.append(f'map name "{m}" baked into the template')
    for r in tpl.get('roles', []):
        if r.get('kind') == 'scene_absolute':
            bad.append(f"role {r.get('id')} uses scene_absolute (absolute scene coordinates)")
    for m in PORT_BAD.finditer(s):
        k = m.group(1)
        if k in ('roadId', 'laneRsl', 'siteId'):
            bad.append(f'road/lane/site identifier "{k}" in template')
    return bad


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--roots', nargs='+', required=True)
    ap.add_argument('--out', required=True)
    a = ap.parse_args()
    os.makedirs(a.out + '/templates', exist_ok=True)
    corpus, seen = [], {}
    for root in a.roots:
        for f in sorted(glob.glob(root + '/*/record.json')):
            r = json.load(open(f))
            if not r.get('admitted'):
                continue
            bid = r['briefId']
            lg = r.get('lastGate') or {}
            entry = {'briefId': bid, 'brief': r.get('brief'), 'category': r.get('category'),
                     'mode': r.get('mode'), 'run': os.path.basename(root),
                     'admittedFrozen': True, 'admittedHQ': bool(lg.get('admittedHQ')),
                     'passingCells': lg.get('passingCells'), 'passingCellsHQ': lg.get('passingCellsHQ'),
                     'nMaps': lg.get('nMaps'), 'nSites': lg.get('nSites'),
                     'evidenceDir': r.get('evidenceDir'), 'wallClockS': r.get('wallClockS'),
                     'name': (r.get('template') or {}).get('meta', {}).get('name'),
                     'expectation': (r.get('template') or {}).get('meta', {}).get('expectation')}
            tpl = r.get('template') or {}
            entry['portabilityViolations'] = portability_check(tpl)
            # keep the best version of each brief: HQ first, then most passing cells
            key = (entry['admittedHQ'], entry['passingCells'] or 0)
            if bid not in seen or key > seen[bid]:
                seen[bid] = key
                path = f"{a.out}/templates/{bid}.template.json"
                json.dump(tpl, open(path, 'w'), indent=1)
                entry['templateFile'] = path
                corpus = [c for c in corpus if c['briefId'] != bid] + [entry]
    viol = [c for c in corpus if c['portabilityViolations']]
    summary = {'n': len(corpus), 'nHQ': sum(1 for c in corpus if c['admittedHQ']),
               'categories': sorted({c['category'] for c in corpus}),
               'nCategories': len({c['category'] for c in corpus}),
               'portabilityViolations': len(viol), 'scenarios': sorted(corpus, key=lambda c: c['briefId'])}
    json.dump(summary, open(a.out + '/CORPUS.json', 'w'), indent=1)
    print(f"corpus: {summary['n']} scenarios, {summary['nHQ']} high-quality, "
          f"{summary['nCategories']} categories, {summary['portabilityViolations']} portability violations")
    for c in viol[:10]:
        print('  VIOLATION', c['briefId'], c['portabilityViolations'])
