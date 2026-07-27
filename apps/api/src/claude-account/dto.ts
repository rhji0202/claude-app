import {
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  MinLength,
} from "class-validator";
import { EFFORT_LEVELS, MODEL_IDS } from "@claude-app/shared";

export class AddAccountDto {
  /** claude setup-token으로 발급받은 sk-ant-oat01-... 토큰 */
  @IsString()
  @MinLength(1)
  token!: string;

  @IsOptional()
  @IsString()
  label?: string;
}

export class UpdateAccountDto {
  @IsOptional() @IsString() @MinLength(1) label?: string;
  /** "" → 전역 기본 사용, 값 → 모델 id */
  @IsOptional()
  @IsIn(["", ...MODEL_IDS])
  model?: string;
  /**
   * "" → 전역 기본, 값 → effort 레벨.
   * effort 미지원 모델(Haiku 등)과의 조합은 서비스 계층에서 비운다.
   */
  @IsOptional()
  @IsIn(["", ...EFFORT_LEVELS])
  effort?: string;
  /** 이 계정의 월 예산(USD). null → 무제한. 0 이상. */
  @IsOptional()
  @IsNumber()
  @Min(0)
  monthlyBudgetUsd?: number | null;
}
