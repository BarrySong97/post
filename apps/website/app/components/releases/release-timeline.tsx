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
    version: "0.1.3",
    date: "2026-07-11",
    head: "Hidden files are no longer imported as assets, with a one-time cleanup of previously imported ones.",
    badge: "latest",
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
