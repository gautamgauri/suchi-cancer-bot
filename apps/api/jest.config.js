const path = require("path");

// <repo>/.claude — computed, not written as "<rootDir>/../..": rootDir
// substitution is textual, so a literal "../.." never matches the absolute,
// already-resolved paths jest tests these patterns against.
const AGENT_WORKTREES = path.resolve(__dirname, "../..", ".claude").replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "/";

module.exports = {
  moduleFileExtensions: ["js", "json", "ts"],
  rootDir: ".",
  roots: ["<rootDir>/src"],
  testRegex: "\\.spec\\.ts$",
  transform: {
    "^.+\\.(t|j)s$": "ts-jest",
  },
  // Never collect/scan tests or modules from Claude Code agent worktrees
  // (<repo>/.claude/worktrees/**) or build output (dist/). These contain full
  // repo copies; without this, their duplicate spec files intermittently
  // surface as confusing "Test suite failed to run" errors and Haste module
  // collisions.
  //
  // Anchored at this checkout's own repo root rather than matching "/.claude/"
  // anywhere in the path: the unanchored form also matched the worktree's OWN
  // path, so running jest inside an agent worktree silently ignored every test
  // in it ("No tests found").
  testPathIgnorePatterns: ["/node_modules/", AGENT_WORKTREES, "<rootDir>/dist/"],
  modulePathIgnorePatterns: [AGENT_WORKTREES, "<rootDir>/dist/"],
  collectCoverageFrom: ["src/**/*.ts", "!src/**/*.spec.ts"],
  coverageDirectory: "./coverage",
  testEnvironment: "node",
};
