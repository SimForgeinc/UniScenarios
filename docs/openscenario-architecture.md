# OpenSCENARIO architecture

This document is the architecture authority for OpenSCENARIO in UniScenarios
and SimCloud. The implementation authority is `packages/openscenario`.
OpenSCENARIO compilers, parsers, compatibility policy, schemas, validation,
artifact identity, and bundle contracts must not be implemented in a CLI,
application UI, cloud route, or execution worker.

## Decision

The dependency direction is one way:

```text
scenario-model + sim-engine
            |
            v
@uniscenarios/openscenario
  - import and security analysis
  - XML 1.4 and DSL 2.2 export
  - esmini XML 1.3 compatibility export
  - capability and fidelity reports
  - immutable snapshot contracts
  - official-schema validation
  - runnable-bundle contracts
            |
            +--> @uniscenarios/cli (command adapter)
            +--> Studio (browser presentation adapter)
            +--> @uniscenarios/esmini-runner (execution adapter)
            +--> CARLA bridge (execution adapter)
            +--> SimCloud (product and cloud adapter)
```

No arrow points back toward the standards package. In particular,
`@uniscenarios/openscenario` must never depend on `@uniscenarios/cli`, Studio,
SimCloud, esmini, or CARLA.

## Public boundaries

| Entry point | Runtime | Owns |
| --- | --- | --- |
| `@uniscenarios/openscenario` | Browser-safe | Import analysis/translation, export compilers, capability reports, snapshots |
| `@uniscenarios/openscenario/import` | Browser-safe | Bounded XML parsing, security rejection, map resolution, translation |
| `@uniscenarios/openscenario/export` | Browser-safe | Format selection and all portable compiler profiles |
| `@uniscenarios/openscenario/types` | Type-only | Export options, results, issues, warnings, fidelity vocabulary |
| `@uniscenarios/openscenario/xml-1.4` | Browser worker-safe | Native XML 1.4 compiler without Node dependencies |
| `@uniscenarios/openscenario/node` | Node-only | Digest-pinned XSD validation and complete esmini runnable bundles |
| `@uniscenarios/esmini-runner` | Node-only | Sandboxed execution and receipts; never rewrites a bundle |
| CARLA bridge | Python/runtime | ScenarioRunner execution adapter; never authors standards semantics |

`@uniscenarios/cli` owns argument parsing, files, exit codes, and JSON output.
Studio owns interaction and presentation. SimCloud owns identity, authorization,
durable jobs, object storage, signed delivery, observability, and billing.

## Canonical flows

### Native export

1. Authoring produces a validated scenario document.
2. Materialization resolves deterministic actors, controls, map bindings, and
   a concrete `SimScenarioInput`.
3. The simulation engine produces the canonical trace.
4. `@uniscenarios/openscenario` creates an immutable snapshot bound to the
   document, concrete input, trace, map, and exporter digests.
5. The selected compiler emits XML/DSL plus a complete capability report.
6. Node validation checks XML against the digest-pinned official ASAM schema
   with networking and external entities disabled.
7. An adapter downloads locally or publishes the immutable artifact.

The compiler fails closed. A warning may describe explicit approximation or
metadata-only retention. Unsupported required semantics are typed issues and
produce no ready artifact.

### esmini compatibility and execution

1. The canonical snapshot is lowered into an explicitly named XML 1.3 profile.
2. A Node-side resolver supplies the complete digest-matched OpenDRIVE file.
3. The standards package creates a closed bundle containing scenario, road,
   canonical trace, capability report, provenance, and manifest hashes.
4. The runner ingests the bundle without rewriting it, executes a pinned
   runtime, and emits an immutable receipt and external trace.
5. The trace comparator produces a separate behavior-parity verdict.

XSD validity, simulator compatibility, successful execution, and behavioral
parity are independent statuses. The UI must never collapse them into one
"valid" badge.

### Import

1. An adapter applies transport limits before parsing (request, archive, file,
   and count limits).
2. The standards package rejects DTD/entities, remote dependencies, traversal,
   executable controllers, unsupported versions, and disallowed commands.
3. Map resolution uses authorized candidates supplied by the adapter.
4. Translation returns a versioned scenario document plus diagnostics and
   explicit unsupported semantics.
5. SimCloud may persist source bytes and translated documents, but it does not
   maintain a second parser or translation policy.

## Artifact identity

Every published artifact or external result is keyed by at least:

- source document hash and schema version;
- concrete input hash, seed, timestep, and engine version;
- canonical trace hash;
- map id, complete OpenDRIVE digest, and lane-graph digest;
- exporter profile and package version;
- official schema version and digest;
- external runner version/digest when applicable;
- comparison policy and thresholds when applicable.

Editing any input invalidates prior results. URLs, local paths, timestamps, and
cloud object locations are delivery metadata and never artifact identity.

## Storage and browser delivery

Core export is local and requires no object store. SimCloud publication follows
this boundary:

```text
browser -> authenticated SimCloud API -> authorized artifact reference
        -> fresh signed CDN/S3 URL or same-origin proxy -> immutable bytes
```

Browser code must not retain raw bucket URLs or treat a bucket hostname as a
stable API. Signed URLs are short-lived delivery capabilities. The publication
API must refresh them on demand, and browser caches must expire before the
signature does.

Direct browser delivery requires an environment-specific CORS contract covering
every actual application origin. Local development should prefer same-origin
Vite/Next proxying or `/dev-assets`; if it intentionally uses a production
bucket, the exact localhost origins must be explicitly allowed. A release smoke
must fetch one signed object from each supported browser origin and assert the
`Access-Control-Allow-Origin` response. HTTP 200 from a server-side probe alone
does not prove browser accessibility.

## Repository ownership

| Concern | Canonical location | Adapter-only locations |
| --- | --- | --- |
| Import/security/translation | `packages/openscenario/src/import.ts` | SimCloud upload/session routes |
| Export and fidelity policy | `packages/openscenario/src/export/` | CLI command, Studio worker, cloud job handler |
| Official validation and bundles | `packages/openscenario/src/node/` | Local runner server, cloud worker |
| Snapshot contract | `packages/openscenario/src/snapshot.ts` | Studio/SimCloud view models |
| esmini execution | `packages/esmini-runner` | Local/cloud transport |
| CARLA execution | `adapters/carla-bridge` | SimCloud worker leasing/storage |
| Authorization/storage/delivery | SimCloud | None in portable packages |

The following SimCloud implementations are migration debt and must be removed
when SimCloud consumes the canonical stack: its local XOSC parser, local XOSC
writer, and their copied worker parser. Until that migration is complete they
must not gain new standards behavior; changes belong in UniScenarios first.
ScenarioRunner's vendored parser is an external runtime implementation, not a
product authoring authority.

### SimCloud migration sequence

1. Publish and lock a UniScenarios stack containing the canonical package
   entry points defined above.
2. Replace `packages/shared/src/xosc/parser.ts` and the generated
   `services/dataset-export-worker/src/xosc-parser.js` with the canonical import
   analysis API. Keep upload/session limits and persistence in SimCloud.
3. Remove `apps/web/app/lib/scenario-editor/xosc-writer/`. The shared v2 editor
   must submit a canonical scenario document/input to the standards package;
   the product must not add a second compiler for its view model.
4. Keep original uploaded source bytes as immutable evidence, separately from
   translated editable documents and generated exports.
5. Route validation and render jobs through versioned profile requests and
   persist capability reports, validation stages, and package identity with the
   artifact row.
6. Replace direct bucket delivery with the authenticated publication API and
   add per-origin signed-download smoke tests.
7. Remove the corresponding forbidden paths from the divergence configuration
   only after the audit proves they are absent and the locked packages are in
   use.

## Change protocol

1. Add or change semantics in `packages/openscenario` with a portable fixture.
2. Validate browser-safe compilation separately from Node-only validation.
3. Run official XSD, negative security, bundle-closure, and execution-adapter
   tests as applicable.
4. Update the capability report for every new top-level scenario field.
5. Publish one immutable UniScenarios stack release.
6. Update SimCloud's locked stack and only then remove/modify product adapters.
7. Verify signed delivery from actual browser origins in each environment.

Architecture is enforced by `scripts/integration/openscenario-architecture.test.mjs`
and the SimCloud divergence audit. Exceptions require an explicit architecture
decision updating this document and both guards in the same change.
