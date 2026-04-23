export default function Loading() {
  return (
    <div className="route-loading" data-testid="public-route-loading">
      <div className="route-loading__spinner" aria-hidden="true" />
      <p className="route-loading__label">Loading…</p>
    </div>
  );
}
