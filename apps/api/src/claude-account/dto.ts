import { IsOptional, IsString, MinLength } from "class-validator";

export class AddAccountDto {
  /** claude setup-token으로 발급받은 sk-ant-oat01-... 토큰 */
  @IsString()
  @MinLength(1)
  token!: string;

  @IsOptional()
  @IsString()
  label?: string;
}
