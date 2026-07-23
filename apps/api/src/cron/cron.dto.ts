import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MinLength,
} from "class-validator";
import type { CronType } from "@claude-app/shared";

export class CreateCronJobDto {
  @IsString() @MinLength(1) name!: string;
  @IsString() @MinLength(1) schedule!: string;
  /** 기본 prompt. import면 prompt 불필요. */
  @IsOptional() @IsIn(["prompt", "import"]) type?: CronType;
  /** prompt 유형에서만 필수(서비스에서 검증). */
  @IsOptional() @IsString() prompt?: string;
  @IsUUID() projectId!: string;
  @IsOptional() @IsBoolean() enabled?: boolean;
}

export class UpdateCronJobDto {
  @IsOptional() @IsString() @MinLength(1) name?: string;
  @IsOptional() @IsString() @MinLength(1) schedule?: string;
  @IsOptional() @IsIn(["prompt", "import"]) type?: CronType;
  @IsOptional() @IsString() prompt?: string;
  @IsOptional() @IsBoolean() enabled?: boolean;
}
