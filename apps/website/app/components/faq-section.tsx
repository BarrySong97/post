/**
 * @purpose Render Post website FAQ content.
 * @role    Server component for landing-page question and answer rows.
 * @deps    Tailwind classes from the shared Post UI theme.
 * @gotcha  FAQ copy is plain text and should stay aligned with the desktop product positioning.
 */
const FAQS = [
  {
    q: "What is Post?",
    a: "Post is a local-first desktop workspace for organizing vault files, assets, notes, tags, and saved views.",
  },
  {
    q: "Where does my data live?",
    a: "Your workspace data stays on your machine. Post indexes local vault folders and stores organization data in a local SQLite database.",
  },
  {
    q: "What can I organize with Post?",
    a: "Use Post to browse assets, keep notes connected to files, apply tags, save filtered views, and prepare publishing-oriented workflows.",
  },
];

export function FaqSection() {
  return (
    <section className="mx-auto max-w-2xl px-6 pt-20">
      <p className="text-xl font-bold tracking-tight text-foreground">FREQUENTLY ASKED QUESTIONS</p>
      <dl className="mt-6 space-y-5">
        {FAQS.map((faq) => (
          <div key={faq.q}>
            <dt className="text-sm font-bold">{faq.q}</dt>
            <dd className="mt-1 text-sm leading-relaxed text-foreground/60">{faq.a}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
