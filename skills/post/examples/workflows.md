# Example workflows

Assume `post-cli` is on PATH or use `npx @barrysongdev4real/post-cli`. Prefer `--json`.

## 1. Bootstrap `.post/` in the vault

```bash
# From a checkout of this skill, or after npx skills add:
cp -R skills/post/assets/dot-post-template/. <vault>/.post/
# or: copy assets/dot-post-template contents into <vault>/.post/
```

Never put non-asset keep files outside `.post/`.

## 2. Discover → tag inbox → commit

```bash
post-cli ledger-info --json
post-cli asset list --json
post-cli tag list --json
post-cli asset tag add <assetId> --tag <tagId>          # dry-run
post-cli asset tag add <assetId> --tag <tagId> --commit
```

## 3. Patch file under `.post/patches/`

```bash
# Write patch JSON to <vault>/.post/patches/organize.json
post-cli apply-patch <vault>/.post/patches/organize.json --dry-run
post-cli apply-patch <vault>/.post/patches/organize.json --commit
```

## 4. Live UI (Desktop must be running)

```bash
post-cli filter inbox
post-cli filter tag <tagNameOrId>
post-cli filter get --json
post-cli asset open <assetId>
post-cli filter clear
```

Exit `3` means the app is not reachable on the local IPC socket.

## 5. Create a saved view

```bash
post-cli view create --name "Inbox images" --tag <tagId> --sort updated_desc
post-cli view create --name "Inbox images" --tag <tagId> --sort updated_desc --commit
post-cli filter view "Inbox images"
```

## Anti-patterns

- Writing agent notes or scratch as normal files under the vault root (they become assets).
- Using `--commit` before a successful dry-run on unfamiliar patches.
- Calling live `filter` / `asset open` when Desktop is closed.
- Trying to drive the Chrome extension from CLI.
