/** Jest config for the eval framework (unit tests only — no live API calls). */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  testMatch: ["**/*.test.ts"],
  modulePathIgnorePatterns: ["<rootDir>/dist/"],
  testPathIgnorePatterns: ["/node_modules/", "/dist/"],
  // Bound the worker pool for the same reason as apps/api/jest.config.js: the
  // default (cores - 1) ts-jest workers exhaust the WSL2 memory cap and the
  // kernel OOM-killer kills node rather than jest failing cleanly.
  maxWorkers: 4,
  workerIdleMemoryLimit: "1GB",
};
