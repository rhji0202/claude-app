-- 채팅 세션을 전용 worktree에서 실행할지 여부.
-- true면 clone base 대신 `chat/<세션id>` 브랜치의 worktree를 cwd로 쓴다.
-- 기존 세션은 지금까지의 동작(clone base)을 유지해야 하므로 기본값 false.
ALTER TABLE "ChatSession" ADD COLUMN "useWorktree" BOOLEAN NOT NULL DEFAULT false;
