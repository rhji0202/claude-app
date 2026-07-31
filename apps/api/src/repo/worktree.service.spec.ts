import { ConfigService } from "@nestjs/config";
import { promises as fs } from "node:fs";
import { git, runGit } from "./git.util";
import { RepoManagerService } from "./repo-manager.service";
import { WorktreeService } from "./worktree.service";

jest.mock("./git.util", () => ({
  git: jest.fn(),
  runGit: jest.fn(),
}));

const gitMock = git as jest.MockedFunction<typeof git>;
const runGitMock = runGit as jest.MockedFunction<typeof runGit>;

const ok = (stdout = "") => ({ code: 0, stdout, stderr: "" });
const fail = (stderr = "") => ({ code: 1, stdout: "", stderr });

describe("WorktreeService.create 기준 브랜치", () => {
  let service: WorktreeService;
  let repos: {
    baseDir: jest.Mock;
    defaultBranch: jest.Mock;
    withProjectLock: jest.Mock;
  };

  /** rev-parse 확인 결과를 지정해 runGit을 구성한다(그 외 호출은 성공 처리). */
  function setupRunGit(revParseOk: boolean): void {
    runGitMock.mockImplementation(async (args) => {
      if (args[0] === "rev-parse" && args.includes("--verify")) {
        return revParseOk ? ok("abc123") : fail("fatal: 없음");
      }
      return ok();
    });
  }

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(fs, "mkdir").mockResolvedValue(undefined);
    jest.spyOn(fs, "rm").mockResolvedValue(undefined);
    gitMock.mockResolvedValue(ok());
    repos = {
      baseDir: jest.fn().mockReturnValue("/repos/p1"),
      defaultBranch: jest.fn().mockResolvedValue("main"),
      withProjectLock: jest.fn(
        (_id: string, fn: () => Promise<unknown>) => fn(),
      ),
    };
    service = new WorktreeService(
      { get: () => "/wt" } as unknown as ConfigService,
      repos as unknown as RepoManagerService,
    );
  });

  afterEach(() => jest.restoreAllMocks());

  it("지정한 기준 브랜치가 원격에 있으면 origin/<branch>를 start point로 쓴다", async () => {
    setupRunGit(true);

    const wt = await service.create("p1", "i1", "develop");

    expect(wt.branch).toBe("issue/i1");
    const addCall = gitMock.mock.calls.find((c) => c[0][0] === "worktree");
    expect(addCall?.[0]).toEqual([
      "worktree",
      "add",
      "-B",
      "issue/i1",
      expect.stringContaining("i1"),
      "origin/develop",
    ]);
    // 지정값이 있으면 origin/HEAD는 조회하지 않는다.
    expect(repos.defaultBranch).not.toHaveBeenCalled();
  });

  it("지정한 기준 브랜치가 원격에 없으면 명시적으로 실패한다", async () => {
    setupRunGit(false);

    await expect(service.create("p1", "i1", "develp")).rejects.toThrow(
      /기준 브랜치 'develp'를 찾을 수 없습니다/,
    );
    // worktree add까지 가지 않는다.
    expect(gitMock).not.toHaveBeenCalled();
  });

  /**
   * 채팅이 이슈 브랜치를 이어받는 경로. autoPr가 꺼져 있으면 issue/<id>는
   * push되지 않아 로컬에만 있으므로, 그 경우에만 로컬 ref를 기준으로 허용한다.
   */
  it("allowLocalBase면 원격에 없어도 로컬 ref를 start point로 쓴다", async () => {
    // 원격(refs/remotes/…)은 없고 로컬(refs/heads/…)만 있는 상황.
    runGitMock.mockImplementation(async (args) => {
      if (args[0] === "rev-parse" && args.includes("--verify")) {
        const ref = args[args.length - 1] as string;
        return ref.startsWith("refs/heads/") ? ok("abc123") : fail("없음");
      }
      return ok();
    });

    const wt = await service.create("p1", "s1", "issue/i1", "chat", true);

    expect(wt.branch).toBe("chat/s1");
    const addCall = gitMock.mock.calls.find((c) => c[0][0] === "worktree");
    // origin/ 접두사 없이 로컬 브랜치를 그대로 기준점으로 쓴다.
    expect(addCall?.[0]).toEqual([
      "worktree",
      "add",
      "-B",
      "chat/s1",
      expect.stringContaining("s1"),
      "issue/i1",
    ]);
  });

  it("allowLocalBase가 꺼져 있으면 로컬에만 있어도 실패한다(기본 동작)", async () => {
    runGitMock.mockImplementation(async (args) => {
      if (args[0] === "rev-parse" && args.includes("--verify")) {
        const ref = args[args.length - 1] as string;
        return ref.startsWith("refs/heads/") ? ok("abc123") : fail("없음");
      }
      return ok();
    });

    // 이슈 경로는 원격 전용을 유지해야 한다 — 오타를 로컬 브랜치로 흡수하면
    // 잘못된 기준으로 작업이 나간다.
    await expect(service.create("p1", "i1", "develp")).rejects.toThrow(
      /기준 브랜치 'develp'를 찾을 수 없습니다/,
    );
    expect(gitMock).not.toHaveBeenCalled();
  });

  it("기준 브랜치가 없으면 origin/HEAD를 start point로 쓴다", async () => {
    setupRunGit(true);

    await service.create("p1", "i1", null);

    expect(repos.defaultBranch).toHaveBeenCalledWith("p1");
    const addCall = gitMock.mock.calls.find((c) => c[0][0] === "worktree");
    expect(addCall?.[0]).toContain("origin/main");
  });

  it("기준 브랜치가 빈 문자열이면 미지정으로 보고 origin/HEAD를 쓴다", async () => {
    setupRunGit(true);

    await service.create("p1", "i1", "   ");

    expect(repos.defaultBranch).toHaveBeenCalledWith("p1");
    const addCall = gitMock.mock.calls.find((c) => c[0][0] === "worktree");
    expect(addCall?.[0]).toContain("origin/main");
  });

  it("origin/HEAD도 조회 실패하면 start point 없이 add한다", async () => {
    setupRunGit(true);
    repos.defaultBranch.mockResolvedValue(null);

    await service.create("p1", "i1", undefined);

    const addCall = gitMock.mock.calls.find((c) => c[0][0] === "worktree");
    expect(addCall?.[0]).toEqual([
      "worktree",
      "add",
      "-B",
      "issue/i1",
      expect.stringContaining("i1"),
    ]);
  });
});
