import type { ReactNode } from "react";

export function MarketingShell({ children }: { children: ReactNode }) {
  return <div className="marketing-shell">{children}</div>;
}

export function PricingCard({
  name,
  price,
  description,
  bullets,
  cta,
}: {
  name: string;
  price: string;
  description: string;
  bullets: string[];
  cta: ReactNode;
}) {
  return (
    <article className="pricing-card">
      <div className="pricing-card__header">
        <h3>{name}</h3>
        <p className="pricing-card__price">{price}</p>
        <p>{description}</p>
      </div>
      <ul className="pricing-card__list">
        {bullets.map(item => <li key={item}>{item}</li>)}
      </ul>
      <div className="pricing-card__cta">{cta}</div>
    </article>
  );
}
