import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { PrismaService } from "../prisma/prisma.service";
import { CryptoService } from "../crypto/crypto.service";
import { GithubService } from "../github/github.service";
import { git, runGit } from "./git.util";

/**
 * 시스템 관리 clone (설계 12절, 옵션 B).
 *
 * 프로젝트의 gitRepo를 `<REPOS_ROOT>/<projectId>`에 clone/fetch하고,
 * 이 clone을 모든 이슈 실행 worktree(11절)의 base repo로 제공한다.
 *
 * - 경로는 **projectId 기준**으로 격리(gitRepo에 유일성 제약 없음).
 * - 토큰은 http.extraHeader로만 주입 — .git/config에 남기지 않는다(git.util).
 * - 지연 clone: 실행 직전 "없으면 clone, 있으면 fetch".
 */
@Injectable()
export class RepoManagerService {
  private readonly logger = new Logger(RepoManagerService.name);

  /** clone 루트. UPLOADS_DIR와 분리(정적 노출 방지). */
  readonly root: string;

  /** 프로젝트별 clone/fetch 직렬화용 락(같은 base .git 동시 접근 방지). */
  private readonly locks = new Map<string, Promise<unknown>>();

  constructor(
    private readonly config: ConfigService,
    private readonly github: GithubService,
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {
    this.root =
      this.config.get<string>("REPOS_DIR") ?? path.join(process.cwd(), "repos");
  }

  /**
   * 프로젝트 id로 관리 clone을 준비하고 base 경로를 반환한다.
   * (대화형 실행: 채팅·프로젝트 임의 실행이 worktree 없이 clone base를 cwd로 쓸 때)
   * gitRepo가 없으면 실행 불가(설계 12.5) — BadRequest.
   */
  async prepareForProject(projectId: string): Promise<string> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
    });
    if (!project) throw new BadRequestException("프로젝트를 찾을 수 없습니다.");
    if (!project.gitRepo)
      throw new BadRequestException(
        "실행하려면 프로젝트에 gitRepo가 설정되어야 합니다.",
      );
    const token = this.crypto.decryptOptional(project.gitTokenEnc);
    return this.ensureRepo(projectId, project.gitRepo, token);
  }

  /** 프로젝트의 관리 clone 절대경로 (존재 여부와 무관). */
  baseDir(projectId: string): string {
    return path.join(this.root, projectId);
  }

  /**
   * 관리 clone이 현재 체크아웃한 브랜치명. **읽기 전용** — clone/fetch를 유발하지 않는다.
   *
   * clone이 아직 없거나(지연 clone) git 명령이 실패하면 null. 표시 용도이므로
   * 호출측은 null을 정상 상태로 다뤄야 한다. detached HEAD면 rev-parse가 "HEAD"를
   * 반환하는데, 브랜치명이 아니므로 짧은 커밋 해시로 대체한다.
   *
   * 주의: prepareForProject를 쓰면 안 된다 — 그쪽은 clone/fetch(수 분)를 유발한다.
   */
  async currentBranch(projectId: string): Promise<string | null> {
    const base = this.baseDir(projectId);
    if (!(await this.exists(path.join(base, ".git")))) return null;
    const res = await runGit(["rev-parse", "--abbrev-ref", "HEAD"], { cwd: base });
    if (res.code !== 0) return null;
    const branch = res.stdout.trim();
    if (!branch) return null;
    if (branch !== "HEAD") return branch;
    const head = await runGit(["rev-parse", "--short", "HEAD"], { cwd: base });
    return head.code === 0 && head.stdout.trim() ? head.stdout.trim() : null;
  }

  /**
   * 프로젝트별 임계구역 직렬화. 같은 projectId 호출을 순차 실행한다.
   * clone/fetch·worktree add/remove가 모두 같은 base .git을 잠그므로 공유한다.
   */
  async withProjectLock<T>(projectId: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(projectId) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    // 락 체인 유지(실패해도 다음 작업이 이어지도록 catch로 흡수한 프로미스를 저장).
    this.locks.set(
      projectId,
      next.then(
        () => undefined,
        () => undefined,
      ),
    );
    return next;
  }

  private async exists(p: string): Promise<boolean> {
    try {
      await fs.access(p);
      return true;
    } catch {
      return false;
    }
  }

  private cloneUrl(gitRepo: string): string {
    const { owner, name } = GithubService.parseRepo(gitRepo);
    const apiBase = process.env.GITHUB_API_URL;
    // GHES 대응: API_URL이 있으면 그 호스트를, 아니면 github.com.
    const host =
      apiBase && !apiBase.includes("api.github.com")
        ? apiBase.replace(/\/api\/v3\/?$/, "").replace(/\/$/, "")
        : "https://github.com";
    return `${host}/${owner}/${name}.git`;
  }

  /**
   * clone이 없으면 clone, 있으면 fetch해 최신화한 뒤 base 디렉터리 경로를 반환한다.
   * (worktree base로 사용) 실패 시 throw — 호출측(워커)이 이슈 ERROR로 흡수.
   */
  async ensureRepo(
    projectId: string,
    gitRepo: string,
    token: string | null,
  ): Promise<string> {
    return this.withProjectLock(projectId, async () => {
      const base = this.baseDir(projectId);
      const url = this.cloneUrl(gitRepo);
      const isRepo =
        (await this.exists(path.join(base, ".git"))) &&
        (await runGit(["rev-parse", "--git-dir"], { cwd: base })).code === 0;

      if (!isRepo) {
        // 손상된 잔여 디렉터리가 있으면 정리 후 clone.
        if (await this.exists(base)) {
          await fs.rm(base, { recursive: true, force: true }).catch(() => {});
        }
        await fs.mkdir(this.root, { recursive: true });
        this.logger.log(`clone: ${gitRepo} → ${base}`);
        // 토큰 없는 remote URL로 clone(헤더로 인증). .git/config에 토큰 미기록.
        await git(["clone", url, base], { token, timeoutMs: 300000 });
      } else {
        this.logger.log(`fetch: ${gitRepo} (${base})`);
        // remote URL이 토큰을 포함하지 않도록 보정(과거 방식 잔재 대비).
        await runGit(["remote", "set-url", "origin", url], { cwd: base });
        await git(["fetch", "--prune", "origin"], {
          cwd: base,
          token,
          timeoutMs: 300000,
        });
      }
      return base;
    });
  }

  /**
   * 관리 clone을 무효화(디렉터리 삭제). gitRepo/gitBranch 변경 시 다음 실행에서 재clone.
   */
  async invalidate(projectId: string): Promise<void> {
    await this.withProjectLock(projectId, async () => {
      const base = this.baseDir(projectId);
      if (await this.exists(base)) {
        await fs.rm(base, { recursive: true, force: true }).catch((e) =>
          this.logger.warn(`clone 무효화 실패 ${projectId}: ${String(e)}`),
        );
        this.logger.log(`clone 무효화: ${projectId}`);
      }
    });
  }

  /** 프로젝트의 기본 기준 브랜치명(origin/HEAD)을 조회. 실패 시 null. */
  async defaultBranch(projectId: string): Promise<string | null> {
    const base = this.baseDir(projectId);
    const res = await runGit(
      ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"],
      { cwd: base },
    );
    if (res.code !== 0) return null;
    // "origin/main" → "main"
    return res.stdout.trim().replace(/^origin\//, "") || null;
  }
}
