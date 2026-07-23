-- CreateTable
CREATE TABLE "CronRun" (
    "id" TEXT NOT NULL,
    "cronJobId" TEXT NOT NULL,
    "status" "CronStatus",
    "result" TEXT,
    "error" TEXT,
    "sessionId" TEXT,
    "durationMs" INTEGER,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "CronRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CronRun_cronJobId_startedAt_idx" ON "CronRun"("cronJobId", "startedAt");

-- AddForeignKey
ALTER TABLE "CronRun" ADD CONSTRAINT "CronRun_cronJobId_fkey" FOREIGN KEY ("cronJobId") REFERENCES "CronJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;
