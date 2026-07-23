-- AlterTable
ALTER TABLE "IssueTask" ADD COLUMN     "category" TEXT;

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "autoTriage" BOOLEAN NOT NULL DEFAULT false;
