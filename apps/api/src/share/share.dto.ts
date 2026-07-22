import {
  IsArray,
  IsEmail,
  IsIn,
  IsISO8601,
  IsOptional,
  IsString,
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
}
