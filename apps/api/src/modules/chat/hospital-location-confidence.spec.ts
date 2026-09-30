import { ChatService } from "./chat.service";
import { ExecutionPlannerService } from "./execution-planner.service";
import { HospitalDirectoryService } from "./hospital-directory.service";

/**
 * Consumer-level regression for the location detector's false cities.
 *
 * Since #148 the city `detectLocation` returns orders the hospital directory by
 * straight-line distance, prints "~N km away" on each centre and heads the list
 * "Nearest cancer centres to <city>". The detector used to invent a city from
 * ordinary words ("What are" → Arrah, "aa gaya" → Gaya, "bukhar" → Buxar), so a
 * patient who never said where they were got a list measured from somewhere
 * else. The planner now only hands the directory a city at or above
 * LOCATION_CONFIDENCE_FOR_GEOGRAPHY; this pins that end to end, through the
 * planner and the prompt block the LLM actually reads.
 */
describe("hospital lookup — only a confidently named city drives distance", () => {
  let planner: ExecutionPlannerService;
  // buildHospitalContextBlock is a pure formatter; exercise it off the prototype.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chat: any = Object.create(ChatService.prototype);

  beforeAll(() => {
    const directory = new HospitalDirectoryService();
    directory.onModuleInit();
    expect(directory.isLoaded()).toBe(true);
    planner = new ExecutionPlannerService(directory);
  });

  const lookup = (text: string) => {
    const plan = planner.plan(text, "NAVIGATION", undefined, "en");
    expect(plan.structuredHospitalGeography).toBeTruthy();
    const block: string = chat.buildHospitalContextBlock(
      plan.structuredHospitalResults,
      plan.structuredHospitalGeography
    );
    return { plan, block };
  };

  it.each([
    ["What are the best hospitals for cancer treatment?"],
    ["Report aa gaya hai, ab kaun sa hospital jaayein?"],
    ["mujhe bukhar aur kamzori hai, kaunsa hospital"],
    ["Papa ko cancer hai, kya karein, hospital batao"],
    // A real city, but only a fuzzy (below-threshold) spelling of it.
    ["I live in Muzafferpur, which hospital should we go to?"],
  ])("%s → no city, no distance ordering, no km figures", (text) => {
    const { plan, block } = lookup(text);
    const geography = plan.structuredHospitalGeography!;
    expect(geography.requestedCity).toBeNull();
    expect(geography.stage).not.toBe("distance");
    expect(
      (plan.structuredHospitalResults ?? []).some((h) => typeof h.distance_km === "number")
    ).toBe(false);
    expect(block).not.toMatch(/Nearest cancer centres to/);
    expect(block).not.toMatch(/km away/);
    expect(block).not.toMatch(/within 10 km/);
  });

  it("a city the patient named still orders by distance from it", () => {
    const { plan, block } = lookup("main Gaya se hoon, kaun sa hospital accha hai?");
    expect(plan.structuredHospitalGeography!.requestedCity).toBe("Gaya");
    expect(plan.structuredHospitalGeography!.stage).toBe("distance");
    expect(block).toContain("Nearest cancer centres to Gaya");
  });

  it("an exactly named city beats a fuzzy guess elsewhere in the sentence", () => {
    const { plan } = lookup("kya Patna me koi accha cancer hospital hai?");
    expect(plan.structuredHospitalGeography!.requestedCity).toBe("Patna");
  });
});
