import { IsBoolean, IsIn, IsOptional, IsString, MinLength } from "class-validator";
import type { ProjectVisibility } from "@claude-app/shared";

export class CreateProjectDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

  /**
   * (레거시) 실행 작업 디렉터리. 더 이상 실행 근거가 아니다(설계 12.5).
   * 실행은 gitRepo 기반 관리 clone→worktree에서만 이뤄진다. 선택 입력.
   */
  @IsOptional()
  @IsString()
  cwd?: string;

  // 프로젝트별 git 연결
  @IsOptional()
  @IsString()
  gitRepo?: string;

  @IsOptional()
  @IsString()
  gitBranch?: string;

  /** 이슈 실행 결과를 브랜치 push + PR로 만들지(gh CLI) */
  @IsOptional()
  @IsBoolean()
  autoPr?: boolean;

  /** PR 생성 후 자동 머지까지(autoPr가 true일 때만 유효) */
  @IsOptional()
  @IsBoolean()
  autoMerge?: boolean;

  /** 이슈 실행 전 triage 분류 수행 */
  @IsOptional()
  @IsBoolean()
  autoTriage?: boolean;

  /** 평문 입력 → 서버에서 암호화 저장 */
  @IsOptional()
  @IsString()
  gitToken?: string;

  /** 알림 webhook URL(Slack/Discord/WeCom 등). 암호화 저장. */
  @IsOptional()
  @IsString()
  notifyWebhook?: string;

  /** 이 프로젝트가 사용할 Claude 계정 id (미지정 시 활성 계정 폴백) */
  @IsOptional()
  @IsString()
  claudeAccountId?: string;

  @IsOptional()
  @IsIn(["private", "shared", "public"])
  visibility?: ProjectVisibility;
}
