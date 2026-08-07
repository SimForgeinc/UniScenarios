# HEAD-TO-HEAD: sight vs blind, judged independently

Gates, labelled unambiguously:
  FROZEN GATE = the pre-registered contract (sha256 1a08698e95fca4bc): C1..C5, >=2 maps,
                >=3 distinct sites. THIS IS THE CONTRACTUAL HEAD-TO-HEAD NUMBER.
  HQ GATE     = frozen gate AND the authoring lane's Q1..Q6 quality clauses. Strictly tighter.
  JUDGE       = this lane's independent rubric (RUBRIC.md), applied to cells the frozen gate
                already admitted. It never loosens anything; it only removes.

## 1. MORE -- admission

mode     briefs  FROZEN adm    rate           95% CI  HQ adm    rate           95% CI
sight        32           8   0.250   (0.133, 0.421)       6   0.188   (0.089, 0.353)
blind        32          15   0.469   (0.309, 0.636)      11   0.344   (0.204, 0.517)

  FROZEN gate, sight vs blind admission: Fisher exact p = 0.1172
  HQ gate,     sight vs blind admission: Fisher exact p = 0.2574
  Lane-1 blind baseline for reference: DEV 0.312 (29-31 admitted of 92).

## 2. BETTER -- quality of the cells the FROZEN gate admitted

### sight  (24 cells judged, up to 3 per admitted brief)
    high                             5   0.208
    acceptable                       8   0.333
    physically-valid-but-boring      4   0.167
    intent-not-realised              3   0.125
    invalid                          4   0.167
    -> good (high|acceptable)       13   0.542  CI (0.351, 0.721)
    -> gate admitted, judge rejects  11   0.458
    mean R1 2.96  CI (2.5, 3.38)
    mean R2 2.62  CI (2.12, 3.12)
    mean R3 2.33  CI (1.96, 2.67)
    mean R4 2.92  CI (2.62, 3.12)
    mean R5 2.67  CI (2.08, 3.21)

### blind  (45 cells judged, up to 3 per admitted brief)
    high                             8   0.178
    acceptable                      10   0.222
    physically-valid-but-boring     12   0.267
    intent-not-realised              8   0.178
    invalid                          7   0.156
    -> good (high|acceptable)       18   0.400  CI (0.27, 0.545)
    -> gate admitted, judge rejects  27   0.600
    mean R1 2.58  CI (2.2, 2.93)
    mean R2 2.40  CI (2.04, 2.76)
    mean R3 2.13  CI (1.84, 2.4)
    mean R4 2.82  CI (2.58, 3.04)
    mean R5 2.84  CI (2.44, 3.2)

  quality difference, Fisher exact p = 0.3141

## 3. The same, with the R3 (novelty) clause REMOVED from the verdict rules
   R3 anchor 0 is literally "generic car-following", so R3 demotes that whole category in BOTH
   modes. This block shows how much of the verdict R3 is carrying. It is NOT a softened rubric;
   the rubric of record is section 2.

  sight  good  14/24  = 0.583   high:7  acceptable:7  physically:3  intent:3  invalid:4
  blind  good  20/45  = 0.444   high:10  acceptable:10  physically:10  intent:8  invalid:7

## 4. Per category -- so category mix cannot masquerade as a mode effect

category                     sight n  good   rate   diff | blind n  good   rate   diff
C1.car-following                  3     2   0.67   47.9 |       6     4   0.67   59.0
C11.parking                       0     0    nan    nan |       6     2   0.33   45.9
C15.adversarial                   3     3   1.00   46.8 |       3     0   0.00   60.7
C2.cut-in-merge                   6     3   0.50   72.0 |       6     3   0.50   61.2
C3.intersection                   0     0    nan    nan |       3     2   0.67   67.6
C4.roundabout                     0     0    nan    nan |       3     2   0.67   75.5
C5.pedestrian                     3     2   0.67   77.4 |       6     2   0.33   79.7
C6.cyclist-ptw                    3     3   1.00   77.8 |       0     0    nan    nan
C8.workzone                       3     0   0.00   55.2 |       6     2   0.33   70.9
C9.hazard                         3     0   0.00   50.7 |       6     1   0.17   56.6

## 4b. Controlling the category-mix confound

   Pooled quality in section 2 compares different sets of briefs: the two modes did not admit
   the same ones. Two controls, in increasing order of strictness.

   (i) CATEGORY-MATCHED -- restricted to categories BOTH modes admitted: ['C1.car-following', 'C15.adversarial', 'C2.cut-in-merge', 'C5.pedestrian', 'C8.workzone', 'C9.hazard']
       sight 10/21 = 0.476   blind 12/33 = 0.364   Fisher exact p = 0.5707
       mean difficulty  sight 60.3   blind 65.1
       sight-ONLY categories ['C6.cyclist-ptw']: 3/3 good (1.000) -- this block is what the pooled number is really comparing
       blind-ONLY categories ['C11.parking', 'C3.intersection', 'C4.roundabout']: 6/12 good (0.500) -- this block is what the pooled number is really comparing

   (ii) PAIRED -- the 5 briefs BOTH modes admitted. Same sentence, same gate,
        same surface hash. This is the cleanest available comparison.
        briefId                    category               |     sight   diff |     blind   diff
        c1-tailgated-brake         C1.car-following       |    2/3      47.9 |    2/3      57.0
        c2-exit-across             C2.cut-in-merge        |    2/3      90.0 |    2/3      68.3
        c5-bus-stop-emergence      C5.pedestrian          |    2/3      77.4 |    1/3      81.0
        c8-taper-merge             C8.workzone            |    0/3      55.2 |    2/3      69.7
        c9-post-crest              C9.hazard              |    0/3      50.7 |    0/3      52.5
        PAIRED TOTAL  sight 6/15 = 0.400   blind 7/15 = 0.467   Fisher exact p = 1.0

## 5. Measured difficulty (trajectory-derived; the authoring surface cannot reach it)

  sight  n= 24  mean  62.5  median  57.1  sd  18.7  min 24.2  max 90.0  95% CI (bootstrap) (55.33, 69.97)
         per-cell: [24.2, 42.2, 43.1, 44.8, 45.9, 46.5, 49.6, 50.7, 52.2, 53.3, 55.3, 56.0, 58.3, 61.5, 63.3, 75.8, 76.2, 78.2, 80.3, 84.0, 87.9, 90.0, 90.0, 90.0]
  blind  n= 45  mean  63.4  median  68.9  sd  17.2  min 13.8  max 85.0  95% CI (bootstrap) (58.28, 68.18)
         per-cell: [13.8, 24.0, 31.3, 37.7, 41.9, 46.0, 47.0, 47.5, 47.8, 51.3, 51.6, 51.9, 52.3, 52.6, 52.8, 54.6, 55.4, 60.5, 61.4, 65.2, 67.6, 67.7, 68.9, 69.9, 71.2, 71.6, 71.6, 73.2, 73.7, 73.9, 74.3, 75.3, 76.1, 77.4, 77.5, 77.7, 78.3, 78.9, 79.5, 81.6, 82.5, 83.4, 83.7, 84.9, 85.0]

  difference (sight - blind): -0.9, 95% bootstrap CI (-9.72, 8.24)
  ** the CI spans zero: this is NOT evidence of a difficulty difference. **

## 6. Better, or merely more?

  MORE   : frozen-gate admission  sight 8/32 = 0.250   blind 15/32 = 0.469
           HQ-gate admission      sight 6/32 = 0.188   blind 11/32 = 0.344
  BETTER : judged good | admitted sight 0.542   blind 0.400
  QUALITY-ADJUSTED YIELD (admitted briefs x good rate, frozen gate):
           sight 8 x 0.542 = 4.33
           blind 15 x 0.400 = 6.00

  READ: sight admitted fewer briefs than blind, and the quality of its admitted cells is
        higher.
        => sight is better on quality; check whether the category mix explains it (section 4b).

  BEFORE READING ANY POOLED QUALITY NUMBER, SEE SECTION 4b. Pooled quality compares
  DIFFERENT SETS OF BRIEFS, because the two modes did not admit the same ones.

## 7. Every cell the FROZEN gate admitted that the judge rejects

  [blind] c1-ccrm (C1.car-following)  -> physically-valid-but-boring   {'R1': 3, 'R2': 1, 'R3': 0, 'R4': 3, 'R5': 4}   HQ-admitted=True
      brief : A slower lead vehicle is encountered at closing speed (Euro NCAP CCRm).
      why   : This is valid ordinary car-following, not a genuine CCRm edge case, because the vehicles never approach with a meaningful simultaneous conflict.
      flags : PROXIMITY_IS_NOT_THE_CONFLICT
      phys  : contested=True pathSep=0.0 m gap=1.6 s C3b=False
      trace : /tmp/vista-dev2-blind/c1-ccrm-blind/batch-final/el-camino-road/104bc250552c04a1/draw-000.trace.json.gz
  [blind] c1-tailgated-brake (C1.car-following)  -> intent-not-realised   {'R1': 1, 'R2': 2, 'R3': 2, 'R4': 3, 'R5': 4}   HQ-admitted=True
      brief : The ego is tailgated while the lead ahead brakes.
      why   : This is a plausible but relatively comfortable crossing encounter, not an ego-tailgated-by-a-rear-vehicle situation with a same-lane lead braking ahead.
      flags : PROXIMITY_IS_NOT_THE_CONFLICT
      phys  : contested=True pathSep=0.0 m gap=3.16 s C3b=False
      trace : /tmp/vista-dev2-blind/c1-tailgated-brake-blind/batch-final/belmont-research-center/194ee3076882ee25/draw-001.trace.json.gz
  [blind] c11-backing-out (C11.parking)  -> physically-valid-but-boring   {'R1': 4, 'R2': 3, 'R3': 3, 'R4': 0, 'R5': 3}   HQ-admitted=True
      brief : A vehicle backs out of a parking space into the ego path.
      why   : The intended backing-out conflict is present, but the ego's completely unchanged trajectory makes this a non-response clip rather than a useful edge case.
      flags : EGO_NEVER_ACTED, EGO_RESPONSE_NEGLIGIBLE, CHALLENGER_STOPPED_AT_CONFLICT, CHALLENGER_STOPPED_AFTER_CROSSING, NEAR_COLLISION_BY_TIMING
      phys  : contested=True pathSep=0.0 m gap=0 s C3b=True
      trace : /tmp/vista-dev2-blind/c11-backing-out-blind/batch-final/belmont-research-center/21d2c5f1a29a8b02/draw-000.trace.json.gz
  [blind] c11-double-park (C11.parking)  -> physically-valid-but-boring   {'R1': 3, 'R2': 1, 'R3': 2, 'R4': 2, 'R5': 4}   HQ-admitted=True
      brief : A double-parked delivery vehicle blocks the ego lane.
      why   : This is a plausible cautious pass-by of a stationary truck, not a genuine contested-space double-parking edge case.
      flags : CHALLENGER_STATIC, NO_CONTESTED_SPACE, CHALLENGER_STOPPED_AFTER_CROSSING, NEAR_COLLISION_BY_TIMING
      phys  : contested=False pathSep=2.105 m gap=0 s C3b=False
      trace : /tmp/vista-dev2-blind/c11-double-park-blind/batch-iter2/belmont-research-center/2c94ec2182e350c4/draw-000.trace.json.gz
  [blind] c11-double-park (C11.parking)  -> physically-valid-but-boring   {'R1': 2, 'R2': 1, 'R3': 2, 'R4': 3, 'R5': 4}   HQ-admitted=True
      brief : A double-parked delivery vehicle blocks the ego lane.
      why   : This is a plausible cautious pass around a stationary truck, not a genuine double-parking conflict that blocks the ego lane.
      flags : CHALLENGER_STATIC, NO_CONTESTED_SPACE, CHALLENGER_STOPPED_AFTER_CROSSING, NEAR_COLLISION_BY_TIMING
      phys  : contested=False pathSep=2.159 m gap=0 s C3b=False
      trace : /tmp/vista-dev2-blind/c11-double-park-blind/batch-iter2/belmont-research-center/5ad6a8c55942ffd7/draw-000.trace.json.gz
  [blind] c11-double-park (C11.parking)  -> physically-valid-but-boring   {'R1': 3, 'R2': 1, 'R3': 0, 'R4': 3, 'R5': 4}   HQ-admitted=True
      brief : A double-parked delivery vehicle blocks the ego lane.
      why   : The brief is realised, but this is only routine braking behind a stationary truck with no genuine spatial conflict or distinctive edge-case mechanism.
      flags : CHALLENGER_STATIC, NO_CONTESTED_SPACE, CHALLENGER_STOPPED_AFTER_CROSSING, NEAR_COLLISION_BY_TIMING
      phys  : contested=False pathSep=3.337 m gap=0 s C3b=False
      trace : /tmp/vista-dev2-blind/c11-double-park-blind/batch-iter2/belmont-research-center/5f90625788c32368/draw-000.trace.json.gz
  [blind] c15-shedding-load (C15.adversarial)  -> physically-valid-but-boring   {'R1': 2, 'R2': 1, 'R3': 2, 'R4': 0, 'R5': 3}   HQ-admitted=True
      brief : A truck ahead sheds part of its load.
      why   : This is a close pass of a stationary object, not a compelling truck-load-shedding edge case, because the ego never has to react.
      flags : CHALLENGER_STATIC, CHALLENGER_STOPPED_AFTER_CROSSING, NEAR_COLLISION_BY_TIMING
      phys  : contested=False pathSep=0.039 m gap=4.02 s C3b=False
      trace : /tmp/vista-dev2-blind/c15-shedding-load-blind/batch-iter1/belmont-research-center/09c55a0ab422c975/draw-000.trace.json.gz
  [blind] c15-shedding-load (C15.adversarial)  -> intent-not-realised   {'R1': 1, 'R2': 1, 'R3': 1, 'R4': 2, 'R5': 3}   HQ-admitted=True
      brief : A truck ahead sheds part of its load.
      why   : This is a valid pass-by of a stationary car, not a truck shedding part of its load, so it misses the authored edge case.
      flags : CHALLENGER_STATIC, CHALLENGER_STOPPED_AFTER_CROSSING, NEAR_COLLISION_BY_TIMING
      phys  : contested=False pathSep=1.381 m gap=0.0 s C3b=True
      trace : /tmp/vista-dev2-blind/c15-shedding-load-blind/batch-iter1/el-camino-road/1b7ef939c8c98738/draw-000.trace.json.gz
  [blind] c15-shedding-load (C15.adversarial)  -> physically-valid-but-boring   {'R1': 2, 'R2': 1, 'R3': 2, 'R4': 3, 'R5': 3}   HQ-admitted=True
      brief : A truck ahead sheds part of its load.
      why   : This is a valid close pass of a pre-existing stationary car, not a convincing truck-ahead-sheds-load interaction.
      flags : CHALLENGER_STATIC, CHALLENGER_STOPPED_AFTER_CROSSING, NEAR_COLLISION_BY_TIMING
      phys  : contested=True pathSep=0.0 m gap=2.08 s C3b=False
      trace : /tmp/vista-dev2-blind/c15-shedding-load-blind/batch-iter1/yale-street/22f2d971a8196224/draw-000.trace.json.gz
  [blind] c2-exit-across (C2.cut-in-merge)  -> physically-valid-but-boring   {'R1': 4, 'R2': 2, 'R3': 1, 'R4': 3, 'R5': 4}   HQ-admitted=True
      brief : A vehicle crosses the ego lane to reach an exit.
      why   : This valid exit turn does not create a meaningful simultaneous conflict, so it is ordinary lead-vehicle braking rather than an edge case.
      flags : PROXIMITY_IS_NOT_THE_CONFLICT
      phys  : contested=True pathSep=0.0 m gap=1.4 s C3b=False
      trace : /tmp/vista-dev2-blind/c2-exit-across-blind/batch-final/belmont-research-center/690f019e7a92cd78/draw-000.trace.json.gz
  [blind] c2-weave (C2.cut-in-merge)  -> physically-valid-but-boring   {'R1': 2, 'R2': 1, 'R3': 2, 'R4': 3, 'R5': 3}   HQ-admitted=True
      brief : Two vehicles weave across each other around the ego.
      why   : This is a valid close pass around a stopped lead vehicle, not the requested two-vehicle weave around the ego.
      flags : CHALLENGER_STOPPED_AT_CONFLICT, CHALLENGER_STOPPED_AFTER_CROSSING, NEAR_COLLISION_BY_TIMING
      phys  : contested=True pathSep=0.0 m gap=0.0 s C3b=True
      trace : /tmp/vista-dev2-blind/c2-weave-blind/batch-final/belmont-research-center/7dd8f5c2c5e3d5d9/draw-000.trace.json.gz
  [blind] c2-weave (C2.cut-in-merge)  -> intent-not-realised   {'R1': 1, 'R2': 2, 'R3': 1, 'R4': 3, 'R5': 4}   HQ-admitted=True
      brief : Two vehicles weave across each other around the ego.
      why   : The clip is physically plausible and demands braking, but it shows lead-vehicle following plus a pass-by rather than two vehicles weaving across each other around the ego.
      flags : CHALLENGER_STOPPED_AT_CONFLICT, PROXIMITY_IS_NOT_THE_CONFLICT
      phys  : contested=True pathSep=0.0 m gap=0.28 s C3b=False
      trace : /tmp/vista-dev2-blind/c2-weave-blind/batch-final/el-camino-road/515c8e0fe173a676/draw-000.trace.json.gz
  [blind] c3-allway-stop (C3.intersection)  -> physically-valid-but-boring   {'R1': 2, 'R2': 2, 'R3': 0, 'R4': 3, 'R5': 4}   HQ-admitted=True
      brief : Two vehicles negotiate an all-way stop and both proceed.
      why   : This is ordinary car-following through a junction, not a clear all-way-stop interaction or a simultaneous contested-space edge case.
      phys  : contested=True pathSep=0.0 m gap=0.96 s C3b=True
      trace : /tmp/vista-dev2-blind/c3-allway-stop-blind/batch-iter2/belmont-research-center/3b536530c93f04a7/draw-000.trace.json.gz
  [blind] c4-exit-cut (C4.roundabout)  -> intent-not-realised   {'R1': 1, 'R2': 2, 'R3': 3, 'R4': 3, 'R5': 3}   HQ-admitted=True
      brief : A circulating vehicle cuts across the ego exit path.
      why   : This is a close head-on pass on a circulatory roadway, not a circulating vehicle cutting across the ego's exit path.
      flags : PROXIMITY_IS_NOT_THE_CONFLICT
      phys  : contested=False pathSep=0.817 m gap=3.22 s C3b=False
      trace : /tmp/vista-dev2-blind/c4-exit-cut-blind/batch-iter2/el-camino-road/33dcb86035a00eeb/draw-000.trace.json.gz
  [blind] c5-bus-stop-emergence (C5.pedestrian)  -> invalid   {'R1': 4, 'R2': 4, 'R3': 3, 'R4': 4, 'R5': 0}   HQ-admitted=False
      brief : A pedestrian emerges in front of a stopped bus.
      why   : This is a strong, genuine bus-occluded pedestrian emergence with a narrow timed margin rather than a routine pass-by.
      flags : EGO_INTERSECTS_PROP
      caps  : [{'flag': 'EGO_INTERSECTS_PROP', 'dim': 'R5', 'from': 4, 'to': 0}]
      phys  : contested=True pathSep=0.0 m gap=0.38 s C3b=True
      trace : /tmp/vista-dev2-blind/c5-bus-stop-emergence-blind/batch-final/el-camino-road/e83093ec0686aa79/draw-000.trace.json.gz
  [blind] c5-bus-stop-emergence (C5.pedestrian)  -> invalid   {'R1': 4, 'R2': 4, 'R3': 3, 'R4': 4, 'R5': 0}   HQ-admitted=False
      brief : A pedestrian emerges in front of a stopped bus.
      why   : This is a strong, high-value stopped-bus occlusion case because the pedestrian genuinely enters contested space and forces a late, substantial ego response.
      flags : EGO_INTERSECTS_PROP
      caps  : [{'flag': 'EGO_INTERSECTS_PROP', 'dim': 'R5', 'from': 4, 'to': 0}]
      phys  : contested=True pathSep=0.0 m gap=0.22 s C3b=True
      trace : /tmp/vista-dev2-blind/c5-bus-stop-emergence-blind/batch-final/richmond-field-station/337622816e7284bf/draw-000.trace.json.gz
  [blind] c5-reversing-ped (C5.pedestrian)  -> physically-valid-but-boring   {'R1': 3, 'R2': 1, 'R3': 3, 'R4': 3, 'R5': 4}   HQ-admitted=False
      brief : A pedestrian walks behind a reversing vehicle.
      why   : The requested pedestrian-behind-reversing-vehicle arrangement is present, but the measured near miss is mainly with a stopped van and does not create a genuine contested-space interaction.
      flags : CHALLENGER_STOPPED_AT_CONFLICT, CHALLENGER_STOPPED_AFTER_CROSSING, NEAR_COLLISION_BY_TIMING
      phys  : contested=True pathSep=0.0 m gap=0.72 s C3b=True
      trace : /tmp/vista-dev2-blind/c5-reversing-ped-blind/batch-iter1/belmont-research-center/81204cf62aba83bf/draw-000.trace.json.gz
  [blind] c5-reversing-ped (C5.pedestrian)  -> intent-not-realised   {'R1': 1, 'R2': 4, 'R3': 3, 'R4': 3, 'R5': 2}   HQ-admitted=False
      brief : A pedestrian walks behind a reversing vehicle.
      why   : This is a severe pedestrian conflict, but it does not realise the brief because the vehicle that should be reversing never moves.
      flags : CHALLENGER_STOPPED_AT_CONFLICT, CHALLENGER_STOPPED_AFTER_CROSSING, NEAR_COLLISION_BY_TIMING
      phys  : contested=True pathSep=0.0 m gap=0 s C3b=True
      trace : /tmp/vista-dev2-blind/c5-reversing-ped-blind/batch-iter1/richmond-field-station/38ebdb2bfe0de992/draw-000.trace.json.gz
  [blind] c8-narrowing (C8.workzone)  -> invalid   {'R1': 4, 'R2': 4, 'R3': 3, 'R4': 3, 'R5': 0}   HQ-admitted=False
      brief : Barriers narrow the ego lane through a work area.
      why   : This is a strong genuine work-zone pinch, but the stopped oncoming vehicle makes the conflict feel more route-exhaustion-driven than naturally negotiated.
      flags : CHALLENGER_STOPPED_AT_CONFLICT, CHALLENGER_STOPPED_AFTER_CROSSING, NEAR_COLLISION_BY_TIMING, EGO_INTERSECTS_PROP, EGO_INTERSECTS_PROP, EGO_INTERSECTS_PROP, EGO_INTERSECTS_PROP
      caps  : [{'flag': 'EGO_INTERSECTS_PROP', 'dim': 'R5', 'from': 3, 'to': 0}]
      phys  : contested=True pathSep=0.0 m gap=0.0 s C3b=True
      trace : /tmp/vista-dev2-blind/c8-narrowing-blind/batch-final/belmont-research-center/034183bd20ecd06e/draw-000.trace.json.gz
  [blind] c8-narrowing (C8.workzone)  -> invalid   {'R1': 4, 'R2': 4, 'R3': 3, 'R4': 4, 'R5': 0}   HQ-admitted=False
      brief : Barriers narrow the ego lane through a work area.
      why   : A genuinely strong work-zone squeeze scenario, though the zero-clearance pass makes the encounter look slightly artifact-like rather than naturally close.
      flags : CHALLENGER_STOPPED_AT_CONFLICT, CHALLENGER_STOPPED_AFTER_CROSSING, NEAR_COLLISION_BY_TIMING, EGO_INTERSECTS_PROP, EGO_INTERSECTS_PROP
      caps  : [{'flag': 'EGO_INTERSECTS_PROP', 'dim': 'R5', 'from': 3, 'to': 0}]
      phys  : contested=True pathSep=0.0 m gap=0.0 s C3b=True
      trace : /tmp/vista-dev2-blind/c8-narrowing-blind/batch-final/el-camino-road/0e40b648d087eabc/draw-000.trace.json.gz
  [blind] c8-narrowing (C8.workzone)  -> invalid   {'R1': 4, 'R2': 4, 'R3': 3, 'R4': 3, 'R5': 0}   HQ-admitted=False
      brief : Barriers narrow the ego lane through a work area.
      why   : This is a genuinely difficult work-zone lane squeeze, but the stopped oncoming vehicle and exact zero-clearance pass make the conflict look more like route exhaustion than a natural moving encroachment.
      flags : CHALLENGER_STOPPED_AT_CONFLICT, CHALLENGER_STOPPED_AFTER_CROSSING, NEAR_COLLISION_BY_TIMING, EGO_INTERSECTS_PROP, EGO_INTERSECTS_PROP, EGO_INTERSECTS_PROP, EGO_INTERSECTS_PROP
      caps  : [{'flag': 'EGO_INTERSECTS_PROP', 'dim': 'R5', 'from': 3, 'to': 0}]
      phys  : contested=True pathSep=0.0 m gap=0.0 s C3b=True
      trace : /tmp/vista-dev2-blind/c8-narrowing-blind/batch-final/yale-street/01fa6e1db627392a/draw-001.trace.json.gz
  [blind] c8-taper-merge (C8.workzone)  -> invalid   {'R1': 1, 'R2': 2, 'R3': 2, 'R4': 3, 'R5': 0}   HQ-admitted=False
      brief : A lane-closure taper forces traffic to merge in front of the ego.
      why   : This is a heavily braking connector crossing, not a lane-closure taper that forces another vehicle to merge in front of the ego.
      flags : PROXIMITY_IS_NOT_THE_CONFLICT, EGO_INTERSECTS_PROP, EGO_INTERSECTS_PROP
      caps  : [{'flag': 'EGO_INTERSECTS_PROP', 'dim': 'R5', 'from': 3, 'to': 0}]
      phys  : contested=True pathSep=0.0 m gap=1.5 s C3b=False
      trace : /tmp/vista-dev2-blind/c8-taper-merge-blind/batch-final/belmont-research-center/cc22cbdd4a401dc8/draw-000.trace.json.gz
  [blind] c9-animal (C9.hazard)  -> invalid   {'R1': 0, 'R2': 1, 'R3': 2, 'R4': 3, 'R5': 0}   HQ-admitted=True
      brief : An animal crosses into the ego path.
      why   : This is a pedestrian post-encroachment pass-by, not an animal crossing into the ego path or a simultaneous conflict.
      flags : CHALLENGER_STOPPED_AT_CONFLICT, CHALLENGER_STOPPED_AFTER_CROSSING, EGO_INTERSECTS_PROP
      caps  : [{'flag': 'EGO_INTERSECTS_PROP', 'dim': 'R5', 'from': 3, 'to': 0}]
      phys  : contested=True pathSep=0.0 m gap=3.88 s C3b=True
      trace : /tmp/vista-dev2-blind/c9-animal-blind/batch-final/belmont-research-center/16b1e000ab3ccd37/draw-000.trace.json.gz
  [blind] c9-animal (C9.hazard)  -> intent-not-realised   {'R1': 0, 'R2': 1, 'R3': 2, 'R4': 3, 'R5': 2}   HQ-admitted=True
      brief : An animal crosses into the ego path.
      why   : This is a pedestrian post-encroachment pass, not an animal entering the ego path in a contemporaneous conflict.
      flags : CHALLENGER_STOPPED_AT_CONFLICT, CHALLENGER_STOPPED_AFTER_CROSSING
      phys  : contested=True pathSep=0.0 m gap=3.14 s C3b=True
      trace : /tmp/vista-dev2-blind/c9-animal-blind/batch-final/easterbrook-discovery-school/03ba449df060654a/draw-001.trace.json.gz
  [blind] c9-post-crest (C9.hazard)  -> intent-not-realised   {'R1': 1, 'R2': 1, 'R3': 0, 'R4': 3, 'R5': 3}   HQ-admitted=True
      brief : A hazard sits just beyond a crest or curve.
      why   : The clip shows ordinary braking behind a stopped car, not a hazard hidden just beyond a crest or curve.
      flags : CHALLENGER_STATIC, NO_CONTESTED_SPACE, CHALLENGER_STOPPED_AFTER_CROSSING, NEAR_COLLISION_BY_TIMING, CHALLENGER_PARTIALLY_ABSENT
      phys  : contested=False pathSep=4.351 m gap=0 s C3b=False
      trace : /tmp/vista-dev2-blind/c9-post-crest-blind/batch-iter2/easterbrook-discovery-school/f635cffb81de551a/draw-000.trace.json.gz
  [blind] c9-post-crest (C9.hazard)  -> intent-not-realised   {'R1': 1, 'R2': 1, 'R3': 0, 'R4': 3, 'R5': 3}   HQ-admitted=True
      brief : A hazard sits just beyond a crest or curve.
      why   : This is a physically valid but ordinary late-revealed stopped-car follow, not a hazard positioned beyond a crest or curve.
      flags : CHALLENGER_STATIC, NO_CONTESTED_SPACE, CHALLENGER_STOPPED_AFTER_CROSSING, NEAR_COLLISION_BY_TIMING, CHALLENGER_PARTIALLY_ABSENT
      phys  : contested=False pathSep=2.961 m gap=0 s C3b=False
      trace : /tmp/vista-dev2-blind/c9-post-crest-blind/batch-iter2/richmond-field-station/79cf6dd15e74e188/draw-000.trace.json.gz
  [blind] c9-post-crest (C9.hazard)  -> physically-valid-but-boring   {'R1': 2, 'R2': 1, 'R3': 1, 'R4': 3, 'R5': 3}   HQ-admitted=True
      brief : A hazard sits just beyond a crest or curve.
      why   : This is a valid braking-to-a-stopped-car clip, but it does not make the blind crest-or-curve mechanism or a consequential conflict evident.
      flags : CHALLENGER_STATIC, NO_CONTESTED_SPACE, CHALLENGER_STOPPED_AFTER_CROSSING, NEAR_COLLISION_BY_TIMING, CHALLENGER_PARTIALLY_ABSENT
      phys  : contested=False pathSep=2.872 m gap=0 s C3b=False
      trace : /tmp/vista-dev2-blind/c9-post-crest-blind/batch-iter2/yale-street/3869f4a9b6b74e5d/draw-000.trace.json.gz
  [sight] c1-tailgated-brake (C1.car-following)  -> physically-valid-but-boring   {'R1': 3, 'R2': 2, 'R3': 1, 'R4': 3, 'R5': 4}   HQ-admitted=True
      brief : The ego is tailgated while the lead ahead brakes.
      why   : The requested pattern is present, but it is a routine lead-car stop with comfortable clearance rather than an interesting tailgating edge case.
      flags : CHALLENGER_STOPPED_AT_CONFLICT, PROXIMITY_IS_NOT_THE_CONFLICT
      phys  : contested=True pathSep=0.0 m gap=0.96 s C3b=True
      trace : /tmp/vista-dev2-sight/c1-tailgated-brake-sight/batch-iter1/easterbrook-discovery-school/99ca00b2031968a5/draw-000.trace.json.gz
  [sight] c2-cut-out-reveals (C2.cut-in-merge)  -> physically-valid-but-boring   {'R1': 4, 'R2': 1, 'R3': 2, 'R4': 3, 'R5': 3}   HQ-admitted=True
      brief : A lead vehicle cuts out and reveals a stopped vehicle ahead.
      why   : The reveal is realised, but the ego encounters a stationary vehicle with ample clearance and never faces a genuine contested-space conflict.
      flags : CHALLENGER_STATIC, NO_CONTESTED_SPACE, CHALLENGER_STOPPED_AFTER_CROSSING, NEAR_COLLISION_BY_TIMING
      phys  : contested=True pathSep=0.0 m gap=2.04 s C3b=False
      trace : /tmp/vista-dev2-sight/c2-cut-out-reveals-sight/batch-final/el-camino-road/64b6b5038cd5e0ad/draw-000.trace.json.gz
  [sight] c2-cut-out-reveals (C2.cut-in-merge)  -> intent-not-realised   {'R1': 1, 'R2': 1, 'R3': 0, 'R4': 3, 'R5': 4}   HQ-admitted=True
      brief : A lead vehicle cuts out and reveals a stopped vehicle ahead.
      why   : This is a physically valid but ordinary stop-and-follow sequence, and the lead never visibly cuts out to expose the stopped vehicle.
      flags : CHALLENGER_STOPPED_AT_CONFLICT, PROXIMITY_IS_NOT_THE_CONFLICT
      phys  : contested=True pathSep=0.0 m gap=3.38 s C3b=False
      trace : /tmp/vista-dev2-sight/c2-cut-out-reveals-sight/batch-final/yale-street/5af5d4e6e716600b/draw-000.trace.json.gz
  [sight] c2-exit-across (C2.cut-in-merge)  -> intent-not-realised   {'R1': 1, 'R2': 1, 'R3': 2, 'R4': 3, 'R5': 2}   HQ-admitted=True
      brief : A vehicle crosses the ego lane to reach an exit.
      why   : This is a physically valid close pass of a stationary, route-exhausted car, not a vehicle crossing the ego lane to reach an exit.
      flags : CHALLENGER_STOPPED_AT_CONFLICT, CHALLENGER_STOPPED_AFTER_CROSSING, NEAR_COLLISION_BY_TIMING
      phys  : contested=True pathSep=0.0 m gap=0.0 s C3b=True
      trace : /tmp/vista-dev2-sight/c2-exit-across-sight/batch-final/belmont-research-center/9c687d2493be3dcb/draw-000.trace.json.gz
  [sight] c5-bus-stop-emergence (C5.pedestrian)  -> invalid   {'R1': 4, 'R2': 3, 'R3': 4, 'R4': 3, 'R5': 0}   HQ-admitted=True
      brief : A pedestrian emerges in front of a stopped bus.
      why   : This is a genuinely strong edge case: bus occlusion, a curved constrained roadway, and a moving pedestrian force a substantial but successful response.
      flags : EGO_INTERSECTS_PROP, EGO_INTERSECTS_PROP
      caps  : [{'flag': 'EGO_INTERSECTS_PROP', 'dim': 'R5', 'from': 4, 'to': 0}]
      phys  : contested=True pathSep=0.0 m gap=1.44 s C3b=True
      trace : /tmp/vista-dev2-sight/c5-bus-stop-emergence-sight/batch-iter2/el-camino-road/11e636f78522c8ae/draw-000.trace.json.gz
  [sight] c8-taper-merge (C8.workzone)  -> invalid   {'R1': 2, 'R2': 4, 'R3': 3, 'R4': 3, 'R5': 0}   HQ-admitted=False
      brief : A lane-closure taper forces traffic to merge in front of the ego.
      why   : This is a genuine and difficult stopped-truck merge conflict, but it does not clearly realise the authored lane-closure-taper mechanism.
      flags : CHALLENGER_STOPPED_AT_CONFLICT, CHALLENGER_STOPPED_AFTER_CROSSING, NEAR_COLLISION_BY_TIMING, EGO_INTERSECTS_PROP
      caps  : [{'flag': 'EGO_INTERSECTS_PROP', 'dim': 'R5', 'from': 3, 'to': 0}]
      phys  : contested=True pathSep=0.0 m gap=0 s C3b=True
      trace : /tmp/vista-dev2-sight/c8-taper-merge-sight/batch-final/easterbrook-discovery-school/68ac996bfbcbc216/draw-000.trace.json.gz
  [sight] c8-taper-merge (C8.workzone)  -> invalid   {'R1': 4, 'R2': 4, 'R3': 3, 'R4': 3, 'R5': 0}   HQ-admitted=False
      brief : A lane-closure taper forces traffic to merge in front of the ego.
      why   : This is a genuine high-conflict taper merge, not a routine pass-by, because the closing vehicle stops in the ego's path with effectively zero clearance.
      flags : CHALLENGER_STOPPED_AT_CONFLICT, CHALLENGER_STOPPED_AFTER_CROSSING, NEAR_COLLISION_BY_TIMING, EGO_INTERSECTS_PROP
      caps  : [{'flag': 'EGO_INTERSECTS_PROP', 'dim': 'R5', 'from': 3, 'to': 0}]
      phys  : contested=True pathSep=0.0 m gap=0.0 s C3b=True
      trace : /tmp/vista-dev2-sight/c8-taper-merge-sight/batch-final/easterbrook-discovery-school/92ba2a0f232d2e48/draw-000.trace.json.gz
  [sight] c8-taper-merge (C8.workzone)  -> invalid   {'R1': 3, 'R2': 4, 'R3': 3, 'R4': 0, 'R5': 0}   HQ-admitted=False
      brief : A lane-closure taper forces traffic to merge in front of the ego.
      why   : The merge conflict is genuine and visually clear, but the ego does nothing through a zero-clearance encounter, so it does not provide a meaningful driving-response edge case.
      flags : CHALLENGER_STOPPED_AT_CONFLICT, CHALLENGER_STOPPED_AFTER_CROSSING, NEAR_COLLISION_BY_TIMING, EGO_INTERSECTS_PROP
      caps  : [{'flag': 'EGO_INTERSECTS_PROP', 'dim': 'R5', 'from': 3, 'to': 0}]
      phys  : contested=True pathSep=0.0 m gap=0.0 s C3b=True
      trace : /tmp/vista-dev2-sight/c8-taper-merge-sight/batch-final/easterbrook-discovery-school/f294828ec1ac1e70/draw-000.trace.json.gz
  [sight] c9-post-crest (C9.hazard)  -> physically-valid-but-boring   {'R1': 3, 'R2': 1, 'R3': 2, 'R4': 3, 'R5': 4}   HQ-admitted=True
      brief : A hazard sits just beyond a crest or curve.
      why   : The curve placement is realised, but the stationary truck remains a comfortable 2.622 m pass-by rather than a genuine contested-space hazard.
      flags : CHALLENGER_STATIC, NO_CONTESTED_SPACE, CHALLENGER_STOPPED_AFTER_CROSSING, NEAR_COLLISION_BY_TIMING
      phys  : contested=False pathSep=2.622 m gap=0 s C3b=False
      trace : /tmp/vista-dev2-sight/c9-post-crest-sight/batch-iter1/belmont-research-center/6041c290ff5a9c72/draw-000.trace.json.gz
  [sight] c9-post-crest (C9.hazard)  -> physically-valid-but-boring   {'R1': 3, 'R2': 1, 'R3': 2, 'R4': 3, 'R5': 3}   HQ-admitted=True
      brief : A hazard sits just beyond a crest or curve.
      why   : The clip realises a stopped-vehicle-around-a-curve scenario and demonstrates braking, but the encounter remains a conventional, well-spaced approach rather than a compelling edge case.
      flags : CHALLENGER_STATIC, NO_CONTESTED_SPACE, CHALLENGER_STOPPED_AFTER_CROSSING, NEAR_COLLISION_BY_TIMING
      caps  : [{'flag': 'CHALLENGER_STATIC', 'dim': 'R2', 'from': 2, 'to': 1}]
      phys  : contested=False pathSep=2.154 m gap=0 s C3b=False
      trace : /tmp/vista-dev2-sight/c9-post-crest-sight/batch-iter1/belmont-research-center/fe78850ede31589a/draw-000.trace.json.gz
  [sight] c9-post-crest (C9.hazard)  -> intent-not-realised   {'R1': 0, 'R2': 1, 'R3': 0, 'R4': 3, 'R5': 3}   HQ-admitted=True
      brief : A hazard sits just beyond a crest or curve.
      why   : This is physically valid but boring ordinary following, and it does not realise the required beyond-a-crest-or-curve hazard.
      flags : CHALLENGER_STATIC, NO_CONTESTED_SPACE, CHALLENGER_STOPPED_AFTER_CROSSING, NEAR_COLLISION_BY_TIMING
      phys  : contested=False pathSep=3.233 m gap=0 s C3b=False
      trace : /tmp/vista-dev2-sight/c9-post-crest-sight/batch-iter1/easterbrook-discovery-school/49b50a71d2bb1088/draw-000.trace.json.gz

## 8. Physics-side flags across all judged cells

  blind  CHALLENGER_PARTIALLY_ABSENT        3
  blind  CHALLENGER_STATIC                  9
  blind  CHALLENGER_STOPPED_AFTER_CROSSING  25
  blind  CHALLENGER_STOPPED_AT_CONFLICT     17
  blind  EGO_INTERSECTS_PROP                15
  blind  EGO_NEVER_ACTED                    1
  blind  EGO_RESPONSE_NEGLIGIBLE            1
  blind  NEAR_COLLISION_BY_TIMING           22
  blind  NO_CONTESTED_SPACE                 6
  blind  PROXIMITY_IS_NOT_THE_CONFLICT      12
  sight  CHALLENGER_STATIC                  4
  sight  CHALLENGER_STOPPED_AFTER_CROSSING  15
  sight  CHALLENGER_STOPPED_AT_CONFLICT     16
  sight  EGO_INTERSECTS_PROP                5
  sight  NEAR_COLLISION_BY_TIMING           15
  sight  NO_CONTESTED_SPACE                 4
  sight  PROXIMITY_IS_NOT_THE_CONFLICT      4

  NO contested-space event (paths never overlapped) despite passing the FROZEN gate: sight 5, blind 11, total 16/69
  -> above the "couple of cells" threshold: NO_CONTESTED_SPACE is worth adding as a Q-clause.
