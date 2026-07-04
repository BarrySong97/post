/**
 * @purpose Render the hero copy and primary call to action.
 * @role    Server component for the text/CTA half of the landing page's combined hero block.
 * @deps    ./ui (HeroUI Button behind a client boundary).
 * @gotcha  Rendered as a plain content block, not its own <section> or background owner: app/page.tsx
 *          mounts this directly above <ProductPreview>, both inside one shared hero <section> whose
 *          full-bleed backdrop image sits behind this copy AND the mock that follows it — see
 *          HERO_BACKDROP_HEIGHT_STYLE in page.tsx for that image's sizing. The wrapper below
 *          intentionally mirrors SiteHeader's `mx-auto max-w-5xl px-6` (centering and padding on the
 *          same element) so this copy's left edge lines up with the header logo.
 */
import { Button } from "./ui";

export function HeroSection() {
  return (
    <div className="mx-auto w-full max-w-5xl px-6 pb-10 pt-28 sm:pb-14 sm:pt-32">
      <h1 className="text-2xl font-bold text-foreground sm:text-3xl">
        Organize your local workspace in Post.
      </h1>
      <p className="mt-3 max-w-md text-sm leading-relaxed text-foreground/70">
        A desktop app for vault files, assets, notes, tags, saved views, and publishing work.
      </p>
      <div className="mt-6">
        <Button>Download Post ↓</Button>
      </div>
    </div>
  );
}
