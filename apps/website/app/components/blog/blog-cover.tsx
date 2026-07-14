/**
 * @purpose Render a post's cover image with a thumbhash blur-up placeholder, or a gradient fallback.
 * @role    Shared cover element for the blog card, featured post, and detail page.
 * @deps    thumbhash (decoded at build time — this stays a Server Component, no client JS).
 * @gotcha  Covers are processed by scripts/img.mjs into an R2 URL + coverThumbhash. The thumbhash paints
 *          an instant blurred placeholder behind the real <img>; without a thumbhash (or cover) it falls
 *          back to the gradient block. No fade-in here (that needs client JS) — the img simply paints
 *          over the placeholder once loaded.
 */
import { thumbHashToAverageRGBA, thumbHashToDataURL } from "thumbhash";

interface BlogCoverProps {
  cover?: string;
  /** Post title — used for the img alt and to seed the gradient-fallback initial. */
  title: string;
  /** base64 thumbhash from scripts/img.mjs (enables the blur-up placeholder). */
  thumbhash?: string;
  /** Extra classes for the outer frame (e.g. aspect ratio, radius). */
  className?: string;
}

function placeholderFrom(thumbhash?: string): { avg: string; url: string } | null {
  if (!thumbhash) return null;
  try {
    const bytes = new Uint8Array(Buffer.from(thumbhash, "base64"));
    const { r, g, b, a } = thumbHashToAverageRGBA(bytes);
    const avg = `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}, ${a})`;
    return { avg, url: thumbHashToDataURL(bytes) };
  } catch {
    return null;
  }
}

export function BlogCover({ cover, title, thumbhash, className = "" }: BlogCoverProps) {
  const frame = `relative overflow-hidden bg-surface-muted ${className}`;

  if (cover) {
    const placeholder = placeholderFrom(thumbhash);
    return (
      <div
        className={frame}
        style={
          placeholder
            ? {
                backgroundColor: placeholder.avg,
                backgroundImage: `url(${placeholder.url})`,
                backgroundSize: "cover",
                backgroundPosition: "center",
              }
            : undefined
        }
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={cover}
          alt={title}
          loading="lazy"
          decoding="async"
          className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
        />
      </div>
    );
  }

  const initial = title.trim().charAt(0).toUpperCase() || "P";

  return (
    <div className={frame}>
      <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-surface-muted to-border-subtle">
        <span className="text-4xl font-bold tracking-tight text-foreground/25">{initial}</span>
      </div>
    </div>
  );
}
