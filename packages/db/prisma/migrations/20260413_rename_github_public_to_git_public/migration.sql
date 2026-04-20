UPDATE "Source"
SET "type" = 'git-public'
WHERE "type" = 'github-public';

UPDATE "AnalysisJob"
SET "sourceType" = 'git-public'
WHERE "sourceType" = 'github-public';
