"use client";

import { useState, useTransition } from "react";

export default function CommercialContactForm() {
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<"idle" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);

  if (status === "sent") {
    return (
      <div className="legal-panel">
        <span className="tag tag--success">Thanks</span>
        <h2>We got your request</h2>
        <p>We will reply to the email you provided with next steps for commercial licensing.</p>
      </div>
    );
  }

  return (
    <form
      className="stack-form form-shell"
      onSubmit={event => {
        event.preventDefault();
        const formData = new FormData(event.currentTarget);
        const payload = {
          name: String(formData.get("name") ?? "").trim(),
          email: String(formData.get("email") ?? "").trim(),
          company: String(formData.get("company") ?? "").trim(),
          message: String(formData.get("message") ?? "").trim(),
        };
        setError(null);

        startTransition(async () => {
          try {
            const response = await fetch("/api/commercial-contact", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify(payload),
            });
            if (!response.ok) {
              const text = await response.text();
              throw new Error(text || "Commercial contact request failed.");
            }
            setStatus("sent");
          } catch (requestError) {
            setError(requestError instanceof Error ? requestError.message : "Commercial contact request failed.");
          }
        });
      }}
    >
      <div className="form-grid">
        <label className="field">
          <span>Name</span>
          <input autoComplete="name" name="name" required placeholder="Your name…" />
        </label>
        <label className="field">
          <span>Work email</span>
          <input autoComplete="email" name="email" required spellCheck={false} type="email" placeholder="you@company.com…" />
        </label>
        <label className="field">
          <span>Company</span>
          <input autoComplete="organization" name="company" placeholder="Company name…" />
        </label>
        <label className="field field--full">
          <span>How can we help?</span>
          <textarea name="message" rows={4} required placeholder="Describe your licensing or self-hosting needs…" />
        </label>
      </div>
      <p className="subtle-note">Useful details: deployment model, procurement constraints, timeline, and whether you need code rights or only hosted access.</p>
      <button className="button" type="submit" disabled={pending}>
        {pending ? "Sending…" : "Send request"}
      </button>
      {error ? <p className="inline-error" role="alert">{error}</p> : null}
    </form>
  );
}
