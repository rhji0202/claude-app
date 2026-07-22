import { Body, Controller, Get, Patch, Post } from "@nestjs/common";
import { AuthService } from "./auth.service";
import { LoginDto } from "./auth.dto";
import { UpdateProfileDto } from "./update-profile.dto";
import { Public } from "./public.decorator";
import { CurrentUser, type AuthUser } from "./current-user.decorator";

@Controller("auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  // 자가 회원가입은 닫혀 있음. 계정 생성은 관리자만 (POST /admin/users).
  @Public()
  @Post("login")
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto);
  }

  @Get("me")
  me(@CurrentUser() user: AuthUser) {
    return this.auth.me(user.userId);
  }

  /** 셀프 프로필 편집 (이름/비밀번호) */
  @Patch("me")
  updateMe(@Body() dto: UpdateProfileDto, @CurrentUser() user: AuthUser) {
    return this.auth.updateProfile(user.userId, dto);
  }
}
