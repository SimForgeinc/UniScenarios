# W8 arm data: read the error column before the admission column

Written 2026-08-16 00:40 by the supervising thread, after the sweep host was rate-limited and the
supervisor stopped with 29/30 arms complete but uncommitted. The arms are now committed under
`W8-arms/`. This note records a measurement fact, **not** an analysis — the pre-registered analysis
still belongs to the lane. But the fact changes the interpretation enough that reporting raw
admission rates without it would produce two conclusions that are simply false.

## The fact

**100 of 580 brief-attempts (17.2%) never produced an authored artifact at all.** They are recorded
in each arm as `authorErrorCount` and per-row `error`, and they are *not* gate rejections. Two
distinct causes appear:

- `author_call_failed` — the model call itself failed (openai-codex arms)
- `unhandled` — an unhandled exception in the authoring path (Anthropic arms)

Distribution, out of 20 attempts per arm:

| model | low | medium | high | xhigh | max |
|---|---|---|---|---|---|
| `gpt-5.6-luna` | 0 | 0 | 0 | 0 | **4** |
| `gpt-5.6-sol` | 0 | 0 | 0 | 0 | 0 |
| `gpt-5.6-terra` | 0 | 0 | 0 | 0 | **20** |
| `claude-opus-5` | **17** | **17** | **9** | **6** | **17** |
| `claude-fable-5` | 3 | 0 | 2 | 3 | 2 |
| `claude-sonnet-5` | 0 | 0 | 0 | 0 | *(pending)* |

## The two false conclusions this prevents

**1. "`gpt-5.6-terra` at max effort scores 0.00 admission."** It scored 0 because **20 of 20 calls
failed**, not because it authored 20 bad scenarios. There is no quality signal in that cell at all.
The same applies to `claude-opus-5` at max (17 of 20 failed).

**2. "`claude-opus-5` improves sharply with reasoning effort" (0.05 → 0.10 → 0.45 → 0.50).** That
curve is almost entirely its *error rate* falling — 17 → 17 → 9 → 6. Among briefs that actually
produced an artifact its rate is 0.33 → 0.67 → 0.82 → 0.71, on usable-n of 3, 3, 11 and 14. Those
denominators are far too small to support any claim, in either direction.

## Admission among briefs that produced an artifact

`admitted / (20 - authorErrorCount)`. Cells with a tiny denominator are marked; they are not
evidence.

| model | low | medium | high | xhigh | max | mean |
|---|---|---|---|---|---|---|
| `gpt-5.6-luna` | 0.65 | 0.70 | 0.65 | 0.60 | 0.56 | 0.633 |
| `gpt-5.6-sol` | **0.75** | 0.70 | **0.75** | 0.65 | 0.65 | **0.700** |
| `gpt-5.6-terra` | 0.70 | 0.65 | 0.70 | 0.60 | — *(0 usable)* | 0.662 |
| `claude-opus-5` | 0.33 †n=3 | 0.67 †n=3 | 0.82 †n=11 | 0.71 †n=14 | — †n=3 | *unusable* |
| `claude-fable-5` | 0.76 †n=17 | 0.65 | 0.67 †n=18 | 0.71 †n=17 | 0.78 †n=18 | 0.713 |
| `claude-sonnet-5` | 0.55 | 0.65 | 0.65 | 0.65 | *(pending)* | 0.625 |

## What this does to the pre-registered hypotheses

Stated as observations for the lane to test properly, not as verdicts:

- **H1 (effort raises admission, monotonically, within model).** Every model with a clean error
  record trends **flat or downward** with effort: luna 0.65 → 0.56, sol 0.75 → 0.65, terra
  0.70 → 0.60. Reasoning tokens rise ~17–30× across that same span. The only apparent rise is
  `claude-opus-5`, and it is confounded by error rate as above. H1 looks falsified, and the failure
  is not marginal.
- **H2 (model rank stable across effort).** Among the three codex models the ordering
  sol > terra > luna holds at low, medium and high. It is worth checking whether the CIs permit
  calling that an ordering at all — at n=20 every interval spans roughly ±0.20 and they overlap
  heavily.
- **Reliability, not quality, is the largest measured difference between models.** `sol` completed
  100 of 100 attempts. `claude-opus-5` failed 66 of 100. That is a much bigger effect than any
  admission-rate gap in the table, and it was not one of the three pre-registered hypotheses.

## The honest caveat on the raw metric

The pre-registration fixed the primary metric as gate admission rate over the 20 briefs — i.e. the
raw numerator/20, which counts an author failure as a non-admission. That definition is defensible
for a production question ("if I run this arm, what fraction of briefs yield an admitted
scenario?") and indefensible for a quality question ("which model authors better?"). **Report both,
label which is which, and do not silently switch between them.** The pre-registration also required
that "refusal/error rate be separated from gate rejection, because collapsing the two would flatter
the weaker arms" — in the event it turned out to flatter nothing and instead to invent a cliff.

## Provenance

- Raw per-arm records: `W8-arms/arm-<model>-<effort>.json`, 29 files.
- The fixed 20-brief sample every arm shared: `W8-arms/sample.json`.
- Missing at the time of writing: `claude-sonnet-5-max`, launched separately since `claude-sonnet-5`
  routes to an account with headroom while Fable is rate-limited.
- Cause of the stop: `michael@simforge.ai` 5-hour window at 100%, every Fable request returning
  HTTP 429 with `retry-after-ms` ≈ 1,791,000. Not a research failure.
