# Immutable package publication

UniScenarios is the source repository for every shared scenario, simulation,
map, OpenSCENARIO, renderer, catalog, editor-core package, and CARLA execution
runtime consumed by SimCloud. SimCloud must never publish or edit a second
implementation.

## Release contract

1. Every public package has the exact version in
   `config/uniscenarios-stack.json`; internal dependencies are pinned to that
   stack version in packed artifacts.
2. A release tag is exactly `v<stackVersion>` and identifies one immutable Git
   tree. Published npm versions are never overwritten or reused.
3. GitHub Actions builds and verifies the complete package set, creates the
   deterministic stack manifest, smoke-installs the packed npm tarballs and
   CARLA wheel, and uses npm and PyPI trusted publishing/provenance
   (`id-token: write`). The Python `0.1.0rc10` spelling is the PEP 440 form of
   stack version `0.1.0-rc.10`.
4. The npm environment provides `NPM_TOKEN` only until trusted publishing is
   configured for every package. Secrets never enter repository files or build
   artifacts.
5. SimCloud synchronizes those exact tarballs and the CARLA wheel, records
   their SHA-256 hashes and UniScenarios revision in its vendor locks, and
   verifies npm lock integrity plus the Python wheel digest before build or
   deployment.

## Release procedure

Run the local gates before creating the tag:

```bash
pnpm install --frozen-lockfile
# Builds packages in dependency order before checking every workspace.
pnpm typecheck
pnpm test:release
pnpm release:manifest
pnpm release:verify-artifacts
pnpm release:smoke-packages
python3 -m pytest adapters/carla-bridge/tests -q
python3 -m build adapters/carla-bridge
```

Commit the release tree, then create and push the exact version tag. The
`publish.yml` workflow is the only supported npm or PyPI publication path. The
`npm` and `pypi` GitHub environments must both use trusted publishing. If any
package already exists at that version, increment the entire stack before
retrying; do not delete or replace registry artifacts.

## Rollback

Rollback SimCloud by restoring a previously committed stack lock and its
content-addressed tarballs and CARLA wheel. A rollback never republishes an old
version and never changes an existing artifact. The lock revision, artifact
digest, registry integrity, and installed package version must all agree.
