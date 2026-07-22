import { HttpException } from "@nestjs/common";
import { GithubService } from "./github.service";

describe("GithubService.parseRepo", () => {
  it("owner/repo 형식을 파싱한다", () => {
    expect(GithubService.parseRepo("rhji0202/tom-jira-app")).toEqual({
      owner: "rhji0202",
      name: "tom-jira-app",
    });
  });

  it("전체 HTTPS URL을 파싱한다 (.git 포함)", () => {
    expect(
      GithubService.parseRepo("https://github.com/rhji0202/tom-jira-app.git"),
    ).toEqual({ owner: "rhji0202", name: "tom-jira-app" });
  });

  it("전체 HTTPS URL을 파싱한다 (.git 없음, 끝 슬래시)", () => {
    expect(
      GithubService.parseRepo("https://github.com/rhji0202/tom-jira-app/"),
    ).toEqual({ owner: "rhji0202", name: "tom-jira-app" });
  });

  it("SSH URL을 파싱한다", () => {
    expect(
      GithubService.parseRepo("git@github.com:rhji0202/tom-jira-app.git"),
    ).toEqual({ owner: "rhji0202", name: "tom-jira-app" });
  });

  it("http(s) 대소문자·공백을 허용한다", () => {
    expect(GithubService.parseRepo("  HTTP://github.com/a/b  ")).toEqual({
      owner: "a",
      name: "b",
    });
  });

  it("형식이 잘못되면 400 예외", () => {
    expect(() => GithubService.parseRepo("justoneword")).toThrow(HttpException);
    expect(() => GithubService.parseRepo("")).toThrow(HttpException);
  });

  it("400 예외의 상태코드는 400", () => {
    try {
      GithubService.parseRepo("bad");
      fail("예외가 발생해야 함");
    } catch (e) {
      expect(e).toBeInstanceOf(HttpException);
      expect((e as HttpException).getStatus()).toBe(400);
    }
  });
});
