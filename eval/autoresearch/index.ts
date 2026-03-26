/**
 * Autoresearch v0 — Public API
 */

export { runAutoresearch } from "./autoresearch-runner";
export { mineFailures, extractScoreSnapshot } from "./failure-miner";
export { Researcher } from "./researcher";
export { Patcher } from "./patcher";
export { checkGates } from "./gatekeeper";
export {
  generateExperimentId,
  saveExperiment,
  loadExperiment,
  listExperiments,
  formatExperimentSummary,
} from "./archivist";
export * from "./types";
