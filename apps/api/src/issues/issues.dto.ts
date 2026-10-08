import { Type } from "class-transformer";
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MinLength,
  ValidateNested,
} from "class-validator";
import type { IssueMode, IssueSource } from "@claude-app/shared";

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
  /** 처리 모드. 기본 direct(바로 처리), plan이면 분석·인터뷰 후 기획안 승인 뒤 처리 */
  @IsOptional() @IsIn(["direct", "plan"]) mode?: IssueMode;
}

export class UpdateIssueTaskDto {
  @IsOptional() @IsString() @MinLength(1) title?: string;
  @IsOptional() @IsString() body?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) labels?: string[];
  @IsOptional() @IsString() prompt?: string;
  @IsOptional() @IsIn(["direct", "plan"]) mode?: IssueMode;
}

/** GitHub 이슈 가져오기. mode 생략 시 바로 처리. */
export class ImportIssuesDto {
  @IsUUID() projectId!: string;
  @IsArray() @IsInt({ each: true }) numbers!: number[];
  @IsOptional() @IsIn(["direct", "plan"]) mode?: IssueMode;
}

export class InterviewAnswerDto {
  @IsString() @MinLength(1) questionId!: string;
  @IsString() @MinLength(1) answer!: string;
}

/** 인터뷰 답 제출. stop=true면 남은 질문은 두고 기획안을 쓰게 한다. */
export class AnswerInterviewDto {
  @IsArray() @ValidateNested({ each: true }) @Type(() => InterviewAnswerDto)
  answers!: InterviewAnswerDto[];
  @IsOptional() @IsBoolean() stop?: boolean;
}

/** 기획안 수정 요청. */
export class RevisePlanDto {
  @IsString() @MinLength(1) request!: string;
}
