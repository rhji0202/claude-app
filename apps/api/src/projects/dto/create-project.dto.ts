import { IsIn, IsOptional, IsString, MinLength } from "class-validator";
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

  /** 이 프로젝트가 사용할 Claude 계정 id (미지정 시 활성 계정 폴백) */
  @IsOptional()
  @IsString()
  claudeAccountId?: string;

  @IsOptional()
  @IsIn(["private", "shared", "public"])
  visibility?: ProjectVisibility;
}
