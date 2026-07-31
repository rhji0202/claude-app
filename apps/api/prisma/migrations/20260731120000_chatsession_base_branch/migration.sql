-- 채팅 worktree를 만들 기준 브랜치.
-- 이슈에서 이어받은 대화는 그 이슈의 `issue/<이슈id>`를 가리켜 작업물을 이어받는다.
-- null이면 프로젝트 기본 브랜치를 쓴다(기존 동작).
ALTER TABLE "ChatSession" ADD COLUMN "baseBranch" TEXT;
