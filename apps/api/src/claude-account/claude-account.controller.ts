import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from "@nestjs/common";
import { ClaudeAccountService } from "./claude-account.service";
import { AddAccountDto, UpdateAccountDto } from "./dto";
import { CurrentUser, type AuthUser } from "../auth/current-user.decorator";

@Controller("claude-accounts")
export class ClaudeAccountController {
  constructor(private readonly accounts: ClaudeAccountService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.accounts.list(user.userId);
  }

  /** setup-token 토큰 붙여넣기로 계정 추가 */
  @Post()
  add(@Body() dto: AddAccountDto, @CurrentUser() user: AuthUser) {
    return this.accounts.addAccount(user.userId, dto.token, dto.label);
  }

  @Patch(":id")
  update(
    @Param("id") id: string,
    @Body() dto: UpdateAccountDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.accounts.update(id, user.userId, dto);
  }

  @Post(":id/activate")
  async activate(@Param("id") id: string, @CurrentUser() user: AuthUser) {
    await this.accounts.activate(user.userId, id);
    return { ok: true };
  }

  @Delete(":id")
  async remove(@Param("id") id: string, @CurrentUser() user: AuthUser) {
    await this.accounts.remove(user.userId, id);
    return { ok: true };
  }
}
