ALTER TABLE "AnalysisJob"
  DROP COLUMN "engine",
  DROP COLUMN "preset";

ALTER TABLE "AnalysisReport"
  DROP COLUMN "preset";
