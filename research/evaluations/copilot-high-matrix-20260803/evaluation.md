# Scenario Copilot controlled high-effort matrix

> **Postmortem:** Subsequent product-owner review found the saved scenarios broadly incoherent and far below usable quality. The automated `strict success` metric below is not a product-quality indicator. See the [canonical generation postmortem](../scenario-copilot-generation-postmortem-20260804.md).

## Findings

- **Highest positive-case coverage:** direct-llm with gpt-5.6-luna (12/20), but it falsely accepted 2 negative controls.
- **Best safety-conscious result:** simulation-agent with gpt-5.6-terra (11 positive cases + 2 correct rejections; zero false accepts).
- **Lowest tokens per strict success:** verified-template-search with gpt-5.6-luna (1963 tokens), with only 3/20 positive cases; this is not the capability winner.
- Direct-model comparison: Luna led raw coverage by one case; Terra was substantially faster and used fewer tokens. Terra became the overall safety-conscious winner when paired with iterative simulator feedback.

## Controls

- Frozen twenty-case Richmond Field Station corpus and executable semantic assertions
- One candidate, identical trusted map slot builder and canonical twenty-second simulator
- High reasoning effort, no model substitution, four-iteration maximum for iterative providers
- Single run per case; results are paired descriptive evidence, not confidence intervals

## Capability and efficiency

| Method | Model | Runs | Strict success | Correct rejects | False accepts | Full sim | Calls | Tokens | Tokens / strict success | Latency / strict success | Median generation |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| direct-llm | gpt-5.6-luna | 20 | 12 | 0 | 2 | 17 | 24 | 100655 | 8388 | 33067 ms | 14597 ms |
| direct-llm | gpt-5.6-sol | 20 | 11 | 0 | 2 | 18 | 22 | 90292 | 8208 | 59844 ms | 21238 ms |
| direct-llm | gpt-5.6-terra | 20 | 11 | 0 | 2 | 18 | 22 | 68959 | 6269 | 17748 ms | 8367 ms |
| simulation-agent | gpt-5.6-luna | 20 | 9 | 2 | 0 | 9 | 52 | 297716 | 33080 | 163497 ms | 87969 ms |
| simulation-agent | gpt-5.6-terra | 20 | 11 | 2 | 0 | 11 | 49 | 177134 | 16103 | 58041 ms | 32697 ms |
| simulation-agent-vision | gpt-5.6-luna | 20 | 7 | 2 | 0 | 7 | 19 | 112416 | 16059 | 110379 ms | 25932 ms |
| relative-goal-optimizer | gpt-5.6-luna | 20 | 3 | 2 | 0 | 3 | 18 | 95696 | 31899 | 167090 ms | 26335 ms |
| verified-template-search | gpt-5.6-luna | 20 | 3 | 2 | 0 | 10 | 10 | 5889 | 1963 | 29259 ms | 3819 ms |

## Caveats

- A single generation was run per case and condition; stochastic variance is not estimated.
- Direct high-effort model baselines are comparable to one another. Older default-effort results are displayed separately and are not pooled into this matrix.
- Image cost is unknown unless the provider reports it; encoded image bytes are recorded instead.
- Passing structural semantic assertions does not prove visual realism or regulatory correctness.

## Source artifacts

- `direct-luna/results.json`
- `direct-sol/results.json`
- `direct-terra/results.json`
- `iterative-text-luna/results.json`
- `iterative-text-terra/results.json`
- `iterative-vision-luna/results.json`
- `relative-optimizer-luna/results.json`
- `template-search-luna/results.json`
