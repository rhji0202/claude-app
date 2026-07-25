/**
 * E2E 부팅 전 env 주입. AppModule의 ConfigModule 검증(env.validation)을 통과시킨다.
 * DATABASE_URL은 실행 중인 docker Postgres를 재사용(.env에 이미 있으면 유지).
 */
process.env.NODE_ENV = "test";
process.env.ENCRYPTION_KEY =
  process.env.ENCRYPTION_KEY || "dGVzdC1lbmNyeXB0aW9uLWtleS0zMmJ5dGVzLWxlbiE="; // 32 bytes base64
process.env.JWT_SECRET =
  process.env.JWT_SECRET || "test-jwt-secret-at-least-32-characters-long";
process.env.JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "1h";
process.env.DATABASE_URL =
  process.env.DATABASE_URL ||
  "postgresql://claude:claude@localhost:5432/claude_management?schema=public";
// 활성 계정/폴백 없이도 부팅되도록 OAuth 토큰은 미설정 유지
delete process.env.ANTHROPIC_OAUTH_TOKEN;
