# Immutable package publication

UniScenarios is the source repository for every shared scenario, simulation,
map, OpenSCENARIO, renderer, catalog, and editor-core package consumed by
SimCloud. SimCloud must never publish or edit a second implementation.

## Release contract

1. Every public package has the exact version in
   `config/uniscenarios-stack.json`; internal dependencies are pinned to that
   stack version in packed artifacts.
2. A release tag is exactly `v<stackVersion>` and identifies one immutable Git
   tree. Published npm versions are never overwritten or reused.
3. GitHub Actions builds and verifies the complete package set, creates the
   deterministic stack manifest, smoke-installs the packed tarballs, and uses
   npm trusted publishing/provenance (`id-token: write`).
4. The npm environment provides `NPM_TOKEN` only until trusted publishing is
   configured for every package. Secrets never enter repository files or build
   artifacts.
5. SimCloud synchronizes those exact tarballs, records their SHA-256 hashes and
   UniScenarios revision in `vendor/uniscenarios/stack-lock.json`, and verifies
   package-lock integrity before build or deployment.

## Release procedure

Run the local gates before creating the tag:

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test:release
pnpm -r --filter "./packages/**" build
pnpm release:manifest
pnpm release:verify-artifacts
pnpm release:smoke-packages
```

Commit the release tree, then create and push the exact version tag. The
`publish.yml` workflow is the only supported npm publication path. If any
package already exists at that version, increment the entire stack before
retrying; do not delete or replace registry artifacts.

## Rollback

Rollback SimCloud by restoring a previously committed stack lock and its
content-addressed tarballs. A rollback never republishes an old version and
never changes an existing tarball. The lock revision, tarball digest, npm
integrity, and installed package version must all agree.
