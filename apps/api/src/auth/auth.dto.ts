import { IsEmail, IsOptional, IsString, MinLength } from "class-validator";

export class RegisterDto {
  @IsEmail() email!: string;
  @IsString() @MinLength(8, { message: "비밀번호는 8자 이상이어야 합니다." })
  password!: string;
  @IsOptional() @IsString() name?: string;
}

export class LoginDto {
  @IsEmail() email!: string;
  @IsString() password!: string;
}
