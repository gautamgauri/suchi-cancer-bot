import { HospitalDirectoryService } from "../hospital-directory.service";
import { ExecutionPlannerService } from "../execution-planner.service";
import { HOSPITAL_HELD_IDS, UNREVIEWED_HOSPITAL_FIELDS } from "../../../common/hospital-visibility";
import { detectPlace } from "../utils/location-detector";
import { ASK_PLACE_REPLY, buildHospitalAnswer } from "./hospital-answer";

/**
 * The reply to "where can I get treatment" questions (issue #260), built from
 * the real hospital directory and nothing else.
 */
describe("buildHospitalAnswer", () => {
  let planner: ExecutionPlannerService;
  beforeAll(() => {
    const directory = new HospitalDirectoryService();
    directory.onModuleInit();
    planner = new ExecutionPlannerService(directory);
  });

  function answer(text: string): string {
    const place = detectPlace(text);
    if (!place) throw new Error(`no place in: ${text}`);
    return buildHospitalAnswer(place, planner.searchForPlace(text, place)!);
  }

  it("asks for the place in one short question", () => {
    expect(ASK_PLACE_REPLY.split("?").length - 1).toBe(1);
    expect(ASK_PLACE_REPLY).not.toMatch(/\n/);
  });

  it("lists the centres in the city itself, from the directory", () => {
    const reply = answer("Which cancer hospitals are there in Patna?");
    expect(reply.startsWith("Cancer centres in Patna, from Suchi's hospital list:")).toBe(true);
    const bullets = reply.split("\n").filter((l) => l.startsWith("- "));
    expect(bullets.length).toBeGreaterThan(0);
    for (const b of bullets) expect(b).toContain(", Patna, Bihar.");
  });

  it("finds the directory's centre for a city the old table did not know (Bhubaneswar)", () => {
    expect(answer("Any cancer centre in Odisha near Bhubaneswar?")).toContain("AIIMS Bhubaneswar");
  });

  it("lists a national centre in the patient's own city (BBCI Guwahati)", () => {
    const reply = answer("Which hospital in Guwahati treats cancer?");
    expect(reply).toContain("BBCI Guwahati");
    expect(reply).not.toContain("patients from this region also travel to");
  });

  it("says when the city has no centre, and names the state of the ones it shows (Kochi)", () => {
    const reply = answer("Cancer hospital in Kochi or Thiruvananthapuram?");
    expect(reply.startsWith("Suchi's hospital list has no cancer centre in Kochi. These are the centres it lists in Kerala:")).toBe(true);
    expect(reply).toContain("Thiruvananthapuram, Kerala.");
    expect(reply).not.toMatch(/Varanasi|Patna/);
  });

  it("says so and shows no list when nothing in or near the place is known (Ludhiana)", () => {
    const reply = answer("Good cancer hospital in Punjab? We live near Ludhiana");
    expect(reply.startsWith("Suchi's hospital list has no cancer centre in Ludhiana yet.")).toBe(true);
    expect(reply.split("\n").filter((l) => l.startsWith("- "))).toHaveLength(0);
  });

  it("ends every answer with how to find a PM-JAY empanelled hospital", () => {
    for (const text of ["Cancer hospital in Hyderabad", "Good cancer hospital in Punjab? We live near Ludhiana"]) {
      const reply = answer(text);
      expect(reply).toContain('use "Find Hospitals" on https://nha.gov.in/');
      expect(reply).toContain("The PM-JAY toll-free helpline is 14555.");
    }
  });

  it("keeps PR #263's rules: the confirmation sentence, no held entries, no unreviewed fields", () => {
    const reply = answer("Which cancer hospitals are there in Patna?");
    expect(reply).toContain(
      "Hospital services, doctors, costs, and PM-JAY availability can change. Please confirm directly with the hospital before travel or payment."
    );
    for (const id of HOSPITAL_HELD_IDS) expect(reply).not.toContain(id);
    expect(reply).not.toMatch(/Ruban|S\.S\. Hospital|score|tier [A-D]/i);
    expect(UNREVIEWED_HOSPITAL_FIELDS.length).toBeGreaterThan(0);
  });

  // Review of PR #267, item 6.
  it("puts public and NCG centres first at the same distance: Tata Memorial in Mumbai", () => {
    const reply = answer("hospital in Mumbai");
    const bullets = reply.split("\n").filter((l) => l.startsWith("- "));
    expect(bullets[0]).toContain("Tata Memorial Hospital");
  });

  it("shows each centre once, deduplicated on id, short name or name: AIIMS in Delhi", () => {
    const reply = answer("cancer hospital in Delhi");
    const bullets = reply.split("\n").filter((l) => l.startsWith("- "));
    expect(bullets.filter((b) => /All India Institute of Medical Sciences/.test(b)).length).toBeLessThanOrEqual(1);
    expect(bullets[0]).toMatch(/AIIMS/);
  });

  it("filters to PM-JAY or government centres when the question names Ayushman", () => {
    const reply = answer("Cancer hospitals in Bangalore that accept Ayushman card");
    expect(reply).toContain("Kidwai Memorial Institute of Oncology");
    expect(reply).not.toContain("Not PM-JAY empanelled");
  });
});
