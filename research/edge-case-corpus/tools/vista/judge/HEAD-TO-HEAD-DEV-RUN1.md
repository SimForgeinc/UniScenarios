# HEAD-TO-HEAD: sight vs blind, judged independently

Gates, labelled unambiguously:
  FROZEN GATE = the pre-registered contract (sha256 1a08698e95fca4bc): C1..C5, >=2 maps,
                >=3 distinct sites. THIS IS THE CONTRACTUAL HEAD-TO-HEAD NUMBER.
  HQ GATE     = frozen gate AND the authoring lane's Q1..Q6 quality clauses. Strictly tighter.
  JUDGE       = this lane's independent rubric (RUBRIC.md), applied to cells the frozen gate
                already admitted. It never loosens anything; it only removes.

## 1. MORE -- admission

mode     briefs  FROZEN adm    rate           95% CI  HQ adm    rate           95% CI
sight        32           9   0.281   (0.156, 0.454)       6   0.188   (0.089, 0.353)
blind        32          10   0.312    (0.18, 0.486)       9   0.281   (0.156, 0.454)

  FROZEN gate, sight vs blind admission: Fisher exact p = 1.0
  HQ gate,     sight vs blind admission: Fisher exact p = 0.5561
  Lane-1 blind baseline for reference: DEV 0.312 (29-31 admitted of 92).

## 2. BETTER -- quality of the cells the FROZEN gate admitted

### sight  (27 cells judged, up to 3 per admitted brief)
    high                             4   0.148
    acceptable                       9   0.333
    physically-valid-but-boring      4   0.148
    intent-not-realised              7   0.259
    invalid                          3   0.111
    -> good (high|acceptable)       13   0.481  CI (0.307, 0.66)
    -> gate admitted, judge rejects  14   0.519
    mean R1 2.89  CI (2.41, 3.33)
    mean R2 2.33  CI (2.04, 2.63)
    mean R3 2.19  CI (1.85, 2.48)
    mean R4 3.00  CI (2.7, 3.22)
    mean R5 3.26  CI (2.74, 3.7)

### blind  (30 cells judged, up to 3 per admitted brief)
    high                             9   0.300
    acceptable                      10   0.333
    physically-valid-but-boring      7   0.233
    intent-not-realised              3   0.100
    invalid                          1   0.033
    -> good (high|acceptable)       19   0.633  CI (0.455, 0.781)
    -> gate admitted, judge rejects  11   0.367
    mean R1 3.30  CI (2.9, 3.63)
    mean R2 2.43  CI (2.07, 2.8)
    mean R3 2.27  CI (1.93, 2.57)
    mean R4 3.03  CI (2.87, 3.2)
    mean R5 3.33  CI (3, 3.6)

  quality difference, Fisher exact p = 0.2929

## 3. The same, with the R3 (novelty) clause REMOVED from the verdict rules
   R3 anchor 0 is literally "generic car-following", so R3 demotes that whole category in BOTH
   modes. This block shows how much of the verdict R3 is carrying. It is NOT a softened rubric;
   the rubric of record is section 2.

  sight  good  16/27  = 0.593   high:4  acceptable:12  physically:1  intent:7  invalid:3
  blind  good  23/30  = 0.767   high:11  acceptable:12  physically:3  intent:3  invalid:1

## 4. Per category -- so category mix cannot masquerade as a mode effect

category                     sight n  good   rate   diff | blind n  good   rate   diff
C1.car-following                  3     0   0.00   43.8 |       3     0   0.00   34.0
C11.parking                       3     2   0.67   60.5 |       0     0    nan    nan
C14.loss-of-control               0     0    nan    nan |       3     3   1.00   68.5
C15.adversarial                   3     1   0.33   46.5 |       3     2   0.67   77.6
C4.roundabout                     0     0    nan    nan |       3     3   1.00   82.8
C5.pedestrian                     6     3   0.50   62.5 |       3     1   0.33   52.6
C6.cyclist-ptw                    0     0    nan    nan |       3     2   0.67   72.1
C7.occlusion                      6     3   0.50   84.3 |       3     3   1.00   78.3
C8.workzone                       0     0    nan    nan |       3     3   1.00   74.9
C9.hazard                         6     4   0.67   59.8 |       6     2   0.33   48.0

## 4b. Controlling the category-mix confound

   Pooled quality in section 2 compares different sets of briefs: the two modes did not admit
   the same ones. Two controls, in increasing order of strictness.

   (i) CATEGORY-MATCHED -- restricted to categories BOTH modes admitted: ['C1.car-following', 'C15.adversarial', 'C5.pedestrian', 'C7.occlusion', 'C9.hazard']
       sight 11/24 = 0.458   blind 8/18 = 0.444   Fisher exact p = 1.0
       mean difficulty  sight 63.0   blind 56.4
       sight-ONLY categories ['C11.parking']: 2/3 good (0.667) -- this block is what the pooled number is really comparing
       blind-ONLY categories ['C14.loss-of-control', 'C4.roundabout', 'C6.cyclist-ptw', 'C8.workzone']: 11/12 good (0.917) -- this block is what the pooled number is really comparing

   (ii) PAIRED -- the 4 briefs BOTH modes admitted. Same sentence, same gate,
        same surface hash. This is the cleanest available comparison.
        briefId                    category               |     sight   diff |     blind   diff
        c5-bus-stop-emergence      C5.pedestrian          |    3/3      61.9 |    1/3      52.6
        c7-double-parked-truck     C7.occlusion           |    0/3      81.0 |    3/3      78.3
        c9-animal                  C9.hazard              |    2/3      70.4 |    2/3      46.8
        c9-post-crest              C9.hazard              |    2/3      49.3 |    0/3      49.2
        PAIRED TOTAL  sight 7/12 = 0.583   blind 6/12 = 0.500   Fisher exact p = 1.0

## 5. Measured difficulty (trajectory-derived; the authoring surface cannot reach it)

  sight  n= 27  mean  62.7  median  63.6  sd  17.9  min 30.0  max 93.5  95% CI (bootstrap) (55.94, 69.33)
         per-cell: [30.0, 35.8, 37.3, 40.7, 45.2, 46.1, 48.1, 49.0, 49.2, 53.3, 54.2, 62.2, 62.8, 63.6, 65.1, 65.4, 69.9, 71.5, 72.9, 74.7, 77.8, 78.3, 83.1, 86.5, 86.8, 89.2, 93.5]
  blind  n= 30  mean  63.7  median  68.0  sd  17.7  min 31.5  max 89.0  95% CI (bootstrap) (57.3, 70.03)
         per-cell: [31.5, 35.0, 35.6, 41.8, 43.9, 45.7, 46.4, 47.1, 51.6, 52.9, 53.7, 54.2, 60.3, 62.2, 65.7, 70.3, 71.3, 71.6, 71.8, 72.2, 73.1, 73.2, 79.4, 82.1, 82.4, 86.3, 86.5, 86.7, 87.1, 89.0]

  difference (sight - blind): -1.0, 95% bootstrap CI (-9.83, 8.12)
  ** the CI spans zero: this is NOT evidence of a difficulty difference. **

## 6. Better, or merely more?

  MORE   : frozen-gate admission  sight 9/32 = 0.281   blind 10/32 = 0.312
           HQ-gate admission      sight 6/32 = 0.188   blind 9/32 = 0.281
  BETTER : judged good | admitted sight 0.481   blind 0.633
  QUALITY-ADJUSTED YIELD (admitted briefs x good rate, frozen gate):
           sight 9 x 0.481 = 4.33
           blind 10 x 0.633 = 6.33

  READ: sight admitted fewer briefs than blind, and the quality of its admitted cells is
        lower.
        => sight is worse on BOTH axes on this run.

  BEFORE READING ANY POOLED QUALITY NUMBER, SEE SECTION 4b. Pooled quality compares
  DIFFERENT SETS OF BRIEFS, because the two modes did not admit the same ones.

## 7. Every cell the FROZEN gate admitted that the judge rejects

  [blind] c1-ccrm (C1.car-following)  -> physically-valid-but-boring   {'R1': 4, 'R2': 2, 'R3': 1, 'R4': 3, 'R5': 4}   HQ-admitted=True
      brief : A slower lead vehicle is encountered at closing speed (Euro NCAP CCRm).
      why   : This cleanly realises slower-lead closing, but it is routine car-following with ample clearance rather than a valuable edge case.
      phys  : contested=True pathSep=0.0 m gap=1.6 s C3b=True
      trace : /tmp/vista-dev-blind/c1-ccrm-blind/batch-iter1/easterbrook-discovery-school/37e505554e09b1c5/draw-000.trace.json.gz
  [blind] c1-ccrm (C1.car-following)  -> physically-valid-but-boring   {'R1': 4, 'R2': 2, 'R3': 1, 'R4': 3, 'R5': 4}   HQ-admitted=True
      brief : A slower lead vehicle is encountered at closing speed (Euro NCAP CCRm).
      why   : This cleanly realizes slower-lead closing, but it is a routine, comfortably resolved car-following event rather than an interesting edge case.
      phys  : contested=True pathSep=0.0 m gap=1.44 s C3b=True
      trace : /tmp/vista-dev-blind/c1-ccrm-blind/batch-iter1/richmond-field-station/6194767b45ce8b63/draw-000.trace.json.gz
  [blind] c1-ccrm (C1.car-following)  -> physically-valid-but-boring   {'R1': 4, 'R2': 2, 'R3': 1, 'R4': 3, 'R5': 4}   HQ-admitted=True
      brief : A slower lead vehicle is encountered at closing speed (Euro NCAP CCRm).
      why   : This cleanly realises slower-lead closing, but it is routine car-following with ample clearance rather than a memorable edge case.
      phys  : contested=True pathSep=0.0 m gap=1.54 s C3b=True
      trace : /tmp/vista-dev-blind/c1-ccrm-blind/batch-iter1/yale-street/25b54f688d54d285/draw-000.trace.json.gz
  [blind] c15-protest (C15.adversarial)  -> intent-not-realised   {'R1': 1, 'R2': 1, 'R3': 2, 'R4': 3, 'R5': 4}   HQ-admitted=True
      brief : Pedestrians occupy the carriageway unexpectedly.
      why   : The clip shows a cautious pass of a stationary roadside pedestrian, not a pedestrian unexpectedly occupying the carriageway.
      flags : CHALLENGER_STATIC, NO_CONTESTED_SPACE, CHALLENGER_STOPPED_AFTER_CROSSING, NEAR_COLLISION_BY_TIMING
      phys  : contested=False pathSep=2.195 m gap=0.0 s C3b=False
      trace : /tmp/vista-dev-blind/c15-protest-blind/batch-iter2/belmont-research-center/201c868067bd8a09/draw-000.trace.json.gz
  [blind] c5-bus-stop-emergence (C5.pedestrian)  -> invalid   {'R1': 4, 'R2': 3, 'R3': 3, 'R4': 3, 'R5': 0}   HQ-admitted=False
      brief : A pedestrian emerges in front of a stopped bus.
      why   : This is a strong bus-occluded pedestrian conflict, but its interest is reduced because the pedestrian stops before the ego arrives and the ego simply brakes past.
      flags : CHALLENGER_STOPPED_AT_CONFLICT, CHALLENGER_STOPPED_AFTER_CROSSING, EGO_INTERSECTS_PROP, EGO_INTERSECTS_PROP
      caps  : [{'flag': 'EGO_INTERSECTS_PROP', 'dim': 'R5', 'from': 3, 'to': 0}]
      phys  : contested=True pathSep=0.0 m gap=1.22 s C3b=True
      trace : /tmp/vista-dev-blind/c5-bus-stop-emergence-blind/batch-iter0/easterbrook-discovery-school/029a490f4c2f7b3a/draw-000.trace.json.gz
  [blind] c5-bus-stop-emergence (C5.pedestrian)  -> physically-valid-but-boring   {'R1': 2, 'R2': 1, 'R3': 2, 'R4': 3, 'R5': 4}   HQ-admitted=False
      brief : A pedestrian emerges in front of a stopped bus.
      why   : The pedestrian has already cleared and stopped before the ego reaches the shared path, so this is a bus-adjacent pass-by rather than a genuine emergence conflict.
      flags : CHALLENGER_STOPPED_AT_CONFLICT, CHALLENGER_STOPPED_AFTER_CROSSING
      phys  : contested=True pathSep=0.0 m gap=1.62 s C3b=True
      trace : /tmp/vista-dev-blind/c5-bus-stop-emergence-blind/batch-iter0/richmond-field-station/0503da86fcf496a2/draw-000.trace.json.gz
  [blind] c6-cbna (C6.cyclist-ptw)  -> physically-valid-but-boring   {'R1': 3, 'R2': 1, 'R3': 2, 'R4': 3, 'R5': 2}   HQ-admitted=True
      brief : A cyclist crosses from the nearside close to the ego (NCAP CBNA).
      why   : This is a valid cyclist crossing, but it is a post-encroachment pass-by rather than a genuine simultaneous NCAP-style near-side conflict.
      flags : CHALLENGER_STOPPED_AT_CONFLICT, CHALLENGER_STOPPED_AFTER_CROSSING
      phys  : contested=True pathSep=0.0 m gap=1.14 s C3b=True
      trace : /tmp/vista-dev-blind/c6-cbna-blind/batch-iter1/richmond-field-station/b25ed3d4ad198bd2/draw-000.trace.json.gz
  [blind] c9-animal (C9.hazard)  -> physically-valid-but-boring   {'R1': 4, 'R2': 2, 'R3': 1, 'R4': 3, 'R5': 3}   HQ-admitted=True
      brief : An animal crosses into the ego path.
      why   : The brief is realised, but the animal clears the contested ground well before the ego arrives, making this a routine, well-anticipated crossing rather than a compelling edge case.
      flags : CHALLENGER_STOPPED_AT_CONFLICT
      phys  : contested=True pathSep=0.0 m gap=1.76 s C3b=True
      trace : /tmp/vista-dev-blind/c9-animal-blind/batch-iter0/el-camino-road/0214299c7555719b/draw-000.trace.json.gz
  [blind] c9-post-crest (C9.hazard)  -> intent-not-realised   {'R1': 1, 'R2': 1, 'R3': 0, 'R4': 3, 'R5': 4}   HQ-admitted=True
      brief : A hazard sits just beyond a crest or curve.
      why   : This is plausible braking behind a visible stopped car, but it does not realise the requested hazard hidden just beyond a crest or curve.
      flags : CHALLENGER_STATIC, NO_CONTESTED_SPACE, CHALLENGER_STOPPED_AFTER_CROSSING, NEAR_COLLISION_BY_TIMING
      phys  : contested=False pathSep=3.282 m gap=0 s C3b=False
      trace : /tmp/vista-dev-blind/c9-post-crest-blind/batch-iter2/easterbrook-discovery-school/08a67e53ba1de950/draw-000.trace.json.gz
  [blind] c9-post-crest (C9.hazard)  -> intent-not-realised   {'R1': 1, 'R2': 1, 'R3': 1, 'R4': 3, 'R5': 3}   HQ-admitted=True
      brief : A hazard sits just beyond a crest or curve.
      why   : This is a physically plausible braking response to a visible stopped car, but it does not realise the requested hazard-beyond-a-crest-or-curve mechanism.
      flags : CHALLENGER_STATIC, NO_CONTESTED_SPACE, CHALLENGER_STOPPED_AFTER_CROSSING, NEAR_COLLISION_BY_TIMING
      caps  : [{'flag': 'CHALLENGER_STATIC', 'dim': 'R2', 'from': 2, 'to': 1}]
      phys  : contested=False pathSep=3.305 m gap=0 s C3b=False
      trace : /tmp/vista-dev-blind/c9-post-crest-blind/batch-iter2/richmond-field-station/c11a31b20b104e47/draw-000.trace.json.gz
  [blind] c9-post-crest (C9.hazard)  -> physically-valid-but-boring   {'R1': 3, 'R2': 1, 'R3': 1, 'R4': 1, 'R5': 3}   HQ-admitted=True
      brief : A hazard sits just beyond a crest or curve.
      why   : The curve placement is correct, but the stationary car never creates a genuine conflict and the ego brakes excessively before simply passing it.
      flags : CHALLENGER_STATIC, NO_CONTESTED_SPACE, CHALLENGER_STOPPED_AFTER_CROSSING, NEAR_COLLISION_BY_TIMING
      phys  : contested=False pathSep=3.252 m gap=0 s C3b=False
      trace : /tmp/vista-dev-blind/c9-post-crest-blind/batch-iter2/yale-street/100889020be89adf/draw-000.trace.json.gz
  [sight] c1-tailgated-brake (C1.car-following)  -> intent-not-realised   {'R1': 1, 'R2': 2, 'R3': 1, 'R4': 3, 'R5': 4}   HQ-admitted=True
      brief : The ego is tailgated while the lead ahead brakes.
      why   : The clip shows ordinary lead braking, but it does not realise the key requirement because the supposed tailgater stays at least 46.2 m behind the ego.
      phys  : contested=True pathSep=0.0 m gap=1.62 s C3b=True
      trace : /tmp/vista-dev-sight/c1-tailgated-brake-sight/batch-final/belmont-research-center/99a7d978e6845a8b/draw-000.trace.json.gz
  [sight] c1-tailgated-brake (C1.car-following)  -> physically-valid-but-boring   {'R1': 2, 'R2': 2, 'R3': 1, 'R4': 3, 'R5': 4}   HQ-admitted=True
      brief : The ego is tailgated while the lead ahead brakes.
      why   : This is a plausible but routine lead-car braking clip, and it does not actually realise the requested ego-tailgated-by-another-vehicle setup.
      phys  : contested=True pathSep=0.0 m gap=2.42 s C3b=True
      trace : /tmp/vista-dev-sight/c1-tailgated-brake-sight/batch-final/easterbrook-discovery-school/289c40b54d9157ad/draw-001.trace.json.gz
  [sight] c1-tailgated-brake (C1.car-following)  -> intent-not-realised   {'R1': 1, 'R2': 2, 'R3': 0, 'R4': 3, 'R5': 4}   HQ-admitted=True
      brief : The ego is tailgated while the lead ahead brakes.
      why   : The clip shows ordinary lead braking, not the requested tailgating scenario, because the supposed tailgater remains at least 50.877 m away.
      phys  : contested=True pathSep=0.0 m gap=2.52 s C3b=True
      trace : /tmp/vista-dev-sight/c1-tailgated-brake-sight/batch-final/easterbrook-discovery-school/4b50e6a0ebde62a3/draw-000.trace.json.gz
  [sight] c11-backing-out (C11.parking)  -> physically-valid-but-boring   {'R1': 3, 'R2': 1, 'R3': 3, 'R4': 0, 'R5': 4}   HQ-admitted=False
      brief : A vehicle backs out of a parking space into the ego path.
      why   : The requested backing-out event is present, but the reversing car stops early enough that the ego never has to react and merely passes it.
      flags : EGO_RESPONSE_NEGLIGIBLE, CHALLENGER_STOPPED_AT_CONFLICT, CHALLENGER_STOPPED_AFTER_CROSSING, NEAR_COLLISION_BY_TIMING
      phys  : contested=False pathSep=0.752 m gap=0.0 s C3b=True
      trace : /tmp/vista-dev-sight/c11-backing-out-sight/batch-iter1/richmond-field-station/1638c19d7c60904d/draw-000.trace.json.gz
  [sight] c15-shedding-load (C15.adversarial)  -> physically-valid-but-boring   {'R1': 4, 'R2': 2, 'R3': 1, 'R4': 3, 'R5': 4}   HQ-admitted=True
      brief : A truck ahead sheds part of its load.
      why   : The load-shedding event is present, but it is too far from the ego to matter and the clip reduces to ordinary braking behind a slowing truck.
      flags : CHALLENGER_STOPPED_AT_CONFLICT, PROXIMITY_IS_NOT_THE_CONFLICT
      phys  : contested=True pathSep=0.0 m gap=3 s C3b=False
      trace : /tmp/vista-dev-sight/c15-shedding-load-sight/batch-iter0/richmond-field-station/1130ca6b3add8392/draw-000.trace.json.gz
  [sight] c15-shedding-load (C15.adversarial)  -> physically-valid-but-boring   {'R1': 3, 'R2': 2, 'R3': 1, 'R4': 3, 'R5': 3}   HQ-admitted=True
      brief : A truck ahead sheds part of its load.
      why   : The named load-shedding event is present, but the ego only performs routine car-following and never has to respond to the shed load.
      flags : CHALLENGER_STOPPED_AT_CONFLICT, PROXIMITY_IS_NOT_THE_CONFLICT
      phys  : contested=True pathSep=0.0 m gap=3.34 s C3b=False
      trace : /tmp/vista-dev-sight/c15-shedding-load-sight/batch-iter0/yale-street/004dcad67f1e2c7f/draw-000.trace.json.gz
  [sight] c5-reversing-ped (C5.pedestrian)  -> intent-not-realised   {'R1': 1, 'R2': 3, 'R3': 2, 'R4': 3, 'R5': 4}   HQ-admitted=True
      brief : A pedestrian walks behind a reversing vehicle.
      why   : The clip contains a genuine ego-versus-reversing-van conflict, but it does not realise the brief because the pedestrian never walks behind the van.
      flags : CHALLENGER_STOPPED_AT_CONFLICT, CHALLENGER_STOPPED_AFTER_CROSSING, NEAR_COLLISION_BY_TIMING
      phys  : contested=True pathSep=0.0 m gap=0.0 s C3b=True
      trace : /tmp/vista-dev-sight/c5-reversing-ped-sight/batch-iter1/belmont-research-center/b732af3ac97b17e6/draw-000.trace.json.gz
  [sight] c5-reversing-ped (C5.pedestrian)  -> intent-not-realised   {'R1': 1, 'R2': 1, 'R3': 2, 'R4': 3, 'R5': 4}   HQ-admitted=True
      brief : A pedestrian walks behind a reversing vehicle.
      why   : This is a valid close pass of a stopped reversing van, but it does not realise the requested pedestrian-walking-behind-the-van mechanism.
      flags : CHALLENGER_STOPPED_AT_CONFLICT, CHALLENGER_STOPPED_AFTER_CROSSING, NEAR_COLLISION_BY_TIMING
      phys  : contested=True pathSep=0.0 m gap=0.0 s C3b=True
      trace : /tmp/vista-dev-sight/c5-reversing-ped-sight/batch-iter1/easterbrook-discovery-school/107a04e02449de67/draw-000.trace.json.gz
  [sight] c5-reversing-ped (C5.pedestrian)  -> intent-not-realised   {'R1': 1, 'R2': 3, 'R3': 2, 'R4': 3, 'R5': 4}   HQ-admitted=True
      brief : A pedestrian walks behind a reversing vehicle.
      why   : This is a valid reversing-van versus ego near-conflict, but it does not realise the requested pedestrian-walking-behind-the-van event.
      flags : CHALLENGER_STOPPED_AT_CONFLICT, CHALLENGER_STOPPED_AFTER_CROSSING, NEAR_COLLISION_BY_TIMING
      phys  : contested=True pathSep=0.0 m gap=0.0 s C3b=True
      trace : /tmp/vista-dev-sight/c5-reversing-ped-sight/batch-iter1/el-camino-road/03befa5e9f8e566a/draw-000.trace.json.gz
  [sight] c7-double-parked-truck (C7.occlusion)  -> invalid   {'R1': 4, 'R2': 3, 'R3': 3, 'R4': 4, 'R5': 0}   HQ-admitted=False
      brief : A pedestrian steps out from behind a double-parked truck.
      why   : This is a strong edge case because the truck occludes a crossing pedestrian who then stops in a narrow vehicle path, forcing substantial braking before a close pass.
      flags : CHALLENGER_STOPPED_AT_CONFLICT, CHALLENGER_STOPPED_AFTER_CROSSING, EGO_INTERSECTS_PROP
      caps  : [{'flag': 'EGO_INTERSECTS_PROP', 'dim': 'R5', 'from': 3, 'to': 0}]
      phys  : contested=True pathSep=0.0 m gap=1.84 s C3b=True
      trace : /tmp/vista-dev-sight/c7-double-parked-truck-sight/batch-iter0/belmont-research-center/0df1edec66a260a5/draw-000.trace.json.gz
  [sight] c7-double-parked-truck (C7.occlusion)  -> invalid   {'R1': 4, 'R2': 3, 'R3': 3, 'R4': 4, 'R5': 0}   HQ-admitted=False
      brief : A pedestrian steps out from behind a double-parked truck.
      why   : This is a strong, genuinely interesting occluded-pedestrian case rather than a merely collision-free pass-by.
      flags : CHALLENGER_STOPPED_AT_CONFLICT, CHALLENGER_STOPPED_AFTER_CROSSING, EGO_INTERSECTS_PROP
      caps  : [{'flag': 'EGO_INTERSECTS_PROP', 'dim': 'R5', 'from': 3, 'to': 0}]
      phys  : contested=True pathSep=0.0 m gap=1.48 s C3b=True
      trace : /tmp/vista-dev-sight/c7-double-parked-truck-sight/batch-iter0/richmond-field-station/5182d3b7433e08f2/draw-000.trace.json.gz
  [sight] c7-double-parked-truck (C7.occlusion)  -> invalid   {'R1': 4, 'R2': 2, 'R3': 3, 'R4': 3, 'R5': 0}   HQ-admitted=False
      brief : A pedestrian steps out from behind a double-parked truck.
      why   : The occluded setup is good, but the pedestrian clears and stops 1.44 seconds before the ego arrives, making the near miss a post-encroachment pass rather than a genuinely simultaneous conflict.
      flags : CHALLENGER_STOPPED_AT_CONFLICT, CHALLENGER_STOPPED_AFTER_CROSSING, EGO_INTERSECTS_PROP
      caps  : [{'flag': 'EGO_INTERSECTS_PROP', 'dim': 'R5', 'from': 3, 'to': 0}]
      phys  : contested=True pathSep=0.0 m gap=1.44 s C3b=True
      trace : /tmp/vista-dev-sight/c7-double-parked-truck-sight/batch-iter0/yale-street/3636d82bfa5ba774/draw-000.trace.json.gz
  [sight] c9-animal (C9.hazard)  -> intent-not-realised   {'R1': 1, 'R2': 1, 'R3': 2, 'R4': 3, 'R5': 3}   HQ-admitted=True
      brief : An animal crosses into the ego path.
      why   : This is a physically valid stationary-animal pass-by, not an animal crossing into the ego path.
      flags : CHALLENGER_STATIC, NO_CONTESTED_SPACE, CHALLENGER_STOPPED_AFTER_CROSSING, NEAR_COLLISION_BY_TIMING
      phys  : contested=False pathSep=2.182 m gap=0.0 s C3b=False
      trace : /tmp/vista-dev-sight/c9-animal-sight/batch-final/el-camino-road/40ecca1b1096e231/draw-000.trace.json.gz
  [sight] c9-post-crest (C9.hazard)  -> intent-not-realised   {'R1': 1, 'R2': 2, 'R3': 1, 'R4': 3, 'R5': 4}   HQ-admitted=True
      brief : A hazard sits just beyond a crest or curve.
      why   : This is a plausible but ordinary, well-observed junction crossing and does not realise the requested hazard beyond a crest or curve.
      phys  : contested=True pathSep=0.0 m gap=0.8 s C3b=True
      trace : /tmp/vista-dev-sight/c9-post-crest-sight/batch-iter2/yale-street/ad6da3b8502acbdb/draw-000.trace.json.gz

## 8. Physics-side flags across all judged cells

  blind  CHALLENGER_STATIC                  4
  blind  CHALLENGER_STOPPED_AFTER_CROSSING  17
  blind  CHALLENGER_STOPPED_AT_CONFLICT     15
  blind  EGO_INTERSECTS_PROP                2
  blind  NEAR_COLLISION_BY_TIMING           9
  blind  NO_CONTESTED_SPACE                 4
  blind  PROXIMITY_IS_NOT_THE_CONFLICT      3
  sight  CHALLENGER_STATIC                  1
  sight  CHALLENGER_STOPPED_AFTER_CROSSING  15
  sight  CHALLENGER_STOPPED_AT_CONFLICT     17
  sight  EGO_INTERSECTS_PROP                3
  sight  EGO_RESPONSE_NEGLIGIBLE            1
  sight  NEAR_COLLISION_BY_TIMING           10
  sight  NO_CONTESTED_SPACE                 1
  sight  PROXIMITY_IS_NOT_THE_CONFLICT      3

  NO contested-space event (paths never overlapped) despite passing the FROZEN gate: sight 3, blind 6, total 9/57
  -> above the "couple of cells" threshold: NO_CONTESTED_SPACE is worth adding as a Q-clause.
