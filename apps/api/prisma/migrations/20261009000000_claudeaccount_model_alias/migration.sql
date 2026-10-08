-- 계정별 모델을 버전 고정 id에서 계열 별칭으로 옮긴다(예: claude-opus-5 → opus).
-- 별칭은 Agent SDK가 실행 시점에 그 계열의 최신 모델로 풀어, 새 모델이 나와도
-- 목록을 고치지 않고 따라간다. 알 수 없는 값은 그대로 둔다.
UPDATE "ClaudeAccount"
SET "model" = CASE
    WHEN "model" LIKE 'claude-opus-%'   THEN 'opus'
    WHEN "model" LIKE 'claude-sonnet-%' THEN 'sonnet'
    WHEN "model" LIKE 'claude-haiku-%'  THEN 'haiku'
    WHEN "model" LIKE 'claude-fable-%'  THEN 'fable'
    ELSE "model"
  END
WHERE "model" LIKE 'claude-%';
