# CHECKPOINT 3 -- is deduplication honest?

Instruments: `audit2/dedup_audit.py`, `audit2/dedup2.py`. Run over the actual harvest population
(the 394 `passHQ` cells produced by mass-simulating 5 verified templates), using the project's own
`gate.deduplicate` unmodified.

## 1. Your "310 raw -> 61" reproduces exactly

| batch | passHQ | distinct |
|---|---|---|
| harvest1 / c9g-displaced-drain-grate | 302 | 54 |
| harvest1 / c3g-trailer-offtrack | 8 | 7 |
| harvest1 / c12g-backward-school-gate | 0 | 0 |
| **harvest1 total** | **310** | **61** |
| harvest2 / c9g-pedestrian-behind-bus | 72 | 45 |
| harvest2 / c10g-left-turn-no-yield | 12 | 3 |

Confirmed. Note the `gate.py` docstring still says "302 ... collapsed to 134", which is the stale
pre-Q8 figure; with Q8 in place it is 302 -> 54.

## 2. It is NOT too aggressive -- same-signature cells really are the same scenario

The signature is `(map, site, clearance/0.5 m, minTTC/0.5 s, egoPeakDecel/1.0)`. The honest test is
whether cells sharing a signature also agree on quantities the signature **never looks at**.
Over the 394 harvest cells in 109 signature groups:

| quantity NOT in the signature | overall SD | mean within-group SD | ratio |
|---|---|---|---|
| closestT | 2.345 s | **0.056 s** | 0.024 |
| pathSeparationM | 0.791 m | **0.016 m** | 0.020 |
| encroachmentGapS | 1.099 s | **0.016 s** | 0.014 |
| egoPeakDecelMps2 | 0.475 | 0.026 | 0.055 |
| minTTC | 1.125 s | 0.054 s | 0.048 |
| clearanceM | 0.352 m | 0.036 m | 0.102 |
| egoSpeedDropMps | 1.555 | 0.307 | 0.197 |

Within a group the spread is **1.4%-20%** of the population spread. Also: **0 of 109 groups contain
more than one distinct challenger** -- the signature implicitly pins down *who the conflict is with*
without ever encoding it. Cells collapsed together are genuinely the same event with numerical
jitter on top. The collapse is justified.

## 3. It IS too lax -- what survives as "distinct" mostly is not

The complementary test: at the SAME site, how much do cells that dedup **kept as different** differ?

| quantity | between-group SD at one site | within-group SD | ratio |
|---|---|---|---|
| pathSeparationM | 0.017 m | 0.016 m | **1.0x** |
| closestT | 0.072 s | 0.056 s | **1.3x** |
| egoPeakDecelMps2 | 0.065 | 0.026 | 2.5x |
| clearanceM | 0.114 m | 0.036 m | 3.2x |
| minTTC | 0.280 s | 0.054 s | 5.2x |

Two cells at the same site that the signature calls **different lessons** differ by, typically,
**11 cm of clearance, 0.28 s of TTC and 0.065 m/s^2 of ego deceleration**, and are
**indistinguishable** in closest-approach time and path separation. No driving policy learns
anything different from a near miss at 1.2 m versus 1.3 m at the same site with the same challenger
under the same geometry.

**The 61 surviving scenarios are still mostly near-duplicates.** The band widths (0.5 m, 0.5 s,
1.0 m/s^2) are far finer than the true structure of the population, so which side of a band a cell
lands on is arbitrary.

## 4. It is also the wrong signature

The deeper problem is that all three numeric fields are **outcome** variables -- how close, how
soon, how hard -- and outcomes are exactly what parameter jitter perturbs. "Teaches a different
lesson" is a statement about **conflict structure**, not about outcome magnitude. A signature that
matched the claim would be over:

    (mapId, siteId, challenger CLASS, conflict GEOMETRY {crossing | oncoming | following},
     whoArrivedFirst, occluded {yes|no}, ego response type {brake | swerve | none},
     and only then a COARSE severity band -- e.g. clearance in {contact, <1 m, 1-3 m, 3-5 m})

All of those are already computed: class from `actorMetadata.dims`, geometry and `whoArrivedFirst`
from `judge/conflict.py`, occlusion from a sightline test, ego response from the speed trace.

**Recommendation:** do not tighten the existing bands -- change the axes. And in the meantime treat
the "distinct" count as a soft upper bound rather than a corpus size. On the evidence here,
61 distinct is closer to ~30 genuinely different lessons.

## 5. Caveat against my own result
This is measured on 5 templates from 2 harvest runs, and 302 of the 394 cells come from a single
template (`c9g-displaced-drain-grate`) which -- see REPORT-1 -- is itself a confirmed critic false
positive whose mechanism is absent. The within/between ratios are therefore dominated by one
scenario family. The direction of the conclusion is clear, the exact ratios are not general.
