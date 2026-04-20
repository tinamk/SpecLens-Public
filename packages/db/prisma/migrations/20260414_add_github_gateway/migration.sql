CREATE TABLE "GithubInstallIntent" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "requestedByUserId" TEXT NOT NULL,
    "targetAppUrl" TEXT NOT NULL,
    "nonce" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GithubInstallIntent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GithubWebhookTarget" (
    "id" TEXT NOT NULL,
    "environmentLabel" TEXT NOT NULL,
    "appUrl" TEXT NOT NULL,
    "webhookForwardUrl" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GithubWebhookTarget_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "GithubInstallIntent_workspaceId_idx" ON "GithubInstallIntent"("workspaceId");
CREATE INDEX "GithubInstallIntent_requestedByUserId_idx" ON "GithubInstallIntent"("requestedByUserId");
CREATE UNIQUE INDEX "GithubWebhookTarget_environmentLabel_kind_key" ON "GithubWebhookTarget"("environmentLabel", "kind");
CREATE INDEX "GithubWebhookTarget_kind_status_expiresAt_idx" ON "GithubWebhookTarget"("kind", "status", "expiresAt");

ALTER TABLE "GithubInstallIntent" ADD CONSTRAINT "GithubInstallIntent_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GithubInstallIntent" ADD CONSTRAINT "GithubInstallIntent_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
