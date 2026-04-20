import assert from "node:assert/strict";
import { localTestUsers } from "../../../scripts/local/test-users";

export type E2eUser = {
  username: string;
  password: string;
  email: string;
};

type UserLabel = "OWNER" | "MEMBER" | "OUTSIDER" | "ADMIN";

function resolveScopedUserEnv(mode: "local" | "production", label: UserLabel, suffix: "USERNAME" | "EMAIL" | "PASSWORD"): string | null {
  const localKey = `E2E_LOCAL_${label}_${suffix}`;
  const sharedKey = `E2E_${label}_${suffix}`;
  if (mode === "local") {
    return process.env[localKey] ?? null;
  }
  return process.env[sharedKey] ?? process.env[localKey] ?? null;
}

export function resolveE2eUser(label: UserLabel, fallback: typeof localTestUsers[number]): E2eUser {
  const mode = resolveE2eMode();
  const username = resolveScopedUserEnv(mode, label, "USERNAME")
    ?? resolveScopedUserEnv(mode, label, "EMAIL")
    ?? fallback.username;
  const inferredEmail = username.includes("@") ? username : null;
  const email = resolveScopedUserEnv(mode, label, "EMAIL")
    ?? inferredEmail
    ?? fallback.email
    ?? username;
  const password = resolveScopedUserEnv(mode, label, "PASSWORD") ?? fallback.password;
  return {
    username,
    email,
    password,
  };
}

export function createTimestampedName(prefix: string): string {
  return `${prefix} ${new Date().toISOString().replace(/[.:]/g, "-")}`;
}

export function workspaceIdFromUrl(url: string): string {
  const workspaceId = url.split("/").at(-1)?.split("?")[0];
  assert.ok(workspaceId, "Workspace id should be present in the URL.");
  return workspaceId;
}

export function jobIdFromUrl(url: string): string {
  const jobId = url.split("/").at(-1)?.split("?")[0];
  assert.ok(jobId, "Job id should be present in the URL.");
  return jobId;
}

export function resolveE2eMode(): "local" | "production" {
  if (process.env.E2E_ENV === "production") {
    return "production";
  }
  if (process.env.E2E_ENV === "local") {
    return "local";
  }
  return (process.env.PLAYWRIGHT_BASE_URL ?? "").includes("localhost") ? "local" : "production";
}
