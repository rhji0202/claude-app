import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { CryptoService } from "../crypto/crypto.service";

export interface ClaudeAccountDto {
  id: string;
  label: string;
  accountEmail: string | null;
  subscriptionType: string | null;
  isActive: boolean;
  tokenPreview: string;
  createdAt: string;
}

@Injectable()
export class ClaudeAccountService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  /**
   * 토큰 붙여넣기로 계정 추가.
   * 사용자가 로컬에서 `claude setup-token`을 실행해 얻은 1년짜리
   * `sk-ant-oat01-` 토큰(또는 sk-ant-api03- API 키)을 저장한다. 첫 계정은 자동 활성화.
   */
  async addAccount(
    userId: string,
    token: string,
    label?: string,
  ): Promise<ClaudeAccountDto> {
    const trimmed = token.trim();
    if (!trimmed.startsWith("sk-ant-"))
      throw new BadRequestException(
        "올바른 토큰이 아닙니다. sk-ant-oat01-... (또는 sk-ant-api03-...) 형식이어야 합니다.",
      );

    const existingCount = await this.prisma.claudeAccount.count({
      where: { userId },
    });
    const account = await this.prisma.claudeAccount.create({
      data: {
        userId,
        label: label?.trim() || `Claude 계정 ${existingCount + 1}`,
        accessTokenEnc: this.crypto.encrypt(trimmed),
        scopes: [],
        isActive: existingCount === 0,
      },
    });
    return this.toDto(account);
  }

  async list(userId: string): Promise<ClaudeAccountDto[]> {
    const rows = await this.prisma.claudeAccount.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
    });
    return rows.map((r) => this.toDto(r));
  }

  async activate(userId: string, id: string): Promise<void> {
    const acc = await this.prisma.claudeAccount.findFirst({
      where: { id, userId },
    });
    if (!acc) throw new NotFoundException("계정을 찾을 수 없습니다.");
    await this.prisma.$transaction([
      this.prisma.claudeAccount.updateMany({
        where: { userId },
        data: { isActive: false },
      }),
      this.prisma.claudeAccount.update({
        where: { id },
        data: { isActive: true },
      }),
    ]);
  }

  async remove(userId: string, id: string): Promise<void> {
    const acc = await this.prisma.claudeAccount.findFirst({
      where: { id, userId },
    });
    if (!acc) throw new NotFoundException("계정을 찾을 수 없습니다.");
    await this.prisma.claudeAccount.delete({ where: { id } });
    // 활성 계정을 지웠다면 가장 최근 계정을 활성화
    if (acc.isActive) {
      const next = await this.prisma.claudeAccount.findFirst({
        where: { userId },
        orderBy: { createdAt: "desc" },
      });
      if (next)
        await this.prisma.claudeAccount.update({
          where: { id: next.id },
          data: { isActive: true },
        });
    }
  }

  /**
   * 사용자의 활성 계정 액세스 토큰(복호화). 없으면 null (호출부가 .env 폴백 처리).
   */
  async getActiveToken(userId: string): Promise<string | null> {
    const acc = await this.prisma.claudeAccount.findFirst({
      where: { userId, isActive: true },
    });
    if (!acc) return null;
    return this.crypto.decryptOptional(acc.accessTokenEnc);
  }

  /** 특정 계정 id의 액세스 토큰(복호화). 프로젝트 지정 계정 실행용. 없으면 null. */
  async getTokenById(accountId: string): Promise<string | null> {
    const acc = await this.prisma.claudeAccount.findUnique({
      where: { id: accountId },
    });
    if (!acc) return null;
    return this.crypto.decryptOptional(acc.accessTokenEnc);
  }

  private toDto(a: {
    id: string;
    label: string;
    accountEmail: string | null;
    subscriptionType: string | null;
    accessTokenEnc: string;
    isActive: boolean;
    createdAt: Date;
  }): ClaudeAccountDto {
    // 토큰 프리뷰: 앞 12자 + …(값은 절대 전체 노출 안 함). 복호화 실패 시 표시만 생략.
    let preview = "sk-ant-…";
    const plain = this.crypto.decryptOptional(a.accessTokenEnc);
    if (plain) preview = `${plain.slice(0, 14)}…`;
    return {
      id: a.id,
      label: a.label,
      accountEmail: a.accountEmail,
      subscriptionType: a.subscriptionType,
      isActive: a.isActive,
      tokenPreview: preview,
      createdAt: a.createdAt.toISOString(),
    };
  }
}
