import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as bcrypt from "bcryptjs";
import { GlobalRole, User as PrismaUser } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import type { User as UserDto } from "@claude-app/shared";
import { CreateUserDto, UpdateUserDto } from "./admin.dto";

@Injectable()
export class AdminService implements OnModuleInit {
  private readonly logger = new Logger(AdminService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /** 첫 관리자 부트스트랩: ADMIN_EMAILS의 기존 사용자를 admin으로 승격(멱등). */
  async onModuleInit(): Promise<void> {
    const raw = this.config.get<string>("ADMIN_EMAILS");
    if (!raw) return;
    const emails = raw
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean);
    if (emails.length === 0) return;
    const res = await this.prisma.user.updateMany({
      where: {
        email: { in: emails },
        role: { not: GlobalRole.ADMIN },
      },
      data: { role: GlobalRole.ADMIN },
    });
    if (res.count > 0)
      this.logger.log(`ADMIN_EMAILS: ${res.count}명을 admin으로 승격`);
  }

  private toDto(u: PrismaUser): UserDto {
    return {
      id: u.id,
      email: u.email,
      name: u.name,
      role: u.role === GlobalRole.ADMIN ? "admin" : "member",
      disabled: u.disabled,
      createdAt: u.createdAt.toISOString(),
    };
  }

  async list(): Promise<UserDto[]> {
    const rows = await this.prisma.user.findMany({
      orderBy: { createdAt: "asc" },
    });
    return rows.map((u) => this.toDto(u));
  }

  async create(dto: CreateUserDto): Promise<UserDto> {
    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (existing) throw new ConflictException("이미 가입된 이메일입니다.");
    const passwordHash = await bcrypt.hash(dto.password, 10);
    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        name: dto.name,
        passwordHash,
        role: dto.role === "admin" ? GlobalRole.ADMIN : GlobalRole.MEMBER,
      },
    });
    return this.toDto(user);
  }

  /** 활성(비활성화 안 된) admin 수 */
  private async activeAdminCount(): Promise<number> {
    return this.prisma.user.count({
      where: { role: GlobalRole.ADMIN, disabled: false },
    });
  }

  async update(
    id: string,
    dto: UpdateUserDto,
    actorUserId: string,
  ): Promise<UserDto> {
    const target = await this.prisma.user.findUnique({ where: { id } });
    if (!target) throw new NotFoundException("사용자를 찾을 수 없습니다.");

    const willDemote =
      dto.role === "member" && target.role === GlobalRole.ADMIN;
    const willDisable = dto.disabled === true && !target.disabled;

    // 마지막 활성 admin을 강등/비활성화하면 관리 불능 → 차단
    if ((willDemote || willDisable) && target.role === GlobalRole.ADMIN) {
      const admins = await this.activeAdminCount();
      if (admins <= 1) {
        throw new BadRequestException(
          "마지막 관리자는 강등하거나 비활성화할 수 없습니다.",
        );
      }
    }
    // 자기 자신을 비활성화하는 것도 방지(실수 잠금 방지)
    if (dto.disabled === true && id === actorUserId) {
      throw new BadRequestException("자신의 계정은 비활성화할 수 없습니다.");
    }

    const data: {
      name?: string;
      role?: GlobalRole;
      disabled?: boolean;
    } = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.role !== undefined)
      data.role = dto.role === "admin" ? GlobalRole.ADMIN : GlobalRole.MEMBER;
    if (dto.disabled !== undefined) data.disabled = dto.disabled;

    const updated = await this.prisma.user.update({ where: { id }, data });
    return this.toDto(updated);
  }
}
