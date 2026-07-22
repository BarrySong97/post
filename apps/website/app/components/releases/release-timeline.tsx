/**
 * @purpose Render Post public release notes and expose release data to release automation.
 * @role    Website changelog source validated before cutting GitHub release tags.
 * @deps    React server components only.
 * @gotcha  Before running `pnpm release <version>`, add the new entry first and move `badge: "latest"`.
 *          Layout is a two-column ledger, not cards: hairline rules and whitespace carry the rhythm, so
 *          resist re-adding borders/shadows/surface fills around each entry. The left rail is sticky at
 *          top-20 to clear the layout's fixed h-14 SiteHeader while a long entry scrolls past.
 */

export type ReleaseGroup = {
  title: string;
  items: string[];
};

export type ReleaseNote = {
  version: string;
  date: string;
  head: string;
  badge?: "latest";
  groups: ReleaseGroup[];
};

export const RELEASES: ReleaseNote[] = [
  {
    version: "0.1.15",
    date: "2026-07-22",
    head: "Hover-only asset metadata and tidier background task status.",
    badge: "latest",
    groups: [
      {
        title: "Desktop",
        items: [
          "Asset metadata now stays out of the detail canvas until the pointer reaches the right edge, then slides in as a temporary card and dismisses when the pointer moves away. A one-time localized hint introduces the interaction.",
          "Long running-task names in the footer now stay within a stable 220px slot, truncate with an ellipsis, and expose the full text on hover.",
        ],
      },
    ],
  },
  {
    version: "0.1.14",
    date: "2026-07-21",
    head: "Animated image previews and more reliable, higher-quality X capture.",
    groups: [
      {
        title: "Desktop",
        items: [
          "Animated GIF, WebP, and AVIF assets now use a still first frame until hovered on the asset board or in detail, with format badges and reduced-motion support.",
          "HEIC images now receive a browser-compatible preview while keeping the original vault file unchanged.",
        ],
      },
      {
        title: "Extension",
        items: [
          "X Post and right-click image capture now save original-resolution media instead of displayed thumbnail variants, and capture-time tags are applied to the Post and its imported media.",
          "When Post is closed, user-triggered Chrome save actions can open Desktop through a confirmed post:// prompt and continue the original save after the app becomes available.",
        ],
      },
    ],
  },
  {
    version: "0.1.13",
    date: "2026-07-16",
    head: "More reliable multi-image capture and sharper asset previews.",
    groups: [
      {
        title: "Desktop",
        items: [
          "Saving several images rapidly from the extension now gives every file a unique reserved path, preventing later imports from replacing or reopening an older asset.",
          "Small images now render from their original source without upscaling or recompression, AVIF and SVG covers display directly, and large PNG previews remain lossless for sharper text and transparency.",
        ],
      },
    ],
  },
  {
    version: "0.1.12",
    date: "2026-07-15",
    head: "A new MDX blog, higher-fidelity X Post capture, and newest-added-first asset browsing.",
    groups: [
      {
        title: "Website",
        items: [
          "Added a statically generated MDX blog with article pages, table of contents, sitemap entries, and an image optimization pipeline for R2-hosted media.",
        ],
      },
      {
        title: "Desktop",
        items: [
          "The asset board, saved views, and live CLI filters now default to newest added first, with separate added, modified, and source-created date sorts.",
          "X Post cards now show the captured author profile photo and retain the existing author-initial fallback when an image is missing or unavailable.",
        ],
      },
      {
        title: "Extension",
        items: [
          "X Post capture expands visible Show more text and resolves complete long-form Note content from provider metadata or server-rendered records, while preserving a partial warning when no complete source is available.",
        ],
      },
    ],
  },
  {
    version: "0.1.11",
    date: "2026-07-13",
    head: "Chrome extension download button on the website, and Desktop now wires itself up to talk to it automatically.",
    groups: [
      {
        title: "Website",
        items: [
          "Added a Get the Chrome Extension button next to Download Post in the hero and footer, linking to the Chrome Web Store listing.",
        ],
      },
      {
        title: "Desktop",
        items: [
          "Packaged installs now register the extension's native messaging bridge automatically on launch, so Desktop and the published Chrome extension can talk to each other without any manual setup.",
        ],
      },
    ],
  },
  {
    version: "0.1.10",
    date: "2026-07-13",
    head: "Video card duration badges count down while hover preview plays.",
    groups: [
      {
        title: "Desktop",
        items: [
          "Hovering a video card now ticks the top-right duration badge down with remaining time, then restores the full duration when the pointer leaves.",
        ],
      },
    ],
  },
  {
    version: "0.1.9",
    date: "2026-07-13",
    head: "Video duration badges backfill for assets that already had thumbnails.",
    groups: [
      {
        title: "Desktop",
        items: [
          "Ready thumbnail cache hits now probe and store missing video durations without regenerating frames, so older videos get the duration badge after prewarm.",
          "Failed duration probes record a sentinel so the indexer does not retry forever.",
        ],
      },
    ],
  },
  {
    version: "0.1.8",
    date: "2026-07-13",
    head: "Clearer drag-and-drop import feedback, plus a richer background-task footer.",
    groups: [
      {
        title: "Desktop",
        items: [
          "Dropping files onto the window shows hover, blocked, in-progress, and done/failed states, with a bottom-right import progress pill.",
          "Background tasks show file or subject names, fold queued work into In progress, and summarize recent non-import completions in a 30-minute digest.",
          "Failed thumbnail tasks can be retried from the footer; short thumbnail bursts from the watcher and extension imports coalesce into one queue.",
        ],
      },
    ],
  },
  {
    version: "0.1.7",
    date: "2026-07-12",
    head: "Asset detail shows every bound tag and lets you bind, unbind, or create tags inline.",
    groups: [
      {
        title: "Desktop",
        items: [
          "Asset detail lists all tags on an asset, not only the primary one used on masonry cards.",
          "Use + to open an inline searchable ComboBox: pick an existing vault tag, or type a name and press Enter to create and bind.",
          "Remove a tag from the asset with the pill control; the vault tag definition stays intact.",
        ],
      },
    ],
  },
  {
    version: "0.1.6",
    date: "2026-07-12",
    head: "Chrome extension zip on every GitHub Release, plus an agent skill for post-cli vault automation.",
    groups: [
      {
        title: "Extension",
        items: [
          "Each Mac release also publishes Post-<version>-chrome-extension.zip for Load unpacked / store packaging.",
          "The zip includes INSTALL.md with Desktop companion and native-host registration steps.",
        ],
      },
      {
        title: "Agents",
        items: [
          "skills/post teaches agents how to drive post-cli, the data model, and the vault .post/ folder for non-asset keep files.",
          "Install with: npx skills add BarrySong97/post -s post (Codex: --path skills/post)",
        ],
      },
    ],
  },
  {
    version: "0.1.5",
    date: "2026-07-12",
    head: "Chinese and English UI language switching, plus asset detail that opens without leaving the board.",
    groups: [
      {
        title: "Desktop",
        items: [
          "Settings → Language can follow the system or lock to 中文 / English; chrome labels, filters, toasts, and dialogs switch with it.",
          "Opening an asset keeps the masonry board mounted underneath; Back closes the overlay and restores scroll.",
          "Deep links to /assets/:id soft-redirect into the same overlay on the home route.",
        ],
      },
    ],
  },
  {
    version: "0.1.4",
    date: "2026-07-12",
    head: "Smoother success toasts, more reliable top-chrome window dragging, and less accidental text selection while moving the window.",
    groups: [
      {
        title: "Desktop",
        items: [
          "Success toasts after delete and edit actions stay in step with the asset list refresh, so feedback no longer races ahead of the board.",
          "Toast enter animation is retained and no longer competes with modal close or heavy list reloads on the same frames.",
          "Dragging the top window chrome is less likely to select text or hit dead zones under empty toast overlays.",
        ],
      },
    ],
  },
  {
    version: "0.1.3",
    date: "2026-07-11",
    head: "Hidden files are no longer imported as assets, with a one-time cleanup of previously imported ones.",
    groups: [
      {
        title: "Desktop",
        items: [
          "Hidden files and folders (names starting with a dot, such as .git, .obsidian and .DS_Store) are no longer imported into your asset library.",
          "Updating automatically removes asset records that earlier versions imported from these hidden paths; the underlying files in your vault are left untouched.",
        ],
      },
    ],
  },
  {
    version: "0.1.0",
    date: "2026-07-04",
    head: "Initial Mac release path for Post desktop updates and public downloads.",
    groups: [
      {
        title: "Desktop",
        items: [
          "Mac app release artifacts are distributed from GitHub Releases.",
          "Packaged apps can check for updates and download updates in-app.",
          "The Settings page exposes version and update controls.",
        ],
      },
      {
        title: "Website",
        items: [
          "Download links point to the latest GitHub Release.",
          "A public changelog page records user-facing release notes.",
        ],
      },
    ],
  },
];

/** Anchor slug for a release, so a single version can be linked and shared: 0.1.13 -> v0-1-13. */
function anchorId(version: string): string {
  return `v${version.replaceAll(".", "-")}`;
}

export function ReleaseTimeline() {
  return (
    <div className="border-t border-border-subtle">
      {RELEASES.map((release) => {
        const anchor = anchorId(release.version);

        return (
          <article
            key={release.version}
            id={anchor}
            className="grid scroll-mt-20 gap-4 border-b border-border-subtle py-11 md:grid-cols-[9rem_1fr] md:gap-8"
          >
            <div className="flex items-baseline gap-3 md:sticky md:top-20 md:block md:self-start">
              <h2 className="font-mono text-[15px] font-semibold text-foreground">
                <a href={`#${anchor}`} className="hover:underline hover:underline-offset-4">
                  v{release.version}
                </a>
              </h2>
              <time
                className="font-mono text-xs tabular-nums text-foreground/45 md:mt-1.5 md:block"
                dateTime={release.date}
              >
                {release.date}
              </time>
              {release.badge ? (
                <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-emerald-600 md:mt-2.5">
                  <span aria-hidden className="size-1.5 rounded-full bg-current" />
                  {release.badge}
                </span>
              ) : null}
            </div>
            <div className="min-w-0">
              <p className="text-balance text-[17px] font-semibold leading-snug text-foreground">
                {release.head}
              </p>
              {release.groups.map((group) => (
                <section key={group.title} className="mt-7">
                  <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-foreground/45">
                    {group.title}
                  </h3>
                  <ul className="mt-2.5 flex flex-col gap-1.5">
                    {group.items.map((item) => (
                      <li
                        key={item}
                        className="relative pl-[1.1rem] text-[14px] leading-[1.65] text-foreground/65"
                      >
                        <span
                          aria-hidden
                          className="absolute left-0 top-[0.72em] h-px w-[0.45rem] bg-foreground/45"
                        />
                        {item}
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          </article>
        );
      })}
    </div>
  );
}
