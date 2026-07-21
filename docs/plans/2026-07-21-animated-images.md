# Animated Images

## Goal

Keep animated GIF, WebP, and AVIF assets on a static first frame until hovered on the asset board
or in detail. Continue to display HEIC as a normal still image through a browser-compatible proxy.

## Implementation

- Extend image cache metadata with an animation flag, media-analysis version, and optional HEIC
  preview path.
- Generate static first-frame thumbnails for animated GIF/WebP sources and a macOS JPEG proxy for
  HEIC.
- Mount the original animated image only while its card or detail preview is hovered. Respect the
  reduced-motion preference.
- Show the animated image format in the top-right badge, in the same visual position as a video's
  duration.

## Verification

- Unit-test animation classification and renderer mapping.
- Run desktop tests and type checks, Rust check/tests, and the docs harness.
