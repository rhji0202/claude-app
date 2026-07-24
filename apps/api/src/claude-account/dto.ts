import {
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  MinLength,
} from "class-validator";

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
  /** "" → 전역 기본 사용, 값 → 모델 id/alias */
  @IsOptional() @IsString() model?: string;
  /** "" → 전역 기본, 값 → effort 레벨 */
  @IsOptional()
  @IsIn(["", "low", "medium", "high", "xhigh", "max"])
  effort?: string;
  /** 이 계정의 월 예산(USD). null → 무제한. 0 이상. */
  @IsOptional()
  @IsNumber()
  @Min(0)
  monthlyBudgetUsd?: number | null;
}
