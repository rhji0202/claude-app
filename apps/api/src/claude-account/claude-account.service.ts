import {
  BadRequestException,
  Injectable,
  Logger,
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
  /** 이 계정으로 실행 시 모델·effort(미지정 시 null → 전역 기본) */
  model: string | null;
  effort: string | null;
  /** 이 계정의 월 예산(USD). null → 무제한. */
  monthlyBudgetUsd: number | null;
  createdAt: string;
}

/** 실행에 쓸 모델·effort (계정 지정값 또는 null). */
export interface ModelConfig {
  model: string | null;
  effort: string | null;
}

@Injectable()
export class ClaudeAccountService {
  private readonly logger = new Logger(ClaudeAccountService.name);

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

  /**
   * 사용자의 활성 계정 id(복호화 없이). 사용량 귀속용 — 활성 계정이 없으면 null.
   */
  async getActiveAccountId(userId: string): Promise<string | null> {
    const acc = await this.prisma.claudeAccount.findFirst({
      where: { userId, isActive: true },
      select: { id: true },
    });
    return acc?.id ?? null;
  }

  /**
   * 특정 계정 id의 액세스 토큰(복호화). 프로젝트 지정 계정 실행용. 없으면 null.
   *
   * expectedUserId가 주어지면 계정 소유자가 그 사용자와 일치할 때만 반환한다
   * (confused-deputy 방지: 실행 경로가 다른 사용자의 계정 토큰을 임의 id로
   * 복호화하지 못하도록 읽기 시점에도 소유권을 재확인). 소유자 불일치면 null.
   */
  async getTokenById(
    accountId: string,
    expectedUserId?: string | null,
  ): Promise<string | null> {
    const acc = await this.prisma.claudeAccount.findUnique({
      where: { id: accountId },
    });
    if (!acc) return null;
    if (expectedUserId && acc.userId !== expectedUserId) {
      this.logger.warn(
        `계정 ${accountId} 소유권 불일치(소유자≠${expectedUserId}) — 토큰 반환 거부`,
      );
      return null;
    }
    return this.crypto.decryptOptional(acc.accessTokenEnc);
  }

  private toDto(a: {
    id: string;
    label: string;
    accountEmail: string | null;
    subscriptionType: string | null;
    accessTokenEnc: string;
    isActive: boolean;
    model: string | null;
    effort: string | null;
    monthlyBudgetUsd: number | null;
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
      model: a.model,
      effort: a.effort,
      monthlyBudgetUsd: a.monthlyBudgetUsd,
      createdAt: a.createdAt.toISOString(),
    };
  }

  /** 계정의 라벨·모델·effort 수정. 본인 계정만. */
  async update(
    id: string,
    userId: string,
    data: {
      label?: string;
      model?: string | null;
      effort?: string | null;
      monthlyBudgetUsd?: number | null;
    },
  ): Promise<ClaudeAccountDto> {
    const acc = await this.prisma.claudeAccount.findFirst({
      where: { id, userId },
    });
    if (!acc) throw new NotFoundException("계정을 찾을 수 없습니다.");
    const updated = await this.prisma.claudeAccount.update({
      where: { id },
      data: {
        ...(data.label !== undefined ? { label: data.label } : {}),
        // "" → null(전역 기본), 값 → 지정
        ...(data.model !== undefined ? { model: data.model || null } : {}),
        ...(data.effort !== undefined ? { effort: data.effort || null } : {}),
        // 0/null → 무제한(null), 양수 → 예산
        ...(data.monthlyBudgetUsd !== undefined
          ? { monthlyBudgetUsd: data.monthlyBudgetUsd || null }
          : {}),
      },
    });
    return this.toDto(updated);
  }

  /**
   * 실행에 쓸 모델·effort 해석: 프로젝트 지정 계정 → 실행 사용자 활성 계정 순.
   * 계정에 지정이 없으면 null(호출부가 env 기본값으로 폴백).
   */
  async getModelConfig(
    userId: string | undefined,
    accountId?: string | null,
  ): Promise<ModelConfig> {
    const acc =
      (accountId
        ? await this.prisma.claudeAccount.findUnique({ where: { id: accountId } })
        : null) ??
      (userId
        ? await this.prisma.claudeAccount.findFirst({
            where: { userId, isActive: true },
          })
        : null);
    return { model: acc?.model ?? null, effort: acc?.effort ?? null };
  }
}
