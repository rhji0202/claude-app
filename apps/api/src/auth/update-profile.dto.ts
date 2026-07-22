import { IsOptional, IsString, MinLength } from "class-validator";

export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  currentPassword?: string;

  @IsOptional()
  @IsString()
  @MinLength(8, { message: "비밀번호는 8자 이상이어야 합니다." })
  newPassword?: string;
}
