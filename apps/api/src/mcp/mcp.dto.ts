import {
  IsArray,
  IsBoolean,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  MinLength,
} from "class-validator";
import type { McpServerType } from "@claude-app/shared";

export class CreateMcpServerDto {
  @IsString() @MinLength(1) name!: string;
  @IsIn(["stdio", "http", "sse"]) type!: McpServerType;
  @IsOptional() @IsString() command?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) args?: string[];
  @IsOptional() @IsString() url?: string;
  @IsOptional() @IsObject() env?: Record<string, string>;
  @IsOptional() @IsBoolean() enabled?: boolean;
}

export class UpdateMcpServerDto {
  @IsOptional() @IsString() @MinLength(1) name?: string;
  @IsOptional() @IsIn(["stdio", "http", "sse"]) type?: McpServerType;
  @IsOptional() @IsString() command?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) args?: string[];
  @IsOptional() @IsString() url?: string;
  @IsOptional() @IsObject() env?: Record<string, string>;
  @IsOptional() @IsBoolean() enabled?: boolean;
}
