import {
  IsArray,
  IsEmail,
  IsIn,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  MinLength,
} from "class-validator";
import type { ShareLinkScope, UserRole } from "@claude-app/shared";

export class AddShareDto {
  @IsEmail() email!: string;
  @IsIn(["viewer", "editor"]) role!: Exclude<UserRole, "owner">;
}

export class CreateShareLinkDto {
  @IsIn(["read", "issue_report"]) scope!: ShareLinkScope;
  @IsOptional() @IsISO8601() expiresAt?: string;
}

/** 공유 링크를 통한 테스터의 수동 이슈 등록 */
export class ReportIssueDto {
  @IsString() @MinLength(1) title!: string;
  @IsOptional() @IsString() body?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) labels?: string[];
  @IsOptional() @IsString() reporter?: string;
  /**
   * 본문에 이미지를 붙여넣으면 프론트가 먼저 빈 이슈(초안)를 만들어 업로드 대상
   * id를 확보한다. 최종 등록 시 그 id를 넘기면 새로 만들지 않고 초안을 갱신한다.
   * 토큰의 프로젝트에 속한 초안(아직 실행 전)만 대상이다.
   */
  @IsOptional() @IsUUID() issueId?: string;
}
