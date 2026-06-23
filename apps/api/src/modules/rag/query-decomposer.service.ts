/**
 * Query Decomposer — Phase 2: Multi-Intent Decomposition
 *
 * Analyzes a user query and session context, then produces a list of
 * retrieval calls the RetrievalToolService should execute. This is
 * the "Planner" component for retrieval — it decides WHAT to retrieve,
 * not HOW to retrieve it.
 *
 * Key insight from the plan: "My uncle has a biopsy report, we're in
 * Gaya, budget is tight" needs HOSPITAL OPTIONS + SCHEME ELIGIBILITY +
 * DOCUMENT CHECKLIST. One retrieval call can't serve all three.
 *
 * Design:
 *  - Pure rule-based decomposition (zero LLM cost)
 *  - Uses agentic intent category + signal detection from the query
 *  - Produces 1-5 RetrievalToolParams per query
 *  - Respects session context (cancer type, district, budget concern)
 */

import { Injectable, Logger } from "@nestjs/common";
import { RetrievalToolParams, RetrievalIntent } from "./retrieval-tool.service";
import { AgenticCategory } from "../chat/agentic-intent-router";

// ─── Types ────────────────────────────────────────────────────────

export interface SessionContext {
  cancerType?: string | null;
  district?: string | null;
  budgetConcern?: boolean;
  userContext?: string | null;  // "patient" | "caregiver" | "general"
  emotionalState?: string | null;
}

export interface DecompositionResult {
  /** The retrieval calls to execute */
  calls: RetrievalToolParams[];
  /** Reasoning for this decomposition (for observability) */
  reasoning: string;
  /** Signals detected in the query */
  detectedSignals: string[];
}

// ─── Signal detectors ─────────────────────────────────────────────

interface Signal {
  name: string;
  patterns: RegExp[];
  retrieval: {
    intent: RetrievalIntent;
    queryTemplate?: (match: string, context: SessionContext) => string;
  };
}

const SIGNALS: Signal[] = [
  // Location signals → navigation retrieval
  {
    name: "location_mentioned",
    patterns: [
      /\b(patna|gaya|muzaffarpur|bhagalpur|bihar|darbhanga|munger|nalanda|vaishali|saran|gopalganj|siwan|chapra|motihari|bettiah|purnia|araria|katihar|kishanganj|saharsa|madhepura|supaul)\b/i,
      /\b(delhi|mumbai|kolkata|chennai|bangalore|hyderabad|lucknow|varanasi|jaipur|chandigarh)\b/i,
      /\b(near|nearby|closest|nearest|local|area|district|city|town|region)\b.*\b(hospital|doctor|center|centre|clinic)\b/i,
      /\b(hospital|doctor|center|centre|clinic)\b.*\b(near|nearby|closest|nearest|in|at)\b/i,
    ],
    retrieval: {
      intent: "navigation",
      queryTemplate: (match, ctx) => {
        const base = `cancer hospital ${match}`;
        return ctx.cancerType ? `${ctx.cancerType} ${base}` : base;
      },
    },
  },

  // Budget/financial signals → schemes retrieval
  {
    name: "budget_concern",
    patterns: [
      /\b(budget|afford|expensive|cost|cheap|free|paisa|paise|money|financial|garib|poor|bpl)\b/i,
      /\b(tight|low|no)\s+(budget|money|funds|income)\b/i,
      /\bkitna\s*(kharcha|paisa|cost)\b/i,
      /पैसे?\s*(की|का|के)?\s*(तंगी|कमी|दिक्कत)/i,
      /गरीब|बीपीएल/i,
    ],
    retrieval: {
      intent: "schemes",
      queryTemplate: (_match, ctx) => {
        const district = ctx.district || "Bihar";
        return `government cancer scheme financial assistance ${district}`;
      },
    },
  },

  // Scheme-specific signals → schemes retrieval
  {
    name: "scheme_query",
    patterns: [
      /\b(ayushman|pmjay|pm-jay|pradhan\s+mantri)\b/i,
      /\b(government|govt|sarkari)\s+(scheme|yojana|help)\b/i,
      /आयुष्मान/i,
      /सरकारी\s*(योजना|स्कीम|मदद)/i,
      /\b(rashtriya|swasthya|bima|arogya)\b/i,
    ],
    retrieval: {
      intent: "schemes",
      queryTemplate: (match) => `${match} cancer treatment coverage eligibility`,
    },
  },

  // Report/biopsy signals → checklist + navigation retrieval
  {
    name: "report_received",
    patterns: [
      /\b(biopsy|report|result)\s+(aa\s*gaya|aa\s*gayi|aa\s*gai|aaya|aya|aai|came|received|mil\s*gaya|mil\s*gayi|milaa?)\b/i,
      /\b(got|have|received)\s+(my|the|a)\s+(biopsy|report|test\s*result|scan\s*result)/i,
      /बायोप्सी\s*(रिपोर्ट)?\s*(आया|आई|मिला|आ\s*गई|आ\s*गया)/i,
      /रिपोर्ट\s*(आ\s*गई|आ\s*गया|मिल\s*गई|आई)/i,
    ],
    retrieval: {
      intent: "checklist",
      queryTemplate: (_match, ctx) => {
        const cancer = ctx.cancerType ? `${ctx.cancerType} cancer` : "cancer";
        return `documents needed ${cancer} hospital first visit biopsy report`;
      },
    },
  },

  // "What next" / navigation signals
  {
    name: "next_steps",
    patterns: [
      /\b(what|kya)\s*(next|aage|aagey)\b/i,
      /\b(aage|agey?)\s*(kya|what)\s*(karna|kare|karein|hoga|karu)\b/i,
      /आगे\s*क्या/i,
      /\b(what\s+should\s+(i|we)\s+do|what\s+to\s+do)\b/i,
      /\b(next\s+step|first\s+step|what\s+now)\b/i,
    ],
    retrieval: {
      intent: "navigation",
      queryTemplate: (_match, ctx) => {
        const cancer = ctx.cancerType ? `${ctx.cancerType} cancer` : "cancer";
        return `${cancer} patient journey next steps after diagnosis`;
      },
    },
  },

  // Hospital/doctor search signals
  {
    name: "hospital_search",
    patterns: [
      /\b(which|best|good|nearest|kaunsa)\s*(hospital|doctor|oncologist|cancer\s*center)\b/i,
      /\b(hospital|doctor|oncologist)\s*(for|near|in)\b/i,
      /कौन\s*सा?\s*(हॉस्पिटल|अस्पताल|डॉक्टर)/i,
      /\b(kaun\s*sa|sabse\s*acha)\s*(hospital|doctor)\b/i,
    ],
    retrieval: {
      intent: "navigation",
      queryTemplate: (_match, ctx) => {
        const district = ctx.district || "";
        const cancer = ctx.cancerType || "cancer";
        return `${cancer} treatment hospital ${district}`.trim();
      },
    },
  },

  // Chemo/treatment preparation signals
  {
    name: "treatment_prep",
    patterns: [
      /\b(prepare|preparation|ready)\s+(for|before)\s+(chemo|chemotherapy|radiation|surgery|treatment)\b/i,
      /\b(what\s+to)\s+(expect|bring|prepare)\s+(for|at|before)\s+(chemo|surgery|radiation)\b/i,
      /\b(chemo|surgery|radiation)\s+(day|session|cycle)\b/i,
      /कीमो\s*(से\s*पहले|की\s*तैयारी)/i,
    ],
    retrieval: {
      intent: "checklist",
      queryTemplate: (match, ctx) => {
        const cancer = ctx.cancerType || "cancer";
        return `${cancer} ${match.trim()} preparation checklist what to expect`;
      },
    },
  },

  // Second opinion signals
  {
    name: "second_opinion",
    patterns: [
      /\b(second\s+opinion|another\s+doctor|dusra\s+doctor|doosra\s+doctor)\b/i,
      /\b(should\s+(i|we)\s+)(go|consult|see)\s+(another|different)\b/i,
      /दूसर[ाे]\s*(डॉक्टर|राय)/i,
    ],
    retrieval: {
      intent: "navigation",
      queryTemplate: (_match, ctx) => {
        const cancer = ctx.cancerType || "cancer";
        return `${cancer} second opinion how when why cancer center`;
      },
    },
  },

  // Emotional distress signals → psychosocial content
  {
    name: "emotional_distress",
    patterns: [
      /\b(scared|terrified|afraid|anxiety|depressed|hopeless|overwhelmed|lonely)\b/i,
      /\b(fear|worry|stress|tension)\b.*\b(cancer|diagnosis|treatment|chemo)\b/i,
      /\b(how\s+do\s+i\s+tell|how\s+to\s+tell)\b.*\b(children|family|kids|spouse|husband|wife)\b/i,
      /बहुत\s*(डर|चिंता|तनाव|अकेला)/i,
      /\b(bahut|bht)\s*(darr?|tension|akela)\b/i,
    ],
    retrieval: {
      intent: "psychosocial",
      queryTemplate: (_match) => "cancer emotional support coping caregiver counseling",
    },
  },

  // Caregiver signals
  {
    name: "caregiver_context",
    patterns: [
      /\b(my|mere)\s+(mother|father|wife|husband|uncle|aunt|brother|sister|child|son|daughter|parent|maa|papa|bhai|behen|pati|patni)\b/i,
      /\b(caregiver|caregiving|taking\s+care|look\s+after)\b/i,
      /\b(he|she|they)\s+(has|have|got|was)\s+(diagnosed|cancer|biopsy)\b/i,
      /\b(unke|unki|uska|uski)\s*(cancer|biopsy|report|ilaj)\b/i,
    ],
    retrieval: {
      intent: "navigation",
      queryTemplate: (_match, ctx) => {
        const cancer = ctx.cancerType || "cancer";
        return `${cancer} caregiver guide patient journey what to do`;
      },
    },
  },
];

// ─── Category → default retrieval mapping ─────────────────────────

const CATEGORY_DEFAULTS: Record<AgenticCategory, RetrievalIntent> = {
  EMERGENCY: "navigation",
  NAVIGATION: "navigation",
  SCHEMES: "schemes",
  PSYCHOSOCIAL: "psychosocial",
  ADMIN: "navigation",
  EDUCATION: "education",
};

// ─── Service ─────────────────────────────────────────────────────

@Injectable()
export class QueryDecomposerService {
  private readonly logger = new Logger(QueryDecomposerService.name);

  /**
   * Decompose a user query into 1-5 retrieval tool calls.
   *
   * @param userText - Original user message
   * @param category - Agentic intent category (from Phase 1 router)
   * @param sessionContext - Session state for personalization
   * @returns DecompositionResult with retrieval calls to execute
   */
  decompose(
    userText: string,
    category: AgenticCategory,
    sessionContext: SessionContext = {}
  ): DecompositionResult {
    const detectedSignals: string[] = [];
    const calls: RetrievalToolParams[] = [];
    const seenIntents = new Set<string>(); // Avoid duplicate intent calls

    // 1. Detect all signals in the user text
    for (const signal of SIGNALS) {
      const matched = signal.patterns.some((re) => re.test(userText));
      if (matched) {
        detectedSignals.push(signal.name);

        // Generate the retrieval call for this signal
        const intentKey = `${signal.retrieval.intent}`;
        if (!seenIntents.has(intentKey) || signal.name === "budget_concern") {
          const query = signal.retrieval.queryTemplate
            ? signal.retrieval.queryTemplate(userText, sessionContext)
            : userText;

          calls.push({
            query,
            intent: signal.retrieval.intent,
            cancerType: sessionContext.cancerType,
            topK: 5,
          });

          seenIntents.add(intentKey);
        }
      }
    }

    // 2. If budget concern detected but no schemes call yet, add one
    if (
      (detectedSignals.includes("budget_concern") ||
        sessionContext.budgetConcern) &&
      !seenIntents.has("schemes")
    ) {
      const district = sessionContext.district || "Bihar";
      calls.push({
        query: `government cancer scheme financial assistance ${district}`,
        intent: "schemes",
        cancerType: sessionContext.cancerType,
        topK: 3,
      });
      seenIntents.add("schemes");
      detectedSignals.push("budget_concern_from_session");
    }

    // 3. If no signals detected, fall back to category-based retrieval
    if (calls.length === 0) {
      const defaultIntent = CATEGORY_DEFAULTS[category];
      calls.push({
        query: userText,
        intent: defaultIntent,
        cancerType: sessionContext.cancerType,
        topK: 6,
      });
    }

    // 4. If "report_received" + "next_steps" detected, also add navigation
    if (
      detectedSignals.includes("report_received") &&
      !seenIntents.has("navigation")
    ) {
      const cancer = sessionContext.cancerType || "cancer";
      calls.push({
        query: `${cancer} after biopsy report next steps hospital visit`,
        intent: "navigation",
        cancerType: sessionContext.cancerType,
        topK: 4,
      });
      seenIntents.add("navigation");
    }

    // 5. Cap at 5 calls to control cost/latency
    const cappedCalls = calls.slice(0, 5);

    const reasoning = this.buildReasoning(
      userText,
      category,
      detectedSignals,
      cappedCalls
    );

    this.logger.log({
      event: "query_decomposed",
      userText: userText.substring(0, 60),
      category,
      detectedSignals,
      retrievalCalls: cappedCalls.length,
      intents: cappedCalls.map((c) => c.intent),
    });

    return {
      calls: cappedCalls,
      reasoning,
      detectedSignals,
    };
  }

  /**
   * Quick check: does this query benefit from multi-call retrieval?
   * Returns false for simple single-intent queries (saves overhead).
   */
  needsDecomposition(userText: string, category: AgenticCategory): boolean {
    // Emergency → no decomposition, fast-path handles it
    if (category === "EMERGENCY") return false;

    // Count how many signals match
    let signalCount = 0;
    for (const signal of SIGNALS) {
      if (signal.patterns.some((re) => re.test(userText))) {
        signalCount++;
        if (signalCount >= 2) return true;
      }
    }

    // Single-intent categories rarely need decomposition
    if (
      category === "EDUCATION" &&
      signalCount <= 1
    ) {
      return false;
    }

    // Navigation/Schemes often benefit from multi-call
    if (
      category === "NAVIGATION" ||
      category === "SCHEMES"
    ) {
      return true;
    }

    return signalCount >= 2;
  }

  private buildReasoning(
    userText: string,
    category: AgenticCategory,
    signals: string[],
    calls: RetrievalToolParams[]
  ): string {
    if (signals.length === 0) {
      return `No specific signals detected in "${userText.substring(0, 40)}...". Using default ${category} retrieval.`;
    }

    const signalList = signals.join(", ");
    const intentList = calls.map((c) => c.intent).join(", ");
    return `Detected signals [${signalList}] → ${calls.length} retrieval calls [${intentList}]`;
  }
}
