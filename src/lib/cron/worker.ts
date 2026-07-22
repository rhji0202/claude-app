/**
 * 스케줄러 워커 - 독립 프로세스로 실행하여 활성 크론 작업을 등록/실행한다.
 *
 *   npm run scheduler
 *
 * 스토어의 크론 작업을 주기적으로 다시 읽어 등록 상태를 동기화한다.
 */

import cron, { type ScheduledTask } from "node-cron";
import { store } from "@/lib/store";
import { runCronJob } from "./scheduler";

const registered = new Map<string, { schedule: string; task: ScheduledTask }>();

async function sync(): Promise<void> {
  const jobs = await store.list("cronJobs");
  const activeIds = new Set<string>();

  for (const job of jobs) {
    if (!job.enabled) continue;
    if (!cron.validate(job.schedule)) {
      console.warn(`[scheduler] 잘못된 크론식 무시: ${job.name} (${job.schedule})`);
      continue;
    }
    activeIds.add(job.id);

    const existing = registered.get(job.id);
    if (existing && existing.schedule === job.schedule) continue;

    // 스케줄이 바뀌었거나 신규 → 재등록
    existing?.task.stop();
    const task = cron.schedule(job.schedule, () => {
      console.log(`[scheduler] 실행: ${job.name} (${job.id})`);
      runCronJob(job.id).catch((err) =>
        console.error(`[scheduler] 실행 오류 ${job.id}:`, err),
      );
    });
    registered.set(job.id, { schedule: job.schedule, task });
    console.log(`[scheduler] 등록: ${job.name} → ${job.schedule}`);
  }

  // 비활성/삭제된 작업 정리
  for (const [id, entry] of registered) {
    if (!activeIds.has(id)) {
      entry.task.stop();
      registered.delete(id);
      console.log(`[scheduler] 해제: ${id}`);
    }
  }
}

async function main(): Promise<void> {
  console.log("[scheduler] 시작. 크론 작업 동기화 중...");
  await sync();
  // 30초마다 스토어와 동기화
  setInterval(() => {
    sync().catch((err) => console.error("[scheduler] 동기화 오류:", err));
  }, 30_000);
}

main().catch((err) => {
  console.error("[scheduler] 치명적 오류:", err);
  process.exit(1);
});
