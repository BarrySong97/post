# Assets and Desktop UI

## Board

Desktop browses vault assets in a dense masonry board with filters, tags, and saved views.

## Soft detail

Opening an asset stays on home with search `asset=<id>` so the board stays mounted. Back closes the overlay. Deep links to `/assets/:id` soft-redirect into the same overlay.

CLI: `asset open <id>` triggers that soft path when Desktop is running.

## Filters and views

- **Tags / status / kind / time / source / sort** shape the list.
- **Saved views** persist filter+sort JSON.
- Live CLI: `filter apply|view|tag|all|inbox|clear|get` drives the running app without writing SQLite.

## What agents can vs cannot do

| Can | Cannot (via this skill/CLI) |
| --- | --- |
| Tag, untag, create views | Rewrite vault media files |
| List/get assets | Call extension APIs |
| Live filter / open detail | Assume Desktop is running for live cmds |
| Organize existing library | Treat `.post/` files as assets |

Collection of new web images/posts is the extension + Desktop import path.
