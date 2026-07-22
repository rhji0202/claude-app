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
  // 프로젝트가 자체 키를 갖지 않을 때의 폴백 (선택)
  ANTHROPIC_API_KEY: z.string().optional(),
  WEB_ORIGIN: z.string().optional(),
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
