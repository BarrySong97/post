/**
 * @purpose Render the website closing call to action.
 * @role    Server component for the final landing-page conversion section.
 * @deps    ./ui (HeroUI Button behind a client boundary).
 * @gotcha  Keep this copy product-focused rather than reference-app copy.
 */
import { Button } from "./ui";

export function ClosingCta() {
  return (
    <section className="mx-auto max-w-2xl px-6 pt-20 pb-24">
      <p className="text-sm font-bold">Bring your local files into one workspace.</p>
      <p className="mt-1 text-sm text-foreground/60">
        Post helps you browse, connect, and prepare your work without giving up local control.
      </p>
      <div className="mt-4">
        <Button>Download Post ↓</Button>
      </div>
    </section>
  );
}
