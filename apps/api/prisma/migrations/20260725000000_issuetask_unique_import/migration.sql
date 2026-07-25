-- 중복 GitHub 이슈 import 방지: (projectId, repo, issueNumber) 유일 제약.
-- issueNumber가 NULL인 행(MANUAL/REPORT 등록)은 Postgres UNIQUE에서 서로 구별되므로
-- 제약 대상이 아니다 → 수동 이슈는 개수 제한 없음.

-- 제약 생성 전, 기존에 쌓였을 수 있는 중복 행 정리(각 키에서 가장 먼저 생성된 1건만 유지).
DELETE FROM "IssueTask" a
USING "IssueTask" b
WHERE a."issueNumber" IS NOT NULL
  AND a."projectId" = b."projectId"
  AND a."repo" = b."repo"
  AND a."issueNumber" = b."issueNumber"
  AND (a."createdAt" > b."createdAt"
       OR (a."createdAt" = b."createdAt" AND a."id" > b."id"));

-- CreateIndex
CREATE UNIQUE INDEX "IssueTask_projectId_repo_issueNumber_key" ON "IssueTask"("projectId", "repo", "issueNumber");
