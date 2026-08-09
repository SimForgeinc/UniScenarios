# HEAD-TO-HEAD: sight vs blind, judged independently

Gates, labelled unambiguously:
  FROZEN GATE = the pre-registered contract (sha256 1a08698e95fca4bc): C1..C5, >=2 maps,
                >=3 distinct sites. THIS IS THE CONTRACTUAL HEAD-TO-HEAD NUMBER.
  HQ GATE     = frozen gate AND the authoring lane's Q1..Q6 quality clauses. Strictly tighter.
  JUDGE       = this lane's independent rubric (RUBRIC.md), applied to cells the frozen gate
                already admitted. It never loosens anything; it only removes.

## 1. MORE -- admission

mode     briefs  FROZEN adm    rate           95% CI  HQ adm    rate           95% CI
sight        60          20   0.333   (0.227, 0.459)       9   0.150   (0.081, 0.261)
blind        60          22   0.367   (0.256, 0.493)      10   0.167    (0.093, 0.28)

  FROZEN gate, sight vs blind admission: Fisher exact p = 0.8484
  HQ gate,     sight vs blind admission: Fisher exact p = 1.0
  Lane-1 blind baseline for reference: DEV 0.312 (29-31 admitted of 92).

## 2. BETTER -- quality of the cells the FROZEN gate admitted

### sight  (60 cells judged, up to 3 per admitted brief)
    high                            20   0.333
    acceptable                       7   0.117
    physically-valid-but-boring     16   0.267
    intent-not-realised             10   0.167
    invalid                          7   0.117
    -> good (high|acceptable)       27   0.450  CI (0.331, 0.575)
    -> gate admitted, judge rejects  33   0.550
    mean R1 3.13  CI (2.8, 3.45)
    mean R2 2.35  CI (2.05, 2.67)
    mean R3 2.27  CI (2, 2.52)
    mean R4 2.92  CI (2.78, 3.02)
    mean R5 3.28  CI (2.98, 3.57)

### blind  (66 cells judged, up to 3 per admitted brief)
    high                            16   0.242
    acceptable                      11   0.167
    physically-valid-but-boring     16   0.242
    intent-not-realised             13   0.197
    invalid                         10   0.152
    -> good (high|acceptable)       27   0.409  CI (0.299, 0.53)
    -> gate admitted, judge rejects  39   0.591
    mean R1 2.92  CI (2.64, 3.2)
    mean R2 2.30  CI (2, 2.61)
    mean R3 2.44  CI (2.26, 2.61)
    mean R4 3.05  CI (2.92, 3.15)
    mean R5 2.80  CI (2.48, 3.09)

  quality difference, Fisher exact p = 0.7195

## 3. The same, with the R3 (novelty) clause REMOVED from the verdict rules
   R3 anchor 0 is literally "generic car-following", so R3 demotes that whole category in BOTH
   modes. This block shows how much of the verdict R3 is carrying. It is NOT a softened rubric;
   the rubric of record is section 2.

  sight  good  30/60  = 0.500   high:20  acceptable:10  physically:13  intent:10  invalid:7
  blind  good  31/66  = 0.470   high:16  acceptable:15  physically:12  intent:13  invalid:10

## 4. Per category -- so category mix cannot masquerade as a mode effect

category                     sight n  good   rate   diff | blind n  good   rate   diff
C1.car-following                  3     0   0.00   54.7 |       6     3   0.50   64.8
C10.oncoming                      3     0   0.00   70.8 |       3     1   0.33   80.4
C11.parking                       0     0    nan    nan |       3     1   0.33   61.1
C12.school                        0     0    nan    nan |       6     4   0.67   73.6
C14.loss-of-control               3     3   1.00   64.8 |       3     3   1.00   82.2
C2.cut-in-merge                  12    10   0.83   71.7 |       9     3   0.33   70.9
C3.intersection                   6     6   1.00   76.9 |       9     4   0.44   70.6
C5.pedestrian                     3     0   0.00   49.7 |      12     5   0.42   74.1
C6.cyclist-ptw                    6     2   0.33   60.9 |       3     0   0.00   78.0
C7.occlusion                      3     1   0.33   83.8 |       6     1   0.17   72.3
C8.workzone                      12     5   0.42   77.7 |       3     2   0.67   82.2
C9.hazard                         9     0   0.00   59.6 |       3     0   0.00   69.4

## 4b. Controlling the category-mix confound

   Pooled quality in section 2 compares different sets of briefs: the two modes did not admit
   the same ones. Two controls, in increasing order of strictness.

   (i) CATEGORY-MATCHED -- restricted to categories BOTH modes admitted: ['C1.car-following', 'C10.oncoming', 'C14.loss-of-control', 'C2.cut-in-merge', 'C3.intersection', 'C5.pedestrian', 'C6.cyclist-ptw', 'C7.occlusion', 'C8.workzone', 'C9.hazard']
       sight 27/60 = 0.450   blind 22/57 = 0.386   Fisher exact p = 0.5746
       mean difficulty  sight 68.8   blind 73.0
       blind-ONLY categories ['C11.parking', 'C12.school']: 5/9 good (0.556) -- this block is what the pooled number is really comparing

   (ii) PAIRED -- the 6 briefs BOTH modes admitted. Same sentence, same gate,
        same surface hash. This is the cleanest available comparison.
        briefId                    category               |     sight   diff |     blind   diff
        c14-friction-patch         C14.loss-of-control    |    3/3      64.8 |    3/3      82.2
        c2-blind-spot              C2.cut-in-merge        |    2/3      53.8 |    1/3      76.9
        c2-parking-cut-in          C2.cut-in-merge        |    3/3      77.8 |    1/3      66.7
        c3-ev-crossing             C3.intersection        |    3/3      70.7 |    0/3      50.2
        c3-ltap-od                 C3.intersection        |    3/3      83.0 |    2/3      80.8
        c8-night-zone              C8.workzone            |    3/3      82.8 |    2/3      82.2
        PAIRED TOTAL  sight 17/18 = 0.944   blind 9/18 = 0.500   Fisher exact p = 0.0072

## 5. Measured difficulty (trajectory-derived; the authoring surface cannot reach it)

  sight  n= 60  mean  68.8  median  71.2  sd  15.6  min 23.5  max 90.0  95% CI (bootstrap) (64.81, 72.62)
         per-cell: [23.5, 29.7, 47.4, 48.2, 49.5, 49.5, 50.1, 50.3, 50.3, 50.6, 51.1, 53.2, 53.5, 53.5, 54.3, 55.7, 57.3, 59.7, 60.0, 60.7, 60.9, 62.3, 64.0, 64.6, 65.2, 66.4, 66.8, 69.7, 70.0, 70.8, 71.7, 73.8, 73.8, 75.7, 75.8, 77.9, 79.6, 79.6, 79.9, 80.0, 80.1, 81.0, 81.5, 81.5, 81.6, 82.4, 82.4, 82.7, 83.4, 83.8, 84.1, 84.5, 85.4, 85.8, 86.3, 87.5, 87.7, 88.8, 89.9, 90.0]
  blind  n= 66  mean  72.5  median  77.0  sd  14.4  min 28.5  max 90.0  95% CI (bootstrap) (69.1, 75.88)
         per-cell: [28.5, 32.1, 40.9, 45.6, 47.1, 48.4, 49.1, 50.9, 51.4, 54.6, 55.3, 56.3, 59.5, 60.7, 62.2, 65.6, 66.6, 67.0, 68.5, 69.2, 71.2, 71.2, 72.7, 74.5, 74.8, 75.6, 76.0, 76.1, 76.1, 76.1, 76.6, 76.7, 76.9, 77.0, 77.1, 77.4, 77.6, 77.6, 79.2, 79.3, 79.3, 79.4, 80.3, 80.5, 80.7, 81.4, 81.4, 81.4, 81.7, 82.2, 83.0, 83.1, 83.1, 84.1, 84.3, 84.5, 84.5, 85.6, 86.7, 87.0, 87.1, 87.2, 89.1, 90.0, 90.0, 90.0]

  difference (sight - blind): -3.7, 95% bootstrap CI (-9.21, 1.39)
  ** the CI spans zero: this is NOT evidence of a difficulty difference. **

## 6. Better, or merely more?

  MORE   : frozen-gate admission  sight 20/60 = 0.333   blind 22/60 = 0.367
           HQ-gate admission      sight 9/60 = 0.150   blind 10/60 = 0.167
  BETTER : judged good | admitted sight 0.450   blind 0.409
  QUALITY-ADJUSTED YIELD (admitted briefs x good rate, frozen gate):
           sight 20 x 0.450 = 9.00
           blind 22 x 0.409 = 9.00

  READ: sight admitted fewer briefs than blind, and the quality of its admitted cells is
        comparable.
        => any difference is in QUANTITY only: sight produced FEWER, not better or worse.

  BEFORE READING ANY POOLED QUALITY NUMBER, SEE SECTION 4b. Pooled quality compares
  DIFFERENT SETS OF BRIEFS, because the two modes did not admit the same ones.

## 7. Every cell the FROZEN gate admitted that the judge rejects

  [blind] c1-lead-hard-brake (C1.car-following)  -> physically-valid-but-boring   {'R1': 3, 'R2': 2, 'R3': 1, 'R4': 3, 'R5': 4}   HQ-admitted=True
      brief : The lead vehicle brakes hard in flowing traffic; the ego follows at a normal headway with a human reaction delay.
      why   : This is a valid and competent car-following stop, but it is a generic ordinary lead-braking clip rather than a compelling edge case.
      flags : CHALLENGER_STOPPED_AT_CONFLICT, PROXIMITY_IS_NOT_THE_CONFLICT
      phys  : contested=True pathSep=0.0 m gap=2.38 s C3b=False
      trace : /tmp/vista-held-blind/c1-lead-hard-brake-blind/batch-iter0/belmont-research-center/0a5c9a3d6746db63/draw-000.trace.json.gz
  [blind] c1-lead-hard-brake (C1.car-following)  -> physically-valid-but-boring   {'R1': 4, 'R2': 2, 'R3': 1, 'R4': 3, 'R5': 4}   HQ-admitted=True
      brief : The lead vehicle brakes hard in flowing traffic; the ego follows at a normal headway with a human reaction delay.
      why   : This cleanly realises ordinary delayed-response lead braking, but it is a routine car-following example rather than an interesting edge case.
      flags : CHALLENGER_STOPPED_AT_CONFLICT, PROXIMITY_IS_NOT_THE_CONFLICT
      phys  : contested=True pathSep=0.0 m gap=2.4 s C3b=False
      trace : /tmp/vista-held-blind/c1-lead-hard-brake-blind/batch-iter0/easterbrook-discovery-school/07ef26f044da2a36/draw-000.trace.json.gz
  [blind] c1-lead-hard-brake (C1.car-following)  -> physically-valid-but-boring   {'R1': 4, 'R2': 2, 'R3': 1, 'R4': 3, 'R5': 4}   HQ-admitted=True
      brief : The lead vehicle brakes hard in flowing traffic; the ego follows at a normal headway with a human reaction delay.
      why   : The clip cleanly realises ordinary delayed-response car-following, but it is not distinctive enough for an edge-case corpus slot.
      flags : CHALLENGER_STOPPED_AT_CONFLICT, PROXIMITY_IS_NOT_THE_CONFLICT
      phys  : contested=True pathSep=0.0 m gap=2.24 s C3b=False
      trace : /tmp/vista-held-blind/c1-lead-hard-brake-blind/batch-iter0/easterbrook-discovery-school/24555fd4e93a8f54/draw-000.trace.json.gz
  [blind] c10-overtake-oncoming (C10.oncoming)  -> intent-not-realised   {'R1': 1, 'R2': 2, 'R3': 1, 'R4': 3, 'R5': 2}   HQ-admitted=True
      brief : A third party overtakes toward the ego in the oncoming lane.
      why   : This is a hard stopped-lead-vehicle encounter, not a third party overtaking toward the ego in the oncoming lane.
      flags : CHALLENGER_STOPPED_AT_CONFLICT, CHALLENGER_STOPPED_AFTER_CROSSING, NEAR_COLLISION_BY_TIMING
      phys  : contested=True pathSep=0.0 m gap=0.0 s C3b=True
      trace : /tmp/vista-held-blind/c10-overtake-oncoming-blind/batch-final/belmont-research-center/90d27c117e2cbe52/draw-000.trace.json.gz
  [blind] c10-overtake-oncoming (C10.oncoming)  -> intent-not-realised   {'R1': 1, 'R2': 1, 'R3': 2, 'R4': 3, 'R5': 3}   HQ-admitted=True
      brief : A third party overtakes toward the ego in the oncoming lane.
      why   : This is a physically valid close pass of a stopped car, not the requested third-party overtaking-toward-ego event.
      flags : CHALLENGER_STOPPED_AT_CONFLICT, CHALLENGER_STOPPED_AFTER_CROSSING, NEAR_COLLISION_BY_TIMING
      phys  : contested=True pathSep=0.0 m gap=0.0 s C3b=True
      trace : /tmp/vista-held-blind/c10-overtake-oncoming-blind/batch-final/el-camino-road/a043886198f5b5e9/draw-000.trace.json.gz
  [blind] c11-aisle-conflict (C11.parking)  -> intent-not-realised   {'R1': 1, 'R2': 1, 'R3': 2, 'R4': 3, 'R5': 4}   HQ-admitted=False
      brief : A conflict occurs in a parking aisle at low speed.
      why   : This is a plausible close pass, but it does not realize the requested parking-aisle conflict because the van never actually contests the ego's space.
      flags : CHALLENGER_STOPPED_AT_CONFLICT, CHALLENGER_STOPPED_AFTER_CROSSING, NEAR_COLLISION_BY_TIMING
      phys  : contested=False pathSep=0.444 m gap=0.0 s C3b=True
      trace : /tmp/vista-held-blind/c11-aisle-conflict-blind/batch-iter2/belmont-research-center/1fe43cbbb2e2fe0c/draw-000.trace.json.gz
  [blind] c11-aisle-conflict (C11.parking)  -> intent-not-realised   {'R1': 1, 'R2': 1, 'R3': 2, 'R4': 3, 'R5': 3}   HQ-admitted=False
      brief : A conflict occurs in a parking aisle at low speed.
      why   : This is physically valid and well-controlled, but it is a cautious close pass of a stopped van, not a genuine parking-aisle conflict.
      flags : CHALLENGER_STOPPED_AT_CONFLICT, CHALLENGER_STOPPED_AFTER_CROSSING, NEAR_COLLISION_BY_TIMING
      phys  : contested=False pathSep=0.838 m gap=0.0 s C3b=True
      trace : /tmp/vista-held-blind/c11-aisle-conflict-blind/batch-iter2/easterbrook-discovery-school/467b3dde21fbe53f/draw-000.trace.json.gz
  [blind] c12-ball-then-child (C12.school)  -> physically-valid-but-boring   {'R1': 3, 'R2': 1, 'R3': 3, 'R4': 3, 'R5': 3}   HQ-admitted=True
      brief : A ball rolls out followed by a child in a school zone.
      why   : The requested sequence is present, but the scored near miss is with a stopped object, making this a pass-by rather than a genuinely dynamic edge case.
      flags : CHALLENGER_STOPPED_AT_CONFLICT, CHALLENGER_STOPPED_AFTER_CROSSING, NEAR_COLLISION_BY_TIMING
      phys  : contested=True pathSep=0.0 m gap=0.0 s C3b=True
      trace : /tmp/vista-held-blind/c12-ball-then-child-blind/batch-final/belmont-research-center/4b9f3c08614ff748/draw-000.trace.json.gz
  [blind] c12-school-dropoff (C12.school)  -> invalid   {'R1': 3, 'R2': 2, 'R3': 2, 'R4': 3, 'R5': 0}   HQ-admitted=False
      brief : Chaotic school drop-off with vehicles and children.
      why   : This is a plausible, well-handled child crossing, but it is not yet a high-value edge case because the child clears the contested ground before the ego arrives and the drop-off scene is not truly chaotic.
      flags : CHALLENGER_STOPPED_AFTER_CROSSING, EGO_INTERSECTS_PROP
      caps  : [{'flag': 'EGO_INTERSECTS_PROP', 'dim': 'R5', 'from': 3, 'to': 0}]
      phys  : contested=True pathSep=0.0 m gap=0.58 s C3b=True
      trace : /tmp/vista-held-blind/c12-school-dropoff-blind/batch-iter2/belmont-research-center/a16e461b03263a96/draw-000.trace.json.gz
  [blind] c2-blind-spot (C2.cut-in-merge)  -> intent-not-realised   {'R1': 1, 'R2': 1, 'R3': 2, 'R4': 3, 'R5': 2}   HQ-admitted=True
      brief : A vehicle drifts from the adjacent lane into the ego blind spot.
      why   : This is a difficult-looking stopped-lead-vehicle overtake, not the requested adjacent-lane drift into the ego blind spot.
      flags : CHALLENGER_STOPPED_AT_CONFLICT, CHALLENGER_STOPPED_AFTER_CROSSING, NEAR_COLLISION_BY_TIMING
      phys  : contested=True pathSep=0.0 m gap=0.0 s C3b=True
      trace : /tmp/vista-held-blind/c2-blind-spot-blind/batch-final/easterbrook-discovery-school/d9f386ec2ab987d1/draw-000.trace.json.gz
  [blind] c2-blind-spot (C2.cut-in-merge)  -> intent-not-realised   {'R1': 1, 'R2': 1, 'R3': 2, 'R4': 2, 'R5': 3}   HQ-admitted=True
      brief : A vehicle drifts from the adjacent lane into the ego blind spot.
      why   : This is a difficult-looking but fundamentally stationary-vehicle pass-by, not a vehicle drifting from an adjacent lane into the ego blind spot.
      flags : CHALLENGER_STOPPED_AT_CONFLICT, CHALLENGER_STOPPED_AFTER_CROSSING, NEAR_COLLISION_BY_TIMING
      phys  : contested=True pathSep=0.0 m gap=0.0 s C3b=True
      trace : /tmp/vista-held-blind/c2-blind-spot-blind/batch-final/yale-street/97b58869e436330a/draw-000.trace.json.gz
  [blind] c2-merge-gap-collapse (C2.cut-in-merge)  -> intent-not-realised   {'R1': 1, 'R2': 1, 'R3': 1, 'R4': 3, 'R5': 3}   HQ-admitted=False
      brief : A merging vehicle takes a gap that collapses.
      why   : This is a post-encroachment pass of a stopped van, not a genuine collapsing-gap merge conflict.
      flags : CHALLENGER_STOPPED_AT_CONFLICT, CHALLENGER_STOPPED_AFTER_CROSSING
      phys  : contested=True pathSep=0.0 m gap=3.52 s C3b=False
      trace : /tmp/vista-held-blind/c2-merge-gap-collapse-blind/batch-iter1/belmont-research-center/045e1e50f5ed10d1/draw-000.trace.json.gz
  [blind] c2-merge-gap-collapse (C2.cut-in-merge)  -> intent-not-realised   {'R1': 1, 'R2': 1, 'R3': 1, 'R4': 3, 'R5': 3}   HQ-admitted=False
      brief : A merging vehicle takes a gap that collapses.
      why   : This is a valid pass-by of a stopped adjacent-lane van, not a merging vehicle taking a gap that then collapses.
      flags : CHALLENGER_STOPPED_AT_CONFLICT, CHALLENGER_STOPPED_AFTER_CROSSING, NEAR_COLLISION_BY_TIMING
      phys  : contested=True pathSep=0.0 m gap=2.44 s C3b=False
      trace : /tmp/vista-held-blind/c2-merge-gap-collapse-blind/batch-iter1/easterbrook-discovery-school/0720ffc60e2f0224/draw-000.trace.json.gz
  [blind] c2-parking-cut-in (C2.cut-in-merge)  -> invalid   {'R1': 4, 'R2': 4, 'R3': 3, 'R4': 3, 'R5': 0}   HQ-admitted=True
      brief : A vehicle pulls out of a parking space directly into the ego lane.
      why   : This is a genuine and difficult parking-space pullout conflict, though the stopped lead vehicle makes the latter half resemble obstacle following and overtaking.
      flags : CHALLENGER_STOPPED_AT_CONFLICT, CHALLENGER_STOPPED_AFTER_CROSSING, NEAR_COLLISION_BY_TIMING, EGO_INTERSECTS_PROP, EGO_INTERSECTS_PROP
      caps  : [{'flag': 'EGO_INTERSECTS_PROP', 'dim': 'R5', 'from': 3, 'to': 0}]
      phys  : contested=True pathSep=0.0 m gap=0.0 s C3b=True
      trace : /tmp/vista-held-blind/c2-parking-cut-in-blind/batch-final/belmont-research-center/70ba6167b26be26f/draw-000.trace.json.gz
  [blind] c2-parking-cut-in (C2.cut-in-merge)  -> physically-valid-but-boring   {'R1': 3, 'R2': 1, 'R3': 2, 'R4': 1, 'R5': 4}   HQ-admitted=True
      brief : A vehicle pulls out of a parking space directly into the ego lane.
      why   : The pullout event is represented, but it is not a genuine conflict because the red car clears the relevant ground nearly a second before the ego arrives.
      flags : NO_CONTESTED_SPACE
      phys  : contested=False pathSep=3.442 m gap=0.98 s C3b=False
      trace : /tmp/vista-held-blind/c2-parking-cut-in-blind/batch-final/belmont-research-center/79853a5ccfaf4d20/draw-001.trace.json.gz
  [blind] c3-ev-crossing (C3.intersection)  -> physically-valid-but-boring   {'R1': 3, 'R2': 1, 'R3': 3, 'R4': 3, 'R5': 3}   HQ-admitted=False
      brief : An emergency vehicle crosses the junction against the ego.
      why   : The crossing event is present, but the purported near miss is dominated by the ego passing an ambulance that has already stopped.
      flags : CHALLENGER_STOPPED_AT_CONFLICT, CHALLENGER_STOPPED_AFTER_CROSSING, NEAR_COLLISION_BY_TIMING
      phys  : contested=True pathSep=0.0 m gap=0.0 s C3b=True
      trace : /tmp/vista-held-blind/c3-ev-crossing-blind/batch-iter2/belmont-research-center/115829bb9f0ae673/draw-000.trace.json.gz
  [blind] c3-ev-crossing (C3.intersection)  -> intent-not-realised   {'R1': 1, 'R2': 1, 'R3': 2, 'R4': 2, 'R5': 3}   HQ-admitted=False
      brief : An emergency vehicle crosses the junction against the ego.
      why   : This is a close pass of a stationary ambulance, not an emergency vehicle crossing the junction against the ego.
      flags : CHALLENGER_STOPPED_AT_CONFLICT, CHALLENGER_STOPPED_AFTER_CROSSING, NEAR_COLLISION_BY_TIMING
      phys  : contested=False pathSep=0.879 m gap=0.0 s C3b=True
      trace : /tmp/vista-held-blind/c3-ev-crossing-blind/batch-iter2/richmond-field-station/2a82337eefdfaed8/draw-000.trace.json.gz
  [blind] c3-ev-crossing (C3.intersection)  -> physically-valid-but-boring   {'R1': 3, 'R2': 1, 'R3': 3, 'R4': 2, 'R5': 4}   HQ-admitted=False
      brief : An emergency vehicle crosses the junction against the ego.
      why   : The ambulance does cross against the ego, but stopping before the encounter turns the intended near-conflict into an ordinary pass-by of a stationary vehicle.
      flags : CHALLENGER_STOPPED_AT_CONFLICT, NO_CONTESTED_SPACE, CHALLENGER_STOPPED_AFTER_CROSSING, NEAR_COLLISION_BY_TIMING
      phys  : contested=False pathSep=2.408 m gap=0.0 s C3b=False
      trace : /tmp/vista-held-blind/c3-ev-crossing-blind/batch-iter2/yale-street/ca6513f128032f6f/draw-000.trace.json.gz
  [blind] c3-ltap-od (C3.intersection)  -> intent-not-realised   {'R1': 1, 'R2': 4, 'R3': 3, 'R4': 3, 'R5': 4}   HQ-admitted=True
      brief : The ego turns left across an oncoming through vehicle at a junction.
      why   : This is a genuine and difficult near miss, but it depicts an opposing pass around a bend rather than the requested ego left turn across an oncoming through vehicle.
      flags : PROXIMITY_IS_NOT_THE_CONFLICT
      phys  : contested=True pathSep=0.0 m gap=3.72 s C3b=False
      trace : /tmp/vista-held-blind/c3-ltap-od-blind/batch-final/belmont-research-center/a94bfa1f7e8ce4cb/draw-001.trace.json.gz
  [blind] c3-red-light-late (C3.intersection)  -> invalid   {'R1': 4, 'R2': 4, 'R3': 3, 'R4': 3, 'R5': 1}   HQ-admitted=False
      brief : A vehicle enters the junction late against the signal.
      why   : This is a strong late-signal-entry edge case because the violating vehicle blocks the ego's path at t=4.8 s and forces hard braking with zero clearance.
      flags : CHALLENGER_STOPPED_AT_CONFLICT, CHALLENGER_DISCONTINUOUS, CHALLENGER_STOPPED_AFTER_CROSSING, NEAR_COLLISION_BY_TIMING
      caps  : [{'flag': 'CHALLENGER_DISCONTINUOUS', 'dim': 'R5', 'from': 3, 'to': 1}]
      phys  : contested=True pathSep=0.0 m gap=0.0 s C3b=True
      trace : /tmp/vista-held-blind/c3-red-light-late-blind/batch-iter2/richmond-field-station/dbd7e48cbf345314/draw-000.trace.json.gz
  [blind] c5-adult-midblock (C5.pedestrian)  -> invalid   {'R1': 2, 'R2': 3, 'R3': 3, 'R4': 4, 'R5': 0}   HQ-admitted=True
      brief : An adult crosses mid-block into the ego path.
      why   : This is a genuine occluded pedestrian conflict, but it only partially realises the brief because the crossing is at a junction rather than mid-block.
      flags : EGO_INTERSECTS_PROP
      caps  : [{'flag': 'EGO_INTERSECTS_PROP', 'dim': 'R5', 'from': 3, 'to': 0}]
      phys  : contested=True pathSep=0.0 m gap=1.12 s C3b=True
      trace : /tmp/vista-held-blind/c5-adult-midblock-blind/batch-final/easterbrook-discovery-school/a4f79cebd6ab4b5b/draw-001.trace.json.gz
  [blind] c5-cpfa (C5.pedestrian)  -> invalid   {'R1': 4, 'R2': 3, 'R3': 3, 'R4': 4, 'R5': 0}   HQ-admitted=False
      brief : A pedestrian crosses from the far side (NCAP CPFA).
      why   : This is a strong far-side pedestrian edge case: a late, diagonally crossing pedestrian forces heavy slowing during a constrained right turn with truck-related occlusion.
      flags : EGO_INTERSECTS_PROP, EGO_NOT_MAKING_PROGRESS
      caps  : [{'flag': 'EGO_INTERSECTS_PROP', 'dim': 'R5', 'from': 4, 'to': 0}]
      phys  : contested=True pathSep=0.0 m gap=0.7 s C3b=True
      trace : /tmp/vista-held-blind/c5-cpfa-blind/batch-final/belmont-research-center/68880075c230c48e/draw-000.trace.json.gz
  [blind] c5-cpfa (C5.pedestrian)  -> invalid   {'R1': 4, 'R2': 3, 'R3': 3, 'R4': 3, 'R5': 0}   HQ-admitted=False
      brief : A pedestrian crosses from the far side (NCAP CPFA).
      why   : This is a worthwhile far-side pedestrian crossing case with a real braking interaction, though the pedestrian clears the contested point 1.36 seconds before the ego arrives.
      flags : EGO_INTERSECTS_PROP
      caps  : [{'flag': 'EGO_INTERSECTS_PROP', 'dim': 'R5', 'from': 3, 'to': 0}]
      phys  : contested=True pathSep=0.0 m gap=1.36 s C3b=True
      trace : /tmp/vista-held-blind/c5-cpfa-blind/batch-final/belmont-research-center/9e5efe6590cddd7b/draw-001.trace.json.gz
  [blind] c5-cpfa (C5.pedestrian)  -> invalid   {'R1': 4, 'R2': 2, 'R3': 2, 'R4': 3, 'R5': 0}   HQ-admitted=False
      brief : A pedestrian crosses from the far side (NCAP CPFA).
      why   : The brief is realised, but the pedestrian finishes crossing and waits two seconds before ego arrival, making this an easy post-encroachment pass-by rather than a sharp edge case.
      flags : CHALLENGER_STOPPED_AT_CONFLICT, CHALLENGER_STOPPED_AFTER_CROSSING, EGO_INTERSECTS_PROP
      caps  : [{'flag': 'EGO_INTERSECTS_PROP', 'dim': 'R5', 'from': 3, 'to': 0}]
      phys  : contested=True pathSep=0.0 m gap=2.0 s C3b=True
      trace : /tmp/vista-held-blind/c5-cpfa-blind/batch-final/el-camino-road/4162e17f4dde8c14/draw-000.trace.json.gz
  [blind] c5-cpna (C5.pedestrian)  -> physically-valid-but-boring   {'R1': 3, 'R2': 1, 'R3': 2, 'R4': 3, 'R5': 3}   HQ-admitted=False
      brief : A pedestrian crosses from the nearside close to the ego (NCAP CPNA).
      why   : This realises the crossing setup, but the pedestrian clears the contested ground 1.4 seconds before the ego arrives, turning the apparent near miss into a close pass by a stationary actor.
      flags : CHALLENGER_STOPPED_AT_CONFLICT, CHALLENGER_STOPPED_AFTER_CROSSING
      phys  : contested=True pathSep=0.0 m gap=1.4 s C3b=True
      trace : /tmp/vista-held-blind/c5-cpna-blind/batch-final/belmont-research-center/6c53a0af4c5310c3/draw-000.trace.json.gz
  [blind] c5-cpna (C5.pedestrian)  -> physically-valid-but-boring   {'R1': 4, 'R2': 1, 'R3': 1, 'R4': 3, 'R5': 3}   HQ-admitted=False
      brief : A pedestrian crosses from the nearside close to the ego (NCAP CPNA).
      why   : The named crossing occurs, but the pedestrian clears the contested ground 1.16 seconds before the ego arrives, so the apparent near miss is only a stopped-pedestrian pass-by.
      flags : CHALLENGER_STOPPED_AT_CONFLICT, PROXIMITY_IS_NOT_THE_CONFLICT
      phys  : contested=True pathSep=0.0 m gap=1.16 s C3b=False
      trace : /tmp/vista-held-blind/c5-cpna-blind/batch-final/richmond-field-station/5a17a5e0664d5b9d/draw-000.trace.json.gz
  [blind] c5-crowd (C5.pedestrian)  -> physically-valid-but-boring   {'R1': 3, 'R2': 2, 'R3': 1, 'R4': 3, 'R5': 4}   HQ-admitted=False
      brief : A group of pedestrians crosses together.
      why   : The clip realizes the group-crossing intent, but it is an ordinary, well-anticipated post-encroachment pass rather than a genuine simultaneous conflict.
      phys  : contested=True pathSep=0.0 m gap=1.58 s C3b=True
      trace : /tmp/vista-held-blind/c5-crowd-blind/batch-final/yale-street/0d40baad1b225202/draw-000.trace.json.gz
  [blind] c6-cyclist-right-hook (C6.cyclist-ptw)  -> intent-not-realised   {'R1': 1, 'R2': 1, 'R3': 2, 'R4': 3, 'R5': 3}   HQ-admitted=True
      brief : A cyclist is right-hooked by a turning vehicle ahead of the ego.
      why   : The cyclist is never involved; this is an ego close-pass of a stopped turning car, not a cyclist right-hook.
      flags : CHALLENGER_STOPPED_AT_CONFLICT, CHALLENGER_STOPPED_AFTER_CROSSING, NEAR_COLLISION_BY_TIMING
      phys  : contested=True pathSep=0.0 m gap=0.0 s C3b=True
      trace : /tmp/vista-held-blind/c6-cyclist-right-hook-blind/batch-final/belmont-research-center/01c714622f8a590c/draw-000.trace.json.gz
  [blind] c6-cyclist-right-hook (C6.cyclist-ptw)  -> intent-not-realised   {'R1': 1, 'R2': 1, 'R3': 1, 'R4': 3, 'R5': 3}   HQ-admitted=True
      brief : A cyclist is right-hooked by a turning vehicle ahead of the ego.
      why   : This is a valid but ordinary stopped-lead-vehicle avoidance event, not a cyclist being right-hooked by the turning vehicle.
      flags : CHALLENGER_STOPPED_AT_CONFLICT, CHALLENGER_STOPPED_AFTER_CROSSING, NEAR_COLLISION_BY_TIMING
      phys  : contested=True pathSep=0.0 m gap=0.0 s C3b=True
      trace : /tmp/vista-held-blind/c6-cyclist-right-hook-blind/batch-final/belmont-research-center/4aac2b1f33d2a538/draw-000.trace.json.gz
  [blind] c6-cyclist-right-hook (C6.cyclist-ptw)  -> intent-not-realised   {'R1': 0, 'R2': 1, 'R3': 2, 'R4': 3, 'R5': 3}   HQ-admitted=True
      brief : A cyclist is right-hooked by a turning vehicle ahead of the ego.
      why   : The cyclist never participates in the ego interaction; this is a stopped-car obstruction at a curved junction rather than a cyclist right-hook.
      flags : CHALLENGER_STOPPED_AT_CONFLICT, CHALLENGER_STOPPED_AFTER_CROSSING, NEAR_COLLISION_BY_TIMING
      phys  : contested=True pathSep=0.0 m gap=0.0 s C3b=True
      trace : /tmp/vista-held-blind/c6-cyclist-right-hook-blind/batch-final/belmont-research-center/78a418035fc1263c/draw-000.trace.json.gz
  [blind] c7-crest-occludes (C7.occlusion)  -> physically-valid-but-boring   {'R1': 4, 'R2': 1, 'R3': 3, 'R4': 3, 'R5': 3}   HQ-admitted=False
      brief : A crest hides a stopped vehicle from the ego.
      why   : The requested crest occlusion is clear, but the clip becomes ordinary because the ego has ample space to brake and simply queues behind the stationary car without a close conflict.
      flags : CHALLENGER_STATIC, NO_CONTESTED_SPACE, CHALLENGER_STOPPED_AFTER_CROSSING, NEAR_COLLISION_BY_TIMING, CHALLENGER_PARTIALLY_ABSENT
      caps  : [{'flag': 'CHALLENGER_STATIC', 'dim': 'R2', 'from': 2, 'to': 1}]
      phys  : contested=False pathSep=2.595 m gap=0 s C3b=False
      trace : /tmp/vista-held-blind/c7-crest-occludes-blind/batch-iter2/easterbrook-discovery-school/1922c5b04a436c76/draw-000.trace.json.gz
  [blind] c7-crest-occludes (C7.occlusion)  -> physically-valid-but-boring   {'R1': 4, 'R2': 1, 'R3': 3, 'R4': 3, 'R5': 3}   HQ-admitted=False
      brief : A crest hides a stopped vehicle from the ego.
      why   : The crest genuinely hides the stopped vehicle, but the ego resolves the reveal with ample margin, making this a controlled hidden-obstacle stop rather than a highly challenging edge case.
      flags : CHALLENGER_STATIC, NO_CONTESTED_SPACE, CHALLENGER_STOPPED_AFTER_CROSSING, NEAR_COLLISION_BY_TIMING, CHALLENGER_PARTIALLY_ABSENT
      caps  : [{'flag': 'CHALLENGER_STATIC', 'dim': 'R2', 'from': 2, 'to': 1}]
      phys  : contested=False pathSep=2.212 m gap=0 s C3b=False
      trace : /tmp/vista-held-blind/c7-crest-occludes-blind/batch-iter2/easterbrook-discovery-school/38ee361df0980b1f/draw-000.trace.json.gz
  [blind] c7-crest-occludes (C7.occlusion)  -> physically-valid-but-boring   {'R1': 4, 'R2': 1, 'R3': 3, 'R4': 3, 'R5': 3}   HQ-admitted=False
      brief : A crest hides a stopped vehicle from the ego.
      why   : This realises the crest-occluded stopped vehicle well, but the generous warning and stationary target make the conflict more controlled than a compelling edge case.
      flags : CHALLENGER_STATIC, CHALLENGER_STOPPED_AFTER_CROSSING, NEAR_COLLISION_BY_TIMING, CHALLENGER_PARTIALLY_ABSENT
      caps  : [{'flag': 'CHALLENGER_STATIC', 'dim': 'R2', 'from': 2, 'to': 1}]
      phys  : contested=False pathSep=1.42 m gap=0 s C3b=True
      trace : /tmp/vista-held-blind/c7-crest-occludes-blind/batch-iter2/el-camino-road/0399bd5a4a90cb2a/draw-000.trace.json.gz
  [blind] c7-hedge-corner (C7.occlusion)  -> invalid   {'R1': 4, 'R2': 2, 'R3': 3, 'R4': 3, 'R5': 0}   HQ-admitted=False
      brief : A roadside hedge hides a crossing pedestrian at a corner.
      why   : This realizes the hidden-pedestrian-at-a-corner brief, but the pedestrian clears the contested ground 1.66 s before the ego arrives, making it a near pass-by rather than a true simultaneous conflict.
      flags : CHALLENGER_STOPPED_AT_CONFLICT, CHALLENGER_STOPPED_AFTER_CROSSING, EGO_INTERSECTS_PROP
      caps  : [{'flag': 'EGO_INTERSECTS_PROP', 'dim': 'R5', 'from': 3, 'to': 0}]
      phys  : contested=True pathSep=0.0 m gap=1.66 s C3b=True
      trace : /tmp/vista-held-blind/c7-hedge-corner-blind/batch-iter2/belmont-research-center/b20b3b3c7151c3c7/draw-000.trace.json.gz
  [blind] c7-hedge-corner (C7.occlusion)  -> invalid   {'R1': 4, 'R2': 1, 'R3': 3, 'R4': 3, 'R5': 0}   HQ-admitted=False
      brief : A roadside hedge hides a crossing pedestrian at a corner.
      why   : The hedge genuinely occludes the pedestrian, but the pedestrian has already cleared the contested space 1.7 seconds before the ego arrives, making this a controlled pass-by rather than a real near-conflict.
      flags : CHALLENGER_STOPPED_AT_CONFLICT, CHALLENGER_STOPPED_AFTER_CROSSING, EGO_INTERSECTS_PROP
      caps  : [{'flag': 'EGO_INTERSECTS_PROP', 'dim': 'R5', 'from': 4, 'to': 0}]
      phys  : contested=True pathSep=0.0 m gap=1.7 s C3b=True
      trace : /tmp/vista-held-blind/c7-hedge-corner-blind/batch-iter2/belmont-research-center/b96af2835de2d2a2/draw-000.trace.json.gz
  [blind] c8-night-zone (C8.workzone)  -> invalid   {'R1': 3, 'R2': 3, 'R3': 3, 'R4': 3, 'R5': 0}   HQ-admitted=False
      brief : A night work zone with limited conspicuity.
      why   : This is a strong occluded-work-zone near miss, but the worker reaches and stops in the contested space 1.18 seconds before the ego arrives rather than forcing a truly simultaneous conflict.
      flags : CHALLENGER_STOPPED_AT_CONFLICT, CHALLENGER_STOPPED_AFTER_CROSSING, EGO_INTERSECTS_PROP
      caps  : [{'flag': 'EGO_INTERSECTS_PROP', 'dim': 'R5', 'from': 3, 'to': 0}]
      phys  : contested=True pathSep=0.0 m gap=1.18 s C3b=True
      trace : /tmp/vista-held-blind/c8-night-zone-blind/batch-iter2/el-camino-road/2c8d867f32390217/draw-000.trace.json.gz
  [blind] c9-accident-scene (C9.hazard)  -> physically-valid-but-boring   {'R1': 3, 'R2': 1, 'R3': 2, 'R4': 3, 'R5': 4}   HQ-admitted=False
      brief : An accident scene partially blocks the ego lane.
      why   : The scene realises the blockage, but the only relevant actor is already stopped, making this a routine static-obstacle braking case rather than a compelling edge case.
      flags : CHALLENGER_STATIC, CHALLENGER_STOPPED_AFTER_CROSSING, NEAR_COLLISION_BY_TIMING
      caps  : [{'flag': 'CHALLENGER_STATIC', 'dim': 'R2', 'from': 2, 'to': 1}]
      phys  : contested=False pathSep=0.449 m gap=0 s C3b=True
      trace : /tmp/vista-held-blind/c9-accident-scene-blind/batch-final/belmont-research-center/387ece0dc99cdee1/draw-000.trace.json.gz
  [blind] c9-accident-scene (C9.hazard)  -> physically-valid-but-boring   {'R1': 4, 'R2': 1, 'R3': 3, 'R4': 3, 'R5': 4}   HQ-admitted=False
      brief : An accident scene partially blocks the ego lane.
      why   : The brief is clearly realised, but under this rubric a stationary disabled vehicle that the ego simply passes is a physically valid obstacle avoidance clip, not a genuine dynamic conflict.
      flags : CHALLENGER_STATIC, CHALLENGER_STOPPED_AFTER_CROSSING, NEAR_COLLISION_BY_TIMING
      phys  : contested=False pathSep=0.139 m gap=0.0 s C3b=True
      trace : /tmp/vista-held-blind/c9-accident-scene-blind/batch-final/easterbrook-discovery-school/35d4f3fc22af3537/draw-000.trace.json.gz
  [blind] c9-accident-scene (C9.hazard)  -> physically-valid-but-boring   {'R1': 3, 'R2': 1, 'R3': 1, 'R4': 3, 'R5': 4}   HQ-admitted=False
      brief : An accident scene partially blocks the ego lane.
      why   : This realises a stationary obstruction but is ultimately ordinary car-following with hard braking and ample clearance, not an interesting edge case.
      flags : CHALLENGER_STATIC, NO_CONTESTED_SPACE, CHALLENGER_STOPPED_AFTER_CROSSING, NEAR_COLLISION_BY_TIMING
      phys  : contested=False pathSep=2.084 m gap=0 s C3b=False
      trace : /tmp/vista-held-blind/c9-accident-scene-blind/batch-final/el-camino-road/019e1244ffbc6e87/draw-001.trace.json.gz
  [sight] c1-brake-check (C1.car-following)  -> intent-not-realised   {'R1': 1, 'R2': 2, 'R3': 1, 'R4': 3, 'R5': 4}   HQ-admitted=True
      brief : The lead vehicle brake-checks the ego briefly then resumes.
      why   : The clip shows a plausible but comfortable crossing yield, not the requested lead-vehicle brake-check while being followed by the ego.
      flags : PROXIMITY_IS_NOT_THE_CONFLICT
      phys  : contested=True pathSep=0.0 m gap=1.62 s C3b=False
      trace : /tmp/vista-held-sight/c1-brake-check-sight/batch-final/belmont-research-center/c684a62b248bfa8e/draw-000.trace.json.gz
  [sight] c1-brake-check (C1.car-following)  -> physically-valid-but-boring   {'R1': 4, 'R2': 2, 'R3': 1, 'R4': 3, 'R5': 4}   HQ-admitted=True
      brief : The lead vehicle brake-checks the ego briefly then resumes.
      why   : The brake-check and resumption are realised, but the generous 4.924 m clearance and timing-separated crossing make this an ordinary interaction rather than an interesting edge case.
      flags : PROXIMITY_IS_NOT_THE_CONFLICT
      phys  : contested=True pathSep=0.0 m gap=1.2 s C3b=False
      trace : /tmp/vista-held-sight/c1-brake-check-sight/batch-final/richmond-field-station/9985b73259db9b73/draw-000.trace.json.gz
  [sight] c1-brake-check (C1.car-following)  -> intent-not-realised   {'R1': 1, 'R2': 2, 'R3': 2, 'R4': 3, 'R5': 4}   HQ-admitted=True
      brief : The lead vehicle brake-checks the ego briefly then resumes.
      why   : This is a plausible but relatively comfortable junction-crossing event, not the requested same-lane lead-vehicle brake-check and resume.
      flags : PROXIMITY_IS_NOT_THE_CONFLICT
      phys  : contested=True pathSep=0.0 m gap=1.1 s C3b=False
      trace : /tmp/vista-held-sight/c1-brake-check-sight/batch-final/richmond-field-station/eea5f8225b7dee38/draw-000.trace.json.gz
  [sight] c10-ego-overtake (C10.oncoming)  -> invalid   {'R1': 1, 'R2': 2, 'R3': 1, 'R4': 3, 'R5': 0}   HQ-admitted=False
      brief : The ego judges a gap to overtake with oncoming traffic.
      why   : The clip depicts cautious following through a junction, not an ego vehicle judging an overtaking gap in the presence of oncoming traffic.
      flags : EGO_INTERSECTS_PROP
      caps  : [{'flag': 'EGO_INTERSECTS_PROP', 'dim': 'R5', 'from': 3, 'to': 0}]
      phys  : contested=True pathSep=0.0 m gap=0.84 s C3b=True
      trace : /tmp/vista-held-sight/c10-ego-overtake-sight/batch-final/belmont-research-center/1cc645388a704739/draw-000.trace.json.gz
  [sight] c10-ego-overtake (C10.oncoming)  -> intent-not-realised   {'R1': 1, 'R2': 1, 'R3': 0, 'R4': 3, 'R5': 4}   HQ-admitted=False
      brief : The ego judges a gap to overtake with oncoming traffic.
      why   : The clip shows hard braking behind a slow lead vehicle, not an ego overtaking decision challenged by oncoming traffic.
      flags : PROXIMITY_IS_NOT_THE_CONFLICT
      phys  : contested=True pathSep=0.0 m gap=0.8 s C3b=False
      trace : /tmp/vista-held-sight/c10-ego-overtake-sight/batch-final/belmont-research-center/92bbfdd40c5295ef/draw-000.trace.json.gz
  [sight] c10-ego-overtake (C10.oncoming)  -> intent-not-realised   {'R1': 1, 'R2': 1, 'R3': 2, 'R4': 1, 'R5': 3}   HQ-admitted=False
      brief : The ego judges a gap to overtake with oncoming traffic.
      why   : This does not realise an oncoming-traffic overtaking-gap judgment: it is mainly a hard approach to a stationary lead van with the oncoming car safely out of the way.
      flags : CHALLENGER_STOPPED_AT_CONFLICT, CHALLENGER_STOPPED_AFTER_CROSSING, NEAR_COLLISION_BY_TIMING
      phys  : contested=True pathSep=0.0 m gap=0.0 s C3b=True
      trace : /tmp/vista-held-sight/c10-ego-overtake-sight/batch-final/belmont-research-center/9e84009a00e9b337/draw-000.trace.json.gz
  [sight] c2-blind-spot (C2.cut-in-merge)  -> intent-not-realised   {'R1': 1, 'R2': 2, 'R3': 2, 'R4': 3, 'R5': 4}   HQ-admitted=True
      brief : A vehicle drifts from the adjacent lane into the ego blind spot.
      why   : This is a strongly controlled response to a slowing lead vehicle that exits at a junction, not a vehicle drifting from an adjacent lane into the ego blind spot.
      flags : PROXIMITY_IS_NOT_THE_CONFLICT
      phys  : contested=True pathSep=0.0 m gap=1.06 s C3b=False
      trace : /tmp/vista-held-sight/c2-blind-spot-sight/batch-final/belmont-research-center/9a027fc71c0144b6/draw-001.trace.json.gz
  [sight] c2-lane-drop (C2.cut-in-merge)  -> invalid   {'R1': 2, 'R2': 1, 'R3': 2, 'R4': 3, 'R5': 1}   HQ-admitted=True
      brief : The ego lane drops and traffic must merge late.
      why   : This is a hard-looking stopped-vehicle bypass, not a convincing realization of traffic merging late when the ego lane drops.
      flags : CHALLENGER_STOPPED_AT_CONFLICT, CHALLENGER_STOPPED_AFTER_CROSSING, NEAR_COLLISION_BY_TIMING, EGO_NOT_MAKING_PROGRESS
      caps  : [{'flag': 'EGO_NOT_MAKING_PROGRESS', 'dim': 'R5', 'from': 3, 'to': 1}]
      phys  : contested=True pathSep=0.0 m gap=0.0 s C3b=True
      trace : /tmp/vista-held-sight/c2-lane-drop-sight/batch-final/belmont-research-center/60278690c831a14d/draw-000.trace.json.gz
  [sight] c5-multiple-threat (C5.pedestrian)  -> intent-not-realised   {'R1': 0, 'R2': 1, 'R3': 0, 'R4': 3, 'R5': 4}   HQ-admitted=False
      brief : A pedestrian steps out from behind a stopped vehicle in the adjacent lane.
      why   : This is a physically plausible but ordinary stop behind a stationary lead vehicle, not a pedestrian emerging from behind an adjacent-lane vehicle.
      flags : CHALLENGER_STATIC, NO_CONTESTED_SPACE, CHALLENGER_STOPPED_AFTER_CROSSING, NEAR_COLLISION_BY_TIMING
      phys  : contested=False pathSep=2.756 m gap=0 s C3b=False
      trace : /tmp/vista-held-sight/c5-multiple-threat-sight/batch-iter2/belmont-research-center/0741fa9895a1d259/draw-000.trace.json.gz
  [sight] c5-multiple-threat (C5.pedestrian)  -> intent-not-realised   {'R1': 0, 'R2': 1, 'R3': 0, 'R4': 3, 'R5': 4}   HQ-admitted=False
      brief : A pedestrian steps out from behind a stopped vehicle in the adjacent lane.
      why   : This is a plausible but ordinary stop-behind-a-lead-vehicle clip, and it does not realise the pedestrian-emerging-from-behind-the-stopped-vehicle event.
      flags : CHALLENGER_STATIC, NO_CONTESTED_SPACE, CHALLENGER_STOPPED_AFTER_CROSSING, NEAR_COLLISION_BY_TIMING
      phys  : contested=False pathSep=2.608 m gap=0 s C3b=False
      trace : /tmp/vista-held-sight/c5-multiple-threat-sight/batch-iter2/belmont-research-center/5ffb20072ccd0506/draw-000.trace.json.gz
  [sight] c5-multiple-threat (C5.pedestrian)  -> intent-not-realised   {'R1': 1, 'R2': 1, 'R3': 0, 'R4': 3, 'R5': 4}   HQ-admitted=False
      brief : A pedestrian steps out from behind a stopped vehicle in the adjacent lane.
      why   : The clip is physically plausible but depicts ordinary braking behind a stopped vehicle, not a pedestrian emerging from behind it in the adjacent lane.
      flags : CHALLENGER_STATIC, NO_CONTESTED_SPACE, CHALLENGER_STOPPED_AFTER_CROSSING, NEAR_COLLISION_BY_TIMING
      phys  : contested=False pathSep=2.597 m gap=0 s C3b=False
      trace : /tmp/vista-held-sight/c5-multiple-threat-sight/batch-iter2/belmont-research-center/fd0ded827840433e/draw-000.trace.json.gz
  [sight] c6-dooring (C6.cyclist-ptw)  -> invalid   {'R1': 1, 'R2': 3, 'R3': 2, 'R4': 3, 'R5': 1}   HQ-admitted=False
      brief : A parked car door opens into a cyclist who swerves into the ego lane.
      why   : The clip contains a genuine zero-clearance encounter, but it does not realise the authored mechanism because neither the parked-car door nor the cyclist's swerve occurs.
      flags : CHALLENGER_STOPPED_AT_CONFLICT, CHALLENGER_DISCONTINUOUS, CHALLENGER_STOPPED_AFTER_CROSSING, NEAR_COLLISION_BY_TIMING
      caps  : [{'flag': 'CHALLENGER_DISCONTINUOUS', 'dim': 'R5', 'from': 2, 'to': 1}]
      phys  : contested=True pathSep=0.0 m gap=0.0 s C3b=True
      trace : /tmp/vista-held-sight/c6-dooring-sight/batch-final/belmont-research-center/4e8553857c229e36/draw-001.trace.json.gz
  [sight] c6-dooring (C6.cyclist-ptw)  -> intent-not-realised   {'R1': 1, 'R2': 1, 'R3': 1, 'R4': 3, 'R5': 3}   HQ-admitted=False
      brief : A parked car door opens into a cyclist who swerves into the ego lane.
      why   : The clip shows braking past a stationary cyclist, not a parked-car door opening that makes a cyclist swerve into the ego lane.
      flags : CHALLENGER_STATIC, CHALLENGER_STOPPED_AFTER_CROSSING, NEAR_COLLISION_BY_TIMING
      phys  : contested=False pathSep=0.718 m gap=0.0 s C3b=True
      trace : /tmp/vista-held-sight/c6-dooring-sight/batch-final/belmont-research-center/626b007ecbb01b3d/draw-000.trace.json.gz
  [sight] c6-dooring (C6.cyclist-ptw)  -> intent-not-realised   {'R1': 1, 'R2': 1, 'R3': 2, 'R4': 3, 'R5': 3}   HQ-admitted=False
      brief : A parked car door opens into a cyclist who swerves into the ego lane.
      why   : This is a valid close pass by a stationary cyclist, not the authored event, because neither the parked-car door opens nor does the cyclist swerve into the ego lane.
      flags : CHALLENGER_STATIC, CHALLENGER_STOPPED_AFTER_CROSSING, NEAR_COLLISION_BY_TIMING
      phys  : contested=False pathSep=0.658 m gap=0.0 s C3b=True
      trace : /tmp/vista-held-sight/c6-dooring-sight/batch-final/belmont-research-center/75db1836b24d1e2a/draw-000.trace.json.gz
  [sight] c6-escooter (C6.cyclist-ptw)  -> physically-valid-but-boring   {'R1': 2, 'R2': 4, 'R3': 3, 'R4': 0, 'R5': 4}   HQ-admitted=False
      brief : An e-scooter enters the ego lane from the footway.
      why   : The scooter creates a real and very tight conflict, but the clip is a poor ego-response edge case because the ego simply drives through unchanged.
      flags : EGO_NEVER_ACTED, EGO_RESPONSE_NEGLIGIBLE, NEAR_COLLISION_BY_TIMING
      phys  : contested=True pathSep=0.0 m gap=0.06 s C3b=True
      trace : /tmp/vista-held-sight/c6-escooter-sight/batch-iter2/easterbrook-discovery-school/452d35051256f993/draw-000.trace.json.gz
  [sight] c7-bus-occludes-cyclist (C7.occlusion)  -> invalid   {'R1': 3, 'R2': 2, 'R3': 3, 'R4': 3, 'R5': 0}   HQ-admitted=False
      brief : A stopped bus hides a cyclist from the ego.
      why   : This is a worthwhile occluded-cyclist scenario, but the conflict is weakened because the cyclist stops and the ego has substantial time to brake before arriving.
      flags : CHALLENGER_STOPPED_AT_CONFLICT, CHALLENGER_STOPPED_AFTER_CROSSING, EGO_INTERSECTS_PROP
      caps  : [{'flag': 'EGO_INTERSECTS_PROP', 'dim': 'R5', 'from': 3, 'to': 0}]
      phys  : contested=True pathSep=0.0 m gap=0.5 s C3b=True
      trace : /tmp/vista-held-sight/c7-bus-occludes-cyclist-sight/batch-iter1/belmont-research-center/45c62ad58f650365/draw-000.trace.json.gz
  [sight] c7-bus-occludes-cyclist (C7.occlusion)  -> physically-valid-but-boring   {'R1': 4, 'R2': 1, 'R3': 3, 'R4': 3, 'R5': 3}   HQ-admitted=False
      brief : A stopped bus hides a cyclist from the ego.
      why   : The bus does hide a cyclist, but the cyclist clears and stops 2.04 seconds before the ego arrives, so this is an occluded pass-by rather than a genuine near-conflict.
      flags : CHALLENGER_STOPPED_AT_CONFLICT, CHALLENGER_STOPPED_AFTER_CROSSING
      phys  : contested=True pathSep=0.0 m gap=2.04 s C3b=True
      trace : /tmp/vista-held-sight/c7-bus-occludes-cyclist-sight/batch-iter1/belmont-research-center/ad3d8b5a3f09e3d8/draw-000.trace.json.gz
  [sight] c8-moving-workzone (C8.workzone)  -> physically-valid-but-boring   {'R1': 4, 'R2': 2, 'R3': 0, 'R4': 3, 'R5': 4}   HQ-admitted=True
      brief : A slow-moving work vehicle occupies the ego lane.
      why   : The brief is realised, but this is only ordinary car-following with ample clearance and no distinctive edge-case mechanism.
      phys  : contested=True pathSep=0.0 m gap=2.04 s C3b=True
      trace : /tmp/vista-held-sight/c8-moving-workzone-sight/batch-final/belmont-research-center/8e84441e763be2f9/draw-001.trace.json.gz
  [sight] c8-moving-workzone (C8.workzone)  -> physically-valid-but-boring   {'R1': 4, 'R2': 2, 'R3': 0, 'R4': 3, 'R5': 4}   HQ-admitted=True
      brief : A slow-moving work vehicle occupies the ego lane.
      why   : This faithfully depicts ordinary slowing behind a work truck, but it is not an interesting edge case because the ego has ample time and clearance and never needs a difficult maneuver.
      phys  : contested=True pathSep=0.0 m gap=3.26 s C3b=True
      trace : /tmp/vista-held-sight/c8-moving-workzone-sight/batch-final/belmont-research-center/916a7cb87347d643/draw-000.trace.json.gz
  [sight] c8-shifted-alignment (C8.workzone)  -> physically-valid-but-boring   {'R1': 4, 'R2': 1, 'R3': 3, 'R4': 3, 'R5': 4}   HQ-admitted=False
      brief : A work zone shifts the alignment laterally and the ego steers around it.
      why   : This is a strong work-zone alignment-shift edge case, although the ego should make the lateral avoidance trajectory more visually unmistakable than simply stopping alongside the truck.
      flags : CHALLENGER_STATIC, CHALLENGER_STOPPED_AFTER_CROSSING, NEAR_COLLISION_BY_TIMING
      caps  : [{'flag': 'CHALLENGER_STATIC', 'dim': 'R2', 'from': 4, 'to': 1}]
      phys  : contested=False pathSep=0.016 m gap=0.0 s C3b=True
      trace : /tmp/vista-held-sight/c8-shifted-alignment-sight/batch-final/el-camino-road/0fb71417641dd269/draw-000.trace.json.gz
  [sight] c8-shifted-alignment (C8.workzone)  -> physically-valid-but-boring   {'R1': 3, 'R2': 1, 'R3': 3, 'R4': 3, 'R5': 3}   HQ-admitted=False
      brief : A work zone shifts the alignment laterally and the ego steers around it.
      why   : This is a carefully avoided stationary obstacle, not a genuinely contested edge case, because the truck never moves and the ego simply passes beside it.
      flags : CHALLENGER_STATIC, CHALLENGER_STOPPED_AFTER_CROSSING, NEAR_COLLISION_BY_TIMING
      phys  : contested=False pathSep=0.088 m gap=0.0 s C3b=True
      trace : /tmp/vista-held-sight/c8-shifted-alignment-sight/batch-final/el-camino-road/3a1835a671613d28/draw-000.trace.json.gz
  [sight] c8-shifted-alignment (C8.workzone)  -> physically-valid-but-boring   {'R1': 3, 'R2': 1, 'R3': 3, 'R4': 3, 'R5': 3}   HQ-admitted=False
      brief : A work zone shifts the alignment laterally and the ego steers around it.
      why   : This is a plausible narrow work-zone bypass, but the stationary truck and lack of an unmistakable evasive lateral shift make it less compelling than a true dynamic conflict.
      flags : CHALLENGER_STATIC, CHALLENGER_STOPPED_AFTER_CROSSING, NEAR_COLLISION_BY_TIMING
      caps  : [{'flag': 'CHALLENGER_STATIC', 'dim': 'R2', 'from': 2, 'to': 1}]
      phys  : contested=False pathSep=0.417 m gap=0.0 s C3b=True
      trace : /tmp/vista-held-sight/c8-shifted-alignment-sight/batch-final/yale-street/00a48e125ab25207/draw-000.trace.json.gz
  [sight] c8-worker-intrusion (C8.workzone)  -> invalid   {'R1': 4, 'R2': 4, 'R3': 3, 'R4': 3, 'R5': 0}   HQ-admitted=False
      brief : A road worker steps out of the work area into the live lane.
      why   : This is a strong, genuinely difficult work-zone pedestrian incursion with simultaneous contested space and a substantial ego response, not a boring stationary pass-by.
      flags : CHALLENGER_STOPPED_AT_CONFLICT, CHALLENGER_STOPPED_AFTER_CROSSING, NEAR_COLLISION_BY_TIMING, EGO_INTERSECTS_PROP
      caps  : [{'flag': 'EGO_INTERSECTS_PROP', 'dim': 'R5', 'from': 4, 'to': 0}]
      phys  : contested=True pathSep=0.0 m gap=0.0 s C3b=True
      trace : /tmp/vista-held-sight/c8-worker-intrusion-sight/batch-iter2/richmond-field-station/81bd9623dd2f5816/draw-000.trace.json.gz
  [sight] c8-worker-intrusion (C8.workzone)  -> invalid   {'R1': 4, 'R2': 4, 'R3': 3, 'R4': 3, 'R5': 0}   HQ-admitted=False
      brief : A road worker steps out of the work area into the live lane.
      why   : This is a strong, genuinely realized road-worker incursion with simultaneous contested-space occupancy rather than a merely close pass.
      flags : CHALLENGER_STOPPED_AT_CONFLICT, CHALLENGER_STOPPED_AFTER_CROSSING, NEAR_COLLISION_BY_TIMING, EGO_INTERSECTS_PROP
      caps  : [{'flag': 'EGO_INTERSECTS_PROP', 'dim': 'R5', 'from': 3, 'to': 0}]
      phys  : contested=True pathSep=0.0 m gap=0.0 s C3b=True
      trace : /tmp/vista-held-sight/c8-worker-intrusion-sight/batch-iter2/richmond-field-station/e0c638f130e6ab39/draw-000.trace.json.gz
  [sight] c9-debris (C9.hazard)  -> physically-valid-but-boring   {'R1': 4, 'R2': 1, 'R3': 1, 'R4': 3, 'R5': 3}   HQ-admitted=False
      brief : Debris lies in the ego lane.
      why   : The brief is realised cleanly, but this is ordinary stationary-obstacle braking rather than a distinctive edge case worth a corpus slot.
      flags : CHALLENGER_STATIC, CHALLENGER_STOPPED_AFTER_CROSSING, NEAR_COLLISION_BY_TIMING, CHALLENGER_PARTIALLY_ABSENT
      caps  : [{'flag': 'CHALLENGER_STATIC', 'dim': 'R2', 'from': 2, 'to': 1}]
      phys  : contested=False pathSep=0.802 m gap=0 s C3b=True
      trace : /tmp/vista-held-sight/c9-debris-sight/batch-iter2/belmont-research-center/14fe11fc8fa83db4/draw-000.trace.json.gz
  [sight] c9-debris (C9.hazard)  -> physically-valid-but-boring   {'R1': 4, 'R2': 1, 'R3': 2, 'R4': 3, 'R5': 4}   HQ-admitted=False
      brief : Debris lies in the ego lane.
      why   : The brief is realised, but the stationary debris is encountered with ample clearance and produces ordinary obstacle-following rather than a genuinely contested edge case.
      flags : CHALLENGER_STATIC, NO_CONTESTED_SPACE, CHALLENGER_STOPPED_AFTER_CROSSING, NEAR_COLLISION_BY_TIMING, CHALLENGER_PARTIALLY_ABSENT
      phys  : contested=False pathSep=2.595 m gap=0 s C3b=False
      trace : /tmp/vista-held-sight/c9-debris-sight/batch-iter2/belmont-research-center/4882c3afef446b14/draw-000.trace.json.gz
  [sight] c9-debris (C9.hazard)  -> invalid   {'R1': 4, 'R2': 1, 'R3': 2, 'R4': 3, 'R5': 0}   HQ-admitted=False
      brief : Debris lies in the ego lane.
      why   : The clip clearly depicts debris in the ego lane, but the ego simply stops and passes a stationary object with 1.35 m clearance rather than facing a genuine contested-space hazard.
      flags : CHALLENGER_STATIC, CHALLENGER_STOPPED_AFTER_CROSSING, NEAR_COLLISION_BY_TIMING, CHALLENGER_PARTIALLY_ABSENT, EGO_INTERSECTS_PROP
      caps  : [{'flag': 'EGO_INTERSECTS_PROP', 'dim': 'R5', 'from': 4, 'to': 0}]
      phys  : contested=False pathSep=1.35 m gap=0 s C3b=True
      trace : /tmp/vista-held-sight/c9-debris-sight/batch-iter2/richmond-field-station/352c8612ec725a9d/draw-000.trace.json.gz
  [sight] c9-disabled-vehicle (C9.hazard)  -> physically-valid-but-boring   {'R1': 4, 'R2': 1, 'R3': 1, 'R4': 3, 'R5': 4}   HQ-admitted=False
      brief : A disabled vehicle is stopped in the ego lane.
      why   : This accurately depicts a disabled vehicle in the ego lane, but it is an ordinary, comfortably resolved stopped-lead-vehicle encounter rather than an interesting edge case.
      flags : CHALLENGER_STATIC, NO_CONTESTED_SPACE, CHALLENGER_STOPPED_AFTER_CROSSING, NEAR_COLLISION_BY_TIMING
      caps  : [{'flag': 'CHALLENGER_STATIC', 'dim': 'R2', 'from': 2, 'to': 1}]
      phys  : contested=False pathSep=2.818 m gap=0.0 s C3b=False
      trace : /tmp/vista-held-sight/c9-disabled-vehicle-sight/batch-final/belmont-research-center/16683cb0b90abf24/draw-001.trace.json.gz
  [sight] c9-disabled-vehicle (C9.hazard)  -> physically-valid-but-boring   {'R1': 4, 'R2': 1, 'R3': 2, 'R4': 3, 'R5': 3}   HQ-admitted=False
      brief : A disabled vehicle is stopped in the ego lane.
      why   : The brief is realised, but this is only a comfortable pass-by of a stationary obstacle rather than a genuine contested-space edge case.
      flags : CHALLENGER_STATIC, NO_CONTESTED_SPACE, CHALLENGER_STOPPED_AFTER_CROSSING, NEAR_COLLISION_BY_TIMING
      phys  : contested=False pathSep=2.429 m gap=0.0 s C3b=False
      trace : /tmp/vista-held-sight/c9-disabled-vehicle-sight/batch-final/belmont-research-center/2892082022d0736a/draw-001.trace.json.gz
  [sight] c9-disabled-vehicle (C9.hazard)  -> physically-valid-but-boring   {'R1': 4, 'R2': 1, 'R3': 2, 'R4': 3, 'R5': 4}   HQ-admitted=False
      brief : A disabled vehicle is stopped in the ego lane.
      why   : The brief is realized, but this is only a stationary obstacle pass with ample clearance rather than a genuinely contested edge case.
      flags : CHALLENGER_STATIC, CHALLENGER_STOPPED_AFTER_CROSSING, NEAR_COLLISION_BY_TIMING
      phys  : contested=False pathSep=1.92 m gap=0.0 s C3b=True
      trace : /tmp/vista-held-sight/c9-disabled-vehicle-sight/batch-final/easterbrook-discovery-school/2ee885b367efb7ee/draw-001.trace.json.gz
  [sight] c9-fallen-cargo (C9.hazard)  -> physically-valid-but-boring   {'R1': 4, 'R2': 1, 'R3': 3, 'R4': 3, 'R5': 4}   HQ-admitted=False
      brief : Fallen cargo blocks part of the ego lane.
      why   : The fallen-cargo trigger is well realised, but the clip resolves as an uncomplicated planned stop with generous clearance rather than a demanding edge case.
      flags : CHALLENGER_STATIC, NO_CONTESTED_SPACE, CHALLENGER_STOPPED_AFTER_CROSSING, NEAR_COLLISION_BY_TIMING, CHALLENGER_PARTIALLY_ABSENT
      caps  : [{'flag': 'CHALLENGER_STATIC', 'dim': 'R2', 'from': 2, 'to': 1}]
      phys  : contested=False pathSep=2.122 m gap=0 s C3b=False
      trace : /tmp/vista-held-sight/c9-fallen-cargo-sight/batch-iter2/belmont-research-center/05745c3d83346a23/draw-000.trace.json.gz
  [sight] c9-fallen-cargo (C9.hazard)  -> physically-valid-but-boring   {'R1': 4, 'R2': 1, 'R3': 2, 'R4': 3, 'R5': 3}   HQ-admitted=False
      brief : Fallen cargo blocks part of the ego lane.
      why   : The cargo event is realised, but this is ultimately comfortable straight-line stopping behind a stationary object rather than a demanding edge case.
      flags : CHALLENGER_STATIC, NO_CONTESTED_SPACE, CHALLENGER_STOPPED_AFTER_CROSSING, NEAR_COLLISION_BY_TIMING, CHALLENGER_PARTIALLY_ABSENT
      caps  : [{'flag': 'CHALLENGER_STATIC', 'dim': 'R2', 'from': 2, 'to': 1}]
      phys  : contested=False pathSep=2.428 m gap=0 s C3b=False
      trace : /tmp/vista-held-sight/c9-fallen-cargo-sight/batch-iter2/easterbrook-discovery-school/1041b0d06b3a2b80/draw-000.trace.json.gz
  [sight] c9-fallen-cargo (C9.hazard)  -> physically-valid-but-boring   {'R1': 4, 'R2': 1, 'R3': 2, 'R4': 3, 'R5': 4}   HQ-admitted=False
      brief : Fallen cargo blocks part of the ego lane.
      why   : The brief is realised cleanly, but this is ultimately an easy stationary-obstacle stop rather than a genuinely contested or surprising edge case.
      flags : CHALLENGER_STATIC, NO_CONTESTED_SPACE, CHALLENGER_STOPPED_AFTER_CROSSING, NEAR_COLLISION_BY_TIMING, CHALLENGER_PARTIALLY_ABSENT
      caps  : [{'flag': 'CHALLENGER_STATIC', 'dim': 'R2', 'from': 2, 'to': 1}]
      phys  : contested=False pathSep=2.366 m gap=0 s C3b=False
      trace : /tmp/vista-held-sight/c9-fallen-cargo-sight/batch-iter2/easterbrook-discovery-school/476f07ec8b1b6908/draw-000.trace.json.gz

## 8. Physics-side flags across all judged cells

  blind  CHALLENGER_DISCONTINUOUS           1
  blind  CHALLENGER_PARTIALLY_ABSENT        3
  blind  CHALLENGER_STATIC                  6
  blind  CHALLENGER_STOPPED_AFTER_CROSSING  46
  blind  CHALLENGER_STOPPED_AT_CONFLICT     45
  blind  EGO_INTERSECTS_PROP                10
  blind  EGO_NOT_MAKING_PROGRESS            1
  blind  NEAR_COLLISION_BY_TIMING           36
  blind  NO_CONTESTED_SPACE                 5
  blind  PROXIMITY_IS_NOT_THE_CONFLICT      8
  sight  CHALLENGER_DISCONTINUOUS           1
  sight  CHALLENGER_PARTIALLY_ABSENT        6
  sight  CHALLENGER_STATIC                  17
  sight  CHALLENGER_STOPPED_AFTER_CROSSING  32
  sight  CHALLENGER_STOPPED_AT_CONFLICT     16
  sight  EGO_INTERSECTS_PROP                5
  sight  EGO_NEVER_ACTED                    1
  sight  EGO_NOT_MAKING_PROGRESS            1
  sight  EGO_RESPONSE_NEGLIGIBLE            1
  sight  NEAR_COLLISION_BY_TIMING           33
  sight  NO_CONTESTED_SPACE                 9
  sight  PROXIMITY_IS_NOT_THE_CONFLICT      13

  NO contested-space event (paths never overlapped) despite passing the FROZEN gate: sight 22, blind 13, total 35/126
  -> above the "couple of cells" threshold: NO_CONTESTED_SPACE is worth adding as a Q-clause.
