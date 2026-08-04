# Scenario Copilot saved-result inspection rerun

> **Postmortem:** Product-owner inspection of these saved scenarios found them broadly nonsensical and not close to usable. The retained drafts and traces are evidence for debugging, not successful authoring examples. See the [canonical generation postmortem](../scenario-copilot-generation-postmortem-20260804.md).

This artifact contains fresh reruns of the original ten edge-case prompts across
the original three providers. It does not recover, replace, or relabel the
original `chat2scenic-20260803` outputs.

## Controlled configuration

- Model requested: `gpt-5.6-luna`
- Reasoning effort: omitted, matching the original run
- Map: `richmond-field-station`
- Candidate count: one per prompt and provider
- Concurrency: at most three providers; cases within each provider ran serially
- Canonical simulation: 20 seconds
- Source commit used by the canonical 30 rows: `82332ed`
- Wall interval: 2026-08-04T06:05:33.730Z to 2026-08-04T06:16:16.790Z

Parallel load can affect latency. These rerun timings must not replace the
original benchmark's method-performance measurements.

## Outcomes and retained evidence

| Provider | Rows | Strict success | Semantic mismatch | Pipeline failure | Unsupported accepted | Saved drafts | Saved 20s traces | BEV images | API calls | Tokens |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Structured + Retrieval | 10 | 2 | 5 | 2 | 1 | 10 | 8 | 10 | 10 | 12,035 |
| Direct LLM | 10 | 6 | 2 | 1 | 1 | 9 | 9 | 9 | 11 | 36,828 |
| Upstream Chat2Scenic | 10 | 5 | 3 | 1 | 1 | 10 | 9 | 10 | 82 | 237,357 |
| **Recorded total** | **30** | **13** | **10** | **4** | **3** | **29** | **26** | **29** | **103** | **286,220** |

Every canonical row contains a sanitized saved-result envelope. Successful
simulations retain a compressed full canonical trace, trace and result hashes,
event summaries, native draft, structured intent, map identity, semantic
assertions, and deterministic bird's-eye evidence. Draft-only and pre-draft
failures are retained truthfully rather than reconstructed.

## Caveats

- A first upstream launch omitted the pinned Scenic Python environment. Two
  attempts reached the Scenic boundary and failed with `No module named
  'scenic'`; their partial evidence is preserved under
  `upstream-chat2scenic-failed-environment-attempt/`. The provider did not
  return usage when it threw, so those two attempts' API calls and tokens are
  not included in the recorded total above. They are not part of the canonical
  30-row inspection set.
- The upstream repository does not distribute its referenced Milvus snapshot.
  Its existing disclosed prompt-example substitute remains in use.
- Generated upstream Scenic component text is not returned across the provider
  boundary, so `generatedScenic` remains `null`; it was not reconstructed or
  falsely labeled as original output.
- All three providers again accepted the impossible flying/teleport request.
  Runnable output is not evidence that a prompt was faithfully satisfied.
- A saved draft can be applied only when its map ID, map hash (when available),
  and scenario schema are compatible with the currently open editor map.
