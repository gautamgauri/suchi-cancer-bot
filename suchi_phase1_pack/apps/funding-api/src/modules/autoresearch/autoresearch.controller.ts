/**
 * Autoresearch API controller.
 * Endpoints for experiment management, variant generation, benchmarking, and promotion.
 */
import { Controller, Post, Get, Param, Body, Logger, BadRequestException, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { RetrievalBenchmarkService, BenchmarkSet } from "./retrieval-benchmark.service";
import {
  BASELINE_RETRIEVAL_CONFIG,
  RetrievalConfig,
  mergeRetrievalConfig,
  configHash,
} from "./retrieval-config";
import { generateVariants, MutationStrategy, listSweepableKnobs, listProfiles } from "./mutation-engine";
import { buildComparisonReport, VariantData } from "./comparison-report";
import { evaluatePromotion, computeUtilityScore } from "./promotion-logic";
import * as goldSet from "./benchmark-sets/gold-retrieval-v1.json";

@Controller("v1/autoresearch")
export class AutoresearchController {
  private readonly logger = new Logger(AutoresearchController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly benchmarkService: RetrievalBenchmarkService,
  ) {}

  // -----------------------------------------------------------------------
  // POST /v1/autoresearch/experiments — create experiment
  // -----------------------------------------------------------------------

  @Post("experiments")
  async createExperiment(
    @Body() body: { name: string; hypothesis: string; targetDomain?: string },
  ) {
    if (!body.name || !body.hypothesis) {
      throw new BadRequestException("name and hypothesis are required");
    }

    const baselineConfig = { ...BASELINE_RETRIEVAL_CONFIG };
    const baselineHash = configHash(baselineConfig);

    // Create experiment with auto-created baseline variant
    const experiment = await this.prisma.experiment.create({
      data: {
        name: body.name,
        hypothesis: body.hypothesis,
        targetDomain: body.targetDomain ?? "retrieval",
        baselineConfig: baselineConfig as object,
        variants: {
          create: {
            variantLabel: "baseline",
            isBaseline: true,
            configDelta: {},
            resolvedConfig: baselineConfig as object,
            configHash: baselineHash,
            mutationSource: "manual",
            status: "pending",
          },
        },
      },
      include: { variants: true },
    });

    this.logger.log({ message: "Experiment created", id: experiment.id, name: body.name });
    return experiment;
  }

  // -----------------------------------------------------------------------
  // POST /v1/autoresearch/experiments/:id/generate-variants
  // -----------------------------------------------------------------------

  @Post("experiments/:id/generate-variants")
  async generateExperimentVariants(
    @Param("id") experimentId: string,
    @Body() body: { strategy: MutationStrategy; knob?: string; profileName?: string },
  ) {
    const experiment = await this.prisma.experiment.findUnique({
      where: { id: experimentId },
      include: { variants: true },
    });
    if (!experiment) throw new NotFoundException("Experiment not found");

    const baseline = experiment.baselineConfig as unknown as RetrievalConfig;
    const variants = generateVariants(
      body.strategy,
      baseline,
      {
        knob: body.knob as keyof RetrievalConfig | undefined,
        profileName: body.profileName,
      },
    );

    // Filter out variants with hashes that already exist in this experiment
    const existingHashes = new Set(experiment.variants.map((v) => v.configHash));
    const newVariants = variants.filter((v) => !existingHashes.has(v.configHashValue));

    // Create variant records
    const created = await Promise.all(
      newVariants.map((v) =>
        this.prisma.experimentVariant.create({
          data: {
            experimentId,
            variantLabel: v.variantLabel,
            isBaseline: v.variantLabel === "baseline",
            configDelta: v.configDelta as object,
            resolvedConfig: v.resolvedConfig as object,
            configHash: v.configHashValue,
            mutationSource: v.mutationSource,
            status: "pending",
          },
        }),
      ),
    );

    this.logger.log({
      message: "Variants generated",
      experimentId,
      strategy: body.strategy,
      total: variants.length,
      new: created.length,
      skippedDuplicates: variants.length - created.length,
    });

    return {
      generated: created.length,
      skippedDuplicates: variants.length - created.length,
      variants: created,
    };
  }

  // -----------------------------------------------------------------------
  // POST /v1/autoresearch/benchmark — run benchmark for a variant
  // -----------------------------------------------------------------------

  @Post("benchmark")
  async runBenchmark(
    @Body() body: { variantId: string; benchmarkSetId?: string },
  ) {
    if (!body.variantId) throw new BadRequestException("variantId is required");

    const variant = await this.prisma.experimentVariant.findUnique({
      where: { id: body.variantId },
    });
    if (!variant) throw new NotFoundException("Variant not found");

    const config = variant.resolvedConfig as unknown as RetrievalConfig;
    const benchmarkSet: BenchmarkSet = goldSet as BenchmarkSet;

    // Mark variant as running
    await this.prisma.experimentVariant.update({
      where: { id: body.variantId },
      data: { status: "running" },
    });

    try {
      const result = await this.benchmarkService.runBenchmark(
        body.variantId,
        benchmarkSet,
        config,
      );

      // Mark variant as scored
      await this.prisma.experimentVariant.update({
        where: { id: body.variantId },
        data: { status: "scored" },
      });

      return result;
    } catch (err) {
      await this.prisma.experimentVariant.update({
        where: { id: body.variantId },
        data: { status: "pending" },
      });
      throw err;
    }
  }

  // -----------------------------------------------------------------------
  // GET /v1/autoresearch/experiments/:id/report — comparison report
  // -----------------------------------------------------------------------

  @Get("experiments/:id/report")
  async getReport(@Param("id") experimentId: string) {
    const experiment = await this.prisma.experiment.findUnique({
      where: { id: experimentId },
      include: {
        variants: {
          include: {
            benchmarkRuns: {
              include: { metrics: true },
            },
          },
        },
      },
    });
    if (!experiment) throw new NotFoundException("Experiment not found");

    const variantData: VariantData[] = experiment.variants.map((v) => ({
      id: v.id,
      variantLabel: v.variantLabel,
      isBaseline: v.isBaseline,
      configDelta: v.configDelta as Record<string, number>,
      status: v.status,
      benchmarkRuns: v.benchmarkRuns.map((r) => ({
        status: r.status,
        sliceMetrics: r.sliceMetrics as import("./retrieval-benchmark.service").SliceMetrics | null,
        metrics: r.metrics.map((m) => ({
          metricName: m.metricName,
          metricValue: m.metricValue,
        })),
      })),
    }));

    return buildComparisonReport(
      { id: experiment.id, name: experiment.name, hypothesis: experiment.hypothesis },
      variantData,
    );
  }

  // -----------------------------------------------------------------------
  // POST /v1/autoresearch/experiments/:id/promote/:variantId
  // -----------------------------------------------------------------------

  @Post("experiments/:id/promote/:variantId")
  async promoteVariant(
    @Param("id") experimentId: string,
    @Param("variantId") variantId: string,
    @Body() body: { note?: string },
  ) {
    const experiment = await this.prisma.experiment.findUnique({
      where: { id: experimentId },
      include: {
        variants: {
          include: {
            benchmarkRuns: {
              include: { metrics: true },
            },
          },
        },
      },
    });
    if (!experiment) throw new NotFoundException("Experiment not found");

    const variant = experiment.variants.find((v) => v.id === variantId);
    if (!variant) throw new NotFoundException("Variant not found in this experiment");

    const baseline = experiment.variants.find((v) => v.isBaseline);
    if (!baseline) throw new BadRequestException("No baseline variant found");

    // Extract metrics
    const extractMetrics = (v: typeof variant) => {
      const runs = v.benchmarkRuns.filter((r) => r.status === "complete");
      if (runs.length === 0) return null;
      const latest = runs[runs.length - 1];
      const map = new Map(latest.metrics.map((m) => [m.metricName, m.metricValue]));
      return {
        recallAtK: map.get("recallAtK") ?? 0,
        avgScore: map.get("avgScore") ?? 0,
        medianScore: map.get("medianScore") ?? 0,
        avgChunksRetrieved: map.get("avgChunksRetrieved") ?? 0,
        avgUniqueDocCount: map.get("avgUniqueDocCount") ?? 0,
        tierAFraction: map.get("tierAFraction") ?? 0,
        avgConfidenceLevel: map.get("avgConfidenceLevel") ?? 0,
        p50LatencyMs: map.get("p50LatencyMs") ?? 0,
        p95LatencyMs: map.get("p95LatencyMs") ?? 0,
        rerankerTriggerRate: map.get("rerankerTriggerRate") ?? 0,
      };
    };

    const baselineMetrics = extractMetrics(baseline);
    const variantMetrics = extractMetrics(variant);

    if (!baselineMetrics || !variantMetrics) {
      throw new BadRequestException("Both baseline and variant must have completed benchmark runs");
    }

    const baselineSlice = baseline.benchmarkRuns.filter((r) => r.status === "complete").pop()?.sliceMetrics as import("./retrieval-benchmark.service").SliceMetrics | null;
    const variantSlice = variant.benchmarkRuns.filter((r) => r.status === "complete").pop()?.sliceMetrics as import("./retrieval-benchmark.service").SliceMetrics | null;

    const result = evaluatePromotion(baselineMetrics, variantMetrics, baselineSlice, variantSlice);

    // Update variant status
    await this.prisma.experimentVariant.update({
      where: { id: variantId },
      data: {
        status: result.decision === "promote" ? "promoted" : result.decision === "reject" ? "rejected" : "hold",
        promotionNote: [
          body.note,
          ...result.reasons,
          ...result.guardrailViolations,
          ...result.sliceViolations,
        ].filter(Boolean).join("\n"),
      },
    });

    // If promoted, log the config for human review
    if (result.decision === "promote") {
      this.logger.log({
        message: "VARIANT PROMOTED — copy to BASELINE_RETRIEVAL_CONFIG",
        experimentId,
        variantId,
        variantLabel: variant.variantLabel,
        resolvedConfig: variant.resolvedConfig,
        utilityDelta: result.utilityDelta,
      });
    }

    return {
      decision: result.decision,
      utilityDelta: result.utilityDelta,
      reasons: result.reasons,
      guardrailViolations: result.guardrailViolations,
      sliceViolations: result.sliceViolations,
      promotedConfig: result.decision === "promote" ? variant.resolvedConfig : null,
    };
  }

  // -----------------------------------------------------------------------
  // GET /v1/autoresearch/meta — list sweepable knobs and profiles
  // -----------------------------------------------------------------------

  @Get("meta")
  getMeta() {
    return {
      sweepableKnobs: listSweepableKnobs(),
      profiles: listProfiles(),
      baselineConfig: BASELINE_RETRIEVAL_CONFIG,
      benchmarkSetId: "gold-retrieval-v1",
      queryCount: (goldSet as BenchmarkSet).queries.length,
    };
  }
}
