export interface CodexStoredTokens {
  accessToken: string;
  refreshToken: string | null;
  idToken: string | null;
  accountId: string | null;
}

export function renderCodexAuthFile(
  tokens: CodexStoredTokens,
  lastRefresh: Date = new Date(),
): string {
  return `${JSON.stringify({
    auth_mode: "chatgpt",
    OPENAI_API_KEY: null,
    tokens: {
      access_token: tokens.accessToken,
      refresh_token: tokens.refreshToken,
      id_token: tokens.idToken,
      account_id: tokens.accountId,
    },
    last_refresh: lastRefresh.toISOString(),
  }, null, 2)}\n`;
}

export function parseCodexAuthFile(raw: string): CodexStoredTokens | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== "object") {
    return null;
  }

  const tokens = (parsed as {
    tokens?: {
      access_token?: unknown;
      refresh_token?: unknown;
      id_token?: unknown;
      account_id?: unknown;
    };
  }).tokens;

  if (!tokens || typeof tokens.access_token !== "string" || tokens.access_token.length === 0) {
    return null;
  }

  return {
    accessToken: tokens.access_token,
    refreshToken: typeof tokens.refresh_token === "string" ? tokens.refresh_token : null,
    idToken: typeof tokens.id_token === "string" ? tokens.id_token : null,
    accountId: typeof tokens.account_id === "string" ? tokens.account_id : null,
  };
}
