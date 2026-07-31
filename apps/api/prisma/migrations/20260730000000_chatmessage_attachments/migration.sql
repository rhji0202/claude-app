-- 채팅 메시지 첨부(이미지·파일) 메타. user 메시지에만 채워진다.
-- [{ kind: "image"|"file", relPath, name }] 형태이며 응답 시 서명 URL로 변환한다.
ALTER TABLE "ChatMessage" ADD COLUMN "attachments" JSONB;
