import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { GhIssuesClient } from "./GhIssuesClient";

/**
 * GitHub Issue 뷰어 페이지 (`/github-issues`).
 *
 * ⚠️ 절대 규칙 — 사이드바의 "이슈"(`/issues`, 에이전트 실행 큐)와
 * 완전히 별개인 기능이다. 두 화면은 컴포넌트·API·상태를 공유하지 않는다.
 * docs/rules/github-issue-separation.md 참고.
 *
 * 목록 상태를 URL 쿼리로 관리하므로 useSearchParams 사용을 위해 Suspense로 감싼다.
 */
export default function GithubIssuesPage() {
  return (
    <Suspense
      fallback={
        <div className="space-y-4">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-9 w-full max-w-md" />
          <Skeleton className="h-64 w-full" />
        </div>
      }
    >
      <GhIssuesClient />
    </Suspense>
  );
}
