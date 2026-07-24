-- CreateEnum
CREATE TYPE "UsageKind" AS ENUM ('ISSUE', 'CRON', 'CHAT');

-- AlterTable
ALTER TABLE "ClaudeAccount" ADD COLUMN     "monthlyBudgetUsd" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "CronRun" ADD COLUMN     "cacheCreationTokens" INTEGER,
ADD COLUMN     "cacheReadTokens" INTEGER,
ADD COLUMN     "costUsd" DOUBLE PRECISION,
ADD COLUMN     "inputTokens" INTEGER,
ADD COLUMN     "outputTokens" INTEGER;

-- AlterTable
ALTER TABLE "IssueTask" ADD COLUMN     "cacheCreationTokens" INTEGER,
ADD COLUMN     "cacheReadTokens" INTEGER,
ADD COLUMN     "costUsd" DOUBLE PRECISION,
ADD COLUMN     "inputTokens" INTEGER,
ADD COLUMN     "outputTokens" INTEGER;

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "monthlyBudgetUsd" DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "UsageRecord" (
    "id" TEXT NOT NULL,
    "kind" "UsageKind" NOT NULL,
    "projectId" TEXT NOT NULL,
    "claudeAccountId" TEXT,
    "userId" TEXT,
    "refId" TEXT,
    "model" TEXT,
    "costUsd" DOUBLE PRECISION NOT NULL,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "cacheReadTokens" INTEGER NOT NULL DEFAULT 0,
    "cacheCreationTokens" INTEGER NOT NULL DEFAULT 0,
    "durationMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UsageRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UsageRecord_projectId_createdAt_idx" ON "UsageRecord"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "UsageRecord_claudeAccountId_createdAt_idx" ON "UsageRecord"("claudeAccountId", "createdAt");

-- CreateIndex
CREATE INDEX "UsageRecord_createdAt_idx" ON "UsageRecord"("createdAt");

-- AddForeignKey
ALTER TABLE "UsageRecord" ADD CONSTRAINT "UsageRecord_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsageRecord" ADD CONSTRAINT "UsageRecord_claudeAccountId_fkey" FOREIGN KEY ("claudeAccountId") REFERENCES "ClaudeAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;
