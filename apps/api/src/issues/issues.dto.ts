import {
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MinLength,
} from "class-validator";
import type { IssueSource } from "@claude-app/shared";

export class CreateIssueTaskDto {
  @IsUUID() projectId!: string;
  @IsString() @MinLength(1) repo!: string;
  @IsString() @MinLength(1) title!: string;
  @IsOptional() @IsString() body?: string;
  @IsOptional() @IsInt() issueNumber?: number;
  @IsOptional() @IsArray() @IsString({ each: true }) labels?: string[];
  @IsOptional() @IsString() author?: string;
  @IsOptional() @IsString() prompt?: string;
  @IsOptional() @IsString() url?: string;
  /** 기본 manual (대시보드 수동 등록). GitHub 가져오기 시 github */
  @IsOptional() @IsIn(["github", "manual"]) source?: IssueSource;
}

export class UpdateIssueTaskDto {
  @IsOptional() @IsString() @MinLength(1) title?: string;
  @IsOptional() @IsString() body?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) labels?: string[];
  @IsOptional() @IsString() prompt?: string;
}
