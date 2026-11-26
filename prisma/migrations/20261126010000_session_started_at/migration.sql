-- Existing rows are backfilled with the time the migration runs, so no token
-- is left with a NULL session start.
ALTER TABLE "refresh_tokens" ADD COLUMN "sessionStartedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
