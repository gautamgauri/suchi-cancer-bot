import { classifyAgenticIntent } from "./agentic-intent-router";
import { ExecutionPlannerService } from "./execution-planner.service";
import { HospitalDirectoryService } from "./hospital-directory.service";

// #212: "X ke paas ... hospital kaun sa hai" is the natural Bihar phrasing of a
// hospital-directory question. Before this fix it fell through Stage 1, was mapped
// to EDUCATION, skipped planning, and prod answered Darbhanga with Patna centres.
describe("agentic router: Hinglish proximity hospital questions (#212)", () => {
  const navigation = [
    "Darbhanga ke paas radiotherapy wala cancer hospital kaun sa hai?",
    "Darbhanga ke paas kaun sa cancer hospital hai?",
    "Purnia ke nazdeek cancer ka ilaj kahan hota hai?",
    "Buxar ke aas-paas koi cancer hospital hai kya?",
    "Muzaffarpur me cancer hospital kaun sa hai?",
    "दरभंगा के पास कैंसर अस्पताल कौन सा है?",
  ];

  it.each(navigation)("classifies %s as NAVIGATION at Stage 1", (q) => {
    const r = classifyAgenticIntent(q, "SAFETY_RESTRICTED" as any, "high");
    expect(r.category).toBe("NAVIGATION");
    expect(r.isRuleBased).toBe(true);
  });

  it("does not turn a plain education question into navigation", () => {
    for (const q of [
      "kya cancer ek insaan se dusre ko chhune se lag sakta hai?",
      "chemo ke baad baal kab aate hain?",
      "radiotherapy ke side effects kya hain?",
    ]) {
      const r = classifyAgenticIntent(q, "GENERAL_EDUCATION" as any, "high");
      expect(r.category).not.toBe("NAVIGATION");
    }
  });

  it("routes the Darbhanga radiotherapy question to the geocoded directory, nearest capable centre first", () => {
    const dir = new HospitalDirectoryService();
    dir.onModuleInit();
    const planner = new ExecutionPlannerService(dir);
    const q = "Darbhanga ke paas radiotherapy wala cancer hospital kaun sa hai?";
    const category = classifyAgenticIntent(q, "SAFETY_RESTRICTED" as any, "high").category;
    expect(planner.needsPlanning(q, category, "SAFETY_RESTRICTED")).toBe(true);
    const plan: any = planner.plan(q, category, undefined as any, "hi", "SAFETY_RESTRICTED");
    const names = (plan.structuredHospitalResults ?? []).map((h: any) => h.short_name);
    expect(names.length).toBeGreaterThan(0);
    expect(names[0]).toMatch(/Muzaffarpur/);
    expect(plan.structuredHospitalResults[0].departments).toContain("radiation_oncology");
  });
});
