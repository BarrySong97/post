/**
 * @purpose Render Post public release notes and expose release data to release automation.
 * @role    Website changelog source validated before cutting GitHub release tags.
 * @deps    React server components only.
 * @gotcha  Before running `pnpm release <version>`, add the new entry first and move `badge: "latest"`.
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
    version: "0.1.12",
    date: "2026-07-15",
    head: "A new MDX blog, higher-fidelity X Post capture, and newest-added-first asset browsing.",
    badge: "latest",
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

export function ReleaseTimeline() {
  return (
    <div className="flex flex-col gap-4">
      {RELEASES.map((release) => (
        <article
          key={release.version}
          className="rounded-lg border border-border bg-surface p-5 shadow-sm"
        >
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="font-mono text-[22px] font-semibold text-foreground">
              v{release.version}
            </h2>
            {release.badge ? (
              <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-emerald-700">
                {release.badge}
              </span>
            ) : null}
            <time className="ml-auto font-mono text-xs text-foreground/50" dateTime={release.date}>
              {release.date}
            </time>
          </div>
          <p className="mt-3 text-[14px] leading-6 text-foreground/70">{release.head}</p>
          <div className="mt-5 grid gap-4 md:grid-cols-2">
            {release.groups.map((group) => (
              <section key={group.title}>
                <h3 className="text-[13px] font-semibold text-foreground">{group.title}</h3>
                <ul className="mt-2 space-y-1.5 text-[13px] leading-6 text-foreground/65">
                  {group.items.map((item) => (
                    <li key={item}>- {item}</li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </article>
      ))}
    </div>
  );
}
