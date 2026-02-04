/**
 * Centralized query key constants for React Query.
 * Using constants prevents typos and makes refactoring easier.
 */

export const QUERY_KEYS = {
  // Health checks
  health: {
    all: ["health"] as const,
    framework: ["health", "framework"] as const,
  },

  // Framework / taxonomy
  framework: {
    all: ["framework"] as const,
    capabilities: ["framework", "capabilities"] as const,
    miModalities: ["framework", "mi-modalities"] as const,
    methodCards: ["framework", "method-cards"] as const,
    patternCards: ["framework", "pattern-cards"] as const,
    comparableCases: ["framework", "comparable-cases"] as const,
    projectTags: (entryId: string) => ["framework", "project-tags", entryId] as const,
  },

  // Pipeline
  pipeline: {
    all: ["pipeline"] as const,
    entries: ["pipeline", "entries"] as const,
    entry: (id: string) => ["pipeline-entry", id] as const,
  },

  // Drafts
  drafts: {
    all: ["drafts"] as const,
    byEntry: (entryId: string) => ["drafts", entryId] as const,
  },

  // Activity
  activity: {
    all: ["activity"] as const,
    byEntry: (entryId: string) => ["activity", entryId] as const,
  },
} as const;
