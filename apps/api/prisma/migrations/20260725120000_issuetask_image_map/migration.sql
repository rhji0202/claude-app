-- 본문 이미지 원본 URL → 저장 상대경로 매핑.
-- GitHub 이슈를 import할 때 첨부 이미지는 이미 로컬로 다운로드되지만(images[]),
-- 본문(body)에는 원본 GitHub URL이 남아 브라우저에서 403/404로 깨졌다.
-- 치환에 필요한 URL↔경로 대응을 보관한다(nullable → 기존 행은 NULL, 백필 불필요).
ALTER TABLE "IssueTask" ADD COLUMN "imageMap" JSONB;
