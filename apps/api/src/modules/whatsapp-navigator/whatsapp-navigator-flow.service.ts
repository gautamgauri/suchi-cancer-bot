import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import * as fs from "fs";
import * as path from "path";
import {
  AffordabilityLevel,
  CancerTypeGroup,
  FlowStep,
  NavigatorMessage,
  NavigatorSession,
} from "./whatsapp-navigator.types";

// ---------------------------------------------------------------------------
// Department → cancer type group mapping
// ---------------------------------------------------------------------------
const CANCER_TYPE_DEPARTMENTS: Record<CancerTypeGroup, string[]> = {
  oral_head_neck: ["head_and_neck", "surgical_oncology", "radiation_oncology"],
  breast: ["medical_oncology", "surgical_oncology"],
  cervical_gynae: ["gynaecology", "gynaec_oncology", "surgical_oncology", "radiation_oncology"],
  blood_cancers: ["haematology", "hemato_oncology", "medical_oncology"],
  gi_cancers: ["surgical_oncology", "medical_oncology"],
  pediatric: ["pediatric_oncology"],
  other: ["medical_oncology", "surgical_oncology"],
};

// Nearby states fallback — if the selected state has no results, expand to
// neighbouring states in East India so the patient always gets an answer.
const NEARBY_STATES: Record<string, string[]> = {
  Bihar: ["Jharkhand", "West Bengal"],
  Jharkhand: ["Bihar", "West Bengal", "Odisha"],
  "West Bengal": ["Bihar", "Jharkhand", "Odisha"],
  Sikkim: ["West Bengal"],
  Other: ["Bihar", "Jharkhand", "West Bengal", "Odisha"],
};

// ---------------------------------------------------------------------------
// State / cancer-type / affordability option maps (for parsing user input)
// ---------------------------------------------------------------------------
const STATE_OPTIONS: Record<string, string> = {
  "1": "Bihar",
  "2": "Jharkhand",
  "3": "West Bengal",
  "4": "Sikkim",
  "5": "Other",
};

const CANCER_TYPE_OPTIONS: Record<string, CancerTypeGroup> = {
  "1": "oral_head_neck",
  "2": "breast",
  "3": "cervical_gynae",
  "4": "blood_cancers",
  "5": "gi_cancers",
  "6": "pediatric",
  "7": "other",
};

const AFFORDABILITY_OPTIONS: Record<string, AffordabilityLevel> = {
  "1": "government_only",
  "2": "mixed",
  "3": "any",
};

// ---------------------------------------------------------------------------
// Hospital shape (minimal — we only use what we need from the JSON)
// ---------------------------------------------------------------------------
interface Hospital {
  id: string;
  name: string;
  short_name: string;
  city: string;
  state: string;
  type: string;
  departments: string[];
  cost_tier: "Low" | "Medium" | "High";
  pmjay_empanelled: boolean | null;
  contact: { phone: string | null; address: string };
  score: number;
  status: string;
}

const DISCLAIMER =
  "\n\n⚠️ यह जानकारी केवल मार्गदर्शन के लिए है। / This is information only. Please consult a doctor for medical advice.";

@Injectable()
export class WhatsAppNavigatorFlowService implements OnModuleInit {
  private readonly logger = new Logger(WhatsAppNavigatorFlowService.name);
  private hospitals: Hospital[] = [];

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------
  onModuleInit(): void {
    this.loadHospitals();
  }

  private loadHospitals(): void {
    // Try multiple candidate paths to handle different working directories
    // (Jest runs from apps/api/, Cloud Run runs from apps/api/dist/, etc.)
    const RELATIVE_PATH = "apps/landing/src/content/hospitals.json";
    const candidates = [
      // From repo root (most common: Jest cwd = apps/api)
      path.resolve(process.cwd(), "..", "..", RELATIVE_PATH),
      // From apps/api (if cwd is set to repo root)
      path.resolve(process.cwd(), RELATIVE_PATH),
      // Absolute fallback using __dirname — works in ts-node source runs
      path.resolve(__dirname, "../../../../../../apps/landing/src/content/hospitals.json"),
      // dist/ layout: __dirname = apps/api/dist/modules/whatsapp-navigator
      path.resolve(__dirname, "../../../../../landing/src/content/hospitals.json"),
    ];

    for (const jsonPath of candidates) {
      try {
        const raw = fs.readFileSync(jsonPath, "utf-8");
        const parsed = JSON.parse(raw) as { hospitals: Hospital[] };
        this.hospitals = (parsed.hospitals ?? []).filter(
          (h) => h.status === "active"
        );
        this.logger.log(`Loaded ${this.hospitals.length} active hospitals from ${jsonPath}`);
        return;
      } catch {
        // Try next candidate
      }
    }

    this.logger.error(
      `Failed to load hospitals.json. Tried: ${candidates.join(", ")}`
    );
    this.hospitals = [];
  }

  // ---------------------------------------------------------------------------
  // Public entry point
  // ---------------------------------------------------------------------------
  processMessage(
    session: NavigatorSession,
    userInput: string
  ): { response: NavigatorMessage; updatedSession: NavigatorSession } {
    const input = userInput.trim();

    switch (session.step) {
      case "start":
        return this.handleStart(session);

      case "select_state":
        return this.handleSelectState(session, input);

      case "select_cancer_type":
        return this.handleSelectCancerType(session, input);

      case "select_affordability":
        return this.handleSelectAffordability(session, input);

      case "show_results":
      case "end":
        // Re-send results or offer restart
        return this.handleEnd(session);

      default:
        return this.handleStart(session);
    }
  }

  // ---------------------------------------------------------------------------
  // Step handlers
  // ---------------------------------------------------------------------------

  private handleStart(session: NavigatorSession): {
    response: NavigatorMessage;
    updatedSession: NavigatorSession;
  } {
    const response: NavigatorMessage = {
      text:
        "नमस्ते! Suchi Cancer Navigator में आपका स्वागत है।\nWelcome to Suchi Cancer Navigator.\n\nआप किस राज्य में हैं? / Which state are you in?",
      options: [
        { key: "1", label: "Bihar" },
        { key: "2", label: "Jharkhand" },
        { key: "3", label: "West Bengal" },
        { key: "4", label: "Sikkim" },
        { key: "5", label: "Other state / दूसरा राज्य" },
      ],
    };

    const updatedSession: NavigatorSession = {
      ...session,
      step: "select_state",
      updatedAt: new Date(),
    };

    return { response, updatedSession };
  }

  private handleSelectState(
    session: NavigatorSession,
    input: string
  ): { response: NavigatorMessage; updatedSession: NavigatorSession } {
    const selected = STATE_OPTIONS[input];

    if (!selected) {
      // Invalid input — re-prompt
      return {
        response: this.invalidInputMessage([
          { key: "1", label: "Bihar" },
          { key: "2", label: "Jharkhand" },
          { key: "3", label: "West Bengal" },
          { key: "4", label: "Sikkim" },
          { key: "5", label: "Other state / दूसरा राज्य" },
        ]),
        updatedSession: { ...session, updatedAt: new Date() },
      };
    }

    const response: NavigatorMessage = {
      text: "किस प्रकार का कैंसर? / Which type of cancer?",
      options: [
        { key: "1", label: "Oral / Mouth / Throat / मुँह-गला" },
        { key: "2", label: "Breast / स्तन" },
        { key: "3", label: "Cervical / Women's cancer / बच्चेदानी" },
        { key: "4", label: "Blood cancer / Leukemia / ब्लड कैंसर" },
        { key: "5", label: "Stomach / Intestine / GI / पेट" },
        { key: "6", label: "Child cancer / बच्चों का कैंसर" },
        { key: "7", label: "Other / Not sure / अन्य" },
      ],
    };

    const updatedSession: NavigatorSession = {
      ...session,
      state: selected,
      step: "select_cancer_type",
      updatedAt: new Date(),
    };

    return { response, updatedSession };
  }

  private handleSelectCancerType(
    session: NavigatorSession,
    input: string
  ): { response: NavigatorMessage; updatedSession: NavigatorSession } {
    const selected = CANCER_TYPE_OPTIONS[input];

    if (!selected) {
      return {
        response: this.invalidInputMessage([
          { key: "1", label: "Oral / Mouth / Throat / मुँह-गला" },
          { key: "2", label: "Breast / स्तन" },
          { key: "3", label: "Cervical / Women's cancer / बच्चेदानी" },
          { key: "4", label: "Blood cancer / Leukemia / ब्लड कैंसर" },
          { key: "5", label: "Stomach / Intestine / GI / पेट" },
          { key: "6", label: "Child cancer / बच्चों का कैंसर" },
          { key: "7", label: "Other / Not sure / अन्य" },
        ]),
        updatedSession: { ...session, updatedAt: new Date() },
      };
    }

    const response: NavigatorMessage = {
      text: "इलाज का खर्च? / Treatment budget?",
      options: [
        { key: "1", label: "Government hospital only (free / PMJAY) / सरकारी, मुफ़्त" },
        { key: "2", label: "Affordable private also OK / सस्ता प्राइवेट भी ठीक" },
        { key: "3", label: "Any hospital / कोई भी" },
      ],
    };

    const updatedSession: NavigatorSession = {
      ...session,
      cancerType: selected,
      step: "select_affordability",
      updatedAt: new Date(),
    };

    return { response, updatedSession };
  }

  private handleSelectAffordability(
    session: NavigatorSession,
    input: string
  ): { response: NavigatorMessage; updatedSession: NavigatorSession } {
    const selected = AFFORDABILITY_OPTIONS[input];

    if (!selected) {
      return {
        response: this.invalidInputMessage([
          { key: "1", label: "Government hospital only (free / PMJAY) / सरकारी, मुफ़्त" },
          { key: "2", label: "Affordable private also OK / सस्ता प्राइवेट भी ठीक" },
          { key: "3", label: "Any hospital / कोई भी" },
        ]),
        updatedSession: { ...session, updatedAt: new Date() },
      };
    }

    const updatedSession: NavigatorSession = {
      ...session,
      affordability: selected,
      step: "show_results",
      updatedAt: new Date(),
    };

    const results = this.buildResultsMessage(updatedSession);

    return {
      response: results,
      updatedSession: { ...updatedSession, step: "end" },
    };
  }

  private handleEnd(session: NavigatorSession): {
    response: NavigatorMessage;
    updatedSession: NavigatorSession;
  } {
    // Re-show results if session has enough context, otherwise offer restart
    if (session.state && session.cancerType && session.affordability) {
      const results = this.buildResultsMessage(session);
      return { response: results, updatedSession: { ...session, updatedAt: new Date() } };
    }

    return {
      response: {
        text:
          "नई खोज शुरू करने के लिए \"hi\" या \"1\" टाइप करें।\nType \"hi\" or \"1\" to start a new search.",
      },
      updatedSession: { ...session, updatedAt: new Date() },
    };
  }

  // ---------------------------------------------------------------------------
  // Hospital matching
  // ---------------------------------------------------------------------------

  private buildResultsMessage(session: NavigatorSession): NavigatorMessage {
    const { state, cancerType, affordability } = session;

    if (!state || !cancerType || !affordability) {
      return { text: "Session error. Please type \"hi\" to restart." };
    }

    const requiredDepts = CANCER_TYPE_DEPARTMENTS[cancerType];

    // Try primary state first, then expand to nearby states
    let matches = this.filterHospitals(state, requiredDepts, affordability);
    let usedFallback = false;

    if (matches.length === 0) {
      const nearby = NEARBY_STATES[state] ?? [];
      for (const fallbackState of nearby) {
        matches = this.filterHospitals(fallbackState, requiredDepts, affordability);
        if (matches.length > 0) {
          usedFallback = true;
          break;
        }
      }
    }

    // Fallback: relax affordability to any
    if (matches.length === 0 && affordability !== "any") {
      const allStates = [state, ...(NEARBY_STATES[state] ?? [])];
      for (const s of allStates) {
        matches = this.filterHospitals(s, requiredDepts, "any");
        if (matches.length > 0) {
          usedFallback = true;
          break;
        }
      }
    }

    // Sort by score descending, take top 3
    const top3 = matches.sort((a, b) => b.score - a.score).slice(0, 3);

    if (top3.length === 0) {
      return {
        text:
          "माफ़ करें, अभी इस क्षेत्र में मेल खाता अस्पताल नहीं मिला।\n" +
          "Sorry, no matching hospital found for your area right now.\n" +
          "Please contact SCCF for guidance." +
          DISCLAIMER,
      };
    }

    const header = usedFallback
      ? `आपके राज्य (${state}) में कोई मेल नहीं मिला — नज़दीकी अस्पताल दिखा रहे हैं:\n` +
        `No exact match in ${state} — showing nearby hospitals:\n\n`
      : `${state} में सुझाए गए अस्पताल / Recommended hospitals in ${state}:\n\n`;

    const cards = top3.map((h, i) => this.formatHospitalCard(i + 1, h)).join("\n\n");

    return {
      text: header + cards + DISCLAIMER,
    };
  }

  private filterHospitals(
    state: string,
    requiredDepts: string[],
    affordability: AffordabilityLevel
  ): Hospital[] {
    return this.hospitals.filter((h) => {
      // State match
      if (h.state.toLowerCase() !== state.toLowerCase()) return false;

      // Department/cancer type match — at least one required dept present
      const hasCapability = requiredDepts.some((dept) =>
        h.departments.includes(dept)
      );
      if (!hasCapability) return false;

      // Affordability filter
      if (affordability === "government_only") {
        if (h.cost_tier !== "Low") return false;
        const isGovOrTrust =
          h.type.toLowerCase().includes("government") ||
          h.type.toLowerCase().includes("trust") ||
          h.type.toLowerCase().includes("tmc");
        if (!isGovOrTrust && h.pmjay_empanelled !== true) return false;
      } else if (affordability === "mixed") {
        if (h.cost_tier === "High") return false;
      }
      // "any" — no filter

      return true;
    });
  }

  private formatHospitalCard(index: number, h: Hospital): string {
    const costLine =
      h.cost_tier === "Low"
        ? h.pmjay_empanelled === true
          ? "✅ Free / PMJAY accepted / मुफ़्त या PMJAY"
          : "✅ Government / Low cost / सरकारी / कम खर्च"
        : h.cost_tier === "Medium"
        ? "💰 Affordable / किफ़ायती"
        : "💳 Private / Check costs / खर्च जाँचें";

    const phone = h.contact?.phone
      ? `📞 Call: ${h.contact.phone}`
      : `📞 Call: check website / वेबसाइट देखें`;

    return (
      `🏥 ${index}. ${h.short_name || h.name}\n` +
      `📍 ${h.city}, ${h.state}\n` +
      `${costLine}\n` +
      `${phone}`
    );
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private invalidInputMessage(
    options: Array<{ key: string; label: string }>
  ): NavigatorMessage {
    return {
      text: "कृपया सही नंबर चुनें। / Please choose a valid number.",
      options,
    };
  }
}
