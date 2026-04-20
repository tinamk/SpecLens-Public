export const localTestUsers = [
  {
    id: "user_local_owner",
    provider: "keycloak",
    subject: "00000000-0000-0000-0000-000000000101",
    username: "owner",
    email: "owner@speclens.dev",
    displayName: "Owner User",
    password: "owner-password",
    entitlement: "pro",
  },
  {
    id: "user_local_member",
    provider: "keycloak",
    subject: "00000000-0000-0000-0000-000000000102",
    username: "member",
    email: "member@speclens.dev",
    displayName: "Member User",
    password: "member-password",
    entitlement: "free",
  },
  {
    id: "user_local_outsider",
    provider: "keycloak",
    subject: "00000000-0000-0000-0000-000000000103",
    username: "outsider",
    email: "outsider@speclens.dev",
    displayName: "Outsider User",
    password: "outsider-password",
    entitlement: "free",
  },
  {
    id: "user_local_admin",
    provider: "keycloak",
    subject: "00000000-0000-0000-0000-000000000104",
    username: "admin",
    email: "admin@speclens.dev",
    displayName: "Admin User",
    password: "admin-password",
    entitlement: "free",
  },
] as const;

export type LocalTestUser = (typeof localTestUsers)[number];
