export type SafetyClassification = "normal" | "refusal" | "red_flag" | "self_harm";

export const RULES = {
  EMERGENCY: "SAFE_EMERGENCY_V1",
  SELF_HARM: "SAFE_SELF_HARM_V1",
  REFUSAL_DIAGNOSIS: "SAFE_REFUSAL_DIAGNOSIS_V1",
  REFUSAL_DOSAGE: "SAFE_REFUSAL_DOSAGE_V1",
  REFUSAL_REPORT_INTERPRETATION: "SAFE_REFUSAL_REPORT_INTERPRETATION_V1",
  REFUSAL_TREATMENT_CHOICE: "SAFE_REFUSAL_TREATMENT_CHOICE_V1",
  MISINFO_STOP_TREATMENT: "SAFE_MISINFO_STOP_TREATMENT_V1"
} as const;

export const SELF_HARM_PATTERNS = [/kill myself/i, /end my life/i, /suicid(e|al)/i, /i want to die/i];
export const EMERGENCY_PATTERNS = [/vomiting blood/i, /uncontrolled bleeding/i, /severe chest pain/i, /can't breathe/i, /faint(ed|ing)/i];
export const DIAGNOSIS_PATTERNS = [/do i have cancer/i, /is it cancer/i, /can you diagnose/i, /what stage/i, /do i have.*cancer/i, /is this cancer/i];
export const DOSAGE_PATTERNS = [/\bmg\b/i, /dose/i, /how much .* take/i, /prescribe/i, /how many.*take/i, /when to take/i, /how often.*take/i];
export const STOP_TREATMENT_PATTERNS = [/stop chemo/i, /quit chemo/i, /only ayurveda/i, /alternative cure/i];
export const REPORT_INTERPRETATION_PATTERNS = [/interpret.*scan/i, /interpret.*report/i, /interpret.*test results/i, /what does.*mean.*lab/i, /what does.*scan show/i, /explain.*report/i, /reading.*results/i];
export const TREATMENT_CHOICE_PATTERNS = [/which.*treatment.*should.*take/i, /which.*chemo.*should/i, /which.*drug.*should.*take/i, /what treatment.*should i/i, /recommend.*treatment/i];
