import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  MinLength,
} from "class-validator";
import type { ProjectVisibility } from "@claude-app/shared";

/**
 * 부분 수정. 시크릿 필드는:
 *  - 미지정(undefined) → 기존 값 유지
 *  - 빈 문자열("")      → 삭제(null)
 *  - 값                 → 새 값으로 암호화 저장
 */
export class UpdateProjectDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  cwd?: string;

  @IsOptional()
  @IsString()
  gitRepo?: string;

  @IsOptional()
  @IsString()
  gitBranch?: string;

  @IsOptional()
  @IsBoolean()
  autoPr?: boolean;

  @IsOptional()
  @IsBoolean()
  autoMerge?: boolean;

  @IsOptional()
  @IsString()
  gitToken?: string;

  /** "" → 해제(null), 값 → 지정 */
  @IsOptional()
  @IsString()
  claudeAccountId?: string;

  @IsOptional()
  @IsIn(["private", "shared", "public"])
  visibility?: ProjectVisibility;
}
