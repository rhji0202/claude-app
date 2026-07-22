import {
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  MinLength,
} from "class-validator";
import type { ProjectVisibility } from "@claude-app/shared";

export class CreateProjectDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsString()
  @MinLength(1)
  cwd!: string;

  @IsOptional()
  @IsString()
  model?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  allowedTools?: string[];

  // 프로젝트별 git 연결
  @IsOptional()
  @IsString()
  gitRepo?: string;

  @IsOptional()
  @IsString()
  gitBranch?: string;

  /** 평문 입력 → 서버에서 암호화 저장 */
  @IsOptional()
  @IsString()
  gitToken?: string;

  // 프로젝트별 Anthropic 설정
  /** 평문 입력 → 서버에서 암호화 저장 */
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
