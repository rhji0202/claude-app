-- 공유 링크로 이슈를 등록할 때, 본문에 이미지를 붙여넣는 순간 업로드 대상 이슈 id가
-- 필요하다. 그래서 제목 입력 전에 빈 초안을 먼저 만드는데, 이 초안이 QUEUED면
-- 워커가 곧바로 집어 빈 이슈를 실행해 버린다. INTERRUPTED로 두는 방법도
-- requeueRetryable이 백오프 후 QUEUED로 되돌리므로 안전하지 않다.
--
-- 워커의 조회 조건(QUEUED / ERROR·INTERRUPTED)에 걸리지 않는 별도 상태를 둔다.
-- 기존 행은 이 값을 쓰지 않으므로 백필이 필요 없다.
ALTER TYPE "IssueStatus" ADD VALUE 'DRAFT';
