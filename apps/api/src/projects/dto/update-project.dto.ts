import {
  IsArray,
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
  model?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  allowedTools?: string[];

  @IsOptional()
  @IsString()
  gitRepo?: string;

  @IsOptional()
  @IsString()
  gitBranch?: string;

  @IsOptional()
  @IsString()
  gitToken?: string;

  @IsOptional()
  @IsString()
  anthropicApiKey?: string;

  @IsOptional()
  @IsString()
  anthropicBaseUrl?: string;

  @IsOptional()
  @IsIn(["private", "shared", "public"])
  visibility?: ProjectVisibility;
}
