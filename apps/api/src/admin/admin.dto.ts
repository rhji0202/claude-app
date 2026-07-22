import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  MinLength,
} from "class-validator";

export class CreateUserDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8, { message: "비밀번호는 8자 이상이어야 합니다." })
  password!: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsIn(["admin", "member"])
  role?: "admin" | "member";
}

export class UpdateUserDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsIn(["admin", "member"])
  role?: "admin" | "member";

  @IsOptional()
  @IsBoolean()
  disabled?: boolean;
}
