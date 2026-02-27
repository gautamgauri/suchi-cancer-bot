/**
 * Diksha Foundation org-level capacity constants.
 * Used by the orchestrator pre-flight gate and budget envelope clamping.
 */
export const ORG_CAPACITY = {
  /** Diksha's agreed ask ceiling per year — never target more than this. */
  maxAskINRPerYear: 10_000_000, // ₹1Cr/year
  /** Frozen planning FX rate (INR per USD). */
  planningFxUSDtoINR: 91,
  /** FY2024-25 operational expenditure (from org-profile). */
  orgTypicalAnnualBudgetINR: 10_456_000, // ₹104.56L
  /** Historical peak annual budget (FY2023). */
  orgPeakAnnualBudgetINR: 25_000_000, // ₹2.5Cr
} as const;
