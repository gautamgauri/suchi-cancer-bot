/**
 * Rule-based mutation engine for generating retrieval config variants.
 * No LLM — pure combinatorial generation respecting knob classification.
 */
import {
  RetrievalConfig,
  BASELINE_RETRIEVAL_CONFIG,
  KNOB_METADATA,
  KnobClass,
  mergeRetrievalConfig,
  configHash,
} from "./retrieval-config";

// ---------------------------------------------------------------------------
// Strategy types
// ---------------------------------------------------------------------------

export type MutationStrategy = "single_knob_sweep" | "paired_knob" | "profile";

export interface VariantSpec {
  variantLabel: string;
  configDelta: Partial<RetrievalConfig>;
  resolvedConfig: RetrievalConfig;
  configHashValue: string;
  mutationSource: "manual" | "rule_sweep";
}

// ---------------------------------------------------------------------------
// Paired knob combinations (ranking class only)
// ---------------------------------------------------------------------------

const PAIRED_KNOBS: Array<[keyof RetrievalConfig, keyof RetrievalConfig]> = [
  ["rrfK", "multiQueryBoost"],
  ["tierBoostA", "tierBoostB"],
  ["confidenceMinAvgScore", "confidenceHighAvgScore"],
];

// ---------------------------------------------------------------------------
// Named profiles (manually curated config packages)
// ---------------------------------------------------------------------------

const PROFILES: Record<string, { label: string; delta: Partial<RetrievalConfig> }> = {
  aggressive_tier_boost: {
    label: "aggressive_tier_boost",
    delta: { tierBoostA: 1.50, tierBoostB: 1.20 },
  },
  tight_focus: {
    label: "tight_focus",
    delta: { finalChunkLimit: 8, maxChunksPerDoc: 3 },
  },
  broad_sweep: {
    label: "broad_sweep",
    delta: { overselectMultiplier: 8, maxQueriesPerSection: 12 },
  },
};

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

export function generateVariants(
  strategy: MutationStrategy,
  baseline: RetrievalConfig = BASELINE_RETRIEVAL_CONFIG,
  options?: {
    knob?: keyof RetrievalConfig;
    profileName?: string;
  },
): VariantSpec[] {
  const variants: VariantSpec[] = [];
  const seenHashes = new Set<string>();

  // Always include baseline as first variant (deduped by hash)
  const baselineHash = configHash(baseline);
  seenHashes.add(baselineHash);
  variants.push({
    variantLabel: "baseline",
    configDelta: {},
    resolvedConfig: { ...baseline },
    configHashValue: baselineHash,
    mutationSource: "rule_sweep",
  });

  switch (strategy) {
    case "single_knob_sweep":
      variants.push(...singleKnobSweep(baseline, seenHashes, options?.knob));
      break;
    case "paired_knob":
      variants.push(...pairedKnobSweep(baseline, seenHashes, options?.knob));
      break;
    case "profile":
      variants.push(...profileVariants(baseline, seenHashes, options?.profileName));
      break;
  }

  return variants;
}

function singleKnobSweep(
  baseline: RetrievalConfig,
  seenHashes: Set<string>,
  knob?: keyof RetrievalConfig,
): VariantSpec[] {
  const variants: VariantSpec[] = [];
  const knobs = knob ? [knob] : (Object.keys(KNOB_METADATA) as Array<keyof RetrievalConfig>);

  for (const k of knobs) {
    const meta = KNOB_METADATA[k];

    // Cost knobs blocked from auto-sweep
    if (meta.class === "cost") continue;
    if (!meta.sweepRange) continue;

    for (const value of meta.sweepRange) {
      // Skip if this is the baseline value
      if (value === baseline[k]) continue;

      const delta = { [k]: value } as Partial<RetrievalConfig>;
      const resolved = mergeRetrievalConfig(baseline, delta);
      const hash = configHash(resolved);

      if (seenHashes.has(hash)) continue;
      seenHashes.add(hash);

      variants.push({
        variantLabel: `${k}=${value}`,
        configDelta: delta,
        resolvedConfig: resolved,
        configHashValue: hash,
        mutationSource: "rule_sweep",
      });
    }
  }

  return variants;
}

function pairedKnobSweep(
  baseline: RetrievalConfig,
  seenHashes: Set<string>,
  knob?: keyof RetrievalConfig,
): VariantSpec[] {
  const variants: VariantSpec[] = [];

  const pairs = knob
    ? PAIRED_KNOBS.filter(([a, b]) => a === knob || b === knob)
    : PAIRED_KNOBS;

  for (const [knobA, knobB] of pairs) {
    const metaA = KNOB_METADATA[knobA];
    const metaB = KNOB_METADATA[knobB];

    // Only ranking knobs for paired sweep
    if (metaA.class !== "ranking" || metaB.class !== "ranking") continue;

    const rangeA = metaA.sweepRange ?? [baseline[knobA]];
    const rangeB = metaB.sweepRange ?? [baseline[knobB]];

    for (const valA of rangeA) {
      for (const valB of rangeB) {
        // Skip if both are baseline values
        if (valA === baseline[knobA] && valB === baseline[knobB]) continue;

        const delta = { [knobA]: valA, [knobB]: valB } as Partial<RetrievalConfig>;
        const resolved = mergeRetrievalConfig(baseline, delta);
        const hash = configHash(resolved);

        if (seenHashes.has(hash)) continue;
        seenHashes.add(hash);

        variants.push({
          variantLabel: `${knobA}=${valA}+${knobB}=${valB}`,
          configDelta: delta,
          resolvedConfig: resolved,
          configHashValue: hash,
          mutationSource: "rule_sweep",
        });
      }
    }
  }

  return variants;
}

function profileVariants(
  baseline: RetrievalConfig,
  seenHashes: Set<string>,
  profileName?: string,
): VariantSpec[] {
  const variants: VariantSpec[] = [];
  const profiles = profileName
    ? { [profileName]: PROFILES[profileName] }
    : PROFILES;

  for (const [name, profile] of Object.entries(profiles)) {
    if (!profile) continue;

    const resolved = mergeRetrievalConfig(baseline, profile.delta);
    const hash = configHash(resolved);

    if (seenHashes.has(hash)) continue;
    seenHashes.add(hash);

    variants.push({
      variantLabel: name,
      configDelta: profile.delta,
      resolvedConfig: resolved,
      configHashValue: hash,
      mutationSource: "manual",
    });
  }

  return variants;
}

/** List available profile names. */
export function listProfiles(): string[] {
  return Object.keys(PROFILES);
}

/** List sweepable knobs (those with sweepRange and not cost class). */
export function listSweepableKnobs(): Array<keyof RetrievalConfig> {
  return (Object.keys(KNOB_METADATA) as Array<keyof RetrievalConfig>).filter((k) => {
    const meta = KNOB_METADATA[k];
    return meta.class !== "cost" && meta.sweepRange;
  });
}
