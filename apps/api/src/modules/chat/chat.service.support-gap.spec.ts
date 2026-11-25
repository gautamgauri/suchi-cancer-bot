import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { Logger } from "@nestjs/common";
import { ChatService } from "./chat.service";
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
 * The 70 questions of the practical support gap assessment (November 2026),
 * run through the real ChatService pipeline with the database, retrieval and
 * the LLM mocked, and compared with a baseline captured from main.
 *
 * The questions are the assessment's own test questions
 * (`docs/support/gap-assessment-2026-11.md`, PR #266). They are not user
 * messages.
 *
 * Retrieval returns three synthetic NCI-style chunks and the LLM returns a
 * fixed cited answer, so a reply that reaches the LLM is recognisable, and so
 * is every reply built without it. The hospital directory is the real one.
 *
 * The baseline (`__fixtures__/support-gap-baseline-main.json`) holds, for each
 * question, a label for the kind of reply and a digest of its text. It was
 * captured by running this file, unchanged, on main at fe9dec0:
 *   SUPPORT_GAP_CAPTURE=1 npx jest --runInBand --testPathPatterns support-gap
 * Do not re-capture it from a branch.
 *
 * Every reply that the branch builds without the LLM is checked line by line
 * against the verified file `apps/api/data/financial-support.json`: every
 * bullet is one of its facts, and every link and number in the reply is in it.
 */

const FIXTURE_DIR = path.join(__dirname, "__fixtures__");
const QUESTIONS: Array<{ id: string; kind: string; lang: string; text: string; assessed: string }> = JSON.parse(
  fs.readFileSync(path.join(FIXTURE_DIR, "support-gap-questions-2026-11.json"), "utf8"),
).questions;
const BASELINE_PATH = path.join(FIXTURE_DIR, "support-gap-baseline-main.json");
const VERIFIED_PATH = path.join(__dirname, "../../../data/financial-support.json");

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

function makePrisma(sessionRow: any) {
  let n = 0;
  const model = (name: string) =>
    new Proxy(
      {},
      {
        get: (_t, method: string) =>
          jest.fn(async (args: any) => {
            if (method === "count") return 0;
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
  return prisma;
}

const directory = new HospitalDirectoryService();

function buildService(prisma: any): { svc: ChatService; llmCalls: () => number } {
  const empathy = new EmpathyDetector();
  const greeting = new GreetingFlowService(prisma, empathy);
  const abstention = new AbstentionService();
  const intent = new IntentClassifier(abstention);
  let llm = 0;
  const retrieve = jest.fn(async () => CHUNKS.map((c) => ({ ...c })));
  const llmCall = (answer: string) =>
    jest.fn(async () => {
      llm += 1;
      return answer;
    });
  const rag = {
    retrieveWithMetadata: retrieve,
    retrieveWithExpansion: retrieve,
    applyPatientStateFilter: (c: any[], st: any) =>
      RagService.prototype.applyPatientStateFilter.call({ logger: new Logger("RagService") }, c, st),
  } as any;
  const svc = new ChatService(
    prisma,
    new AnalyticsService(prisma),
    new SafetyService(),
    rag,
    {
      generateWithCitations: llmCall(CITED_ANSWER),
      generateRaw: llmCall(CITED_ANSWER),
      generate: llmCall("Synthetic supportive reply. Please see a doctor about this."),
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
    new ExecutionPlannerService(directory),
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
  return { svc, llmCalls: () => llm };
}

/** Text of a reply without the disclaimer the persist layer appends to every reply. */
function body(text: string): string {
  const i = text.lastIndexOf("\n\n---\n*");
  return i >= 0 ? text.slice(0, i) : text;
}

/**
 * The kind of reply, read from its text. Written so that it labels replies
 * from main and from the branch alike.
 */
function labelReply(text: string, classification: string, llmCalls: number): string {
  if (classification !== "normal") return `safety:${classification}`;
  const b = body(text);
  if (/Checked on \d{1,2} \w+ \d{4}\./.test(b) && /^Here is what Suchi has (checked|on record)/m.test(b)) return "verified_answer";
  if (b.startsWith("Which city or state are you asking about?")) return "ask_place";
  if (b.startsWith("Suchi does not have confirmed information on that yet.")) return "practical_unknown";
  if (/^(Cancer centres|Suchi's hospital list has no)/.test(b) && b.includes("Suchi's hospital list")) return "directory_answer";
  if (b.includes("**Documents Required**")) return "scheme_template";
  if (b.includes("**Documents to Carry**")) {
    return /\*\*Hospital \/ Treatment Centre Information\*\*\n(Cancer centres|Nearest|The directory|Major)/.test(b)
      ? "visit_template_directory"
      : /\*\*Hospital \/ Treatment Centre Information\*\*/.test(b)
        ? "visit_template_kb"
        : "visit_template_no_list";
  }
  if (b.includes("NCI sources")) return "refusal_nci";
  if (b.includes("I can't confidently verify")) return "refusal_a0";
  if (b.includes("I don't have enough specific information in my knowledge base")) return "refusal_gate";
  const heading = b.match(/^\*\*([^*\n]+)\*\*$/m);
  if (heading && llmCalls === 0) return `template:${heading[1]}`;
  if (llmCalls > 0) return "llm";
  return "other";
}

async function run(text: string) {
  const sessionId = `00000000-0000-4000-8000-${createHash("sha1").update(text).digest("hex").slice(0, 12)}`;
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
  const prisma = makePrisma(sessionRow);
  const { svc, llmCalls } = buildService(prisma);
  const r: any = await svc.handle({ sessionId, channel: "web", userText: text } as any);
  for (let i = 0; i < 5; i++) {
    const s: any = svc;
    if (typeof s.settleBackgroundWrites === "function") await s.settleBackgroundWrites();
    await new Promise((res) => setImmediate(res));
  }
  const responseText: string = r.responseText ?? "";
  const classification: string = r.safety?.classification ?? "none";
  return {
    responseText,
    classification,
    label: labelReply(responseText, classification, llmCalls()),
    digest: createHash("sha256").update(responseText).digest("hex").slice(0, 16),
  };
}

type Row = { id: string; label: string; digest: string };

/**
 * What the branch is expected to give each question. "existing" means the
 * question takes the path it took on main (medical content, or a question
 * this change does not cover): its label is pinned too, so a change is seen.
 */
const EXPECTED: Record<string, string> = {
  // How to pay
  P01: "verified_answer",
  P02: "verified_answer",
  P03: "verified_answer",
  P04: "llm", // names chemo, so it is medical and takes the existing path
  P05: "verified_answer",
  P06: "verified_answer",
  P07: "llm", // names surgery
  P08: "verified_answer",
  P09: "verified_answer",
  P10: "verified_answer",
  P11: "verified_answer",
  P12: "refusal_a0", // names a test (PET CT scan): medical, the evidence gate abstains as on main
  P13: "visit_template_no_list", // names chemotherapy: medical, now the visit checklist with verified PM-JAY lines
  P14: "llm", // names radiation therapy
  P15: "practical_unknown",
  P16: "verified_answer",
  P17: "verified_answer",
  P18: "verified_answer",
  P19: "llm", // names medicines
  P20: "llm", // names medicines
  P21: "verified_answer",
  P22: "verified_answer",
  P23: "verified_answer",
  P24: "verified_answer",
  P25: "verified_answer",
  // Where to go
  W01: "visit_template_no_list", // a choice of hospital type, not a place question
  W02: "directory_answer",
  W03: "directory_answer",
  W04: "directory_answer",
  W05: "directory_answer",
  W06: "directory_answer",
  W07: "directory_answer",
  W08: "visit_template_directory",
  W09: "practical_unknown",
  W10: "refusal_a0", // a choice between two cities, not a place search: the evidence gate abstains as on main
  W11: "template:Understanding Your Biopsy Report", // names a biopsy report: medical, unchanged
  W12: "directory_answer",
  W13: "llm",
  W14: "directory_answer",
  W15: "directory_answer",
  W16: "directory_answer",
  W17: "directory_answer",
  W18: "directory_answer",
  W19: "llm",
  W20: "directory_answer",
};

const DETERMINISTIC = new Set(["verified_answer", "ask_place", "practical_unknown", "directory_answer"]);

describe("Practical support gap questions (assessment of November 2026) through the real pipeline", () => {
  beforeAll(() => {
    for (const level of ["log", "warn", "error", "debug"] as const) {
      jest.spyOn(Logger.prototype, level).mockImplementation(() => undefined);
    }
    directory.onModuleInit();
  });
  afterAll(() => jest.restoreAllMocks());

  it("runs all 70 questions and compares them with main", async () => {
    expect(QUESTIONS).toHaveLength(70);
    const rows: Row[] = [];
    const replies: Record<string, any> = {};
    for (const q of QUESTIONS) {
      const r = await run(q.text);
      rows.push({ id: q.id, label: r.label, digest: r.digest });
      replies[q.id] = { kind: q.kind, text: q.text, label: r.label, reply: r.responseText };
    }

    if (process.env.SUPPORT_GAP_DUMP) {
      fs.writeFileSync(process.env.SUPPORT_GAP_DUMP, JSON.stringify(replies, null, 1) + "\n");
    }
    if (process.env.SUPPORT_GAP_CAPTURE === "1") {
      fs.writeFileSync(BASELINE_PATH, "[\n" + rows.map((r) => JSON.stringify(r)).join(",\n") + "\n]\n");
      return;
    }

    const baseline: Row[] = JSON.parse(fs.readFileSync(BASELINE_PATH, "utf8"));
    const before = new Map(baseline.map((r) => [r.id, r]));

    // Summary by kind of support: deterministic verified answers, questions
    // asking for the place, practical "I do not know" replies, and replies
    // unchanged from main.
    const summary: Record<string, Record<string, number>> = {};
    for (const q of QUESTIONS) {
      const row = rows.find((r) => r.id === q.id)!;
      const s = (summary[q.kind] ||= { questions: 0, verified: 0, askPlace: 0, practicalUnknown: 0, unchanged: 0, otherChange: 0 });
      s.questions += 1;
      if (row.label === "verified_answer" || row.label === "directory_answer") s.verified += 1;
      else if (row.label === "ask_place") s.askPlace += 1;
      else if (row.label === "practical_unknown") s.practicalUnknown += 1;
      else if (before.get(q.id)!.digest === row.digest) s.unchanged += 1;
      else s.otherChange += 1;
    }
    if (process.env.SUPPORT_GAP_SUMMARY) {
      fs.writeFileSync(
        process.env.SUPPORT_GAP_SUMMARY,
        JSON.stringify({ summary, rows: rows.map((r) => ({ ...r, before: before.get(r.id)!.label })) }, null, 1) + "\n",
      );
    }

    // Each Pay and Where question gets the reply this change intends.
    for (const q of QUESTIONS.filter((x) => EXPECTED[x.id])) {
      expect({ id: q.id, label: rows.find((r) => r.id === q.id)!.label }).toEqual({ id: q.id, label: EXPECTED[q.id] });
    }

    // The other three kinds are outside this change. Every one of them must
    // take the same kind of path as on main, and the safety replies must be
    // byte-identical.
    for (const q of QUESTIONS.filter((x) => !EXPECTED[x.id])) {
      const row = rows.find((r) => r.id === q.id)!;
      const was = before.get(q.id)!;
      if (was.label.startsWith("safety:")) {
        expect({ id: q.id, label: row.label, digest: row.digest }).toEqual({ id: q.id, label: was.label, digest: was.digest });
      }
      expect({ id: q.id, deterministic: DETERMINISTIC.has(row.label) }).toEqual({ id: q.id, deterministic: false });
    }

    expect(summary).toEqual({
      Pay: { questions: 25, verified: 17, askPlace: 0, practicalUnknown: 1, unchanged: 4, otherChange: 3 },
      Where: { questions: 20, verified: 13, askPlace: 0, practicalUnknown: 1, unchanged: 4, otherChange: 2 },
      Treatment: { questions: 12, verified: 0, askPlace: 0, practicalUnknown: 0, unchanged: 12, otherChange: 0 },
      Emotional: { questions: 8, verified: 0, askPlace: 0, practicalUnknown: 0, unchanged: 8, otherChange: 0 },
      Mixed: { questions: 5, verified: 0, askPlace: 0, practicalUnknown: 0, unchanged: 3, otherChange: 2 },
    });

    // Every reply built without the LLM uses only what the verified file holds.
    const verified = JSON.parse(fs.readFileSync(VERIFIED_PATH, "utf8"));
    const facts = new Set<string>(collectFactTexts(verified));
    const fileText = JSON.stringify(verified);
    for (const q of QUESTIONS) {
      const { label, reply } = replies[q.id];
      if (label !== "verified_answer" && label !== "practical_unknown") continue;
      const b = body(reply);
      for (const line of b.split("\n").filter((l) => l.startsWith("- "))) {
        expect({ id: q.id, line, inFile: facts.has(line.slice(2)) }).toEqual({ id: q.id, line, inFile: true });
      }
      for (const url of (b.match(/https?:\/\/[^\s)]+/g) ?? []).map((u) => u.replace(/[.,]+$/, ""))) {
        expect({ id: q.id, url, inFile: fileText.includes(url) }).toEqual({ id: q.id, url, inFile: true });
      }
      for (const num of b.match(/\b\d[\d ]{2,}\d\b/g) ?? []) {
        expect({ id: q.id, num, inFile: fileText.includes(num) }).toEqual({ id: q.id, num, inFile: true });
      }
    }
  }, 300_000);
});

/** Every display sentence in the verified file. */
function collectFactTexts(file: any): string[] {
  const out: string[] = [];
  for (const topic of Object.values<any>(file.topics ?? {})) {
    for (const f of topic.facts ?? []) out.push(f.text);
  }
  for (const s of file.states ?? []) {
    for (const f of s.facts ?? []) out.push(f.text);
  }
  return out;
}
