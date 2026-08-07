"""Is gate.deduplicate() honest?

The signature is (mapId, siteId, clearance/0.5 m, minTTC/0.5 s, egoPeakDecel/1.0 m/s^2), and 310
raw cells collapsed to 61. The question is not whether 61 < 310 but whether cells sharing a
signature really teach the same lesson, and whether cells with DIFFERENT signatures really teach
different ones.

Three tests, none of which requires an opinion:
  T1  BITE      -- how much of the collapse is due to each field? A field that never splits
                   anything is decoration; a field that splits everything is noise.
  T2  WITHIN    -- do same-signature cells actually have near-identical behaviour on quantities
                   the signature does NOT contain (geometry, timing, who the challenger is,
                   the ego's actual speed profile)? If they differ a lot, the collapse is too
                   aggressive.
  T3  BETWEEN   -- do different-signature cells differ on those same quantities by MORE than
                   same-signature cells do? If not, the signature is not tracking behaviour.
"""
import collections, json, os, sys
import numpy as np
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.dirname(HERE))


def band(x, w):
    return None if x is None else int(x / w)


def sig(c, fields=('map', 'site', 'clear', 'ttc', 'decel')):
    out = []
    if 'map' in fields:
        out.append(c.get('mapId'))
    if 'site' in fields:
        out.append(c.get('siteId'))
    if 'clear' in fields:
        out.append(band(c.get('clearanceM'), 0.5))
    if 'ttc' in fields:
        out.append(band(c.get('minTTC'), 0.5))
    if 'decel' in fields:
        out.append(band(c.get('egoPeakDecelMps2'), 1.0))
    return tuple(out)


# behavioural quantities the signature does NOT encode
PROBE = ['closestT', 'pathSeparationM', 'encroachmentGapS', 'egoSpeedDropMps']


def load_cells():
    ql = {r['trace']: r for r in json.load(open(os.path.join(HERE, 'qlayer.json')))}
    sc = json.load(open(os.path.join(HERE, 'scan-all.json')))
    out = []
    for r in sc:
        if not r.get('pass'):
            continue
        q = ql.get(r['trace'], {})
        out.append({'trace': r['trace'], 'run': r['run'], 'mapId': r['mapId'],
                    'siteId': r['siteId'], 'clearanceM': r['clearanceM'],
                    'minTTC': r['minTTC'], 'egoPeakDecelMps2': q.get('egoPeakDecelMps2'),
                    'closestT': r['closestT'], 'pathSeparationM': q.get('pathSeparationM'),
                    'encroachmentGapS': q.get('encroachmentGapS'),
                    'egoSpeedDropMps': q.get('egoSpeedDropMps'),
                    'challenger': q.get('Q1_challenger'), 'highQuality': q.get('highQuality')})
    return out
