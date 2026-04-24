import type { ReactNode } from "react";

function normalizeText(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return "";
  return String(value);
}

function splitPath(value: string): string[] {
  const trimmed = value.trim();
  if (!trimmed) return [];
  try {
    const url = new URL(trimmed);
    const pathParts = url.pathname.split("/").filter(Boolean);
    return [url.hostname, ...pathParts];
  } catch {
    return trimmed.split(/[\\/]+/).filter(Boolean);
  }
}

export function getCompactPathLabel(value: string): string {
  const parts = splitPath(value);
  if (parts.length === 0) return value;
  if (parts.length === 1) return parts[0] ?? value;
  return parts.slice(-2).join("/");
}

export function DataValue({
  value,
  tone = "plain",
}: {
  value: string | number | boolean | null | undefined;
  tone?: "plain" | "id";
}) {
  const text = normalizeText(value);
  return (
    <span className={tone === "id" ? "data-value data-value--id" : "data-value"} title={text}>
      {text || "n/a"}
    </span>
  );
}

export function DataPath({
  value,
  label,
}: {
  value: string | null | undefined;
  label?: ReactNode;
}) {
  const text = normalizeText(value);
  const compactLabel = label ?? getCompactPathLabel(text);
  return (
    <span className="data-path" title={text}>
      <span className="data-path__leaf">{compactLabel || "n/a"}</span>
      {text && text !== compactLabel ? <span className="data-path__trail">{text}</span> : null}
    </span>
  );
}

export function DataChipList({
  items,
  emptyLabel = "none",
  limit = 8,
}: {
  items: string[];
  emptyLabel?: string;
  limit?: number;
}) {
  if (items.length === 0) {
    return <span className="data-value">{emptyLabel}</span>;
  }
  const visibleItems = items.slice(0, limit);
  const hiddenCount = Math.max(items.length - visibleItems.length, 0);
  return (
    <span className="data-chip-list">
      {visibleItems.map(item => (
        <span className="data-chip" key={item} title={item}>
          {getCompactPathLabel(item)}
        </span>
      ))}
      {hiddenCount > 0 ? <span className="data-chip data-chip--muted">+{hiddenCount} more</span> : null}
    </span>
  );
}

export function DataCommandList({
  commands,
  emptyLabel = "No commands recorded",
}: {
  commands: string[];
  emptyLabel?: string;
}) {
  if (commands.length === 0) {
    return <span className="data-value">{emptyLabel}</span>;
  }
  return (
    <ol className="data-command-list">
      {commands.map(command => (
        <li key={command}>
          <code>{command}</code>
        </li>
      ))}
    </ol>
  );
}
