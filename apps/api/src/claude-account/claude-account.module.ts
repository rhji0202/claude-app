import { Module } from "@nestjs/common";
import { ClaudeAccountController } from "./claude-account.controller";
import { ClaudeAccountService } from "./claude-account.service";

@Module({
  controllers: [ClaudeAccountController],
  providers: [ClaudeAccountService],
  exports: [ClaudeAccountService],
})
export class ClaudeAccountModule {}
