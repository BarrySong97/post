# Bundled FFmpeg

Place the platform FFmpeg executable here before packaging:

- macOS/Linux: `ffmpeg`
- Windows: `ffmpeg.exe`

The root `pnpm package` and `pnpm dist` scripts run `pnpm ffmpeg:prepare` first.
That script can also copy a binary from an explicit path:

```bash
POST_FFMPEG_PATH=/absolute/path/to/ffmpeg pnpm package
```

Release builds should use a vetted FFmpeg build with licensing reviewed for the
app distribution model. Prefer an LGPL/minimal build unless the project
intentionally accepts GPL FFmpeg distribution requirements.
