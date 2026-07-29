import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { git, runGit } from "./git.util";
import { RepoManagerService } from "./repo-manager.service";

export interface Worktree {
  /** 에이전트 cwd로 넘길 절대경로 (posix 정규화) */
  path: string;
  /** worktree가 체크아웃한 브랜치 */
  branch: string;
}

/**
 * per-run worktree 격리 (설계 11절).
 *
 * 관리 clone(RepoManagerService)을 base로, 실행마다 독립 작업 디렉터리를 만든다.
 * 같은 프로젝트 이슈를 병렬 실행해도 파일/git 충돌이 없다.
 *
 * - 경로: `<WORKTREE_ROOT>/<projectId>/<issueId>`
 * - worktree add/remove는 base .git을 공유하므로 **프로젝트별 직렬화**(RepoManager 락 재사용).
 * - 브랜치: `issue/<issueId>` (재개 시 같은 이름으로 고정).
 */
@Injectable()
export class WorktreeService {
  private readonly logger = new Logger(WorktreeService.name);

  readonly root: string;

  constructor(
    private readonly config: ConfigService,
    private readonly repos: RepoManagerService,
  ) {
    this.root =
      this.config.get<string>("ISSUE_WORKTREE_ROOT") ??
      path.join(process.cwd(), "worktrees");
  }

  private dir(projectId: string, issueId: string): string {
    return path.join(this.root, projectId, issueId);
  }

  /** SDK cwd로 넘길 절대경로(posix 슬래시 정규화). */
  private normalize(p: string): string {
    return path.resolve(p).split(path.sep).join("/");
  }

  /**
   * 이슈용 worktree를 생성한다. base clone은 호출 전에 준비돼 있어야 한다.
   * baseBranch가 있으면 origin/<baseBranch>를, 없으면 origin/HEAD를 기준으로 브랜치를 만든다.
   * 지정한 baseBranch가 원격에 없으면(오타·삭제된 브랜치) 명시적으로 실패한다 —
   * 조용히 다른 브랜치를 base로 삼으면 잘못된 기준으로 작업이 나간다.
   */
  async create(
    projectId: string,
    issueId: string,
    baseBranch?: string | null,
  ): Promise<Worktree> {
    const base = this.repos.baseDir(projectId);
    const wt = this.dir(projectId, issueId);
    const branch = `issue/${issueId}`;

    // 기준 브랜치 결정: 지정값 → origin/HEAD → 실패 시 지정 없이 add(현재 HEAD).
    const wanted = baseBranch?.trim();
    let startPoint: string | null;
    if (wanted) {
      startPoint = `origin/${wanted}`;
      const check = await runGit(
        ["rev-parse", "--verify", "--quiet", `refs/remotes/${startPoint}`],
        { cwd: base },
      );
      if (check.code !== 0) {
        throw new Error(
          `프로젝트에 설정된 기준 브랜치 '${wanted}'를 원격에서 찾을 수 없습니다. ` +
            `브랜치명을 확인하세요(origin/${wanted} 없음).`,
        );
      }
    } else {
      const def = await this.repos.defaultBranch(projectId);
      startPoint = def ? `origin/${def}` : null;
    }

    // worktree add/remove는 base .git 잠금 → 프로젝트별 직렬화.
    await this.repos.withProjectLock(projectId, async () => {
      // 재개 등으로 잔여 worktree가 있으면 먼저 제거.
      await this.removeRaw(base, wt);
      await fs.mkdir(path.dirname(wt), { recursive: true });
      const args = ["worktree", "add", "-B", branch, wt];
      if (startPoint) args.push(startPoint);
      await git(args, { cwd: base, timeoutMs: 120000 });
    });

    this.logger.log(`worktree 생성: ${wt} (${branch})`);
    return { path: this.normalize(wt), branch };
  }

  /** 이슈 worktree 제거(정리). 실패해도 throw하지 않음(finally에서 호출). */
  async remove(projectId: string, issueId: string): Promise<void> {
    const base = this.repos.baseDir(projectId);
    const wt = this.dir(projectId, issueId);
    try {
      await this.repos.withProjectLock(projectId, () => this.removeRaw(base, wt));
      this.logger.log(`worktree 제거: ${wt}`);
    } catch (e) {
      this.logger.warn(`worktree 제거 실패 ${wt}: ${String(e)}`);
    }
  }

  /** base가 존재할 때만 worktree remove + 디렉터리 강제 정리. */
  private async removeRaw(base: string, wt: string): Promise<void> {
    // base가 유효한 repo일 때만 git worktree remove 시도.
    if ((await runGit(["rev-parse", "--git-dir"], { cwd: base })).code === 0) {
      await runGit(["worktree", "remove", "--force", wt], { cwd: base });
      await runGit(["worktree", "prune"], { cwd: base });
    }
    // git이 못 지운 잔여 디렉터리 강제 정리.
    await fs.rm(wt, { recursive: true, force: true }).catch(() => {});
  }

  /** 프로젝트의 worktree 루트 디렉터리를 통째로 정리(프로젝트 삭제 시). */
  async removeProjectDir(projectId: string): Promise<void> {
    const dir = path.join(this.root, projectId);
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }

  /**
   * 고아 worktree 정리(부팅/tick). 프로세스가 죽어 finally가 안 돌면 worktree가 남는다.
   * 각 프로젝트 clone에서 `git worktree prune`을 돌린다.
   */
  async pruneOrphans(): Promise<void> {
    let entries: string[] = [];
    try {
      entries = await fs.readdir(this.repos.root);
    } catch {
      return; // repos 루트가 아직 없음
    }
    for (const projectId of entries) {
      const base = this.repos.baseDir(projectId);
      if ((await runGit(["rev-parse", "--git-dir"], { cwd: base })).code === 0) {
        await runGit(["worktree", "prune"], { cwd: base }).catch(() => undefined);
      }
    }
  }
}
