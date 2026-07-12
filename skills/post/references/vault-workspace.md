# Vault workspace and `.post/`

## Vault = Agent project root

The folder the user linked in Post **is** the Agent’s working directory. There is no requirement that content live only under a subfolder named `assets/`. The indexer walks the vault tree; **non-dot paths become assets**.

## Indexer skip (already implemented)

Any path segment whose name starts with `.` is skipped (whole subtree), plus `node_modules`. So `.post`, `.agents`, `.claude`, `.cursor`, `.cloud`, `.git`, `.obsidian` never enter the asset ledger.

## Rule (locked)

| Content | Where |
| --- | --- |
| Asset / library content (notes, images, videos, …) | Normal (non-dot) paths in the vault |
| **Anything else that must be kept** | **`<vault>/.post/` only** |

That includes scripts, `apply-patch` JSON, chat leftovers, agent notes, and mid-process retainables.

## Recommended layout

```text
<vault>/
  …user library files…          # indexed
  .post/                        # NOT indexed
    README.md
    scripts/
    patches/
    scratch/
  .agents/skills/post/          # optional skill install — NOT indexed
  .claude/skills/post/          # optional — NOT indexed
```

Skill installs under `.agents` / `.claude` / `.cursor` are tooling homes only — **not** a second scratch tree. Non-asset keeps stay in `.post/`.

## Bootstrap

If `.post/` is missing, copy the skill template:

- From this skill: `assets/dot-post-template/` → `<vault>/.post/`

Then write scripts to `.post/scripts/`, patches to `.post/patches/`, everything else non-asset to `.post/scratch/`.
