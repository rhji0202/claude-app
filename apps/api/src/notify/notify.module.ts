import { Global, Module } from "@nestjs/common";
import { NotifyService } from "./notify.service";

/** 알림 발신(webhook). 이슈·크론 등 여러 모듈에서 쓰므로 전역 제공. */
@Global()
@Module({
  providers: [NotifyService],
  exports: [NotifyService],
})
export class NotifyModule {}
