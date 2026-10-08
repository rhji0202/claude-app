-- 이슈 처리 모드(바로 처리 / 분석 후 진행)와 분석 후 진행의 단계·산출물.
-- 기존 이슈는 모두 바로 처리(DIRECT)로 둔다.
CREATE TYPE "IssueMode" AS ENUM ('DIRECT', 'PLAN');
CREATE TYPE "PlanStage" AS ENUM ('INTERVIEW', 'REVIEW', 'APPROVED');

ALTER TABLE "IssueTask"
  ADD COLUMN "mode" "IssueMode" NOT NULL DEFAULT 'DIRECT',
  ADD COLUMN "planStage" "PlanStage",
  ADD COLUMN "interview" JSONB,
  ADD COLUMN "plan" TEXT,
  ADD COLUMN "planCommentUrl" TEXT,
  ADD COLUMN "forcePlan" BOOLEAN NOT NULL DEFAULT false;
