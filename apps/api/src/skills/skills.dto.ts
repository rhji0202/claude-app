import { IsBoolean, IsIn, IsOptional, IsString, MinLength } from "class-validator";
import type { SkillScope } from "@claude-app/shared";

export class CreateSkillDto {
  @IsString() @MinLength(1) name!: string;
  @IsString() @MinLength(1) description!: string;
  @IsOptional() @IsString() content?: string;
  @IsOptional() @IsIn(["global", "project"]) scope?: SkillScope;
  @IsOptional() @IsBoolean() enabled?: boolean;
}

export class UpdateSkillDto {
  @IsOptional() @IsString() @MinLength(1) name?: string;
  @IsOptional() @IsString() @MinLength(1) description?: string;
  @IsOptional() @IsString() content?: string;
  @IsOptional() @IsIn(["global", "project"]) scope?: SkillScope;
  @IsOptional() @IsBoolean() enabled?: boolean;
}
