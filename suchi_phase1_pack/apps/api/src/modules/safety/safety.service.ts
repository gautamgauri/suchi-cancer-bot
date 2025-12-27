import { Injectable } from "@nestjs/common";
import { DIAGNOSIS_PATTERNS, DOSAGE_PATTERNS, EMERGENCY_PATTERNS, RULES, SELF_HARM_PATTERNS, STOP_TREATMENT_PATTERNS, REPORT_INTERPRETATION_PATTERNS, TREATMENT_CHOICE_PATTERNS } from "./safety.rules";
import { SafetyResult, TEMPLATES } from "./safety.templates";

@Injectable()
export class SafetyService {
  evaluate(userText: string): SafetyResult {
    const t = userText.trim();
    if (SELF_HARM_PATTERNS.some((re) => re.test(t))) return TEMPLATES.selfHarm();
    if (EMERGENCY_PATTERNS.some((re) => re.test(t))) return TEMPLATES.emergency(RULES.EMERGENCY);
    if (STOP_TREATMENT_PATTERNS.some((re) => re.test(t))) return TEMPLATES.misinfo(RULES.MISINFO_STOP_TREATMENT);
    if (REPORT_INTERPRETATION_PATTERNS.some((re) => re.test(t))) return TEMPLATES.refusal(RULES.REFUSAL_REPORT_INTERPRETATION);
    if (TREATMENT_CHOICE_PATTERNS.some((re) => re.test(t))) return TEMPLATES.refusal(RULES.REFUSAL_TREATMENT_CHOICE);
    if (DOSAGE_PATTERNS.some((re) => re.test(t))) return TEMPLATES.refusal(RULES.REFUSAL_DOSAGE);
    if (DIAGNOSIS_PATTERNS.some((re) => re.test(t))) return TEMPLATES.refusal(RULES.REFUSAL_DIAGNOSIS);
    return { classification: "normal", rulesFired: [], actions: [] };
  }
}
