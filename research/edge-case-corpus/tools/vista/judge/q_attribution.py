
import sys, os, json, collections, statistics
sys.path.insert(0, os.getcwd())
import gate as G
QK=('Q1_jointChallenger','Q2_egoReallyResponded','Q3_noPropOverlap','Q4_headingSane',
    'Q5_notClipped','Q6_ttcPairIsEgo','Q7_contestedSpace')
import glob
def scan(root):
    return [json.load(open(p)) for p in sorted(glob.glob(root+'/*/record.json'))]
def af(r): return bool(r.get('admitted')) or bool((r.get('lastGate') or {}).get('admitted'))
def analyse(root,lbl):
    recs=scan(root); per=collections.Counter(); n=0; hq=set(); hq_noQ7=set(); lost=[]
    for r in recs:
        if not af(r): continue
        cells=[]
        for c in (r.get('lastCells') or []):
            if not (c.get('pass') and c.get('traceFile')): continue
            try: gc=G.gate_cell(c['traceFile'], c.get('verdict'), c.get('band'))
            except Exception: continue
            n+=1
            for k in QK:
                if gc.get(k) is False: per[k]+=1
            cells.append(((c['mapId'],c['siteId']), {k:gc.get(k) for k in QK}))
        def adm(skip=()):
            ok=[k for k,q in cells if all(v is not False for kk,v in q.items() if kk not in skip)]
            return len({m for m,_ in ok})>=2 and len(set(ok))>=3
        if adm(): hq.add(r['briefId'])
        if adm(skip=('Q7_contestedSpace',)): hq_noQ7.add(r['briefId'])
        if not adm():
            lost.append((r['briefId'],[q for q in QK if adm(skip=(q,))]))
    nf=sum(1 for r in recs if af(r))
    print(f"{lbl:12s} n={len(recs):3d} frozen={nf:3d}  HQ(all Q)={len(hq):3d}  HQ(no Q7)={len(hq_noQ7):3d}  cells={n}")
    print(f"{'':12s} per-cell Q loss: " + "  ".join(f"{k.split('_')[0]}:{per[k]/max(n,1):.3f}" for k in QK))
    rc=collections.Counter(x for _,rs in lost for x in (rs if rs else ['<multi-clause>']))
    print(f"{'':12s} lost {len(lost)} briefs -> {dict(rc)}")
    return dict(n=len(recs),frozen=nf,hq=hq,hq_noQ7=hq_noQ7)
out={}
for root,lbl in (('/tmp/vista-dev2-sight','DEV2-sight'),('/tmp/vista-dev2-blind','DEV2-blind'),
                 ('/tmp/vista-held-sight','HELD-sight'),('/tmp/vista-held-blind','HELD-blind')):
    out[lbl]=analyse(root,lbl)
print()
for tag,a,b in (('DEV2',out['DEV2-sight'],out['DEV2-blind']),('HELD',out['HELD-sight'],out['HELD-blind'])):
    N=a['n']
    print(f"{tag}: best-of-2 union   frozen n/a   HQ(all Q) {len(a['hq']|b['hq'])}/{N} = {len(a['hq']|b['hq'])/N:.3f}"
          f"   HQ(no Q7) {len(a['hq_noQ7']|b['hq_noQ7'])}/{N} = {len(a['hq_noQ7']|b['hq_noQ7'])/N:.3f}")
