/**
 * @purpose Render the website how-it-works steps for the Post desktop workflow.
 * @role    Server component for the landing-page workflow explanation section.
 * @deps    Tailwind classes from the shared Post UI theme.
 * @gotcha  Keep the steps local-first and desktop-product focused.
 */
const HOW_IT_WORKS = [
  {
    title: "Choose a local vault.",
    body: "Point Post at a folder you already use for files, images, notes, and publishing assets.",
  },
  {
    title: "Let Post index it.",
    body: "Post scans your vault locally, builds previews, and keeps organization data on your machine.",
  },
  {
    title: "Organize for reuse.",
    body: "Apply tags, save filtered views, and keep the materials for each publishing workflow easy to find.",
  },
  {
    title: "Use your agent and command line.",
    body: "Use your agent and our command line tool to manage your assets.",
  },
];

export function HowItWorksSection() {
  return (
    <section className="mx-auto max-w-2xl px-6 pt-20">
      <p className="text-xl font-bold tracking-tight text-foreground">HOW IT WORKS</p>
      <ol className="mt-6 space-y-5">
        {HOW_IT_WORKS.map((step, index) => (
          <li key={step.title} className="text-sm">
            <span className="font-bold">
              {index + 1}. {step.title}
            </span>
            <p className="mt-1 leading-relaxed text-foreground/60">{step.body}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
