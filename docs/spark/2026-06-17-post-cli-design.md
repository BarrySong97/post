# Post CLI Design

## Summary

Post will add a first-party command line interface for users and AI agents to organize the local Post workspace without directly editing SQLite. The CLI is not a reduced capability surface. It is the complete command surface for asset organization data: tags, asset-tag bindings, saved views, galleries, gallery membership, and supporting asset queries.

The CLI exists to prevent accidental database damage while still exposing the full organization workflow. All write operations go through the same business rules used by the desktop app, so users and AI agents can automate organization work without bypassing constraints such as gallery membership, tag uniqueness, saved-view validation, and file-safety boundaries.

## Goals

- Add `packages/cli` as the Post CLI workspace package.
- Use Commander.js for command registration, arguments, help text, and top-level error handling.
- Add a root development command such as `pnpm post-cli ...`.
- Run the CLI through the Electron Node runtime during development so `better-sqlite3` uses the correct native ABI.
- Provide complete create, read, update, delete, reorder, bind, and unbind operations for tags, saved views, galleries, and asset-tag relations.
- Provide asset query commands that help users and AI agents find targets for organization operations.
- Provide `apply-patch` as a batch operation entry point with `--dry-run` and `--commit`.
- Reuse desktop business logic through a shared Electron-free domain package rather than duplicating rules in the CLI.
- Keep future installation open by structuring `packages/cli` so it can later add `bin`, build output, and install docs.

## Non-Goals

- Do not expose arbitrary writable SQL as a public interface.
- Do not delete, move, rename, or rewrite original vault files from the first CLI version.
- Do not require the Electron desktop window to be running.
- Do not expose renderer or preload APIs to the CLI.
- Do not make `packages/cli` import Electron main-process modules directly.
- Do not make the CLI the owner of database schema migrations; schema and migrations remain in `packages/db`.

## Product Positioning

The CLI is Post's safe automation interface. It should let a user or AI agent do the same organization work that the desktop UI can do:

- Create, update, delete, list, and reorder tags.
- Bind and unbind tags to assets, including batch operations.
- Create, update, delete, list, and reorder saved views.
- Create, update, delete, list, and inspect galleries.
- Add, remove, reorder, and caption gallery members.
- Set gallery covers.
- Query assets by id, kind, status, tag, source, and search text.

The safety boundary is not a capability reduction. The boundary is that the CLI exposes domain operations, not raw database writes. Domain operations can be broad and complete while still validating input, preserving invariants, and returning useful errors.

## Architecture

Use the selected shared-business-logic approach:

```text
packages/
  db/
    src/
      index.ts
      schema.ts
  domain/
    src/
      context.ts
      errors.ts
      assets/
      tags/
      saved-views/
      galleries/
  cli/
    src/
      main.ts
      runtime/
      commands/
      output/

apps/
  desktop/
    src/main/
      db.ts
      trpc/routers/
```

### `packages/domain`

`packages/domain` owns reusable business workflows and repositories that must be shared by desktop main and the CLI. It must not import Electron, tRPC, renderer code, preload code, or `apps/desktop/src/main/db.ts`.

Domain functions receive an explicit context:

```ts
type DomainContext = {
  db: Database;
  activeVaultId?: string;
  now: () => Date;
  id: () => string;
};
```

The existing desktop use cases for tags, saved views, and galleries should move toward this shape:

```ts
createTag(ctx, input)
updateTag(ctx, input)
deleteTag(ctx, input)
addTagToAsset(ctx, input)
removeTagFromAsset(ctx, input)
createSavedView(ctx, input)
updateSavedView(ctx, input)
deleteSavedView(ctx, input)
createGallery(ctx, input)
addGalleryItems(ctx, input)
removeGalleryItems(ctx, input)
reorderGalleryItems(ctx, input)
setGalleryCover(ctx, input)
```

Domain errors should be Post-specific error classes or structured error objects. Desktop routers translate them to `TRPCError`; CLI commands translate them to process exit codes and JSON/text output.

### `packages/cli`

`packages/cli` owns command parsing and presentation only. It should not contain gallery, tag, or saved-view rules inline. A command should parse input, build a domain context, call the domain service, and render the result.

Commander.js handles:

- command hierarchy
- arguments and options
- help output
- unknown command handling
- top-level async error handling

### Desktop Main

Desktop main remains responsible for Electron-specific concerns:

- resolving the app `userData` database path
- resolving migrations in dev and packaged modes
- opening the database before routers run
- translating domain errors to tRPC responses
- integrating background tasks, watcher state, and renderer invalidation

Desktop routers should call `packages/domain` for the organization workflows that the CLI also exposes.

## Runtime And Database Path

Development commands:

```bash
pnpm post-cli ledger-info
pnpm post-cli apply-patch patch.json --dry-run
pnpm post-cli apply-patch patch.json --commit
```

The root `post-cli` script should launch the CLI with Electron's Node runtime during development. This keeps `better-sqlite3` aligned with Electron's ABI, matching the desktop app's native dependency requirements.

The CLI needs a deterministic database resolution strategy:

1. `--db <path>` explicitly chooses a SQLite file. This is useful for tests, temporary fixtures, and AI sandbox workflows.
2. Without `--db`, development mode resolves the same Post userData database used by the desktop app for the current app environment.
3. The CLI runs migrations before use when opening an application database, using the committed Drizzle migrations from `packages/db/drizzle`.

The CLI should report the resolved database path in `ledger-info --json` so users and AI agents can verify which workspace they are operating on.

## Command Shape

### Workspace And Asset Queries

```bash
pnpm post-cli ledger-info --json
pnpm post-cli vault list --json
pnpm post-cli vault current --json
pnpm post-cli asset list --kind image --tag <tag-id> --status inbox --json
pnpm post-cli asset get <asset-id> --json
```

`ledger-info` returns a compact machine-readable snapshot: CLI version, schema/migration state, database path, active vault, counts, supported operations, and patch schema version.

### Tags

```bash
pnpm post-cli tag list --json
pnpm post-cli tag get <tag-id> --json
pnpm post-cli tag create "可发布" --color "#22c55e" --commit
pnpm post-cli tag update <tag-id> --name "小红书" --color "#ef4444" --commit
pnpm post-cli tag delete <tag-id> --commit
pnpm post-cli tag reorder <tag-id> <tag-id> ... --commit
```

Tag deletion uses the same cleanup rules as the desktop app, including saved-view cleanup for views that reference the deleted tag.

### Asset-Tag Relations

```bash
pnpm post-cli asset tags <asset-id> --json
pnpm post-cli asset tag add <asset-id> <tag-name-or-id> --commit
pnpm post-cli asset tag remove <asset-id> <tag-id> --commit
pnpm post-cli asset tag add-many --asset <asset-id> --tag <tag-id> --tag <tag-id> --commit
pnpm post-cli asset tag remove-many --asset <asset-id> --tag <tag-id> --tag <tag-id> --commit
```

The first version may accept tag names for add operations so AI agents can create-or-bind in one step. Remove operations should prefer ids to avoid ambiguous deletion.

### Saved Views

```bash
pnpm post-cli view list --json
pnpm post-cli view get <view-id> --json
pnpm post-cli view create "待发布图片" --kind image --tag <tag-id> --status draft --commit
pnpm post-cli view update <view-id> --name "本周待发" --kind image --tag <tag-id> --commit
pnpm post-cli view delete <view-id> --commit
pnpm post-cli view reorder <view-id> <view-id> ... --commit
```

Saved-view filters use the same schema and serialization as the desktop app.

### Galleries

```bash
pnpm post-cli gallery list --json
pnpm post-cli gallery get <gallery-id> --json
pnpm post-cli gallery create "产品图第一组" --asset <id1> --asset <id2> --commit
pnpm post-cli gallery update <gallery-id> --title "新标题" --description "说明" --commit
pnpm post-cli gallery delete <gallery-id> --commit
pnpm post-cli gallery add <gallery-id> --asset <asset-id> --commit
pnpm post-cli gallery remove <gallery-id> --asset <asset-id> --commit
pnpm post-cli gallery reorder <gallery-id> <asset-id> <asset-id> ... --commit
pnpm post-cli gallery set-cover <gallery-id> <asset-id> --commit
pnpm post-cli gallery caption <gallery-id> <asset-id> --caption "封面图" --commit
```

Gallery operations must preserve existing rules:

- Gallery members must be image assets.
- One image can belong to at most one gallery in a vault.
- A gallery cover must be a member.
- Deleting a gallery removes relationship rows only and never deletes member assets or files.
- Missing files remain in gallery membership until the asset is permanently deleted.

## Batch Patch Interface

`apply-patch` is the primary AI batch-entry command. It accepts a JSON file containing ordered domain operations.

```bash
pnpm post-cli apply-patch patch.json --dry-run
pnpm post-cli apply-patch patch.json --commit
```

Patch files should include a version and ordered operations:

```json
{
  "version": 1,
  "operations": [
    { "op": "tag.create", "name": "可发布", "color": "#22c55e" },
    { "op": "tag.update", "tagId": "tag_1", "name": "小红书" },
    { "op": "tag.delete", "tagId": "tag_2" },
    { "op": "tag.reorder", "orderedTagIds": ["tag_1", "tag_3"] },
    { "op": "asset.tag.add", "assetId": "asset_1", "tagName": "可发布" },
    { "op": "asset.tag.remove", "assetId": "asset_1", "tagId": "tag_1" },
    { "op": "view.create", "name": "待发布图片", "filters": { "types": ["image"] } },
    { "op": "view.update", "viewId": "view_1", "name": "本周待发", "filters": {} },
    { "op": "view.delete", "viewId": "view_2" },
    { "op": "view.reorder", "orderedViewIds": ["view_1", "view_3"] },
    { "op": "gallery.create", "title": "产品图", "assetIds": ["asset_1", "asset_2"] },
    { "op": "gallery.update", "galleryId": "gallery_1", "title": "新标题" },
    { "op": "gallery.delete", "galleryId": "gallery_2" },
    { "op": "gallery.add", "galleryId": "gallery_1", "assetIds": ["asset_3"] },
    { "op": "gallery.remove", "galleryId": "gallery_1", "assetIds": ["asset_2"] },
    { "op": "gallery.reorder", "galleryId": "gallery_1", "orderedAssetIds": ["asset_3", "asset_1"] },
    { "op": "gallery.setCover", "galleryId": "gallery_1", "assetId": "asset_3" },
    { "op": "gallery.caption", "galleryId": "gallery_1", "assetId": "asset_3", "caption": "封面图" }
  ]
}
```

Dry-run output reports what would happen without writing the database. Commit output reports what did happen. For batch operations, the first implementation should prefer transactional execution when all operations target the same database and no external side effects exist.

## Safety Model

The safety model is designed to prevent mistakes, not restrict legitimate organization work.

- Write commands require `--commit`.
- `--dry-run` is always available and is the default for `apply-patch`.
- Commands that would delete tags, views, or galleries report affected relationship counts before committing.
- Commands never delete original vault files.
- Commands never accept arbitrary writable SQL.
- Domain rules validate all writes before persistence.
- JSON output includes stable error codes and operation indexes so AI agents can repair failed patches.
- The CLI should fail closed when the database path, active vault, or migration state is ambiguous.

## Output And Errors

Default output is concise text for humans. `--json` returns stable machine-readable output.

Successful JSON responses use this shape:

```json
{
  "ok": true,
  "data": {},
  "warnings": []
}
```

Errors use this shape:

```json
{
  "ok": false,
  "error": {
    "code": "GALLERY_MEMBER_NOT_IMAGE",
    "message": "Gallery members must be images",
    "operationIndex": 4,
    "details": {}
  }
}
```

Recommended exit codes:

- `0` success
- `1` validation or domain error
- `2` command usage error
- `3` database path or migration error
- `4` unexpected runtime error

## Testing

Add focused tests around the shared domain layer and CLI command behavior:

- Domain tests for tag create/update/delete/reorder.
- Domain tests for asset-tag add/remove and duplicate handling.
- Domain tests for saved-view validation and tag reference cleanup.
- Domain tests for gallery create/update/delete/add/remove/reorder/set-cover/caption.
- CLI tests for argument parsing and JSON output using temporary SQLite databases.
- Patch tests for dry-run no-op behavior, commit behavior, transaction rollback, and operation-indexed errors.

Verification commands should include:

```bash
pnpm test
pnpm check-types
node scripts/check-docs.mjs
```

If CLI packaging or runtime scripts change native dependency behavior, also verify the development command through the Electron Node runtime.

## Implementation Phases

1. Add `packages/domain` with context, errors, and migrated tag/saved-view/gallery business logic.
2. Update desktop routers to call the domain services while preserving current tRPC procedure names and renderer behavior.
3. Add `packages/cli` with Commander.js, runtime bootstrap, output helpers, and `ledger-info`.
4. Add read commands for vaults, assets, tags, views, and galleries.
5. Add write commands for tags, asset-tag relations, views, and galleries.
6. Add `apply-patch` with full operation coverage, dry-run, commit, JSON output, and transaction handling.
7. Add root `pnpm post-cli` script and workspace package wiring.
8. Update `docs/run.md`, `docs/testing.md`, `docs/modules/desktop/README.md`, and add a CLI module doc if the package becomes part of the harness scope.
9. Run focused verification and manually confirm that CLI writes are visible in the desktop UI and desktop UI writes are visible through the CLI.

## Open Decisions

- Final installed binary name can be `post` or `post-cli`. Development should use `post-cli` to avoid ambiguity while the desktop app and future packaged CLI are still separate.
- The exact location of shared Zod contracts can be decided during implementation: either move the relevant contracts into `packages/domain` or add a dedicated `packages/contracts`.
- The final packaged runtime can be decided later. The first version should keep the package structured for future `bin` support without requiring install docs immediately.
