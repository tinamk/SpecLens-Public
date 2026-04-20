ALTER TABLE "AnalysisJob"
ADD COLUMN "companionSourceId" TEXT,
ADD COLUMN "companionSourceType" TEXT,
ADD COLUMN "companionSourceLocation" TEXT;

ALTER TABLE "AnalysisJob"
ADD CONSTRAINT "AnalysisJob_companionSourceId_fkey"
FOREIGN KEY ("companionSourceId") REFERENCES "Source"("id")
ON DELETE SET NULL
ON UPDATE CASCADE;
