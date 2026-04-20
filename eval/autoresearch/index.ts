/**
 * Autoresearch v1 — Public API
 */

export { runAutoresearch } from "./autoresearch-runner";
export { mineFailures, extractScoreSnapshot } from "./failure-miner";
export { Researcher } from "./researcher";
export { Patcher } from "./patcher";
export { TriageRouter } from "./triage-router";
export { PromptResearcher, PromptPatcher } from "./prompt-agent";
export { KBResearcher, KBPatcher } from "./kb-agent";
export { checkGates } from "./gatekeeper";
export {
  generateExperimentId,
  saveExperiment,
  loadExperiment,
  listExperiments,
  formatExperimentSummary,
} from "./archivist";
export * from "./types";
