/** 단위 테스트 (src 내부 *.spec.ts). DB 불필요, mock 기반. */
/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  rootDir: "src",
  testRegex: ".*\\.spec\\.ts$",
  moduleFileExtensions: ["ts", "js", "json"],
  collectCoverageFrom: ["**/*.(t|j)s"],
  coverageDirectory: "../coverage",
};
