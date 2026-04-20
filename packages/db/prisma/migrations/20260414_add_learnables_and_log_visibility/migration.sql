ALTER TABLE "AnalysisJobLog"
ADD COLUMN "visibility" TEXT NOT NULL DEFAULT 'default';

ALTER TABLE "AiRole"
ADD COLUMN "consoleVisibility" TEXT NOT NULL DEFAULT 'normal';

CREATE TABLE "SourceLearnable" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "learnedFromJobId" TEXT NOT NULL,
  "statement" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "evidenceJson" JSONB NOT NULL,
  "order" INTEGER NOT NULL DEFAULT 0,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "SourceLearnable_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SourceLearnable_workspaceId_sourceId_active_order_idx"
ON "SourceLearnable"("workspaceId", "sourceId", "active", "order");

ALTER TABLE "SourceLearnable"
ADD CONSTRAINT "SourceLearnable_workspaceId_fkey"
FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SourceLearnable"
ADD CONSTRAINT "SourceLearnable_sourceId_fkey"
FOREIGN KEY ("sourceId") REFERENCES "Source"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SourceLearnable"
ADD CONSTRAINT "SourceLearnable_learnedFromJobId_fkey"
FOREIGN KEY ("learnedFromJobId") REFERENCES "AnalysisJob"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
