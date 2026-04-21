import type { Route } from "next";
import Link from "next/link";
import type { PageInfo } from "@speclens/contracts";

type SearchValue = string | string[] | undefined;

function firstSearchValue(value: SearchValue): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function buildHref(
  pathname: string,
  searchParams: Record<string, SearchValue>,
  updates: Record<string, string | number | undefined>,
): Route {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    const next = firstSearchValue(value);
    if (next) {
      params.set(key, next);
    }
  }
  for (const [key, value] of Object.entries(updates)) {
    if (value === undefined || value === "") {
      params.delete(key);
      continue;
    }
    params.set(key, String(value));
  }
  const query = params.toString();
  return `${pathname}${query ? `?${query}` : ""}` as Route;
}

export function PaginationLinks({
  pathname,
  searchParams,
  pageInfo,
  testIdPrefix,
  pageParamKey = "page",
}: {
  pathname: string;
  searchParams: Record<string, SearchValue>;
  pageInfo: PageInfo;
  testIdPrefix: string;
  pageParamKey?: string;
}) {
  if (pageInfo.total <= pageInfo.pageSize) {
    return null;
  }

  return (
    <div className="portal-inline-actions" data-testid={`${testIdPrefix}-pagination`}>
      <span className="subtle-note">
        Page {pageInfo.page} of {pageInfo.totalPages} · {pageInfo.total} total
      </span>
      <Link
        className="button-ghost"
        data-testid={`${testIdPrefix}-page-prev`}
        aria-disabled={pageInfo.page <= 1}
        href={buildHref(pathname, searchParams, { [pageParamKey]: Math.max(1, pageInfo.page - 1) })}
      >
        Previous
      </Link>
      <Link
        className="button-ghost"
        data-testid={`${testIdPrefix}-page-next`}
        aria-disabled={pageInfo.page >= pageInfo.totalPages}
        href={buildHref(pathname, searchParams, { [pageParamKey]: Math.min(pageInfo.totalPages, pageInfo.page + 1) })}
      >
        Next
      </Link>
    </div>
  );
}

export function buildSearchHref(
  pathname: string,
  searchParams: Record<string, SearchValue>,
  updates: Record<string, string | number | undefined>,
): Route {
  return buildHref(pathname, searchParams, updates);
}
