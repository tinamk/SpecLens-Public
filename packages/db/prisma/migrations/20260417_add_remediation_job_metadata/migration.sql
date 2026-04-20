ALTER TABLE "AnalysisJob"
ADD COLUMN "parentReportId" TEXT,
ADD COLUMN "jobKind" TEXT NOT NULL DEFAULT 'audit',
ADD COLUMN "metadataJson" JSONB;

ALTER TABLE "AnalysisJob"
ADD CONSTRAINT "AnalysisJob_parentReportId_fkey"
FOREIGN KEY ("parentReportId") REFERENCES "AnalysisReport"("id")
ON DELETE SET NULL
ON UPDATE CASCADE;

CREATE INDEX "AnalysisJob_parentReportId_idx" ON "AnalysisJob"("parentReportId");
CREATE INDEX "AnalysisJob_jobKind_idx" ON "AnalysisJob"("jobKind");
