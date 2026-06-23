module.exports = {
  moduleFileExtensions: ["js", "json", "ts"],
  rootDir: ".",
  roots: ["<rootDir>/src"],
  testRegex: "\\.spec\\.ts$",
  transform: {
    "^.+\\.(t|j)s$": "ts-jest",
  },
  // Never collect/scan tests or modules from Claude Code agent worktrees
  // (.claude/worktrees/**) or build output (dist/). These contain full repo
  // copies; without this, their duplicate spec files intermittently surface as
  // confusing "Test suite failed to run" errors and Haste module collisions.
  testPathIgnorePatterns: ["/node_modules/", "/\\.claude/", "<rootDir>/dist/"],
  modulePathIgnorePatterns: ["/\\.claude/", "<rootDir>/dist/"],
  collectCoverageFrom: ["src/**/*.ts", "!src/**/*.spec.ts"],
  coverageDirectory: "./coverage",
  testEnvironment: "node",
};
