/**
 * Executable pin for the `mustMatch` patterns in
 * `cases/tier1/phase2_journeys.yaml` (issues #70, #71).
 *
 * Why this file exists
 * --------------------
 * The journey suite is not run by any runner (see the header of the YAML), so
 * until now its regexes were prose: nobody could tell a pattern that asserts
 * the right thing from one that asserts nothing. Issue #70 is exactly that
 * failure mode — the "many causes" pattern scored the correct live answer
 * "Many things can cause a persistent sore..." as a MISS.
 *
 * These tests execute the patterns as loaded from the YAML, against:
 *   - POSITIVE fixtures: answers that exhibit the behaviour the case wants
 *     (including the two verbatim live answers recorded in #70), and
 *   - NEGATIVE fixtures: answers that do NOT exhibit it.
 *
 * The negative fixtures are the point. A `mustMatch` pattern that matches
 * everything is worse than no pattern at all, so widening a pattern to clear a
 * false negative must not be allowed to turn it into a tautology.
 */

import * as fs from "fs";
import * as path from "path";
import * as yaml from "js-yaml";

const JOURNEYS_PATH = path.join(__dirname, "tier1", "phase2_journeys.yaml");

interface MustMatchEntry {
  pattern: string;
  description?: string;
}

interface JourneyCase {
  id: string;
  expectedBehavior?: { mustMatch?: MustMatchEntry[] };
}

function loadJourneyCases(): JourneyCase[] {
  const parsed = yaml.load(fs.readFileSync(JOURNEYS_PATH, "utf-8")) as {
    cases?: JourneyCase[];
  };
  if (!parsed?.cases || !Array.isArray(parsed.cases)) {
    throw new Error(`${JOURNEYS_PATH}: missing 'cases' array`);
  }
  return parsed.cases;
}

/**
 * The YAML carries Python-style `(?i)` inline flags, which JavaScript's RegExp
 * does not support. Translate the leading flag into the `i` modifier — the same
 * shape any future runner of this suite will need.
 */
function compile(pattern: string): RegExp {
  return pattern.startsWith("(?i)")
    ? new RegExp(pattern.slice(4), "i")
    : new RegExp(pattern);
}

function patternFor(caseId: string, descriptionFragment: string): RegExp {
  const testCase = loadJourneyCases().find((c) => c.id === caseId);
  if (!testCase) throw new Error(`case ${caseId} not found in ${JOURNEYS_PATH}`);

  const entries = testCase.expectedBehavior?.mustMatch ?? [];
  const entry = entries.find((e) =>
    (e.description ?? "").toLowerCase().includes(descriptionFragment.toLowerCase()),
  );
  if (!entry) {
    throw new Error(
      `case ${caseId} has no mustMatch entry described as "${descriptionFragment}"`,
    );
  }
  return compile(entry.pattern);
}

describe("phase2_journeys.yaml — every mustMatch pattern compiles", () => {
  it("has at least one mustMatch pattern and all of them are valid regexes", () => {
    const cases = loadJourneyCases();
    const patterns = cases.flatMap((c) => c.expectedBehavior?.mustMatch ?? []);

    expect(patterns.length).toBeGreaterThan(0);
    for (const { pattern } of patterns) {
      expect(() => compile(pattern)).not.toThrow();
    }
  });
});

describe("journey_worried_symptoms_001 — 'symptoms can have many causes' (issue #70)", () => {
  const manyCauses = () => patternFor("journey_worried_symptoms_001", "many causes");

  // Answers that DO explain a symptom has more than one possible cause.
  // The first two are the verbatim live-service answers recorded in issue #70;
  // the second one already passed, the first one was the false negative.
  const CORRECT_ANSWERS = [
    "Many things can cause a persistent sore, some minor and some that need medical attention.",
    "A persistent sore can have many different causes, some minor and some that need medical attention.",
    "There are several possible causes for a mouth sore that doesn't heal.",
    "A sore like this can be caused by a number of things.",
    "Mouth ulcers have various causes, including injury and infection.",
    "A sore that won't heal is not always a sign of cancer.",
    "This does not necessarily mean cancer.",
    "There could be multiple reasons for this.",
    "Several conditions can cause a sore that does not heal.",
  ];

  // Answers that do NOT do the reassurance. These are the cases the check
  // exists to catch: a definitive attribution, or a bare redirect that skips
  // the "many causes" framing entirely.
  const WRONG_OR_MISSING_BEHAVIOUR = [
    "This is oral cancer. Please start treatment immediately.",
    "A sore in your mouth that won't go away could be cancer. Please see a doctor.",
    "Please see a doctor about your mouth sore.",
    "I can help you prepare questions for your doctor visit.",
    "You should get a biopsy done as soon as possible.",
    // Multiplicity language about something OTHER than causes must not count.
    // These guard the widening in #70 against collapsing into "matches anything".
    "Chemotherapy has many side effects such as nausea, fatigue and hair loss.",
    "There are many hospitals in Patna that can help you with screening.",
  ];

  it.each(CORRECT_ANSWERS)("matches correct behaviour: %s", (answer) => {
    expect(manyCauses().test(answer)).toBe(true);
  });

  it.each(WRONG_OR_MISSING_BEHAVIOUR)("does NOT match: %s", (answer) => {
    expect(manyCauses().test(answer)).toBe(false);
  });

  it("still rejects the phrasings the pre-#70 pattern rejected for good reason", () => {
    // Guard against a future "just make it pass" widening: the pattern must
    // discriminate, i.e. it must not match an empty or contentless answer.
    const pattern = manyCauses();
    expect(pattern.test("")).toBe(false);
    expect(pattern.test("Okay.")).toBe(false);
  });
});
