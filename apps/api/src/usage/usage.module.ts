import { Global, Module } from "@nestjs/common";
import { UsageService } from "./usage.service";
import { UsageController } from "./usage.controller";
import { ProjectsModule } from "../projects/projects.module";

/**
 * 사용량 원장·집계·예산. 이슈·크론·채팅 실행이 기록하므로 전역 제공.
 * 컨트롤러(집계 조회)는 ProjectsService(접근 범위)를 쓴다.
 */
@Global()
@Module({
  imports: [ProjectsModule],
  providers: [UsageService],
  controllers: [UsageController],
  exports: [UsageService],
})
export class UsageModule {}
