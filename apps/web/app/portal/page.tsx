import { redirect } from "next/navigation";

export default async function PortalEntryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = new URLSearchParams();
  const entries = await searchParams;
  for (const [key, value] of Object.entries(entries)) {
    if (typeof value === "string") {
      params.set(key, value);
      continue;
    }
    for (const entry of value ?? []) {
      params.append(key, entry);
    }
  }
  const query = params.toString();
  redirect(query ? `/portal/workspaces?${query}` : "/portal/workspaces");
}
