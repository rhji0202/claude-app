import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { JwtModule } from "@nestjs/jwt";
import { PassportModule } from "@nestjs/passport";
import { AuthService } from "./auth.service";
import { AuthController } from "./auth.controller";
import { JwtStrategy } from "./jwt.strategy";
import { JwtAuthGuard } from "./jwt-auth.guard";
import { RolesGuard } from "./roles.guard";
import { requireJwtSecret } from "./jwt-secret.util";

@Module({
  imports: [
    PassportModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: requireJwtSecret(config),
        // '7d' 등 ms 문자열. @nestjs/jwt v11의 StringValue 타입 회피 위해 캐스팅.
        signOptions: {
          expiresIn: (config.get<string>("JWT_EXPIRES_IN") ?? "7d") as `${number}d`,
        },
      }),
    }),
  ],
  providers: [
    AuthService,
    JwtStrategy,
    // 전역 JWT 가드 (@Public 라우트는 우회) — authn
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    // 전역 역할 가드 (@AdminOnly 라우트만 admin 요구) — authz, JWT 가드 다음
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
  controllers: [AuthController],
})
export class AuthModule {}
