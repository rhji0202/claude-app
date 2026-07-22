import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { ADMIN_ONLY_KEY } from "./admin.decorator";
import type { AuthUser } from "./current-user.decorator";

/**
 * @AdminOnly()가 붙은 라우트/컨트롤러는 전역 admin만 통과.
 * JwtAuthGuard 다음에 동작한다(전역 APP_GUARD 등록 순서).
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const adminOnly = this.reflector.getAllAndOverride<boolean>(ADMIN_ONLY_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!adminOnly) return true;

    const user = ctx.switchToHttp().getRequest<{ user?: AuthUser }>().user;
    if (user?.role !== "admin") {
      throw new ForbiddenException("관리자만 접근할 수 있습니다.");
    }
    return true;
  }
}
