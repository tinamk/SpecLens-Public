ALTER TABLE "AiAuth"
ADD COLUMN "scopeKey" TEXT,
ADD COLUMN "scopeType" TEXT NOT NULL DEFAULT 'global',
ADD COLUMN "disabled" BOOLEAN NOT NULL DEFAULT false;

UPDATE "AiAuth"
SET "id" = 'codex:global'
WHERE "id" = 'codex';

UPDATE "AiAuth"
SET "scopeKey" = "id",
    "scopeType" = 'global'
WHERE "scopeKey" IS NULL;

ALTER TABLE "AiAuth"
ALTER COLUMN "scopeKey" SET NOT NULL;

CREATE UNIQUE INDEX "AiAuth_scopeKey_key" ON "AiAuth"("scopeKey");
