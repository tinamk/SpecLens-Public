ALTER TABLE "Source"
ADD COLUMN "verificationStatus" TEXT NOT NULL DEFAULT 'verified',
ADD COLUMN "verificationError" TEXT;
