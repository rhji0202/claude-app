import { IsBoolean, IsOptional, IsString, IsUUID, MinLength } from "class-validator";

export class CreateCronJobDto {
  @IsString() @MinLength(1) name!: string;
  @IsString() @MinLength(1) schedule!: string;
  @IsString() @MinLength(1) prompt!: string;
  @IsUUID() projectId!: string;
  @IsOptional() @IsBoolean() enabled?: boolean;
}

export class UpdateCronJobDto {
  @IsOptional() @IsString() @MinLength(1) name?: string;
  @IsOptional() @IsString() @MinLength(1) schedule?: string;
  @IsOptional() @IsString() @MinLength(1) prompt?: string;
  @IsOptional() @IsBoolean() enabled?: boolean;
}
