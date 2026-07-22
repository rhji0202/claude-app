import { Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import * as bcrypt from "bcryptjs";
import { User as PrismaUser } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import type { AuthResult, User as UserDto } from "@claude-app/shared";
import { LoginDto } from "./auth.dto";

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  private toDto(u: PrismaUser): UserDto {
    return {
      id: u.id,
      email: u.email,
      name: u.name,
      role: u.role === "ADMIN" ? "admin" : "member",
      disabled: u.disabled,
      createdAt: u.createdAt.toISOString(),
    };
  }

  private issue(u: PrismaUser): AuthResult {
    const accessToken = this.jwt.sign({
      sub: u.id,
      email: u.email,
      role: u.role,
    });
    return { accessToken, user: this.toDto(u) };
  }

  async login(dto: LoginDto): Promise<AuthResult> {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (!user) throw new UnauthorizedException("이메일 또는 비밀번호가 올바르지 않습니다.");
    if (user.disabled)
      throw new UnauthorizedException("비활성화된 계정입니다. 관리자에게 문의하세요.");
    const ok = await bcrypt.compare(dto.password, user.passwordHash);
    if (!ok) throw new UnauthorizedException("이메일 또는 비밀번호가 올바르지 않습니다.");
    return this.issue(user);
  }

  async me(userId: string): Promise<UserDto> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException();
    return this.toDto(user);
  }

  /** 셀프 프로필 편집: 이름/비밀번호. 비밀번호 변경 시 현재 비번 확인. */
  async updateProfile(
    userId: string,
    dto: { name?: string; currentPassword?: string; newPassword?: string },
  ): Promise<UserDto> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException();

    const data: { name?: string; passwordHash?: string } = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.newPassword) {
      const ok =
        dto.currentPassword &&
        (await bcrypt.compare(dto.currentPassword, user.passwordHash));
      if (!ok)
        throw new UnauthorizedException("현재 비밀번호가 올바르지 않습니다.");
      data.passwordHash = await bcrypt.hash(dto.newPassword, 10);
    }
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data,
    });
    return this.toDto(updated);
  }
}
