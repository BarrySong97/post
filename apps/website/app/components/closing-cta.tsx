/**
 * @purpose Render the website closing call to action.
 * @role    Server component for the final landing-page conversion section.
 * @deps    ./ui (HeroUI Link behind a client boundary), ../lib/seo for the download URL.
 * @gotcha  Keep this copy product-focused rather than reference-app copy. Uses <Link> styled with raw
 *          `button button--*` classes, not HeroUI's <Button> — see ./ui.tsx for why.
 */
import { Link } from "./ui";
import { DOWNLOAD_URL } from "../lib/seo";

export function ClosingCta() {
  return (
    <section className="mx-auto max-w-2xl px-6 pt-20 pb-24">
      <p className="text-sm font-bold">Bring your local files into one workspace.</p>
      <p className="mt-1 text-sm text-foreground/60">
        Post helps you browse, connect, and prepare your work without giving up local control.
      </p>
      <div className="mt-4">
        <Link href={DOWNLOAD_URL} className="button button--md button--primary rounded-lg">
          Download Post ↓
        </Link>
      </div>
    </section>
  );
}
