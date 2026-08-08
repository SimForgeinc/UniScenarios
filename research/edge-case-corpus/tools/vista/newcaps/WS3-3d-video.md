# WS-3: 3D VIDEO (UniScenarios-vista)

## BOTTOM LINE
**IN PROGRESS.** Root cause of the previous agents' hang is FOUND and it is NOT the graphics chooser.
`context.addInitScript` seeding `{"preset":"minimal"}` is sufficient (`parseQualityPreference` accepts a
bare `{preset}` for any non-`custom` preset id, so state === 'stored'); the 3D world mounts in ~2.9 s and
streams idle at ~2.9 s. Verified visually: real streamed city geometry renders (/tmp/vista-3d/p_canvas.png).

The real blocker is a bug in `hideUiForExport()` in scripts/export-render.mjs:
it hides every non-CANVAS child of `#root > div`, but the canvas is NOT a direct child --
DOM chain is `#root > DIV > DIV > DIV > DIV > CANVAS`, and `#root > div` has children [HEADER, DIV].
So the wrapper DIV containing the canvas gets `visibility:hidden`, the canvas becomes invisible, and
`canvas.screenshot()` blocks on actionability forever (measured: >105 s with no error; with an explicit
20 s timeout it throws `TimeoutError: elementHandle.screenshot`). That is exactly where both previous
agents died, right after `[progress] ... composition`.

Evidence (scripts/_ws3-probe.mjs):
```
OK   page.screenshot 144 ms 761819
OK   canvas.screenshot 157 ms 714749          <- before hideUiForExport
FAIL canvas.screenshot afterHideUi 20004 ms TimeoutError
OK   page.screenshot afterHideUi 21 ms 6717   <- 6.7 KB = blank, whole app hidden
```

## Measures
- M3.1 (3D world render path): PARTIAL - world mounts and renders; screenshot bug being fixed
- M3.2 (manifest integrity: instance-hash, trace-hash, exact actor-id equality): UNKNOWN
- M3.3 (>=720p, >=12fps, full clip duration via ffprobe): UNKNOWN
- M3.4 (seconds/scenario at stated concurrency -> renders/hour): UNKNOWN

## Log
- stub created
- confirmed dev server live on 127.0.0.1:5199
- reproduced previous agent's hang exactly (stops after `composition` stage)
- probe isolated the hang to hideUiForExport + element screenshot actionability
