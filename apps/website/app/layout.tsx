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
import {
  APPLE_TOUCH_ICON_URL,
  FAVICON_URL,
  OG_IMAGE_URL,
  SITE_DESCRIPTION,
  SITE_ICON_URL,
  SITE_KEYWORDS,
  SITE_NAME,
  SITE_TITLE,
  SITE_URL,
} from "./lib/seo";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  applicationName: SITE_NAME,
  title: {
    default: SITE_TITLE,
    template: `%s | ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  keywords: SITE_KEYWORDS,
  alternates: {
    canonical: "/",
  },
  icons: {
    icon: [
      { url: FAVICON_URL, sizes: "any" },
      { url: SITE_ICON_URL, type: "image/png", sizes: "512x512" },
    ],
    shortcut: FAVICON_URL,
    apple: [{ url: APPLE_TOUCH_ICON_URL, type: "image/png", sizes: "256x256" }],
  },
  openGraph: {
    type: "website",
    locale: "en_US",
    url: "/",
    siteName: SITE_NAME,
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    images: [
      {
        url: OG_IMAGE_URL,
        width: 1200,
        height: 630,
        alt: `${SITE_NAME} desktop workspace preview`,
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    images: [OG_IMAGE_URL],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
  appleWebApp: {
    capable: true,
    title: SITE_NAME,
  },
  formatDetection: {
    telephone: false,
  },
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
