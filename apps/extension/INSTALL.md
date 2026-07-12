# Install the Post Chrome extension

This zip is the **prod** Post browser extension (`appEnv: prod`). It talks to the Post desktop app over Chrome Native Messaging (`com.post.desktop`).

## Requirements

1. Install **Post Desktop** (prod) from the same GitHub Release as this zip (or a matching later release).
2. Keep the desktop app installed so the native messaging bridge can reach it.

## Load in Chrome

1. Unzip this archive to a folder you will keep (moving it later changes the unpacked extension ID).
2. Open `chrome://extensions`.
3. Turn on **Developer mode**.
4. Click **Load unpacked** and select the unzipped folder (it must contain `manifest.json` at the root).

Or install from the Chrome Web Store / Edge Add-ons when a listing is published — use the same prod package.

## Register the native host (Load unpacked)

Unpacked extensions get a **path-derived ID**. Chrome shows it on the extension card (32 lowercase letters `a`–`p`).

From a Post source checkout (with Node and the repo dependencies available):

```bash
pnpm -F extension native-host:install -- --extension-id <your-32-char-id>
```

Pass multiple IDs comma-separated if you also keep a “Post Dev” build loaded.

After registering, restart Chrome (or reload the extension) and ensure Post Desktop is running before using “Add … to Post”.

## Verify

1. Start Post Desktop and open or link a vault.
2. Right-click an image (or an X post / video) → **Add … to Post**.
3. The asset should appear in Post (Inbox if you chose direct save, or under the tag you picked).

## Support

- Releases: https://github.com/BarrySong97/post/releases
- Extension docs in the repo: `docs/modules/extension/README.md`
