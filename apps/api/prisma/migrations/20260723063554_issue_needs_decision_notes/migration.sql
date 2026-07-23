-- CreateEnum
CREATE TYPE "IssueNoteAuthor" AS ENUM ('HUMAN', 'AGENT', 'SYSTEM');

-- AlterEnum
ALTER TYPE "IssueStatus" ADD VALUE 'NEEDS_DECISION';

-- CreateTable
CREATE TABLE "IssueNote" (
    "id" TEXT NOT NULL,
    "issueId" TEXT NOT NULL,
    "author" "IssueNoteAuthor" NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IssueNote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "IssueNote_issueId_idx" ON "IssueNote"("issueId");

-- AddForeignKey
ALTER TABLE "IssueNote" ADD CONSTRAINT "IssueNote_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "IssueTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;
