/**
 * @purpose Compose the website landing page from section components.
 * @role    Next.js App Router index route (Server Component).
 * @deps    ./components/* landing-page section components, next/image for the shared hero backdrop.
 * @gotcha  Product-preview is a neutral color-block placeholder; HeroUI components keep their native
 *          theme (only the page canvas uses the desktop --background/--foreground/--surface tokens).
 *          SiteHeader lives in the root layout (fixed nav shared across routes), not here.
 *          <HeroSection> (copy) and <ProductPreview> (mock) are one visual "hero" block sharing this
 *          full-bleed background image, not two independent sections. The image is rendered at its
 *          full, uncropped size — full width, `h-auto` so its own aspect ratio decides the height —
 *          not `fill`/`object-cover` into a capped box, which would crop it. It fades to the page
 *          background via gradient before its own bottom edge so it blends into whatever content
 *          (hero copy, then the mock) ends up sitting on top of/past it.
 */
import Image from "next/image";

import { ClosingCta } from "./components/closing-cta";
import { FaqSection } from "./components/faq-section";
import { HeroSection } from "./components/hero-section";
import { HowItWorksSection } from "./components/how-it-works-section";
import { ProductPreview } from "./components/product-preview";
import { SiteFooter } from "./components/site-footer";

// Intrinsic size of public/hero-sky.png — required by next/image in non-`fill` mode so it can reserve
// the right aspect ratio before the asset loads.
const HERO_IMAGE_SIZE = { width: 1672, height: 941 };

export default function Page() {
  return (
    <div className="text-sm">
      <section className="relative isolate overflow-hidden">
        <div className="absolute inset-x-0 top-0 -z-10">
          <Image
            src="/hero-sky.png"
            alt=""
            width={HERO_IMAGE_SIZE.width}
            height={HERO_IMAGE_SIZE.height}
            priority
            sizes="100vw"
            className="block h-auto w-full"
          />
          <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-background" />
        </div>
        <HeroSection />
        <ProductPreview />
      </section>
      <HowItWorksSection />
      <FaqSection />
      <ClosingCta />
      <SiteFooter />
    </div>
  );
}
