"""Score a verdict set against the ground truth, with Wilson intervals."""
import collections, json, math


def wilson(k, n, z=1.96):
    if n == 0:
        return (float('nan'), float('nan'))
    p = k / n
    d = 1 + z * z / n
    c = (p + z * z / (2 * n)) / d
    h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return (max(0.0, c - h), min(1.0, c + h))


def score(gt_pairs, verdicts, positive=('verified',), name='critic'):
    """positive = which verdict strings count as ACCEPT (i.e. admit to the corpus)."""
    tp = fp = fn = tn = 0
    fps, fns = [], []
    for p in gt_pairs:
        v = verdicts.get(p['id'])
        if not v:
            continue
        acc = v['verdict'] in positive
        pos = p['gt'] == 'present'
        if acc and pos:
            tp += 1
        elif acc and not pos:
            fp += 1
            fps.append(p)
        elif not acc and pos:
            fn += 1
            fns.append(p)
        else:
            tn += 1
    n = tp + fp + fn + tn
    prec = tp / (tp + fp) if tp + fp else float('nan')
    rec = tp / (tp + fn) if tp + fn else float('nan')
    f1 = 2 * prec * rec / (prec + rec) if (prec == prec and rec == rec and prec + rec > 0) else float('nan')
    return {'name': name, 'positive': list(positive), 'n': n,
            'tp': tp, 'fp': fp, 'fn': fn, 'tn': tn,
            'precision': prec, 'precisionCI': wilson(tp, tp + fp),
            'recall': rec, 'recallCI': wilson(tp, tp + fn),
            'f1': f1,
            'fpRate': fp / (fp + tn) if fp + tn else float('nan'),
            'fpRateCI': wilson(fp, fp + tn),
            'accuracy': (tp + tn) / n if n else float('nan'),
            'falsePositives': [q['id'] for q in fps], 'falseNegatives': [q['id'] for q in fns]}


def show(s):
    print(f"--- {s['name']}  (accept = {s['positive']})   n={s['n']}")
    print(f"                  GT present   GT absent")
    print(f"    accept          {s['tp']:5d}       {s['fp']:5d}")
    print(f"    not-accept      {s['fn']:5d}       {s['tn']:5d}")
    print(f"    precision {s['precision']:.3f}  95% CI ({s['precisionCI'][0]:.3f}, {s['precisionCI'][1]:.3f})")
    print(f"    recall    {s['recall']:.3f}  95% CI ({s['recallCI'][0]:.3f}, {s['recallCI'][1]:.3f})")
    print(f"    F1        {s['f1']:.3f}   accuracy {s['accuracy']:.3f}")
    print(f"    FP rate   {s['fpRate']:.3f}  95% CI ({s['fpRateCI'][0]:.3f}, {s['fpRateCI'][1]:.3f})   [FPs poison the corpus]")
