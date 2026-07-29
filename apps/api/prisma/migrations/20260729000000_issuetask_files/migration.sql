-- 이미지가 아닌 첨부 파일(엑셀·PDF 등) 목록. `<상대경로>|<원본파일명>` 형식.
ALTER TABLE "IssueTask" ADD COLUMN "files" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- 기존 행은 NULL이 아닌 빈 배열로 맞춘다(코드가 항상 배열을 기대).
UPDATE "IssueTask" SET "files" = ARRAY[]::TEXT[] WHERE "files" IS NULL;
