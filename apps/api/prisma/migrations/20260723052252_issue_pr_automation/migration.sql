-- AlterTable
ALTER TABLE "IssueTask" ADD COLUMN     "prUrl" TEXT;

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "autoPr" BOOLEAN NOT NULL DEFAULT false;
