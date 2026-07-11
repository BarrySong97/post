# Publishing the Post extension

The extension ships as two channels (see `docs/modules/extension/README.md`): `pnpm -F extension build`
(dev, "Post Dev") and the release build below. Chrome Web Store and Microsoft Edge Add-ons both
accept the same package.

## Build the upload package

```bash
pnpm -F extension package:prod
# -> apps/extension/post-extension.zip  (upload this)
```

The zip has `manifest.json` at its root, the `icons/`, and the bundled scripts.

## Store listing checklist

- [ ] Icons: 16 / 48 / 128 are in the manifest and package (already wired to the Post brand icons).
- [ ] Screenshots: 1–5, 1280×800 or 640×400 (e.g. the right-click menu on an X post).
- [ ] Short + detailed description (see single purpose below).
- [ ] Privacy policy URL (required — the extension reads page content).
- [ ] Category + language.
- [ ] Visibility: **Unlisted** is the natural fit — this is a companion to the Post desktop app,
      distributed via a link rather than public search.

## Single purpose

Collect the image, video, or post the user right-clicks — on X (x.com / twitter.com) or any image
on the web — and hand it to the user's locally-installed Post desktop app for organizing.

## Permission justifications (for the review form)

| Permission | Why it is needed |
| --- | --- |
| `contextMenus` | Adds the right-click "Add … to Post" menu that starts a collection. |
| `nativeMessaging` | Delivers the collected asset to the user's own locally-installed Post desktop app. This is the only data destination — nothing is sent to a developer-operated server. |
| `storage` | Remembers the user's recently-used tags locally to order the menu; no personal data leaves the device. |
| `webRequest` | Read-only observation of `video.twimg.com` media requests to discover the playable MP4 URL for the tweet the user chose to save. It never blocks or modifies requests. |
| `host_permissions: x.com, twitter.com` | Reads the post the user right-clicks (author, text, media links) so it can be saved. |
| `host_permissions: video.twimg.com` | Resolves the video media URL when saving an X video. |

## Data handling (privacy form)

The extension sends collected content **only to the user's own locally-running Post desktop app**
over Chrome Native Messaging. It does not transmit data to any remote server operated by the
developer, and it stores only a short recently-used-tag list in local extension storage.

## Native host note for reviewers / users

The extension requires the separately-installed Post desktop app (its native messaging host,
`com.post.desktop`). The desktop app registers the host with the extension's fixed store ID baked
into `allowed_origins`; end users do not enter any ID. Disclose the required companion app in the
listing.
