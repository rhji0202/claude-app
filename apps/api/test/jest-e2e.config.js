/** E2E 테스트 (test/*.e2e-spec.ts). 실행 중 docker Postgres 사용. */
/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  rootDir: "..",
  testRegex: ".e2e-spec\\.ts$",
  moduleFileExtensions: ["ts", "js", "json"],
  setupFiles: ["<rootDir>/test/setup-e2e.ts"],
  testTimeout: 30000,
};
