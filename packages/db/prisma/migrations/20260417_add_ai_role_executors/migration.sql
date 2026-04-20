ALTER TABLE "AiRole"
ADD COLUMN "executorKind" TEXT NOT NULL DEFAULT 'codex',
ADD COLUMN "nativeExecutorId" TEXT;
