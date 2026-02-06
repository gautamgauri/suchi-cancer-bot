import * as fs from "fs/promises";
import * as yaml from "js-yaml";
import type {
  FundingCaseFile,
  FundingCaseResult,
  FundingCaseType,
  FundingTestCase,
  FundingEvalReport,
} from "../types.js";
import {
  FundingApiClient,
  countCitations,
  hasAbstain,
  hasPlaceholder,
} from "./funding-api-client.js";

const CRUD_TYPES: FundingCaseType[] = [
  "pipeline_crud",
  "activity_log",
  "opportunity_intake",
  "approvals",
];
const CITATION_TYPES: FundingCaseType[] = ["need_statement", "need_statement_refine", "email_draft"];
const PLACEHOLDER_TYPES: FundingCaseType[] = ["email_draft"];

function getByPath(obj: unknown, path: string): unknown {
  let current: unknown = obj;
  for (const key of path.split(".")) {
    if (current == null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function resolveRefs(
  value: unknown,
  previousResults: Map<string, FundingCaseResult>
): unknown {
  if (typeof value === "string" && value.startsWith("$ref:")) {
    const rest = value.slice(5).trim();
    const [caseId, ...pathParts] = rest.split(".");
    const path = pathParts.join(".");
    const res = previousResults.get(caseId);
    const response = (res as FundingCaseResult & { response?: unknown })?.response;
    return path ? getByPath(response, path) : response;
  }
  if (Array.isArray(value)) {
    return value.map((v) => resolveRefs(v, previousResults));
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = resolveRefs(v, previousResults);
    }
    return out;
  }
  return value;
}

export class FundingEvaluator {
  constructor(
    private apiBaseUrl: string,
    private timeoutMs = 60_000
  ) {}

  static async loadCases(filePath: string): Promise<FundingTestCase[]> {
    const content = await fs.readFile(filePath, "utf-8");
    const parsed = yaml.load(content) as FundingCaseFile;
    if (!parsed?.cases || !Array.isArray(parsed.cases)) {
      throw new Error("Invalid case file: missing 'cases' array");
    }
    return parsed.cases;
  }

  async runCase(
    tc: FundingTestCase,
    client: FundingApiClient,
    previousResults: Map<string, FundingCaseResult> = new Map()
  ): Promise<FundingCaseResult> {
    const start = Date.now();
    const expectAbstain = tc.expectations?.expect_abstain ?? false;
    const minCitations = tc.expectations?.min_citations ?? 0;
    const body = tc.body ? (resolveRefs(tc.body, previousResults) as Record<string, unknown>) : undefined;
    const params = tc.params ? (resolveRefs(tc.params, previousResults) as Record<string, string>) : undefined;
    const action = tc.action ?? "";

    const resultBase = {
      caseId: tc.id,
      type: tc.type,
      passed: false,
      citationCount: 0,
      expectAbstain,
      abstainCorrect: true,
      latencyMs: 0,
    };

    try {
      let text = "";
      let response: unknown = undefined;
      let responseStatus = 200;

      if (tc.type === "need_statement") {
        const out = await client.draftNeedStatement(
          tc.context ?? "",
          tc.userMessage ?? "",
          tc.chunks,
          tc.conversationContext
        );
        text = out.text;
        response = out;
      } else if (tc.type === "need_statement_refine") {
        const out = await client.draftNeedStatementRefine(
          tc.context ?? "",
          tc.userMessage ?? "",
          tc.chunks,
          tc.conversationContext
        );
        text = out.refined;
        response = out;
      } else if (tc.type === "donor_profile") {
        const payload = body?.orgName
          ? { orgName: body.orgName as string, urls: body.urls as string[] | undefined, notes: body.notes as string | undefined, chunks: body.chunks as Array<{ content: string; title?: string; url?: string }> | undefined }
          : (tc.context ?? "");
        const out = await client.donorProfileGenerate(payload);
        text = JSON.stringify(out);
        response = out;
      } else if (tc.type === "email_draft") {
        const payload = {
          template: (body?.template ?? "intro") as string,
          context: (body?.context ?? tc.context ?? "") as string,
          pipelineContext: body?.pipelineContext as Record<string, string> | undefined,
          donorProfileSnippet: body?.donorProfileSnippet as string | undefined,
          chunks: (body?.chunks ?? tc.chunks) as FundingTestCase["chunks"],
        };
        const out = await client.draftEmail(payload);
        text = out.text;
        response = out;
      } else if (tc.type === "pipeline_crud") {
        if (action === "list") {
          const out = await client.pipelineList();
          response = out;
          const ok = Array.isArray(out.entries);
          return {
            ...resultBase,
            passed: ok && (tc.expectations?.expect_array !== false),
            latencyMs: Date.now() - start,
            responseStatus: 200,
            responsePreview: JSON.stringify(out).slice(0, 300),
            response: out,
          };
        }
        if (action === "create") {
          const out = await client.pipelineCreate(body ?? {});
          response = out;
          const created = out as { id?: string };
          const ok = created?.id != null;
          return {
            ...resultBase,
            passed: ok && (tc.expectations?.expect_keys?.every((k) => (out as Record<string, unknown>)[k] != null) ?? true),
            latencyMs: Date.now() - start,
            responseStatus: 201,
            responsePreview: JSON.stringify(out).slice(0, 300),
            response: out,
          };
        }
        if (action === "get") {
          const id = params?.id;
          if (!id) {
            return { ...resultBase, latencyMs: Date.now() - start, error: "params.id required for get" };
          }
          const out = await client.pipelineGet(id);
          response = out;
          return {
            ...resultBase,
            passed: out != null && (tc.expectations?.expect_keys?.every((k) => (out as Record<string, unknown>)[k] != null) ?? true),
            latencyMs: Date.now() - start,
            responseStatus: 200,
            responsePreview: JSON.stringify(out).slice(0, 300),
            response: out,
          };
        }
        if (action === "update") {
          const id = params?.id;
          if (!id) {
            return { ...resultBase, latencyMs: Date.now() - start, error: "params.id required for update" };
          }
          const out = await client.pipelineUpdate(id, body ?? {});
          response = out;
          return {
            ...resultBase,
            passed: out != null,
            latencyMs: Date.now() - start,
            responseStatus: 200,
            responsePreview: JSON.stringify(out).slice(0, 300),
            response: out,
          };
        }
        return { ...resultBase, latencyMs: Date.now() - start, error: `Unknown pipeline_crud action: ${action}` };
      } else if (tc.type === "activity_log") {
        if (action === "log_with_createdBy" || action === "log") {
          const out = await client.pipelineLogActivity({
            donorId: body?.donorId as string | undefined,
            orgId: body?.orgId as string | undefined,
            type: (body?.type ?? "note") as string,
            notes: body?.notes as string | undefined,
            timestamp: body?.timestamp as string | undefined,
            createdBy: body?.createdBy as string | undefined,
          });
          response = out;
          const expectCreatedBy = tc.expectations?.expect_createdBy ?? false;
          const hasCreatedBy = (out as { createdBy?: string })?.createdBy != null;
          return {
            ...resultBase,
            passed: out != null && (!expectCreatedBy || hasCreatedBy),
            latencyMs: Date.now() - start,
            responseStatus: 201,
            responsePreview: JSON.stringify(out).slice(0, 300),
            response: out,
          };
        }
        if (action === "require_donor_or_org") {
          try {
            await client.pipelineLogActivity({ type: "note" });
          } catch (err: unknown) {
            responseStatus = FundingApiClient.getStatus(err) ?? 400;
            const passed = responseStatus === 400;
            return {
              ...resultBase,
              passed,
              latencyMs: Date.now() - start,
              responseStatus,
              responsePreview: passed ? "400 as expected" : String(err),
            };
          }
          return { ...resultBase, latencyMs: Date.now() - start, passed: false, error: "Expected 400" };
        }
        if (action === "get_activities") {
          const entryId = params?.entryId ?? body?.entryId;
          if (!entryId) {
            return { ...resultBase, latencyMs: Date.now() - start, error: "entryId required" };
          }
          const out = await client.pipelineGetActivities(entryId as string);
          response = out;
          const ok = Array.isArray(out.activities);
          return {
            ...resultBase,
            passed: ok,
            latencyMs: Date.now() - start,
            responseStatus: 200,
            responsePreview: JSON.stringify(out).slice(0, 300),
            response: out,
          };
        }
        return { ...resultBase, latencyMs: Date.now() - start, error: `Unknown activity_log action: ${action}` };
      } else if (tc.type === "opportunity_intake") {
        if (action === "list") {
          const q = tc.query ? { status: tc.query.status, limit: Number(tc.query.limit) || 10, offset: Number(tc.query.offset) || 0 } : undefined;
          const out = await client.opportunityList(q);
          response = out;
          const ok = Array.isArray(out.items) && typeof out.total === "number";
          return {
            ...resultBase,
            passed: ok,
            latencyMs: Date.now() - start,
            responseStatus: 200,
            responsePreview: JSON.stringify(out).slice(0, 300),
            response: out,
          };
        }
        if (action === "create") {
          try {
            const out = await client.opportunityCreate(body ?? {});
            response = out;
            const created = out as { id?: string };
            const ok = created?.id != null;
            return {
              ...resultBase,
              passed: ok,
              latencyMs: Date.now() - start,
              responseStatus: 201,
              responsePreview: JSON.stringify(out).slice(0, 300),
              response: out,
            };
          } catch (err: unknown) {
            // 409 = already exists, treat as success for idempotency
            const status = FundingApiClient.getStatus(err);
            if (status === 409) {
              return {
                ...resultBase,
                passed: true,
                latencyMs: Date.now() - start,
                responseStatus: 409,
                responsePreview: "409 Conflict - already exists (idempotent success)",
                response: { alreadyExists: true },
              };
            }
            throw err;
          }
        }
        if (action === "update") {
          const id = params?.id;
          if (!id) return { ...resultBase, latencyMs: Date.now() - start, error: "params.id required" };
          const out = await client.opportunityUpdate(id, body ?? {});
          response = out;
          return { ...resultBase, passed: out != null, latencyMs: Date.now() - start, responseStatus: 200, responsePreview: JSON.stringify(out).slice(0, 300), response: out };
        }
        if (action === "ingest_from_email") {
          const messageId = (body?.messageId ?? params?.messageId) as string;
          if (!messageId) return { ...resultBase, latencyMs: Date.now() - start, error: "messageId required" };
          const out = await client.opportunityIngestFromEmail(messageId);
          response = out;
          return {
            ...resultBase,
            passed: out != null,
            latencyMs: Date.now() - start,
            responseStatus: 200,
            responsePreview: JSON.stringify(out).slice(0, 300),
            response: out,
          };
        }
        return { ...resultBase, latencyMs: Date.now() - start, error: `Unknown opportunity_intake action: ${action}` };
      } else if (tc.type === "proposal_generate") {
        if (action === "generate") {
          const opportunityId = (body?.opportunityId ?? params?.opportunityId) as string;
          if (!opportunityId) return { ...resultBase, latencyMs: Date.now() - start, error: "opportunityId required" };
          const out = await client.proposalGenerate(opportunityId, body?.options as Record<string, unknown>);
          response = out;
          const ok = (out as { runId?: string })?.runId != null;
          return {
            ...resultBase,
            passed: ok,
            latencyMs: Date.now() - start,
            responseStatus: 200,
            responsePreview: JSON.stringify(out).slice(0, 300),
            response: out,
          };
        }
        if (action === "get_run") {
          const runId = params?.runId as string;
          if (!runId) return { ...resultBase, latencyMs: Date.now() - start, error: "params.runId required" };
          const out = await client.proposalGetRun(runId);
          response = out;
          return {
            ...resultBase,
            passed: out != null,
            latencyMs: Date.now() - start,
            responseStatus: 200,
            responsePreview: JSON.stringify(out).slice(0, 300),
            response: out,
          };
        }
        if (action === "get_gaps") {
          const runId = params?.runId as string;
          if (!runId) return { ...resultBase, latencyMs: Date.now() - start, error: "params.runId required" };
          const out = await client.proposalGetGaps(runId);
          response = out;
          return {
            ...resultBase,
            passed: out != null,
            latencyMs: Date.now() - start,
            responseStatus: 200,
            responsePreview: JSON.stringify(out).slice(0, 300),
            response: out,
          };
        }
        return { ...resultBase, latencyMs: Date.now() - start, error: `Unknown proposal_generate action: ${action}` };
      } else if (tc.type === "framework_retrieve") {
        if (action === "retrieve") {
          const out = await client.frameworkRetrieve(body ?? {});
          response = out;
          return {
            ...resultBase,
            passed: out != null,
            latencyMs: Date.now() - start,
            responseStatus: 200,
            responsePreview: JSON.stringify(out).slice(0, 300),
            response: out,
          };
        }
        if (action === "recommend_methods") {
          const q = (body ?? {}) as { ageBand: string; setting: string; capabilities?: string; miModalities?: string };
          if (!q.ageBand || !q.setting) return { ...resultBase, latencyMs: Date.now() - start, error: "ageBand and setting required" };
          const out = await client.frameworkRecommendMethods({
            ageBand: q.ageBand,
            setting: q.setting,
            capabilities: q.capabilities,
            miModalities: q.miModalities,
          });
          response = out;
          return {
            ...resultBase,
            passed: out != null,
            latencyMs: Date.now() - start,
            responseStatus: 200,
            responsePreview: JSON.stringify(out).slice(0, 300),
            response: out,
          };
        }
        if (action === "check_consistency") {
          const payload = body as { draftText: string; claimedCapabilities: string[]; projectId?: string };
          if (!payload?.draftText || !Array.isArray(payload.claimedCapabilities)) {
            return { ...resultBase, latencyMs: Date.now() - start, error: "draftText and claimedCapabilities required" };
          }
          const out = await client.frameworkCheckConsistency(payload);
          response = out;
          const ok = out != null && typeof (out as { overallScore?: number }).overallScore === "number";
          return {
            ...resultBase,
            passed: ok,
            latencyMs: Date.now() - start,
            responseStatus: 200,
            responsePreview: JSON.stringify(out).slice(0, 300),
            response: out,
          };
        }
        if (action === "generate_mel_pack") {
          const payload = body as { capabilities: string[]; targetGroup: string; projectId?: string };
          if (!Array.isArray(payload?.capabilities) || !payload?.targetGroup) {
            return { ...resultBase, latencyMs: Date.now() - start, error: "capabilities and targetGroup required" };
          }
          const out = await client.frameworkGenerateMelPack(payload);
          response = out;
          return {
            ...resultBase,
            passed: out != null,
            latencyMs: Date.now() - start,
            responseStatus: 200,
            responsePreview: JSON.stringify(out).slice(0, 300),
            response: out,
          };
        }
        return { ...resultBase, latencyMs: Date.now() - start, error: `Unknown framework_retrieve action: ${action}` };
      } else if (tc.type === "evidence_retrieve") {
        if (action === "retrieve") {
          const query = (body?.query ?? tc.context) as string;
          if (!query) return { ...resultBase, latencyMs: Date.now() - start, error: "query required" };
          const out = await client.evidenceRetrieve({
            query,
            mode: body?.mode as string | undefined,
            limit: body?.limit as number | undefined,
            publicSafeOnly: body?.publicSafeOnly as boolean | undefined,
            visibilityScope: body?.visibilityScope as string | undefined,
          });
          response = out;
          return {
            ...resultBase,
            passed: out != null,
            latencyMs: Date.now() - start,
            responseStatus: 200,
            responsePreview: JSON.stringify(out).slice(0, 300),
            response: out,
          };
        }
        if (action === "eval") {
          const out = await client.evidenceEval(body as { mode?: string; limit?: number; queries?: string[] });
          response = out;
          return {
            ...resultBase,
            passed: out != null,
            latencyMs: Date.now() - start,
            responseStatus: 200,
            responsePreview: JSON.stringify(out).slice(0, 300),
            response: out,
          };
        }
        return { ...resultBase, latencyMs: Date.now() - start, error: `Unknown evidence_retrieve action: ${action}` };
      } else if (tc.type === "approvals") {
        if (action === "create_artifact") {
          const pipelineEntryId = (body?.pipelineEntryId ?? params?.pipelineEntryId) as string;
          const type = (body?.type ?? "need_statement") as string;
          if (!pipelineEntryId) return { ...resultBase, latencyMs: Date.now() - start, error: "pipelineEntryId required" };
          const out = await client.approvalsCreateArtifact(pipelineEntryId, type);
          response = out;
          const ok = (out as { id?: string })?.id != null;
          return {
            ...resultBase,
            passed: ok,
            latencyMs: Date.now() - start,
            responseStatus: 201,
            responsePreview: JSON.stringify(out).slice(0, 300),
            response: out,
          };
        }
        if (action === "create_version") {
          const artifactId = (params?.artifactId ?? body?.artifactId) as string;
          const content = (body?.content ?? "") as string;
          if (!artifactId) return { ...resultBase, latencyMs: Date.now() - start, error: "artifactId required" };
          const out = await client.approvalsCreateVersion(artifactId, content, body?.createdBy as string | undefined);
          response = out;
          const ok = (out as { id?: string })?.id != null;
          return {
            ...resultBase,
            passed: ok,
            latencyMs: Date.now() - start,
            responseStatus: 201,
            responsePreview: JSON.stringify(out).slice(0, 300),
            response: out,
          };
        }
        if (action === "submit_approval") {
          const versionId = (params?.versionId ?? body?.versionId) as string;
          const status = (body?.status ?? "approved") as string;
          if (!versionId) return { ...resultBase, latencyMs: Date.now() - start, error: "versionId required" };
          const out = await client.approvalsSubmitApproval(versionId, status, body?.decidedBy as string, body?.comment as string);
          response = out;
          return {
            ...resultBase,
            passed: out != null,
            latencyMs: Date.now() - start,
            responseStatus: 200,
            responsePreview: JSON.stringify(out).slice(0, 300),
            response: out,
          };
        }
        if (action === "get_pending") {
          const pipelineEntryId = (params?.pipelineEntryId ?? body?.pipelineEntryId) as string;
          if (!pipelineEntryId) return { ...resultBase, latencyMs: Date.now() - start, error: "pipelineEntryId required" };
          const out = await client.approvalsGetPendingForEntry(pipelineEntryId);
          response = out;
          const ok = Array.isArray((out as { pending?: unknown[] })?.pending);
          return {
            ...resultBase,
            passed: ok,
            latencyMs: Date.now() - start,
            responseStatus: 200,
            responsePreview: JSON.stringify(out).slice(0, 300),
            response: out,
          };
        }
        return { ...resultBase, latencyMs: Date.now() - start, error: `Unknown approvals action: ${action}` };
      } else if (tc.type === "safety") {
        if (action === "expect_400") {
          try {
            await client.pipelineLogActivity({ type: "note" });
          } catch (err: unknown) {
            responseStatus = FundingApiClient.getStatus(err) ?? 400;
            const passed = responseStatus === 400;
            return {
              ...resultBase,
              passed,
              latencyMs: Date.now() - start,
              responseStatus,
              error: passed ? undefined : String(err),
            };
          }
          return { ...resultBase, latencyMs: Date.now() - start, passed: false, error: "Expected 400" };
        }
        return { ...resultBase, latencyMs: Date.now() - start, error: `Unknown safety action: ${action}` };
      }

      const latencyMs = Date.now() - start;
      const citationCount = countCitations(text);
      const abstain = hasAbstain(text);
      const abstainCorrect = expectAbstain ? abstain : !abstain;
      const citationsOk = citationCount >= minCitations;
      const expectPlaceholder = tc.expectations?.expect_placeholder ?? false;
      const placeholderOk = !expectPlaceholder || hasPlaceholder(text);
      const expectNoFabrication = tc.expectations?.expect_no_fabrication ?? false;
      const noFabricationOk = !expectNoFabrication || hasPlaceholder(text) || citationCount > 0;
      const passed = citationsOk && abstainCorrect && placeholderOk && noFabricationOk;

      return {
        ...resultBase,
        passed,
        citationCount,
        abstainCorrect,
        latencyMs,
        textPreview: text.slice(0, 200),
        response: response ?? (text ? { text } : undefined),
      };
    } catch (err: unknown) {
      const latencyMs = Date.now() - start;
      const message = err instanceof Error ? err.message : String(err);
      const status = FundingApiClient.getStatus(err);
      const expectError = tc.expectations?.expect_error ?? false;
      const passed = expectError && (status === 400 || status === 404);
      return {
        ...resultBase,
        passed: passed,
        latencyMs,
        error: message,
        responseStatus: status,
        abstainCorrect: expectAbstain ? false : true,
      };
    }
  }

  buildReport(
    results: FundingCaseResult[],
    caseExpectations: Map<string, { min_citations?: number; expect_placeholder?: boolean }>
  ): FundingEvalReport {
    const passed = results.filter((r) => r.passed).length;
    const total = results.length;
    const citationRelevant = results.filter((r) =>
      CITATION_TYPES.includes(r.type) && r.type !== "email_draft"
    );
    const citationOk = citationRelevant.filter((r) => {
      const exp = caseExpectations.get(r.caseId);
      const min = exp?.min_citations ?? 0;
      return r.citationCount >= min;
    }).length;
    const citationCoverageRate =
      citationRelevant.length > 0 ? citationOk / citationRelevant.length : 1;
    const abstainRelevant = results.filter(
      (r) => r.type === "need_statement" || r.type === "need_statement_refine" || r.type === "donor_profile"
    );
    const abstainCorrectnessRate =
      abstainRelevant.length > 0
        ? abstainRelevant.filter((r) => r.abstainCorrect).length / abstainRelevant.length
        : 1;
    const latencies = results.map((r) => r.latencyMs).sort((a, b) => a - b);
    const p50 = latencies[Math.floor(latencies.length * 0.5)] ?? 0;
    const p95 = latencies[Math.floor(latencies.length * 0.95)] ?? 0;
    const mean = latencies.length ? latencies.reduce((a, b) => a + b, 0) / latencies.length : 0;

    const crudResults = results.filter((r) => CRUD_TYPES.includes(r.type));
    const crudSuccessRate =
      crudResults.length > 0 ? crudResults.filter((r) => r.passed).length / crudResults.length : 1;

    const emailDraftResults = results.filter((r) => r.type === "email_draft");
    const placeholderOk = emailDraftResults.filter((r) => {
      const exp = caseExpectations.get(r.caseId);
      const needPlaceholder = exp?.expect_placeholder ?? false;
      return !needPlaceholder || (r.textPreview && hasPlaceholder(r.textPreview));
    }).length;
    const placeholderCompliance =
      emailDraftResults.length > 0 ? placeholderOk / emailDraftResults.length : 1;

    const fabricationRelevant = results.filter(
      (r) => r.type === "email_draft" && (r.textPreview != null)
    );
    const noFabrication = fabricationRelevant.filter((r) => {
      const t = r.textPreview ?? "";
      return hasPlaceholder(t) || countCitations(t) > 0;
    }).length;
    const fabricationRate =
      fabricationRelevant.length > 0 ? noFabrication / fabricationRelevant.length : 1;

    return {
      runAt: new Date().toISOString(),
      apiBaseUrl: this.apiBaseUrl,
      totalCases: total,
      passed,
      failed: total - passed,
      citationCoverageRate,
      abstainCorrectnessRate,
      latencyMs: { p50, p95, mean },
      results,
      crudSuccessRate,
      placeholderCompliance,
      fabricationRate,
    };
  }
}
