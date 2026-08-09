# OPEN: reversing-pedestrian-runtime golden is stale in TWO places

`packages/cli/src/__tests__/reversing-pedestrian-runtime.test.ts` — "backs rear-first, yields at one
physical path crossing, and settles without collision".

After the `dynamic-v1` tyre-slip sign fix (`frontSlip = atan2(vy + lf*r, |u|) - direction * steerRad`):

1. `minPathTTC.value` 0.80196 -> **0.75245** at the same t=3.38.
   Without the fix it is **null** — no crossing conflict detected at all. So the golden is stale in the
   GOOD direction: the scenario previously failed to produce the conflict it is named after.
2. Updating (1) exposes a second failure: `new Set(egoTrack.x.slice(-25)).size` expects **1** (the ego
   has come to rest by the end of the clip) and now measures **25** — the reversing ego is still moving
   at clip end.

(2) is a real behavioural change, not a stale constant, and I am NOT updating both numbers to make the
suite green. Prior to the fix the reversing body detached from its route and froze, which is what made
"settles" true; now it actually reverses. Whether it SHOULD still be moving at clip end is a question
about the fixture's intent, and the honest options are to extend the clip, add an explicit stop, or
re-state what the test asserts.

Context: caps-reverse A/B'd the cli suite and measured **67 failures with and without** the slip-sign
change, with identical failure sets, so this test was already red before. It is recorded here because
the REASON it is red has changed, and because silently re-baselining a golden is how a physics
regression gets locked in.
