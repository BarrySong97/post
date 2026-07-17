/**
 * @purpose Render the website landing-page footer.
 * @role    Server component for footer navigation groups and copyright text.
 * @deps    ./ui (HeroUI Link behind a client boundary), ../lib/seo.
 * @gotcha  Download, GitHub, and npm CLI links must stay aligned with app/lib/seo.ts.
 */
import { Link } from "./ui";
import { DOWNLOAD_URL, EXTENSION_DOWNLOAD_URL, GITHUB_URL, NPM_CLI_URL } from "../lib/seo";

const FOOTER = [
  {
    title: "[Product]",
    links: [
      { label: "Download", href: DOWNLOAD_URL },
      { label: "Desktop app", href: DOWNLOAD_URL },
      { label: "Chrome extension", href: EXTENSION_DOWNLOAD_URL },
    ],
  },
  {
    title: "[Resources]",
    links: [{ label: "Changelog", href: "/releases" }],
  },
  {
    title: "[Connect]",
    links: [
      { label: "GitHub", href: GITHUB_URL },
      { label: "npm CLI", href: NPM_CLI_URL },
    ],
  },
];

const NAV_LINK = "text-xs text-foreground/60 transition-colors hover:text-foreground";

export function SiteFooter() {
  return (
    <footer className="border-t border-border bg-surface">
      <div className="mx-auto max-w-5xl px-6 py-12">
        <div className="grid grid-cols-2 gap-8 md:grid-cols-3">
          {FOOTER.map((column) => (
            <div key={column.title}>
              <p className="text-[11px] tracking-wider text-foreground/50">{column.title}</p>
              <ul className="mt-3 space-y-2">
                {column.links.map((link) => (
                  <li key={link.label}>
                    <Link href={link.href} className={NAV_LINK}>
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <p className="mt-10 text-[11px] text-foreground/40">© 2026 Post</p>
      </div>
    </footer>
  );
}
