# UniScenarios repository transition

This repository is the standalone successor to the Scenario Studio working tree.
It was extracted without modifying or deleting the source repository.

## Naming contract

- Product and repository: **UniScenarios** / `uniscenarios`
- Package scope: `@uniscenarios/*`
- Primary CLI: `uniscenarios`
- Compatibility CLI alias: `scen`
- Application workspace: `apps/studio` (`@uniscenarios/studio`)

The `apps/studio` directory name describes the authoring surface; it is not a
legacy product name. Public UI, schemas, package metadata, and documentation use
UniScenarios naming.

## Provenance and local-only state

`MIGRATION-SOURCE.json` records the exact source commit, dirty status, and a
SHA-256 digest for every copied source file. The extraction preserves committed
history but intentionally configures no Git remote, so publishing requires an
explicit remote choice.

Ignored dependencies, generated build output, local render evidence, and
proprietary/local map assets are not committed. Publish selected evidence through
Git LFS or an external artifact store. For local development, provide `dev-assets/` separately or
use the extraction command's `--link-dev-assets` option on the source machine.

## Compatibility

Existing automation can continue invoking `scen`. New integrations should use
`uniscenarios`. Serialized scenario formats retain their schema versions; only
the owning product namespace and canonical schema host have changed.
