import { Transform, Type } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from "class-validator";
import type {
  GhIssueSort,
  GhIssueState,
  GhIssueStateFilter,
  GhSortDirection,
} from "@claude-app/shared";

/**
 * GitHub Issue 뷰어 DTO.
 * ⚠️ 절대 규칙 — 에이전트 이슈 큐의 issues.dto.ts와 공유하지 않는다.
 */

/** 쿼리스트링의 `a,b` 또는 `a&labels=b`를 문자열 배열로 정규화. */
const toStringArray = ({ value }: { value: unknown }): string[] | undefined => {
  if (value === undefined || value === null || value === "") return undefined;
  const arr = Array.isArray(value) ? value : String(value).split(",");
  return arr.map((v) => String(v).trim()).filter((v) => v.length > 0);
};

export class ListGhIssuesQueryDto {
  @IsOptional() @IsIn(["open", "closed", "all"]) state?: GhIssueStateFilter;

  @IsOptional()
  @Transform(toStringArray)
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(20)
  labels?: string[];

  @IsOptional() @IsString() @MaxLength(200) q?: string;

  @IsOptional() @IsIn(["created", "updated", "comments"]) sort?: GhIssueSort;

  @IsOptional() @IsIn(["asc", "desc"]) direction?: GhSortDirection;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) perPage?: number;
}

export class CreateGhIssueDto {
  @IsString() @MinLength(1) @MaxLength(300) title!: string;
  @IsOptional() @IsString() body?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) labels?: string[];
  @IsOptional() @IsArray() @IsString({ each: true }) assignees?: string[];
}

export class UpdateGhIssueDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(300) title?: string;
  @IsOptional() @IsString() body?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) labels?: string[];
}

export class SetGhIssueStateDto {
  @IsIn(["open", "closed"]) state!: GhIssueState;
  /** 닫을 때만 의미 있음. 미지정 시 completed. */
  @IsOptional() @IsIn(["completed", "not_planned"]) stateReason?:
    | "completed"
    | "not_planned";
}

export class SetGhLabelsDto {
  @IsArray() @IsString({ each: true }) labels!: string[];
}

export class SetGhAssigneesDto {
  @IsArray() @IsString({ each: true }) assignees!: string[];
}

export class CreateGhCommentDto {
  @IsString() @MinLength(1) body!: string;
}

/** 이미지 프록시 쿼리. u=base64url(원본 URL), exp=만료(ms), sig=HMAC. */
export class GhImageQueryDto {
  @IsString() @MinLength(1) u!: string;
  @Type(() => Number) @IsInt() exp!: number;
  @IsString() @MinLength(1) sig!: string;
}
