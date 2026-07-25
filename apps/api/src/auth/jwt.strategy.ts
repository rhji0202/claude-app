import { Injectable, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";
import { GlobalRole } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import type { AuthUser } from "./current-user.decorator";
import { requireJwtSecret } from "./jwt-secret.util";

interface JwtPayload {
  sub: string;
  email: string;
  role?: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      // env 검증(min 32)을 통과하면 항상 존재. 검증 우회 시 예측 가능한
      // 기본값으로 폴백하지 않고 부팅을 실패시킨다.
      secretOrKey: requireJwtSecret(config),
    });
  }

  /**
   * 토큰 서명 검증 후, DB에서 role/disabled를 재확인한다.
   * → 비활성화·역할변경이 기존 토큰에도 즉시 반영된다.
   */
  async validate(payload: JwtPayload): Promise<AuthUser> {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, email: true, role: true, disabled: true },
    });
    if (!user || user.disabled) {
      throw new UnauthorizedException("비활성화되었거나 존재하지 않는 계정입니다.");
    }
    return {
      userId: user.id,
      email: user.email,
      role: user.role === GlobalRole.ADMIN ? "admin" : "member",
    };
  }
}
