import { ExecutionPlannerService } from "./execution-planner.service";
import { HospitalDirectoryService } from "./hospital-directory.service";

/**
 * Devanagari signal detection in the execution planner.
 *
 * Every Devanagari alternative in detectSignals() used to sit inside a
 * `\b(...)\b` group. JavaScript's `\b` is ASCII-only, so none of them could
 * ever match Hindi script: a Hindi-script Ayushman or "गरीब" hospital question
 * reached the directory with pmjayRequired=false and affordabilityTier="any".
 * All strings below are synthetic.
 */

type SearchArgs = {
  pmjayRequired: boolean;
  affordabilityTier: "low" | "medium" | "any";
};

function plannerWithSpy() {
  const search = jest.fn().mockReturnValue({
    results: [],
    nonCapableRegional: [],
    geography: { stage: "none" },
  });
  const directory = {
    isLoaded: () => true,
    searchHospitalsWithGeography: search,
  } as unknown as HospitalDirectoryService;
  return { planner: new ExecutionPlannerService(directory), search };
}

function searchArgs(text: string): SearchArgs {
  const { planner, search } = plannerWithSpy();
  planner.plan(text, "NAVIGATION", undefined, "hi");
  expect(search).toHaveBeenCalledTimes(1);
  return search.mock.calls[0][0] as SearchArgs;
}

function signals(text: string): string[] {
  const planner = new ExecutionPlannerService(new HospitalDirectoryService());
  return planner.plan(text, "EDUCATION", undefined, "hi").signals;
}

describe("ExecutionPlanner — Devanagari signals (no ASCII-only \\b)", () => {
  describe("hospital search filters", () => {
    test("Ayushman card in Hindi script → pmjayRequired", () => {
      expect(searchArgs("आयुष्मान कार्ड से कौन सा अस्पताल इलाज करेगा?").pmjayRequired).toBe(true);
    });

    test("सरकारी अस्पताल → pmjayRequired (parity with 'government hospital')", () => {
      expect(searchArgs("पटना में कौन सा सरकारी अस्पताल अच्छा है?").pmjayRequired).toBe(true);
    });

    test("सरकारी योजना → pmjayRequired", () => {
      expect(searchArgs("किसी योजना में इलाज वाला अस्पताल बताइए").pmjayRequired).toBe(true);
    });

    test.each([
      "हम गरीब हैं, कौन सा अस्पताल सस्ता है?",
      "इलाज का खर्च कम हो ऐसा अस्पताल बताइए",
      "मुफ्त इलाज वाला अस्पताल कौन सा है?",
      "मुफ़्त इलाज वाला अस्पताल कौन सा है?",
      "पैसे नहीं हैं, कौन सा अस्पताल जाएं?",
    ])("budget concern %s → affordabilityTier low", (text) => {
      expect(searchArgs(text).affordabilityTier).toBe("low");
    });

    test("plain Hindi hospital question → no scheme, no budget filter", () => {
      const args = searchArgs("पटना में कैंसर का अच्छा अस्पताल कौन सा है?");
      expect(args.pmjayRequired).toBe(false);
      expect(args.affordabilityTier).toBe("any");
    });

    test("आधार कार्ड is ID, not a scheme → no PM-JAY filter", () => {
      expect(searchArgs("आधार कार्ड लेकर कौन सा अस्पताल जाएं?").pmjayRequired).toBe(false);
    });

    test("इलाज की योजना (treatment plan) is not a government scheme", () => {
      expect(searchArgs("इलाज की योजना के लिए कौन सा अस्पताल अच्छा है?").pmjayRequired).toBe(false);
    });

    test("Latin forms are unchanged", () => {
      expect(searchArgs("ayushman card wala hospital kaun sa hai").pmjayRequired).toBe(true);
      expect(searchArgs("which hospital can I afford in Patna").affordabilityTier).toBe("low");
    });
  });

  describe("other signals", () => {
    test.each([
      ["मेरे शहर में इलाज कहाँ होगा", "location_mentioned"],
      ["जिला अस्पताल में जांच हुई", "location_mentioned"],
      ["बायोप्सी की रिपोर्ट आ गई है", "report_received"],
      ["पैथोलॉजी में क्या लिखा है", "report_received"],
      ["अब आगे क्या होगा?", "next_steps"],
      ["डॉक्टर ने कैंसर बताया, क्या करें?", "next_steps"],
      ["मुझे बहुत डर लग रहा है", "emotional_distress"],
      ["मैं बहुत चिंतित हूँ", "emotional_distress"],
      ["पापा की बहुत चिंता हो रही है", "emotional_distress"],
      ["घबराहट हो रही है", "emotional_distress"],
      ["पहली कीमो की तैयारी कैसे करें", "chemo_prepare"],
      ["क्या दूसरी राय लेनी चाहिए?", "second_opinion"],
      ["आयुष्मान कार्ड कैसे बनेगा", "scheme_query"],
    ])("%s → %s", (text, signal) => {
      expect(signals(text)).toContain(signal);
    });

    test.each([
      // Ordinary Hindi educational questions must set no signal at all.
      "कैंसर क्या होता है?",
      "स्तन कैंसर के लक्षण क्या हैं?",
      "कीमोथेरेपी के साइड इफेक्ट क्या होते हैं?",
    ])("plain educational question %s → no signals", (text) => {
      expect(signals(text)).toEqual([]);
    });

    test.each([
      // "came" is not "the report came".
      ["कल रात बुखार आया था", "report_received"],
      ["खांसी में थोड़ा खून आ गई", "report_received"],
      // Bare आगे is ordinary phrasing, not "what next".
      ["गांठ आगे की तरफ है", "next_steps"],
      ["कीमो में क्या करते हैं?", "next_steps"],
      // "Is it something to worry about?" is a symptom question.
      ["क्या यह चिंता की बात है?", "emotional_distress"],
      ["डॉक्टर ने कहा चिंता मत करो", "emotional_distress"],
      ["घबराओ मत, सब ठीक है", "emotional_distress"],
      // अंडर (under) is not डर (fear).
      ["अंडरआर्म में गांठ है", "emotional_distress"],
    ])("%s must NOT set %s", (text, signal) => {
      expect(signals(text)).not.toContain(signal);
    });
  });
});
