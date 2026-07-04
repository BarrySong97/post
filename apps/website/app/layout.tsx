/**
 * @purpose Define the root HTML layout for the website app.
 * @role    Next.js App Router root layout wrapping every page.
 * @deps    next, react, geist (self-hosted font), global stylesheet, SiteHeader nav.
 * @gotcha  Geist is applied on <body> so it overrides @post/ui/theme.css's `body { font-family }`.
 *          SiteHeader is `fixed` and rendered once here (not per-page) since it's shared navigation;
 *          it stays out of document flow, so pages are responsible for their own top clearance.
 */
import { GeistSans } from "geist/font/sans";
import type { Metadata } from "next";
import type { ReactNode } from "react";

import { SiteHeader } from "./components/site-header";
import "./globals.css";

export const metadata: Metadata = {
  title: "Post — Local-first desktop workspace",
  description:
    "Post is a local-first desktop workspace for organizing vault files, assets, notes, tags, saved views, and publishing workflows.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body
        className={`${GeistSans.className} min-h-screen bg-background text-foreground antialiased`}
      >
        <SiteHeader />
        {children}
      </body>
    </html>
  );
}
