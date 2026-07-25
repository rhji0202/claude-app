import { z } from "zod";

/**
 * 환경변수 검증 스키마. 부팅 시 @nestjs/config가 이 함수로 검증한다.
 */
export const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().default(3001),
  DATABASE_URL: z.string().min(1, "DATABASE_URL이 필요합니다."),
  // 32바이트 base64 마스터 키 (openssl rand -base64 32)
  ENCRYPTION_KEY: z
    .string()
    .min(1, "ENCRYPTION_KEY가 필요합니다. (openssl rand -base64 32)"),
  // 32자 이상 강제. 약한/미설정 시크릿으로 토큰 위조되는 것을 부팅 시 차단.
  JWT_SECRET: z
    .string()
    .min(32, "JWT_SECRET은 32자 이상이어야 합니다. (openssl rand -base64 32)"),
  JWT_EXPIRES_IN: z.string().default("7d"),
  // 활성 Claude 계정이 없을 때의 폴백 OAuth 토큰 (선택, sk-ant-oat...)
  ANTHROPIC_OAUTH_TOKEN: z.string().optional(),
  // 실행 기본 모델(계정별 지정이 없을 때). 예: claude-opus-5 또는 alias opus/sonnet/haiku.
  ANTHROPIC_MODEL: z.string().default("claude-opus-5"),
  // 실행 기본 reasoning effort. low|medium|high|xhigh|max.
  ANTHROPIC_EFFORT: z
    .enum(["low", "medium", "high", "xhigh", "max"])
    .default("high"),
  WEB_ORIGIN: z.string().optional(),
  // 부팅 시 admin으로 승격할 이메일(쉼표 구분). 첫 관리자 부트스트랩.
  ADMIN_EMAILS: z.string().optional(),
  // 업로드(이슈 이미지) 저장 루트. 미설정 시 apps/api/uploads.
  UPLOADS_DIR: z.string().optional(),
  // 동시에 실행할 에이전트 수 상한 (에이전트 1개 = CLI 서브프로세스 1개)
  AGENT_CONCURRENCY: z.coerce.number().int().positive().default(3),
  // ---- 이슈 큐/워커 ----
  // 워커 폴링 주기(ms). 0 이하면 폴링 비활성.
  ISSUE_WORKER_POLL_MS: z.coerce.number().int().nonnegative().default(5000),
  // 실패/중단 이슈 자동 재시도 최대 횟수
  ISSUE_MAX_RETRY: z.coerce.number().int().nonnegative().default(2),
  // 이슈 실행 최대 턴 수(에이전트 왕복). 넉넉히 잡아 조사+수정+요약이 한 실행에 끝나게 한다.
  ISSUE_MAX_TURNS: z.coerce.number().int().positive().default(300),
  // stale 클레임 회수 임계(ms). RUNNING인데 이 시간 넘게 갱신 없으면 회수(INTERRUPTED).
  // maxTurns가 크면 실행이 길어지므로 넉넉히(기본 30분).
  ISSUE_STALE_MS: z.coerce.number().int().positive().default(1800000),
  // 월 예산 임박 경고 임계 비율(spent/budget). 이 비율 도달 시 초과 전 1회 경고.
  BUDGET_WARN_RATIO: z.coerce.number().positive().max(1).default(0.8),
  // per-run worktree 루트. 미설정 시 apps/api/worktrees.
  ISSUE_WORKTREE_ROOT: z.string().optional(),
  // 시스템 관리 clone 루트. 미설정 시 apps/api/repos. UPLOADS_DIR와 분리 필수(정적 노출 방지).
  REPOS_DIR: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(config: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(config);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`환경변수 검증 실패:\n${issues}`);
  }
  return parsed.data;
}
