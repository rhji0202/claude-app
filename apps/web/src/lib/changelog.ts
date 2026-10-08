/**
 * 대시보드 체인지로그 데이터. 사용자에게 보이는 변경만 날짜별로 적는다.
 * 새 릴리스는 배열 맨 앞에 추가한다(최신순).
 */

export type ChangeKind = "new" | "improved" | "fixed";

export interface ChangelogEntry {
  date: string; // YYYY-MM-DD
  changes: { kind: ChangeKind; text: string }[];
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    date: "2026-10-08",
    changes: [
      { kind: "new", text: "분석 후 진행 — 에이전트가 이슈를 분석해 질문하고, 답으로 정한 기획안을 승인하면 작업" },
      { kind: "new", text: "GitHub Issue에서 '바로 처리'·'분석 후 진행'으로 이슈 화면에 넘겨 에이전트로 처리" },
      { kind: "new", text: "이슈 실행을 대화형 화면·다이얼로그로 보고, 실행 중 중지" },
      { kind: "new", text: "대시보드에 체인지로그 섹션 추가" },
      { kind: "new", text: "더원 에이전트 로고 추가 — 사이드바·상단바·파비콘" },
      { kind: "improved", text: "채팅을 대화형 화면(말풍선·진행 표시·마크다운 답변)으로 개편" },
      { kind: "improved", text: "결정 대기 이슈는 실행 결과·이력을 감추고 에이전트 질문만 표시" },
      { kind: "improved", text: "이슈 목록의 실행 상태를 '명령 실행 중'처럼 간단히 표시" },
      { kind: "fixed", text: "배포 환경에서 사이드바 로고가 보이지 않던 문제" },
    ],
  },
  {
    date: "2026-08-22",
    changes: [
      { kind: "improved", text: "결정 대기 질문을 비개발자도 선택지로 고를 수 있게 개선하고 GitHub에도 질문 등록" },
    ],
  },
  {
    date: "2026-07-31",
    changes: [
      { kind: "new", text: "채팅에 첨부 업로드 지원, 이슈에서 대화로 이어가기(전용 worktree)" },
      { kind: "new", text: "완료·오류·중단된 이슈도 대화로 이어가기" },
      { kind: "improved", text: "첨부 허용 형식 확대" },
      { kind: "fixed", text: "채팅 첨부 이미지 유실·텍스트 중복 출력" },
    ],
  },
  {
    date: "2026-07-30",
    changes: [
      { kind: "new", text: "채팅을 CLI 트랜스크립트 형태로 표시하고 진행 상황을 실시간 반영" },
      { kind: "improved", text: "채팅 최대 턴 수를 300으로 상향" },
      { kind: "fixed", text: "에이전트 답변이 두 번 출력되거나 텍스트가 갈라지는 문제" },
      { kind: "fixed", text: "에이전트 실행 환경에 호스트 설정·환경변수가 새는 문제" },
    ],
  },
  {
    date: "2026-07-28",
    changes: [
      { kind: "new", text: "GitHub Issue 뷰어 메뉴 추가" },
      { kind: "improved", text: "콘텐츠 여백 통일, 등록 폼을 레이어 팝업으로 전환" },
    ],
  },
  {
    date: "2026-07-27",
    changes: [
      { kind: "improved", text: "공유 페이지 이슈 등록에 마크다운 에디터 적용, 상태 한글화" },
      { kind: "fixed", text: "실행 오류 문구가 표시되지 않던 문제" },
      { kind: "fixed", text: "effort 미지원 모델에서 실행이 실패하던 문제" },
    ],
  },
  {
    date: "2026-07-25",
    changes: [
      { kind: "new", text: "Opus 5 / Fable 5 모델 추가, 기본 모델을 Opus 5로 변경" },
      { kind: "new", text: "이슈 목록 상태 필터와 상세 다이얼로그" },
      { kind: "improved", text: "이슈 이력 노트를 마크다운 카드로 표시하고 접기 지원" },
      { kind: "fixed", text: "이슈 본문의 GitHub 첨부 이미지가 깨지는 문제" },
      { kind: "fixed", text: "보안·정합성 점검 후 7건 수정" },
    ],
  },
  {
    date: "2026-07-24",
    changes: [
      { kind: "improved", text: "앱 이름을 \"더원 에이전트\"로 변경" },
      { kind: "improved", text: "이슈 결과 보고 형식 개선, 진행 상황 실시간 표시" },
      { kind: "fixed", text: "결정 대기 선택지(A/B/C)가 잘리던 문제" },
    ],
  },
  {
    date: "2026-07-23",
    changes: [
      { kind: "new", text: "실행 비용·토큰 사용량 추적과 월 예산 가드레일" },
      { kind: "new", text: "계정별 실행 모델·effort 선택" },
      { kind: "new", text: "GitHub 이슈 자동 가져오기 크론" },
      { kind: "new", text: "이슈 결정 대기·메모·재개, GitHub triage 자동 분류" },
      { kind: "new", text: "이슈 큐 워커·worktree 격리·PR 자동 생성, webhook 알림(WeCom 포함)" },
      { kind: "improved", text: "이슈 목록 UI 정리 — 진행 타임라인, 추가 지시 입력, 아이콘 버튼" },
    ],
  },
  {
    date: "2026-07-22",
    changes: [
      { kind: "new", text: "더원 에이전트 첫 공개 — 프로젝트·이슈·크론·스킬·MCP 관리" },
      { kind: "new", text: "로그인, 프로젝트 팀 공유, 공유 링크로 테스터 이슈 등록" },
      { kind: "new", text: "Claude 계정·채팅·사용자 관리" },
    ],
  },
];
