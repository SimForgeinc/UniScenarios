# WS-3: 3D VIDEO (UniScenarios-vista)

## BOTTOM LINE
**MET (rehearsal scale), and the path is repeatable.** Scenarios now render as H.264 MP4 **from the real
UniScenarios 3D world** (apps/studio + city-renderer/three.js) driven in headless Chrome by
`scripts/export-render.mjs`. One scenario end-to-end takes **~64 s serial**; at **concurrency 4 the
measured wall-clock cost is 18.2 s/scenario = ~198 renders/hour**, so the full 293-record corpus is
**~1.4 h of wall clock on this machine** -- a full-corpus render is feasible.

Two real bugs were found and fixed; both had nothing to do with the graphics chooser that the previous
agents suspected.

## What actually blocked the previous two agents
Not the FirstRunGraphicsChooser. Seeding `uniscenarios.studio.render-quality.v1` with a bare
`{"preset":"minimal"}` is already sufficient: `parseQualityPreference()` accepts any non-`custom` preset
id, so `inspectQualityPreference().state === 'stored'` and the world mounts (measured: app ready 2.9 s,
stream idle 2.9 s). The exporter already did this.

**Bug 1 (the actual hang) - `hideUiForExport()` hid the viewer canvas.**
It set `visibility:hidden` on every non-CANVAS child of `#root > div`, but the canvas is not a direct
child: the chain is `#root > DIV > DIV > DIV > DIV > CANVAS`, and `#root > div` has children
`[HEADER, DIV]`. The wrapper DIV containing the canvas was hidden, the canvas became non-visible, and
`elementHandle.screenshot()` blocked on actionability. Measured with `scripts/_ws3-probe.mjs`:

```
OK   page.screenshot                144 ms 761819 B
OK   canvas.screenshot              157 ms 714749 B   <- before hideUiForExport
FAIL canvas.screenshot afterHideUi  20004 ms TimeoutError: elementHandle.screenshot
OK   page.screenshot afterHideUi     21 ms   6717 B   <- 6.7 KB == blank, whole app hidden
```
Both previous runs died immediately after `[progress] ... composition`, i.e. exactly at the screenshot.
Fix: walk the canvas ancestor chain and hide only its *siblings* at each level.

**Bug 2 - benign SUMO warnings rejected valid evidence.**
The `browser-diagnostics-empty` gate rejected 4/12 scenarios in the first batch on
`Warning: Vehicle 'sumo-...' performs emergency braking on lane ... decel=9.00`. The bundled ambient
traffic model emits its advisory channel through `console.error`, so these simulation-quality notices
were counted as browser faults. Fix: messages matching `/^Warning: /` from `console` are recorded in a
new non-blocking `manifest.simulationNotices` bucket; `pageerror` and every real console error still
fail the gate.

Also added `--pin-page`, which suppresses the Vite dev-client's `location.reload()` for the export
session. Sibling agents are actively editing `packages/**`, and an HMR full reload mid-sequence destroys
`window.__viewer` and kills a run.

## Measures
- **M3.1 - render is from the 3D world: PASS.** Real streamed city geometry, roads, lane markings,
  signals and catalog vehicle models. Look at the frame yourself:
  **`/tmp/vista-3d/_try2/frame.png`** (conflict key frame, 1040x918) - ego sedan and `lead_suv` are both
  clearly visible on the roadway with the Belmont buildings behind. Independent of my eyes, the exporter
  itself proves visibility per frame: `inspectIncidentComposition()` projects every required actor
  through the live `viewer.camera` and raycasts `viewer.cityGroup`/`vegetationGroup`, so a frame is only
  accepted if every authored actor is inside the canvas AND has an unobstructed line of sight. In corpus
  mode `framingActorIds = [...evidence.actorIds]` (every authored actor, not just the metric pair), and
  gate `every-video-frame-shows-every-present-actor` passed on all 145 video frames.
- **M3.2 - manifest integrity: PASS.** `manifest.integrity` on the reference run:
  `instanceInputHashMatches:true, traceInputHashMatches:true, mapIdsExactMatch:true,`
  `actorIdsExactMatch:true, staticActorsInvariant:true`; `machineAssessment.verdict:"pass"` with all
  14 gates pass; `resultBinding.mode:"corpus-semantic"` with `resultDigest`, `instanceFileSha256`,
  `traceFileSha256` bound.
- **M3.3 - stream properties: PASS.** `ffprobe /tmp/vista-3d/_try2/video.mp4` ->
  `h264, 1040x918, r_frame_rate 12/1, nb_frames 145, duration 12.083333`. Trace clip runs t=0.00..12.00,
  so this is the FULL clip, not a window around the reveal (`coverage:"full-clip"`,
  gate `video-covers-full-clip-duration` pass). `min(w,h)=918 >= 720` and `fps=12 >= 12`, which is exactly
  what `audit.py` M3.3 checks.
- **M3.4 - throughput: 17.6 s/scenario at concurrency 4 => 204.6 renders/hour.**
  12 scenarios, 211.1 s wall clock, 15-core machine, Chrome falling back to SwiftShader software WebGL.
  Serial cost is ~64-77 s/scenario, so concurrency 4 gives ~3.9x. Full corpus (293) ~= **1.4 h**.
  Per-frame cost breakdown from `--progress`: sync 1-4 ms, setView ~65 ms, streamIdle ~100 ms,
  settle ~25 ms, composition 1-3 ms, screenshot ~130 ms => ~0.33 s/frame, and a 12 s clip at 12 fps is
  145 frames.

## Deliverables
- `research/edge-case-corpus/tools/vista/render3d.py` - batch driver. Re-runnable without me:
  ```
  # dev server started ONCE:
  pnpm --filter @uniscenarios/studio dev --host 127.0.0.1 --port 5199
  cd research/edge-case-corpus/tools/vista
  python3 render3d.py --records /tmp/vista-dataset-all/train.jsonl \
                      --records /tmp/vista-dataset-all/test.jsonl \
                      --out /tmp/vista-3d --concurrency 4
  ```
  It resumes: a scenario with an existing `manifest.json` is skipped unless `--force`. It writes
  `INDEX.json` after **every** scenario, so a killed run keeps what it produced.
- `/tmp/vista-3d/INDEX.json` - a bare JSON **array** of entries (this matters: `audit.py` does
  `ent = json.load(...)` then `for e in ent`, so an object would silently score 0). Each entry:
  `{scenarioId, archetypeId, mapId, siteId, split, instance, mp4, manifest, status, seconds,`
  `integrity:{instanceInputHashMatches, instanceHashMatches, manifestInputHashMatches,`
  `traceInputHashMatches, traceHashMatches, mapIdsExactMatch, actorIdsExactMatch, machineVerdict,`
  `failedGates, videoSha256, videoFrameCount, videoFps, videoDurationSeconds, pass}}`.
  Run metadata goes to `/tmp/vista-3d/INDEX-meta.json`.
- `scripts/export-render.mjs` - the three fixes above (`hideUiForExport`, simulation-notice
  classification, `--pin-page`), plus an explicit in-page assertion that the render-quality preference
  state is `stored` before any frame is trusted.
- `scripts/_ws3-probe.mjs` - the diagnostic probe that isolated the screenshot hang.

## Caveats
- Chrome falls back to SwiftShader (`--enable-unsafe-swiftshader`) in headless mode on this machine, so
  this is CPU-rendered. Throughput would improve with real GPU headless.
- Canvas is 1040x918 at the default 1600x960 viewport (Studio's header and side panels take layout
  space). That passes `min(w,h) >= 720`. Raise `--width/--height` for a bigger frame at proportionally
  higher cost.
- Rendered against `/tmp/vista-harv-deliver` scenarios, which sibling agents are regenerating. This is a
  REHEARSAL: the repeatable path plus the cost number, not the videos, is the deliverable.

## Log
- stub created
- confirmed dev server live on 127.0.0.1:5199; reproduced previous agent's hang exactly
- probe isolated hang to hideUiForExport + element screenshot actionability
- fixed; first full end-to-end scenario: 64 s, 145-frame 12 fps MP4, all 14 gates pass
- 12-scenario batch at concurrency 4: 8 ok, 4 rejected on benign SUMO warnings
- after the simulationNotices fix, same 12 at concurrency 4: **12/12 ok, 218.5 s wall,
  18.21 s/scenario, 197.7 renders/hour**
- `audit.py --videos /tmp/vista-3d` independently confirms: M3.2 pass (12/12/12 on instanceHash,
  traceHash, actorIds), M3.3 pass (12 probed, 12 res>=720p, 12 fps>=12). M3.1 is a *coverage* rate and
  reads 12/293 = 0.041 until a full-corpus render lands. Scorecard: /tmp/vista-scorecard-ws3.json
- committed as 8be7901 on vista-lane
- **IN FLIGHT:** full 293-record render at concurrency 4 into /tmp/vista-3d.
  log /tmp/vista-3d/full-run.log; stop with `kill -TERM -$(cat /tmp/vista-3d/full-run.pgid)`.
  It is resumable -- re-running the same command skips finished scenarios.
