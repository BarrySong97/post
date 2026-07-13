/**
 * @purpose Render the hero copy and primary call to action.
 * @role    Server component for the text/CTA half of the landing page's combined hero block.
 * @deps    ./ui (HeroUI Link behind a client boundary), ../lib/seo for download URLs.
 * @gotcha  Rendered as a plain content block, not its own <section> or background owner: app/page.tsx
 *          mounts this directly above <ProductPreview>, both inside one shared hero <section> whose
 *          full-bleed backdrop image sits behind this copy AND the mock that follows it — see
 *          HERO_BACKDROP_HEIGHT_STYLE in page.tsx for that image's sizing. The wrapper below
 *          intentionally mirrors SiteHeader's `mx-auto max-w-5xl px-6` (centering and padding on the
 *          same element) so this copy's left edge lines up with the header logo.
 *          Both CTAs are <Link> styled with raw `button button--*` classes, not HeroUI's <Button> —
 *          see ./ui.tsx for why. The extension link overrides `--button-bg-hover` inline (scoped to
 *          this one element only) because HeroUI's `button--ghost` default hover fill resolves to
 *          `--default`, a near-white token that looks hazy over the hero's sky photo backdrop — a
 *          dark, translucent scrim (matching the desktop sidebar's rgb(24 24 27 / a%) hover family)
 *          reads clearly over photographic content instead. It also adds a `gap-2` utility: HeroUI's
 *          <Link> always injects its own base "link" class alongside whatever className we pass, and
 *          `.link.button{gap:0}` (a rule aimed at plain text links styled as buttons) zeroes the gap
 *          between the icon and label — same fix pattern as `rounded-lg` in ./ui.tsx, a utilities-layer
 *          class beats the components-layer rule regardless of selector specificity.
 *          LogosChromeWebStore is the Chrome Web Store brand mark (SVG Logos icon set by Gil Barbara,
 *          MIT-licensed), inlined by hand rather than adding a dependency for one icon.
 */
import type { SVGProps } from "react";
import { Link } from "./ui";
import { AgentSetupNote } from "./agent-setup-note";
import { DOWNLOAD_URL, EXTENSION_DOWNLOAD_URL } from "../lib/seo";

function LogosChromeWebStore(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="1.15em"
      height="1em"
      viewBox="0 0 256 223"
      {...props}
    >
      {/* Icon from SVG Logos by Gil Barbara - https://raw.githubusercontent.com/gilbarbara/logos/master/LICENSE.txt */}
      <defs>
        <linearGradient id="logosChromeWebStoreRed" x1="0%" x2="100%" y1="50%" y2="50%">
          <stop offset="0%" stopColor="#D93025" />
          <stop offset="100%" stopColor="#EA4335" />
        </linearGradient>
        <linearGradient
          id="logosChromeWebStoreGreen"
          x1="74.943%"
          x2="19.813%"
          y1="95.826%"
          y2="-4.161%"
        >
          <stop offset="0%" stopColor="#1E8E3E" />
          <stop offset="100%" stopColor="#34A853" />
        </linearGradient>
        <linearGradient
          id="logosChromeWebStoreYellow"
          x1="59.898%"
          x2="21.416%"
          y1="-.134%"
          y2="99.86%"
        >
          <stop offset="0%" stopColor="#FBBC04" />
          <stop offset="100%" stopColor="#FCC934" />
        </linearGradient>
        <path
          id="logosChromeWebStoreOutline"
          d="M255.983 0H0v204.837c0 9.633 7.814 17.464 17.464 17.464h221.072c9.633 0 17.464-7.814 17.464-17.464z"
        />
      </defs>
      <path
        fill="#F1F3F4"
        d="M255.983 0H0v204.837c0 9.633 7.814 17.464 17.464 17.464h221.072c9.633 0 17.464-7.814 17.464-17.464z"
      />
      <path fill="#E8EAED" d="M0 0h255.983v111.74H0z" />
      <path
        fill="#FFF"
        d="M157.076 47.727H98.907A11.63 11.63 0 0 1 87.27 36.09a11.63 11.63 0 0 1 11.637-11.637h58.169a11.63 11.63 0 0 1 11.637 11.637c0 6.417-5.204 11.637-11.637 11.637"
      />
      <mask id="logosChromeWebStoreMask" fill="#fff">
        <use href="#logosChromeWebStoreOutline" />
      </mask>
      <g mask="url(#logosChromeWebStoreMask)">
        <g transform="translate(17.455 94.293)">
          <path
            fill="url(#logosChromeWebStoreRed)"
            d="m14.812 55.255l15.241 46.498l32.638 36.427l47.845-82.908l95.724-.017C187.146 22.213 151.443 0 110.536 0s-76.61 22.213-95.724 55.255"
          />
          <path
            fill="url(#logosChromeWebStoreGreen)"
            d="m110.52 221.105l32.637-36.443l15.224-46.482H62.674L14.812 55.255c-19.047 33.076-20.445 75.128.017 110.561c20.445 35.434 57.545 55.256 95.69 55.29"
          />
          <path
            fill="url(#logosChromeWebStoreYellow)"
            d="M206.26 55.272h-95.724l47.862 82.908l-47.862 82.925c38.162-.033 75.263-19.855 95.708-55.289c20.461-35.433 19.064-77.468.016-110.544"
          />
          <ellipse cx="110.536" cy="110.544" fill="#F1F3F4" rx="55.255" ry="55.272" />
          <ellipse cx="110.536" cy="110.544" fill="#1A73E8" rx="44.898" ry="44.915" />
        </g>
      </g>
      <path fill="#BDC1C6" d="M0 111.74h255.983v1.448H0zm0-1.465h255.983v1.448H0z" opacity=".1" />
    </svg>
  );
}

export function HeroSection() {
  return (
    <div className="mx-auto w-full max-w-5xl px-6 pb-10 pt-28 sm:pb-14 sm:pt-32">
      <h1 className="text-2xl font-bold text-foreground sm:text-3xl">
        Organize your local workspace in Post.
      </h1>
      <p className="mt-3 max-w-md text-sm leading-relaxed text-foreground/70">
        A desktop app for vault files, assets, notes, tags, saved views, and publishing work.
      </p>
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <Link href={DOWNLOAD_URL} className="button button--md button--primary rounded-lg">
          Download Post ↓
        </Link>
        <Link
          href={EXTENSION_DOWNLOAD_URL}
          className="button button--md button--ghost gap-2 rounded-lg"
          style={{ "--button-bg-hover": "rgb(24 24 27 / 0.08)" } as React.CSSProperties}
        >
          <LogosChromeWebStore />
          Get the Chrome Extension
        </Link>
      </div>
      <AgentSetupNote />
    </div>
  );
}
