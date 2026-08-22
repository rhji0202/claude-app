-- 결정 대기 질문을 GitHub 이슈 코멘트로 물어본 URL.
-- 있으면 다시 물어보지 않고 링크만 보여준다(중복 게시 방지).
-- 기존 이슈는 물어본 적이 없으므로 null.
ALTER TABLE "IssueTask" ADD COLUMN "decisionCommentUrl" TEXT;
