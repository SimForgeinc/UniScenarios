# UniScenarios repository extraction

The current Scenario Studio working tree contains active, uncommitted work from
multiple agents. It must not be moved, reset, or used as the final repository
boundary until that work is preserved.

Use the one-way extractor to create the standalone UniScenarios repository:

```sh
node scripts/extract-uniscenarios.mjs \
  --destination /Users/maikyon/Documents/Programming/UniScenarios \
  --link-dev-assets \
  --commit
```

The destination must not already exist. The extractor:

1. clones the source Git history without filesystem hard links;
2. overlays every tracked file, tracked edit, and non-ignored untracked file;
3. records source provenance and SHA-256 hashes in `MIGRATION-SOURCE.json`;
4. changes the product and package namespace to UniScenarios / `@uniscenarios`;
5. exposes `uniscenarios` as the primary CLI while preserving `scen` as an alias;
6. removes the clone's local-source remote, leaving remote publication explicit;
7. optionally links ignored local `dev-assets/` so the new checkout can run on
   the same workstation without copying proprietary or multi-gigabyte map data.

The source repository is never modified beyond adding this extraction tooling.
The extractor refuses to overwrite an existing destination.
