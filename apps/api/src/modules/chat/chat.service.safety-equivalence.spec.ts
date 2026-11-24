import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { Logger } from "@nestjs/common";
import { ChatService } from "./chat.service";
import { MAX_USER_TEXT_HARD_LIMIT } from "./dto";
import { EvidenceGateService } from "../evidence/evidence-gate.service";
import { CitationService } from "../citations/citation.service";
import { ResponseValidatorService } from "./response-validator.service";
import { ClinicalKeywordEnforcerService } from "../llm/clinical-keyword-enforcer";
import { QueryDecomposerService } from "../rag/query-decomposer.service";
import { RetrievalToolService } from "../rag/retrieval-tool.service";
import { ExecutionPlannerService } from "./execution-planner.service";
import { HospitalDirectoryService } from "./hospital-directory.service";
import { PlanExecutorService } from "./plan-executor.service";
import { RagService } from "../rag/rag.service";
import { ResponseTemplates } from "./response-templates";
import { preprocessUserText } from "./deterministic-safety";
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
 * with a baseline captured from code WITHOUT the reorder
 * (`__fixtures__/safety-path-baseline.json`). The current baseline was
 * captured from `ChatService` and the greeting detector as they stand on main
 * at b121036, which has no length limit and none of PR #202. The rows for
 * the probes PR #255 added to EXPECTED_DIFFERENCE_PROBES were captured on
 * main at f5690ec and merged in. On every older probe main at f5690ec gives
 * the b121036 rows, apart from #202's three listed long greetings. Every run must
 * match, apart from the probes listed in EXPECTED_DIFFERENCES, which must
 * differ, for the reason given there.
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

type Variant = {
  name: string;
  channel: string;
  inputMode?: string;
  locale?: string;
  /** Session.locale. The disclaimer falls back to it when the request has none. */
  sessionLocale?: string;
  priorAssistant: number;
};
const VARIANTS: Variant[] = [
  // Web typed, first message, no request locale (the web client sends none).
  { name: "web-typed-first", channel: "web", priorAssistant: 0 },
  // WhatsApp-style typed text with a request locale and earlier replies.
  { name: "whatsapp-hi-later", channel: "whatsapp", locale: "hi", priorAssistant: 2 },
  // Spoken input: the cleanVoiceInput preprocessing branch.
  { name: "web-voice-first", channel: "web", inputMode: "voice", priorAssistant: 0 },
  // No request locale, so the session's locale decides the disclaimer language.
  { name: "web-session-hi", channel: "web", sessionLocale: "hi", priorAssistant: 1 },
  { name: "web-session-bh", channel: "web", sessionLocale: "bh", priorAssistant: 0 },
];

/**
 * Probes added in code (review of PR #202), all synthetic.
 *
 * Long messages with the safety phrase after 4096 characters (reviews B1
 * and B2): main reads the whole message, and so must this branch.
 *
 * Personal symptom questions after 4,100 and 9,000 characters of neutral
 * filler, with and without a greeting opener (review B4). They exercise
 * routing past the safety gates: mode, intent, the symptom redirect.
 *
 * Overlaps that trip more than one screen without the fast path, so that
 * any change to the order of precedence changes a reply: the safety module
 * with urgency, and urgency with the mental-health screen.
 */
/**
 * Probes where the branch is MEANT to differ from main, with the reason. The
 * comparison requires each of them to differ in at least one run, so the
 * difference stays pinned and visible.
 *
 * Greeting bound (PR #202): a message over 500 characters that opens with a
 * greeting word main recognises is no longer answered with the greeting
 * menu. It is routed like any other message.
 */
const GREETING_TAIL = "I wanted to say thank you for the kind words last week. ".repeat(10);
const EXPECTED_DIFFERENCE_PROBES: Array<{ text: string; reason: string }> = [
  { text: "hello how are you " + GREETING_TAIL, reason: "greeting bound: over 500 characters is never a greeting" },
  { text: "namaste, " + GREETING_TAIL, reason: "greeting bound: over 500 characters is never a greeting" },
  // Main's greeting check misses these symptom words, so main shows the
  // greeting menu. The branch routes the symptom question.
  {
    text: "hello how are you " + "I have had a lump in my breast for two weeks and it hurts. ".repeat(10),
    reason: "greeting bound: main answered a 608 character symptom message with the greeting menu",
  },
  // Hindi and Hinglish greetings (PR #255). None of these trips a safety
  // screen. They differ only in which greeting or answer path they take.
  { text: "hello there", reason: "greetings: now a greeting (the address word 'there'), main sent it to the pipeline" },
  {
    text: "नमस्ते सुचि, मुझे कुछ जानकारी चाहिए।\nHello Suchi, I would like some information.",
    reason: "greetings: the site's greeting now gets the Hindi then English welcome, main missed the greeting route",
  },
  { text: "नमस्ते सुचि", reason: "greetings: a Devanagari greeting now gets the Hindi welcome, main missed the greeting route" },
  { text: "namaste", reason: "greetings: a romanised Hindi first greeting now gets the Hindi welcome, main gave the English one" },
  // Review F2: main's pattern took "namaste" or "namaskar" followed by
  // anything as a greeting, so these symptom messages got the welcome.
  { text: "namaste ji saans phool rahi hai", reason: "F2: main answered a breathing symptom with the greeting, now routed" },
  { text: "namaskar ji, stan me ganth hai", reason: "F2: main answered a breast lump with the greeting, now routed" },
  { text: "namaste 102 bukhar", reason: "F2: main answered a fever with the greeting, now routed" },
];
const EXPECTED_DIFFERENCE_KEYS = new Set(EXPECTED_DIFFERENCE_PROBES.map((p) => probeKey(p.text)));

const EN_FILLER = "I have some questions about my treatment plan. ";
const HI_FILLER = "मेरे इलाज के बारे में कुछ सवाल हैं। ";
const EXTRA_PROBES: Array<{ source: string; text: string }> = [
  { source: "long", text: EN_FILLER.repeat(200) + " I want to kill myself" },
  { source: "long", text: EN_FILLER.repeat(200) + " I am coughing up blood right now" },
  { source: "long", text: EN_FILLER.repeat(200) + " I don't want to live anymore" },
  { source: "long", text: HI_FILLER.repeat(400) + " सांस नहीं आ रही" },
  { source: "long", text: HI_FILLER.repeat(400) + " जीने का मन नहीं है" },
  // Urgency only (no fast path, no safety rule) beyond 4096 (review B2). The
  // urgent template is chosen by text that the cut would drop.
  { source: "long-urgency", text: EN_FILLER.repeat(200) + " weakness on one side" },
  { source: "long-urgency", text: EN_FILLER.repeat(200) + " coughed up blood" },
  { source: "long-urgency", text: EN_FILLER.repeat(420) + " this is an emergency, please help" },
  { source: "long-urgency", text: HI_FILLER.repeat(400) + " weakness on one side" },
  { source: "long-urgency", text: HI_FILLER.repeat(400) + " coughed up blood" },
  { source: "overlap", text: "how much painkiller should I take, the pain is severe" },
  { source: "overlap", text: "is it safe to stop chemo, she has been confused since yesterday" },
  { source: "overlap", text: "do I have cancer, I am breathless" },
  { source: "overlap", text: "I feel so alone and the pain is severe" },
  { source: "overlap", text: "I feel hopeless and I am confused" },
  ...routingProbes(),
  ...mixedScriptProbes(),
  ...EXPECTED_DIFFERENCE_PROBES.map((p) => ({ source: "expected-difference", text: p.text })),
];

function routingProbes(): Array<{ source: string; text: string }> {
  const en = "Thank you for reading my message. ";
  const hi = "मेरा संदेश पढ़ने के लिए धन्यवाद। ";
  const pad = (f: string, n: number) => f.repeat(Math.ceil(n / f.length)).slice(0, n);
  const enQ = " I have had a lump in my breast for two weeks and it hurts, what should I do?";
  const hiQ = " मेरे स्तन में दो हफ्ते से गांठ है और दर्द होता है, मुझे क्या करना चाहिए?";
  const out: Array<{ source: string; text: string }> = [];
  for (const n of [4_100, 9_000]) {
    out.push({ source: "routing", text: pad(en, n) + enQ });
    out.push({ source: "routing", text: "hello, " + pad(en, n) + enQ });
    out.push({ source: "routing", text: pad(hi, n) + hiQ });
    out.push({ source: "routing", text: "नमस्ते, " + pad(hi, n) + hiQ });
  }
  // General "how to identify" questions, which the evidence gate treats on
  // their own terms, after impersonal filler (a personal word anywhere makes
  // the question personal, and the gate then treats it as such).
  const enGen = "This is some general background text. ";
  const hiGen = "यह कुछ सामान्य पृष्ठभूमि पाठ है। ";
  const enId = " How to identify the signs of lymphoma?";
  const hiId = " लिंफोमा के लक्षण क्या हैं, कैसे पहचानें?";
  for (const n of [4_100, 9_000]) {
    out.push({ source: "routing-identify", text: pad(enGen, n) + enId });
    out.push({ source: "routing-identify", text: pad(hiGen, n) + hiId });
  }
  // The same questions on their own, as a short control.
  out.push({ source: "routing", text: enQ.trim() }, { source: "routing", text: hiQ.trim() });
  out.push({ source: "routing-identify", text: enId.trim() }, { source: "routing-identify", text: hiId.trim() });
  return out;
}
const ALL_PROBES = [...PROBES, ...EXTRA_PROBES];

/**
 * Messages over 20,000 characters whose head and tail are in different
 * scripts, with the safety or urgency phrase only in the tail (review F5).
 * The reply's language decisions read one text, so its parts agree.
 */
function mixedScriptProbes(): Array<{ source: string; text: string }> {
  const en = "Thank you for reading my message. ";
  const hi = "मेरा संदेश पढ़ने के लिए धन्यवाद। ";
  const pad = (f: string, n: number) => f.repeat(Math.ceil(n / f.length)).slice(0, n);
  return [
    // English head, Devanagari tail with an urgency-only phrase.
    { source: "mixed-script", text: pad(en, 21_000) + pad(hi, 4_000) + " पापा confused हैं" },
    // Devanagari head, English tail with an urgency-only phrase.
    { source: "mixed-script", text: pad(hi, 21_000) + pad(en, 4_000) + " weakness on one side" },
    // English head, Devanagari tail with an emergency phrase.
    { source: "mixed-script", text: pad(en, 21_000) + pad(hi, 4_000) + " मम्मी बेहोश हो गई" },
  ];
}

/** How a probe is named in the baseline file. Long probes by length and hash. */
function probeKey(text: string): string {
  return text.length <= 300 ? text : `${text.length} chars, sha1 ${createHash("sha1").update(text).digest("hex")}`;
}

/**
 * Mock configurations. "gates" stops each turn at the first ordinary step
 * after the safety gates, over every variant. The other three run the whole
 * pipeline with retrieval and the LLM returning content (review B4), over
 * two variants: chunks with a cited answer, no retrieval, chunks with the
 * LLM throwing, and low-similarity chunks with a cited answer.
 */
type Config = { name: "gates" | "cited-answer" | "no-retrieval" | "llm-throws" | "weak-chunks"; variants: string[] };
const CONFIGS: Config[] = [
  { name: "gates", variants: VARIANTS.map((v) => v.name) },
  { name: "cited-answer", variants: ["web-typed-first", "whatsapp-hi-later"] },
  { name: "no-retrieval", variants: ["web-typed-first", "whatsapp-hi-later"] },
  { name: "llm-throws", variants: ["web-typed-first", "whatsapp-hi-later"] },
  // One low-similarity, untrusted chunk with a cited answer: the evidence
  // gate's own reading of the question decides whether the turn is answered.
  { name: "weak-chunks", variants: ["web-typed-first", "whatsapp-hi-later"] },
];

const CHUNKS = [1, 2, 3].map((i) => ({
  id: `chunk-${i}`,
  chunkId: `chunk-${i}`,
  docId: `doc-${i}`,
  content: `Synthetic trusted evidence ${i} about cancer symptoms, treatment and when to see a doctor.`,
  similarity: 0.82,
  vecSim: 0.82,
  lexSim: 0.4,
  document: {
    title: `Synthetic source ${i}`,
    url: `https://example.org/doc-${i}`,
    sourceType: "02_nci_core",
    source: "NCI",
    citation: null,
    isTrustedSource: true,
  },
}));
const CITED_ANSWER =
  "Here is general information from trusted sources [citation:doc-1:chunk-1]. " +
  "Please discuss any new symptom with your doctor [citation:doc-2:chunk-2].";

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

function buildService(prisma: any, config: Config["name"]): { svc: ChatService; seen: any[] } {
  const empathy = new EmpathyDetector();
  const greeting = new GreetingFlowService(prisma, empathy);
  if (config === "gates") {
    jest.spyOn(greeting, "isGreetingFlowInProgress").mockRejectedValue(new Error(PAST_GATES));
  }
  const abstention = new AbstentionService();
  const intent = new IntentClassifier(abstention);
  // Every argument that reaches retrieval and the LLM is recorded, so the
  // comparison also pins what they are given (one text value, as on main).
  const seen: any[] = [];
  const chunks =
    config === "no-retrieval"
      ? []
      : config === "weak-chunks"
        ? [
            {
              ...CHUNKS[0],
              similarity: 0.05,
              vecSim: 0.05,
              lexSim: 0,
              document: { ...CHUNKS[0].document, sourceType: "99_other", isTrustedSource: false },
            },
          ]
        : CHUNKS;
  const retrieve = (name: string) =>
    jest.fn(async (...args: any[]) => {
      seen.push([name, args]);
      return config === "gates" ? [] : chunks.map((c) => ({ ...c }));
    });
  const llmCall = (name: string, answer: string) =>
    jest.fn(async (...args: any[]) => {
      seen.push([name, args.filter((a) => typeof a === "string")]);
      if (config === "gates") throw new Error("not expected on the safety path");
      if (config === "llm-throws") throw new Error("LLM unavailable");
      return answer;
    });
  const rag = {
    retrieveWithMetadata: retrieve("rag.retrieveWithMetadata"),
    retrieveWithExpansion: retrieve("rag.retrieveWithExpansion"),
    // The real filter. It is a pure function of its arguments.
    applyPatientStateFilter: (c: any[], st: any) =>
      RagService.prototype.applyPatientStateFilter.call({ logger: new Logger("RagService") }, c, st),
  } as any;
  const svc = new ChatService(
    prisma,
    new AnalyticsService(prisma),
    new SafetyService(),
    rag,
    {
      generateWithCitations: llmCall("llm.generateWithCitations", CITED_ANSWER),
      generateRaw: llmCall("llm.generateRaw", CITED_ANSWER),
      generate: llmCall("llm.generate", "Synthetic supportive reply. Please see a doctor about this."),
    } as any,
    new EvidenceGateService(prisma),
    new CitationService(),
    abstention,
    intent,
    new TemplateSelector(intent),
    new ResponseValidatorService(),
    greeting,
    empathy,
    new StructuredExtractorService(),
    new PatientStateService(),
    new ClinicalKeywordEnforcerService(),
    new RetrievalToolService(rag),
    new QueryDecomposerService(),
    new CrossLingualService(),
    new ExecutionPlannerService(new HospitalDirectoryService()),
    new PlanExecutorService(new RetrievalToolService(rag), new OutputVerifierService()),
    new OutputVerifierService(),
    {
      copilotMode: "off",
      review: jest.fn(async () => ({ verdict: "PASS", hardFailures: [] })),
      persistRecord: jest.fn(async () => undefined),
      buildBlockedFallback: jest.fn(),
    } as any,
    { startTrace: () => ({}), startSpan: () => ({}), endSpan: () => undefined, finalizeTrace: () => undefined } as any,
  );
  return { svc, seen };
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
  const scrub = (v: any): any =>
    atCeiling(stripTimings(JSON.parse(JSON.stringify(v ?? null).split(sessionId).join("SESSION"))));
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

/**
 * Write order across tables, pinned where it is meant to equal main's.
 *
 * `turnRows` always: the user message, then the reply, then the SafetyEvent.
 *
 * `allWrites` only for turns that take the ordinary or urgency path, which
 * PR #202 leaves in place. Deterministic safety replies now write behind the
 * reply, so their analytics and session-context writes may interleave
 * differently from main's. That is timing, not content.
 */
function writeOrder(calls: Array<{ model: string; method: string; args: any }>, ordinaryOrUrgency: boolean) {
  const label = (c: { model: string; method: string; args: any }) =>
    c.model === "message" && c.method === "create" ? `message.create:${c.args?.data?.role}` : `${c.model}.${c.method}`;
  const writes = calls.filter((c) => c.method !== "count" && c.method !== "findMany" && c.method !== "findUnique" && c.method !== "findFirst");
  const turnRows = writes.filter((c) => (c.model === "message" || c.model === "safetyEvent") && c.method === "create").map(label);
  return ordinaryOrUrgency ? { turnRows, allWrites: writes.map(label) } : { turnRows };
}

/**
 * Cut every string at the 20,000 character ceiling. Text beyond it is not
 * read or stored on the branch (a stated difference from main), so for the
 * few probes over 20,000 characters the stored row and the retrieval and LLM
 * arguments are compared up to the ceiling. Shorter strings are unchanged.
 */
function atCeiling(v: any): any {
  if (typeof v === "string") return v.length > MAX_USER_TEXT_HARD_LIMIT ? v.slice(0, MAX_USER_TEXT_HARD_LIMIT) : v;
  if (Array.isArray(v)) return v.map(atCeiling);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, atCeiling(x)]));
  return v;
}

/** Drop wall-clock fields (latencies, durations, timestamps) at any depth. */
function stripTimings(v: any): any {
  if (Array.isArray(v)) return v.map(stripTimings);
  if (v && typeof v === "object") {
    const out: any = {};
    for (const [k, x] of Object.entries(v)) {
      // planId embeds a timestamp.
      if (/(Ms|At)$|latency|duration|timestamp|^planId$/i.test(k)) continue;
      out[k] = stripTimings(x);
    }
    return out;
  }
  return v;
}

/** JSON with object keys sorted at every level. Array order still counts. */
function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, v[k]]))
      : v,
  );
}

async function runProbe(text: string, variant: Variant, config: Config["name"]) {
  const sessionId = `00000000-0000-4000-8000-${createHash("sha1").update(text + variant.name).digest("hex").slice(0, 12)}`;
  const sessionRow = {
    id: sessionId,
    createdAt: new Date(0),
    channel: variant.channel,
    locale: variant.sessionLocale ?? "en",
    userType: null,
    status: "active",
    userContext: null,
    cancerType: null,
    greetingCompleted: true,
    emotionalState: "neutral",
  };
  const { prisma, calls } = makeRecordingPrisma(sessionRow, variant.priorAssistant);
  const { svc, seen } = buildService(prisma, config);
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
  const urgencyPath = calls.some(
    (c) => c.model === "safetyEvent" && c.method === "create" && c.args?.data?.detail === "urgency_indicators_detected",
  );
  const record = {
    outcome,
    rows: normaliseRows(calls, sessionId),
    order: writeOrder(calls, outcome.kind !== "reply" || urgencyPath),
    // What retrieval and the LLM were given, with session ids scrubbed.
    calls: atCeiling(JSON.parse(JSON.stringify(seen).split(sessionId).join("SESSION"))),
  };
  // Keys are sorted first, so the order of fields in an insert does not count.
  const digest = createHash("sha256").update(canonicalJson(record)).digest("hex").slice(0, 20);
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

  const runs = CONFIGS.reduce((n, c) => n + c.variants.length * ALL_PROBES.length, 0);
  it(`replays ${ALL_PROBES.length} probes in ${CONFIGS.length} mock configurations (${runs} runs) against the baseline`, async () => {
    const results: Array<{ config: string; text: string; variant: string; label: string; digest: string }> = [];
    const records: Record<string, any> = {};
    for (const c of CONFIGS) {
      for (const p of ALL_PROBES) {
        for (const v of VARIANTS.filter((x) => c.variants.includes(x.name))) {
          const r = await runProbe(p.text, v, c.name);
          results.push({ config: c.name, text: probeKey(p.text), variant: v.name, label: r.label, digest: r.digest });
          records[`${c.name}::${v.name}::${probeKey(p.text)}`] = r.record;
        }
      }
    }

    // Diagnostic: write every full record (not only digests) for a diff.
    if (process.env.SAFETY_BASELINE_DUMP) {
      fs.writeFileSync(process.env.SAFETY_BASELINE_DUMP, JSON.stringify(records, null, 1) + "\n");
    }

    if (process.env.SAFETY_BASELINE_CAPTURE === "1") {
      // One line per run keeps the fixture readable in a diff.
      fs.writeFileSync(BASELINE_PATH, "[\n" + results.map((r) => JSON.stringify(r)).join(",\n") + "\n]\n");
      return;
    }

    const baseline: typeof results = JSON.parse(fs.readFileSync(BASELINE_PATH, "utf8"));
    expect(results.length).toBe(baseline.length);
    const mismatches = results
      .map((r, i) => ({ r, b: baseline[i] }))
      .filter(
        ({ r, b }) =>
          r.config !== b.config || r.text !== b.text || r.variant !== b.variant || r.label !== b.label || r.digest !== b.digest,
      )
      .filter(({ r }) => !EXPECTED_DIFFERENCE_KEYS.has(r.text))
      .map(({ r, b }) => ({
        config: r.config,
        variant: r.variant,
        text: r.text.slice(0, 80),
        before: b.label,
        after: r.label,
        record: records[`${r.config}::${r.variant}::${r.text}`],
      }));
    expect(mismatches).toEqual([]);

    // Each expected difference must still differ, so it stays visible.
    for (const p of EXPECTED_DIFFERENCE_PROBES) {
      const differs = results.some((r, i) => r.text === probeKey(p.text) && r.digest !== baseline[i].digest);
      expect({ probe: p.text.slice(0, 40), reason: p.reason, differs }).toEqual({
        probe: p.text.slice(0, 40),
        reason: p.reason,
        differs: true,
      });
    }

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
    // Every long probe gets a safety reply, as on main, whatever its length.
    const longKeys = new Set(
      EXTRA_PROBES.filter((p) => p.source === "long" || p.source === "long-urgency").map((p) => probeKey(p.text)),
    );
    for (const r of results.filter((x) => x.config === "gates" && longKeys.has(x.text))) {
      expect({ probe: r.text, variant: r.variant, label: r.label }).toEqual(
        expect.objectContaining({ label: expect.stringMatching(/^reply:(red_flag|self_harm|mental_health_crisis)$/) }),
      );
    }
  }, 600_000);
});

/**
 * Routing on long messages (review B4). A personal symptom question after
 * 4,100 or 9,000 characters of neutral filler, English or Devanagari, with or
 * without a greeting opener, must route as on main: the symptom soft redirect,
 * the `symptom_query` review flag, and the navigate frame when the LLM fails.
 * The LLM is given the whole message, as on main.
 */
describe("ChatService routing on long messages (review B4)", () => {
  beforeAll(() => {
    for (const level of ["log", "warn", "error", "debug"] as const) {
      jest.spyOn(Logger.prototype, level).mockImplementation(() => undefined);
    }
  });
  afterAll(() => jest.restoreAllMocks());

  const variant = VARIANTS.find((v) => v.name === "web-typed-first")!;
  const longRouting = routingProbes().filter((p) => p.source === "routing" && p.text.length > 4096);

  async function turn(text: string, config: Config["name"]) {
    const sessionId = "00000000-0000-4000-8000-0000000000b4";
    const sessionRow = {
      id: sessionId,
      createdAt: new Date(0),
      channel: "web",
      locale: "en",
      userType: null,
      status: "active",
      userContext: null,
      cancerType: null,
      greetingCompleted: true,
      emotionalState: "neutral",
    };
    const { prisma, calls } = makeRecordingPrisma(sessionRow, variant.priorAssistant);
    const { svc, seen } = buildService(prisma, config);
    const result: any = await svc.handle({ sessionId, channel: "web", userText: text } as any);
    await drain(svc);
    const flags = calls
      .filter((c) => c.model === "session" && c.method === "update")
      .map((c) => c.args?.data?.reviewFlagReason)
      .filter(Boolean);
    return { result, seen, flags, calls };
  }

  it("covers both lengths, both scripts and the greeting opener", () => {
    expect(longRouting).toHaveLength(8);
  });

  it.each(longRouting.map((p) => [p.text.length, p.text]))(
    "a %i character message: symptom redirect from the LLM, flagged for review, LLM given the whole message",
    async (_len, text) => {
      const { result, seen, flags, calls } = await turn(text as string, "cited-answer");
      expect(result.safety.classification).toBe("normal");
      expect(result.responseText.startsWith("Synthetic supportive reply.")).toBe(true);
      expect(flags).toContain("symptom_query");
      const whole = preprocessUserText(text as string, "web");
      const redirect = seen.find((s: any) => s[0] === "llm.generate");
      expect(redirect[1][redirect[1].length - 1]).toBe(whole);
      // The whole message is stored, as on main.
      const userRow = calls.find((c) => c.model === "message" && c.method === "create" && c.args.data.role === "user");
      expect(userRow.args.data.text).toBe(whole);
    },
  );

  it.each(longRouting.map((p) => [p.text.length, p.text]))(
    "a %i character message: the navigate frame when the LLM fails",
    async (_len, text) => {
      const { result, flags } = await turn(text as string, "llm-throws");
      expect(result.safety.classification).toBe("normal");
      const whole = preprocessUserText(text as string, "web");
      expect(result.responseText.startsWith(ResponseTemplates.navigateModeFrame(whole))).toBe(true);
      expect(flags).toContain("symptom_query");
    },
  );
});
