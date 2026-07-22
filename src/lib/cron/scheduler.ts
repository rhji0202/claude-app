/**
 * 크론 스케줄러 - 크론 작업의 다음 실행 시각 계산 및 단발 실행.
 *
 * 상시 스케줄링은 별도 워커 프로세스(worker.ts)에서 node-cron으로 수행한다.
 * Next.js 서버 라우트에서는 "지금 실행"(runCronJob) 및 스케줄 검증에 사용한다.
 */

import parser from "cron-parser";
import { store } from "@/lib/store";
import { runAgent } from "@/lib/agent/runner";
import type { CronJob } from "@/lib/types";

/** 크론식이 유효한지 검사한다. */
export function validateSchedule(schedule: string): { ok: boolean; error?: string } {
  try {
    parser.parseExpression(schedule);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

/** 다음 실행 시각(ISO 문자열)을 반환한다. */
export function nextRun(schedule: string): string | null {
  try {
    return parser.parseExpression(schedule).next().toISOString();
  } catch {
    return null;
  }
}

/** 크론 작업 하나를 즉시 실행한다. */
export async function runCronJob(id: string): Promise<CronJob | null> {
  const job = await store.get("cronJobs", id);
  if (!job) return null;

  const project = await store.get("projects", job.projectId);
  if (!project) {
    return store.update("cronJobs", id, {
      lastStatus: "error",
      lastResult: "연결된 프로젝트를 찾을 수 없습니다.",
      lastRunAt: new Date().toISOString(),
    });
  }

  const result = await runAgent({
    prompt: job.prompt,
    project,
    systemPrompt: "당신은 정기 작업을 수행하는 자동화 에이전트입니다.",
  });

  return store.update("cronJobs", id, {
    lastRunAt: new Date().toISOString(),
    lastStatus: result.status,
    lastResult: result.status === "ok" ? result.text : result.error,
  });
}
