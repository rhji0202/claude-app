-- AlterTable
ALTER TABLE "IssueTask" ADD COLUMN     "attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "claimedAt" TIMESTAMP(3),
ADD COLUMN     "lockedBy" TEXT;

-- CreateIndex
CREATE INDEX "IssueTask_status_idx" ON "IssueTask"("status");
