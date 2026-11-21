import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { Logger } from "@nestjs/common";
import { ChatService } from "./chat.service";
import { AnalyticsService } from "../analytics/analytics.service";
import { SafetyService } from "../safety/safety.service";
import { AbstentionService } from "../abstention/abstention.service";
import { IntentClassifier } from "./intent-classifier";
import { TemplateSelector } from "./template-selector";
import { StructuredExtractorService } from "./structured-extractor.service";
import { GreetingFlowService } from "./greeting-flow.service";
import { EmpathyDetector } from "./empathy-detector";
import { PatientStateService } from "./patient-state.service";
import { CrossLingualService } from "../rag/cross-lingual.service";
import { OutputVerifierService } from "./output-verifier.service";

/**
 * Behaviour lock for the safety path of ChatService.handle (PR #202).
 *
 * PR #202 moved the deterministic safety screen ahead of the session lookup
 * and made safety replies return before their database writes. With a healthy
 * database that must change nothing but timing. This spec replays every probe
 * phrase from the safety, emergency, abstention, empathy and input-cleanup
 * specs through the real safety, abstention, empathy, greeting-context and
 * template code over a healthy in-memory database, and compares the outcome
 * with a baseline captured from the branch BEFORE the reorder
 * (`__fixtures__/safety-path-baseline.json`).
 *
 * For each probe and variant the record holds the reply text, classification,
 * actions and banner, whether a message id came back, every row written
 * (message, safety event, session update, analytics event) with ids and
 * latencies normalised away, and whether the turn went on past the safety
 * gates into the ordinary pipeline. Only a digest of that record is stored,
 * next to the classification, to keep the fixture small.
 *
 * To re-capture (only when a reviewed change is meant to alter safety
 * behaviour): SAFETY_BASELINE_CAPTURE=1 npx jest --runInBand
 * --testPathPatterns safety-equivalence
 */

const FIXTURE_DIR = path.join(__dirname, "__fixtures__");
const PROBES: Array<{ source: string; text: string }> = JSON.parse(
  fs.readFileSync(path.join(FIXTURE_DIR, "safety-path-probes.json"), "utf8"),
);
const BASELINE_PATH = path.join(FIXTURE_DIR, "safety-path-baseline.json");

/** Thrown by the first ordinary-pipeline step, to mark "went past every safety gate". */
const PAST_GATES = "PAST_SAFETY_GATES";

type Variant = { name: string; channel: string; inputMode?: string; locale?: string; priorAssistant: number };
const VARIANTS: Variant[] = [
  // Web typed, first message, no request locale (the web client sends none).
  { name: "web-typed-first", channel: "web", priorAssistant: 0 },
  // WhatsApp-style typed text with a request locale and earlier replies.
  { name: "whatsapp-hi-later", channel: "whatsapp", locale: "hi", priorAssistant: 2 },
  // Spoken input: the cleanVoiceInput preprocessing branch.
  { name: "web-voice-first", channel: "web", inputMode: "voice", priorAssistant: 0 },
];

function makeRecordingPrisma(sessionRow: any, priorAssistant: number) {
  const calls: Array<{ model: string; method: string; args: any }> = [];
  let n = 0;
  const model = (name: string) =>
    new Proxy(
      {},
      {
        get: (_t, method: string) =>
          jest.fn(async (args: any) => {
            calls.push({ model: name, method, args });
            if (method === "count") return priorAssistant;
            if (method === "findMany") return [];
            if (method === "findUnique" || method === "findFirst") return name === "session" ? sessionRow : null;
            if (method === "create" || method === "update" || method === "upsert") {
              n += 1;
              return { id: args?.data?.id ?? `row-${n}`, createdAt: new Date(), ...(args?.data ?? {}) };
            }
            return { count: 0 };
          }),
      },
    );
  const prisma: any = {
    $queryRaw: jest.fn(async () => [sessionRow]),
    $executeRawUnsafe: jest.fn(async () => 1),
    $executeRaw: jest.fn(async () => 1),
  };
  for (const m of ["session", "message", "messageCitation", "safetyEvent", "analyticsEvent", "reviewRecord", "feedback"]) {
    prisma[m] = model(m);
  }
  return { prisma, calls };
}

function buildService(prisma: any): { svc: ChatService; greeting: GreetingFlowService } {
  const empathy = new EmpathyDetector();
  const greeting = new GreetingFlowService(prisma, empathy);
  jest.spyOn(greeting, "isGreetingFlowInProgress").mockRejectedValue(new Error(PAST_GATES));
  const abstention = new AbstentionService();
  const intent = new IntentClassifier(abstention);
  const unused = () => {
    throw new Error("not expected on the safety path");
  };
  const svc = new ChatService(
    prisma,
    new AnalyticsService(prisma),
    new SafetyService(),
    // Retrieval returns nothing, so the urgency path takes its template branch.
    { retrieveWithMetadata: jest.fn(async () => []), retrieveWithExpansion: jest.fn(async () => []) } as any,
    { generateWithCitations: jest.fn(unused), generateRaw: jest.fn(unused), generate: jest.fn(unused) } as any,
    { validateEvidence: jest.fn(unused) } as any,
    {
      extractCitations: jest.fn(() => ({ citations: [], orphanCount: 0 })),
      validateCitations: jest.fn(() => ({ isValid: true, confidenceLevel: "GREEN", citations: [] })),
      enrichCitations: jest.fn(async () => []),
    } as any,
    abstention,
    intent,
    new TemplateSelector(intent),
    { validate: jest.fn(unused) } as any,
    greeting,
    empathy,
    new StructuredExtractorService(),
    new PatientStateService(),
    { enforce: (t: string) => t } as any,
    { multiRetrieve: jest.fn(unused) } as any,
    { needsDecomposition: () => false, decompose: jest.fn(unused) } as any,
    new CrossLingualService(),
    { needsPlanning: () => false, plan: jest.fn(unused) } as any,
    { execute: jest.fn(unused) } as any,
    new OutputVerifierService(),
    {
      copilotMode: "off",
      review: jest.fn(async () => ({ verdict: "PASS", hardFailures: [] })),
      persistRecord: jest.fn(async () => undefined),
      buildBlockedFallback: jest.fn(unused),
    } as any,
    { startTrace: () => ({}), startSpan: () => ({}), endSpan: () => undefined, finalizeTrace: () => undefined } as any,
  );
  return { svc, greeting };
}

/** Let fire-and-forget writes land before the rows are read. */
async function drain(svc: any) {
  for (let i = 0; i < 5; i++) {
    if (typeof svc.settleBackgroundWrites === "function") await svc.settleBackgroundWrites();
    await new Promise((r) => setImmediate(r));
  }
}

function normaliseRows(calls: Array<{ model: string; method: string; args: any }>, sessionId: string) {
  const assistantIds = new Set<string>();
  const byModel: Record<string, any[]> = {};
  const scrub = (v: any): any => JSON.parse(JSON.stringify(v ?? null).split(sessionId).join("SESSION"));
  for (const c of calls) {
    if (c.model === "message" && c.method === "count") continue; // a read
    const args = scrub(c.args);
    if (c.model === "message" && c.method === "create") {
      if (args.data.id) assistantIds.add(args.data.id);
      delete args.data.id;
      delete args.data.latencyMs;
    }
    if (c.model === "safetyEvent" && c.method === "create") {
      args.data.messageId = args.data.messageId ? "ASSISTANT_ROW" : null;
    }
    if (c.model === "analyticsEvent" && c.method === "create" && args.data.payload) {
      delete args.data.payload.latencyMs;
    }
    (byModel[`${c.model}.${c.method}`] ||= []).push(args);
  }
  return Object.keys(byModel)
    .sort()
    .map((k) => [k, byModel[k]]);
}

async function runProbe(text: string, variant: Variant) {
  const sessionId = `00000000-0000-4000-8000-${createHash("sha1").update(text + variant.name).digest("hex").slice(0, 12)}`;
  const sessionRow = {
    id: sessionId,
    createdAt: new Date(0),
    channel: variant.channel,
    locale: "en",
    userType: null,
    status: "active",
    userContext: null,
    cancerType: null,
    greetingCompleted: true,
    emotionalState: "neutral",
  };
  const { prisma, calls } = makeRecordingPrisma(sessionRow, variant.priorAssistant);
  const { svc } = buildService(prisma);
  let outcome: any;
  try {
    const r: any = await svc.handle({
      sessionId,
      channel: variant.channel,
      inputMode: variant.inputMode,
      locale: variant.locale,
      userText: text,
    } as any);
    outcome = {
      kind: "reply",
      responseText: r.responseText,
      classification: r.safety?.classification,
      actions: r.safety?.actions,
      bannerText: r.safety?.bannerText,
      hasMessageId: typeof r.messageId === "string" && r.messageId.length > 0,
    };
  } catch (err: any) {
    outcome = { kind: err?.message === PAST_GATES ? "past_gates" : "error", message: err?.message };
  }
  await drain(svc);
  const record = { outcome, rows: normaliseRows(calls, sessionId) };
  const digest = createHash("sha256").update(JSON.stringify(record)).digest("hex");
  const label = outcome.kind === "reply" ? `reply:${outcome.classification}` : outcome.kind;
  return { label, digest, record };
}

describe("ChatService safety path: behaviour identical to the pre-reorder baseline (healthy DB)", () => {
  beforeAll(() => {
    jest.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, "debug").mockImplementation(() => undefined);
  });
  afterAll(() => jest.restoreAllMocks());

  it(`replays ${PROBES.length} probes x ${VARIANTS.length} variants against the baseline`, async () => {
    const results: Array<{ text: string; variant: string; label: string; digest: string }> = [];
    const records: Record<string, any> = {};
    for (const p of PROBES) {
      for (const v of VARIANTS) {
        const r = await runProbe(p.text, v);
        results.push({ text: p.text, variant: v.name, label: r.label, digest: r.digest });
        records[`${v.name}::${p.text}`] = r.record;
      }
    }

    if (process.env.SAFETY_BASELINE_CAPTURE === "1") {
      fs.writeFileSync(BASELINE_PATH, JSON.stringify(results, null, 1) + "\n");
      return;
    }

    const baseline: typeof results = JSON.parse(fs.readFileSync(BASELINE_PATH, "utf8"));
    expect(results.length).toBe(baseline.length);
    const mismatches = results
      .map((r, i) => ({ r, b: baseline[i] }))
      .filter(({ r, b }) => r.text !== b.text || r.variant !== b.variant || r.label !== b.label || r.digest !== b.digest)
      .map(({ r, b }) => ({
        variant: r.variant,
        text: r.text.slice(0, 80),
        before: b.label,
        after: r.label,
        record: records[`${r.variant}::${r.text}`],
      }));
    expect(mismatches).toEqual([]);

    // The probe set must exercise every gate, or the comparison proves little.
    const labels = new Set(results.map((r) => r.label));
    for (const l of [
      "reply:red_flag",
      "reply:self_harm",
      "reply:mental_health_crisis",
      "reply:mental_health_support",
      "past_gates",
    ]) {
      expect(labels).toContain(l);
    }
  }, 120_000);
});
