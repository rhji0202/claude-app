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
  JWT_SECRET: z.string().min(1, "JWT_SECRET이 필요합니다."),
  JWT_EXPIRES_IN: z.string().default("7d"),
  // 활성 Claude 계정이 없을 때의 폴백 OAuth 토큰 (선택, sk-ant-oat...)
  ANTHROPIC_OAUTH_TOKEN: z.string().optional(),
  WEB_ORIGIN: z.string().optional(),
  // 부팅 시 admin으로 승격할 이메일(쉼표 구분). 첫 관리자 부트스트랩.
  ADMIN_EMAILS: z.string().optional(),
  // 업로드(이슈 이미지) 저장 루트. 미설정 시 apps/api/uploads.
  UPLOADS_DIR: z.string().optional(),
  // 동시에 실행할 에이전트 수 상한 (에이전트 1개 = CLI 서브프로세스 1개)
  AGENT_CONCURRENCY: z.coerce.number().int().positive().default(3),
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
