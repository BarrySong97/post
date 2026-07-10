# Post CLI npm Publish Plan

## Summary

Post should ship a user-installable npm CLI for local and agent workflows. The
current workspace CLI works through `pnpm post-cli`, but it is not publishable:
`packages/cli/package.json` is private, depends on `workspace:*` packages, and
runtime migration resolution assumes the monorepo path
`packages/db/drizzle`.

Use the proven `flowm-desktop` pattern as the reference: keep the workspace
developer command optimized for the Electron app, but generate a separate npm
publish directory that bundles local workspace code and contains only real npm
runtime dependencies.

## Goals

- Let users run the CLI with `npx <package> ...` and install it globally with
  `npm install -g <package>`.
- Preserve the existing workspace command: `pnpm post-cli ...`.
- Avoid publishing `@post/db` and `@post/domain` as independent public packages
  for the first release.
- Keep all CLI writes guarded by domain services and existing `--commit`
  behavior.
- Make npm packaging testable without publishing.

## Proposed Package Shape

Recommended npm package name: `@barrysongdev4real/post-cli`, unless a dedicated
Post npm org is created before launch.

Keep `packages/cli/package.json` as the workspace package, but add:

- `description`, `license`, and real runtime versions for publish metadata.
- `build`: generate `packages/cli/npm`.
- `pack:dry`: run `pnpm build` then `npm pack --dry-run ./npm`.
- `publish:npm`: build, verify, then publish `./npm`.

The generated `packages/cli/npm/package.json` should contain:

- `name`, `version`, `description`, `license`.
- `type: "module"`.
- `main` and `exports` pointing to `./dist/index.mjs`.
- `bin` exposing `post-cli`.
- `files: ["dist", "README.md"]`.
- `publishConfig.access: "public"` for a scoped public package.
- runtime dependencies only: `better-sqlite3`, `commander`, `drizzle-orm`, and
  any other externalized packages that are not bundled.

Do not publish a package that contains `workspace:*`, TypeScript source
entrypoints, or monorepo-relative runtime paths.

## Implementation Steps

1. Add an npm build script for `packages/cli`.
   - Use `esbuild` to bundle `packages/cli/src/main.ts` into
     `packages/cli/dist/index.mjs`.
   - Set `platform=node`, `format=esm`, and a Node target aligned with current
     support, likely Node 20+.
   - Add a shebang banner and mark the output executable.
   - Bundle `@post/domain` and `@post/db` into the output so npm users do not
     need private workspace packages.
   - Keep native/runtime packages external: `better-sqlite3`, `commander`,
     `drizzle-orm`, and `drizzle-orm/*`.

2. Copy database migrations into the npm artifact.
   - Copy `packages/db/drizzle` to `dist/drizzle` or `dist/migrations`.
   - Update CLI migration resolution so bundled npm execution uses the copied
     folder.
   - Keep workspace execution able to resolve the existing monorepo folder.
   - Add a focused smoke test that fails if the migrations folder is missing.

3. Keep two launch paths.
   - Workspace path: continue to run under Electron Node mode for the desktop
     app's `better-sqlite3` ABI.
   - npm path: run under the user's normal Node runtime and install its own
     `better-sqlite3` native module for that ABI.
   - Document that npm users may need a working native module install toolchain
     on platforms without prebuilds.

4. Add npm-facing README content.
   - Include `npx @barrysongdev4real/post-cli ledger-info --json`.
   - Include `npm install -g @barrysongdev4real/post-cli`.
   - Explain `--db`, `--env`, `POST_USER_DATA_DIR`, and default Post app data
     resolution.
   - Make clear that write commands dry-run by default and require `--commit`.
   - Note that live commands such as `filter.*` and `asset.open` require the
     desktop app to be running.

5. Add release automation.
   - Extend `scripts/release.mjs` or add `scripts/release-cli.mjs` with:
     `npm view <package>@<version> version`, `pnpm -F @post/cli build`,
     `npm publish packages/cli/npm --access public`, then post-publish
     validation.
   - Add `--no-npm` and `--dry-run` flags if integrated into the desktop release
     script.
   - Bump `packages/cli/package.json` with the desktop release version, unless
     a separate CLI version cadence is intentionally chosen.

6. Handle npm credentials without committing secrets.
   - Reuse the existing npm account/token used by `flowm-desktop`, but store it
     only as a local user credential or CI secret.
   - Accept these credential sources:
     `NODE_AUTH_TOKEN`, user-level `~/.npmrc`, or CI secret-backed `.npmrc`
     generated at publish time.
   - Do not copy a token into this repository, `packages/cli/npm`, release
     notes, docs, or git-tracked config.
   - If a token must be moved from the Flowm setup, copy it only into the same
     non-repo credential target used by npm publish.

## Verification Matrix

Before publishing:

- `pnpm -F @post/domain check-types`
- `pnpm -F @post/db check-types`
- `pnpm -F @post/cli check-types`
- `pnpm -F @post/cli build`
- `npm pack --dry-run packages/cli/npm`
- Install the generated tarball into an isolated prefix:
  `npm install --prefix /private/tmp/post-cli-npm-prefix <tarball>`
- Run the installed binary:
  `/private/tmp/post-cli-npm-prefix/bin/post-cli --db /private/tmp/post-cli-npm-smoke.sqlite --json ledger-info`
- Run a write dry-run command and a committed command against a temporary
  SQLite database.
- Confirm `filter.get` exits with the documented app-unreachable code when the
  desktop app is not running.
- `node scripts/check-docs.mjs`

After publishing:

- `npm view @barrysongdev4real/post-cli@<version> version`
- `npx @barrysongdev4real/post-cli@<version> --db /private/tmp/post-cli-npx-smoke.sqlite --json ledger-info`
- `npm install -g @barrysongdev4real/post-cli@<version>` then
  `post-cli --db /private/tmp/post-cli-global-smoke.sqlite --json ledger-info`

## Risks And Decisions

- Package name: `@post/cli` is only viable if the npm scope exists and is owned
  by the release account. Otherwise use `@barrysongdev4real/post-cli`.
- Native dependency installs: npm users run a Node ABI build of
  `better-sqlite3`, not the Electron ABI build. This is expected for the npm
  package and must be tested separately from `pnpm post-cli`.
- Migration path drift: publishing must fail if the generated npm artifact does
  not contain Drizzle migrations.
- Public API stability: once published, command names and JSON shapes need
  compatibility discipline. Keep `ledger-info --json` as the baseline smoke
  contract.
- Token handling: npm tokens are secrets. Reusing the Flowm credential is fine,
  but only through secret storage or local npm auth, never by committing or
  documenting the token value.

## Definition Of Done

- `packages/cli/npm` is generated and ignored or treated as build output.
- The npm tarball installs in a clean temporary directory with no `workspace:*`
  dependency errors.
- Installed `post-cli` opens a fresh SQLite DB, runs migrations from packaged
  files, and returns valid JSON for `ledger-info`.
- Release automation can publish or dry-run npm publish without touching
  desktop release behavior unexpectedly.
- CLI module docs, runbook, and testing docs describe npm installation and the
  separate workspace/npm runtime paths.
