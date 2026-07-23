import { spawn } from "node:child_process";

export interface GitRunOptions {
  /** 작업 디렉터리 (-C 대신 spawn cwd 사용) */
  cwd?: string;
  /**
   * 인증 토큰. 지정 시 `-c http.extraHeader=Authorization: Basic ...`로 주입한다.
   * URL·remote·.git/config에 토큰이 남지 않도록 매 호출 헤더로만 전달한다.
   */
  token?: string | null;
  /** 타임아웃(ms). 기본 120초. */
  timeoutMs?: number;
}

export interface GitResult {
  code: number;
  stdout: string;
  stderr: string;
}

/**
 * GitHub HTTP 인증 헤더 값. `x-access-token:<token>`을 Basic으로 인코딩한다.
 * (Authorization: Basic base64("x-access-token:TOKEN") — GitHub PAT/App 토큰 모두 허용)
 */
function authHeaderArgs(token: string | null | undefined): string[] {
  if (!token) return [];
  const basic = Buffer.from(`x-access-token:${token}`).toString("base64");
  // `-c` 값은 프로세스 인자로만 전달되어 .git/config에 기록되지 않는다.
  return ["-c", `http.extraHeader=Authorization: Basic ${basic}`];
}

/**
 * git 명령을 실행한다. 토큰은 항상 http.extraHeader로만 주입해 디스크에 남기지 않는다.
 * 실패(비0 종료)해도 throw하지 않고 GitResult를 반환 — 호출측이 code로 판단.
 */
export function runGit(
  args: string[],
  opts: GitRunOptions = {},
): Promise<GitResult> {
  const full = [...authHeaderArgs(opts.token), ...args];
  return new Promise<GitResult>((resolve, reject) => {
    const child = spawn("git", full, {
      cwd: opts.cwd,
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`git ${args[0]} 타임아웃 (${opts.timeoutMs ?? 120000}ms)`));
    }, opts.timeoutMs ?? 120000);
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, stdout, stderr });
    });
  });
}

/** runGit 후 실패면 stderr를 담아 throw하는 편의 래퍼. */
export async function git(
  args: string[],
  opts: GitRunOptions = {},
): Promise<GitResult> {
  const res = await runGit(args, opts);
  if (res.code !== 0) {
    // stderr에 토큰이 섞이지 않도록(헤더만 사용하므로 URL 토큰 없음) 그대로 노출 가능.
    throw new Error(`git ${args.join(" ")} 실패 (code ${res.code}): ${res.stderr.trim()}`);
  }
  return res;
}
