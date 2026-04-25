const STORY_STEPS = [
  {
    index: "01",
    title: "Attach the source",
    copy: "Point the QA run at the exact repository boundary. Public Git stays explicit, private GitHub stays workspace-bound.",
    bullets: ["Public Git or private GitHub repositories", "Archive uploads for isolated reviews"],
  },
  {
    index: "02",
    title: "Execute the pack",
    copy: "Workers, logs, and artifacts stay visible while the QA run is active — no more waiting blind.",
    bullets: ["Queued execution stays legible", "Live logs replace waiting blind"],
  },
  {
    index: "03",
    title: "Review the gate",
    copy: "Findings, report sections, and remediation routes stay connected to the same QA frame.",
    bullets: ["Release gates stay explicit", "Findings stay tied to action"],
  },
] as const;

export function HomeStory() {
  return (
    <section className="section">
      <div className="section-heading">
        <div>
          <p className="section-kicker">From spec to gate</p>
          <h2 className="text-balance">A QA workflow that keeps the spec, the run, and the gate in one chain of evidence.</h2>
        </div>
        <p className="section-copy">
          SpecLens is strongest when the flow stays linear: attach the source, execute the pack, review the gate.
        </p>
      </div>

      <div className="steps-grid">
        {STORY_STEPS.map(step => (
          <article className="step-card" key={step.index}>
            <span className="step-card__index">{step.index}</span>
            <h3 className="step-card__title">{step.title}</h3>
            <p className="step-card__copy">{step.copy}</p>
            <ul className="step-card__bullets">
              {step.bullets.map(bullet => <li key={bullet}>{bullet}</li>)}
            </ul>
          </article>
        ))}
      </div>
    </section>
  );
}
