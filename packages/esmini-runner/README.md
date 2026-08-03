# `@uniscenarios/esmini-runner`

Pinned external execution boundary for esmini 3.6.0. It consumes only the typed
`EsminiExecutionJob` produced by the compatibility bundle builder and returns a
browser-safe `ExternalRunResult` containing execution status, immutable cache
identity, structured logs, and opaque artifact handles.

Production jobs must use the Docker invocation profile: no network, read-only
root and inputs, an unprivileged user, no Linux capabilities, bounded CPU,
memory, processes, runtime, and output. `LocalProcessExecutor` is explicitly a
developer convenience and reports `developer-local` isolation; it must not be
used as production evidence.

The numerical CSV/DAT/OSI outputs and collision log are authoritative external
evidence. Frames and video are optional, non-authoritative human evidence.

Install the official pinned binary locally with:

```sh
node packages/esmini-runner/scripts/fetch-pinned-esmini.mjs
```

The helper verifies the upstream archive SHA-256 before extraction. `.tools/`
must remain untracked. See [NOTICE.md](./NOTICE.md) for licensing.
