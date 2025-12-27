import { SafetyClassification } from "./safety.rules";
export interface SafetyResult {
  classification: SafetyClassification;
  rulesFired: string[];
  responseText?: string;
  actions: Array<"show_emergency_banner" | "suggest_doctor_visit" | "end_conversation">;
}

export const TEMPLATES = {
  selfHarm(): SafetyResult {
    return {
      classification: "self_harm",
      rulesFired: ["SAFE_SELF_HARM_V1"],
      actions: ["end_conversation"],
      responseText:
        "I’m really sorry you’re feeling this way. I can’t help with harming yourself, but you deserve immediate support. " +
        "If you are in immediate danger, contact local emergency services now. If you can, reach out to a trusted person right away. " +
        "If you tell me your country/city, I can suggest reputable crisis support options."
    };
  },
  emergency(ruleId: string): SafetyResult {
    return {
      classification: "red_flag",
      rulesFired: [ruleId],
      actions: ["show_emergency_banner", "end_conversation"],
      responseText:
        "Some of what you described could be urgent. Please seek emergency medical care now or call local emergency services. " +
        "If you can share your age and what symptoms are happening right now, I can help you prepare what to say to the clinician."
    };
  },
  refusal(ruleId: string): SafetyResult {
    let responseText = "I can't diagnose cancer or recommend medication doses. I can help with typical next steps, questions to ask your doctor, and warning signs that need urgent care.";
    
    if (ruleId === "SAFE_REFUSAL_REPORT_INTERPRETATION") {
      responseText = "I can't interpret medical reports, scans, or test results. Please share these with your doctor who can explain what they mean in the context of your specific situation. I can help you prepare questions to ask your doctor about your results.";
    } else if (ruleId === "SAFE_REFUSAL_TREATMENT_CHOICE") {
      responseText = "I can't recommend specific treatments or medications for individual cases. Treatment decisions should be made with your oncology team based on your specific diagnosis, stage, and other factors. I can help you understand general treatment options and prepare questions to discuss with your doctor.";
    } else if (ruleId === "SAFE_REFUSAL_DOSAGE") {
      responseText = "I can't provide medication dosing information or instructions on when/how to take medications. Please follow your doctor's prescribed dosage and timing. If you have questions about your medication, contact your healthcare provider or pharmacist.";
    }
    
    return {
      classification: "refusal",
      rulesFired: [ruleId],
      actions: ["suggest_doctor_visit"],
      responseText
    };
  },
  misinfo(ruleId: string): SafetyResult {
    return {
      classification: "refusal",
      rulesFired: [ruleId],
      actions: ["suggest_doctor_visit"],
      responseText:
        "I can’t support stopping prescribed cancer treatment based on unverified claims. Please discuss any changes with your oncology team."
    };
  }
};
