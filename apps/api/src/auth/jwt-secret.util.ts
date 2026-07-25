import { ConfigService } from "@nestjs/config";

/**
 * JWT_SECRET을 반환한다. 없으면(=env 검증 우회 등) 예측 가능한 기본값으로
 * 폴백하지 않고 즉시 실패시킨다. env 검증(min 32)을 통과하면 항상 존재.
 */
export function requireJwtSecret(config: ConfigService): string {
  const secret = config.get<string>("JWT_SECRET");
  if (!secret) throw new Error("JWT_SECRET이 설정되지 않았습니다.");
  return secret;
}
