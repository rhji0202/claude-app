import { Injectable, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";
import { GlobalRole } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import type { AuthUser } from "./current-user.decorator";

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
      secretOrKey: config.get<string>("JWT_SECRET") ?? "change-me",
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
