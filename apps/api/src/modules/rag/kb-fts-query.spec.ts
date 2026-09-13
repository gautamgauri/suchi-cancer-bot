import { CrossLingualService, MEDICAL_TERM } from "./cross-lingual.service";
import {
  KB_FTS_MAX_GENERIC_TERMS,
  KB_FTS_MAX_SPECIFIC_TERMS,
  buildKbFtsQuery,
  quoteTsqueryLexeme,
} from "./kb-fts-query";

/**
 * Unit tests for the lexical query builder (issue #134). The end-to-end
 * assertion — that the built query actually matches a pregnancy chunk in a real
 * Postgres — lives in kb-fts.spec.ts; here we pin the token filter and the shape
 * of the emitted tsquery text.
 */

/** The Hinglish probe from the issue, as the user typed it. */
const PROBE_A =
  "meri mausi ko cancer hai aur wo pregnant hai, kya cancer ki dawai se bachcha affected hoga? exact batao";

/** Split a tsquery into its top-level `|` conjuncts, respecting parentheses. */
function topLevelConjuncts(tsquery: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let current = "";
  for (let i = 0; i < tsquery.length; i++) {
    const ch = tsquery[i];
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "|" && depth === 0) {
      out.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  out.push(current.trim());
  return out.filter((c) => c.length > 0);
}

/** Every conjunct as a sorted pair of term texts (quotes and outer parens stripped). */
function pairs(tsquery: string): string[][] {
  return topLevelConjuncts(tsquery).map((c) =>
    c
      .replace(/^\((.*)\)$/s, "$1")
      .split(" & ")
      .map((t) => t.replace(/^\(|\)$/g, "").replace(/^'|'$/g, ""))
      .sort()
  );
}

describe("buildKbFtsQuery (issue #134)", () => {
  describe("the Hinglish probe from the issue", () => {
    const translated = new CrossLingualService().generateParallelQueries(PROBE_A).parallelQueries[1];

    it("is what the chat path sends to retrieval (sanity: translation still holds)", () => {
      expect(translated).toMatch(/\bmedicine\b/);
      expect(translated).toMatch(/\bbaby\b/);
      expect(translated).toMatch(/\bpregnant\b/);
    });

    it("drops every Hinglish function word, the kinship word and the filler, keeps the medical content", () => {
      const q = buildKbFtsQuery(translated);
      expect(q).not.toBeNull();
      expect(q!.terms.map((t) => t.toLowerCase())).toEqual(["cancer", "pregnant", "medicine", "baby", "affected"]);
      for (const noise of ["meri", "mausi", "ko", "hai", "aur", "wo", "kya", "ki", "se", "hoga", "exact", "tell", "me"]) {
        expect(q!.terms.map((t) => t.toLowerCase())).not.toContain(noise);
        expect(q!.droppedTerms.map((t) => t.toLowerCase())).toContain(noise);
      }
    });

    it("keeps 'cancer' as a GENERIC term: usable, but never a hit on its own", () => {
      const q = buildKbFtsQuery(translated)!;
      expect(q.genericTerms.map((t) => t.toLowerCase())).toEqual(["cancer"]);
      // It appears only inside conjunctions that also carry a specific term.
      for (const pair of pairs(q.tsquery)) {
        expect(pair.filter((t) => t !== "cancer").length).toBeGreaterThanOrEqual(1);
      }
    });

    it("requires at least two terms to co-occur (pairwise OR-of-ANDs)", () => {
      const q = buildKbFtsQuery(translated)!;
      expect(q.minMatchedTerms).toBe(2);
      // C(4 specific, 2) = 6, plus 4 specific × 1 generic = 10.
      expect(pairs(q.tsquery)).toHaveLength(10);
      expect(pairs(q.tsquery)).toContainEqual(["baby", "medicine"]);
      expect(pairs(q.tsquery)).toContainEqual(["baby", "pregnant"]);
      expect(pairs(q.tsquery)).toContainEqual(["affected", "medicine"]);
      expect(pairs(q.tsquery)).toContainEqual(["cancer", "pregnant"]);
      // No token of the original sentence survives unquoted.
      expect(q.tsquery).toMatch(/^(\('[^']+' & '[^']+'\)( \| )?)+$/);
    });

    it("the untranslated original keeps the Hinglish medical nouns as content", () => {
      const q = buildKbFtsQuery(PROBE_A)!;
      // 'dawai' (medicine) and 'bachcha' (child) are not translated here — that is
      // CrossLingualService's job — but they are content, not function words, and
      // the Hindi KB (kb/hi) does contain them.
      expect(q.terms.map((t) => t.toLowerCase())).toEqual(["cancer", "pregnant", "dawai", "bachcha", "affected"]);
    });
  });

  describe("what the token filter must never eat", () => {
    it("keeps the content-bearing Hinglish words CrossLingualService recognises", () => {
      // These are markers in CrossLingualService.detectLanguage — but unlike
      // "mujhe"/"batao"/"chahiye" they are what the question is ABOUT.
      for (const word of ["ilaaj", "dawai", "gaanth", "bukhar", "saans", "lakshan", "janch", "kharcha", "sarkari"]) {
        const q = buildKbFtsQuery(`${word} ke baare mein batao`);
        expect(q).not.toBeNull();
        expect(q!.terms.map((t) => t.toLowerCase())).toContain(word);
      }
    });

    it("keeps every medical noun MEDICAL_TERM knows, whatever the stopword lists say", () => {
      const nouns = ["lump", "pain", "fever", "biopsy", "report", "test", "hospital", "doctor", "appointment", "baby"];
      for (const noun of nouns) {
        expect(MEDICAL_TERM.test(noun)).toBe(true);
        expect(buildKbFtsQuery(`${noun} details please`)!.terms.map((t) => t.toLowerCase())).toContain(noun);
      }
    });
  });

  describe("natural-language English", () => {
    it("keeps the content words of a question and drops the grammar", () => {
      const q = buildKbFtsQuery("What are the early warning signs of breast cancer?")!;
      expect(q.terms.map((t) => t.toLowerCase())).toEqual(["early", "warning", "signs", "breast", "cancer"]);
      expect(q.genericTerms.map((t) => t.toLowerCase())).toEqual(["cancer"]);
      expect(q.minMatchedTerms).toBe(2);
      expect(pairs(q.tsquery)).toHaveLength(10); // C(4,2) + 4×1
    });

    it("the WhatsApp probe from the issue thread produces a usable query", () => {
      const q = buildKbFtsQuery("What questions should I ask the doctor at my first oncology appointment?")!;
      expect(q.terms.map((t) => t.toLowerCase())).toEqual(["questions", "doctor", "first", "oncology", "appointment"]);
      expect(pairs(q.tsquery)).toContainEqual(["doctor", "questions"]);
      expect(pairs(q.tsquery)).toContainEqual(["appointment", "oncology"]);
    });

    it("strips punctuation at word edges but keeps it inside words so Postgres tokenises them like the content", () => {
      const q = buildKbFtsQuery("Is HER-2/neu positive (stage 2) follow-up different?")!;
      expect(q.terms).toEqual(["HER-2/neu", "positive", "stage", "follow-up", "different"]);
      expect(q.tsquery).toContain("'HER-2/neu'");
      expect(q.tsquery).toContain("'follow-up'");
      // "2" and "Is" are gone.
      expect(q.tsquery).not.toMatch(/'2'/);
    });

    it("de-duplicates case-insensitively and keeps first-appearance order", () => {
      const q = buildKbFtsQuery("Chemotherapy chemotherapy CHEMOTHERAPY nausea")!;
      expect(q.terms).toEqual(["Chemotherapy", "nausea"]);
      expect(q.tsquery).toBe("('Chemotherapy' & 'nausea')");
    });
  });

  describe("the minimum-matched-terms floor", () => {
    it("one specific term + generic terms → the specific term AND any generic one", () => {
      const q = buildKbFtsQuery("breast cancer treatment")!;
      expect(q.tsquery).toBe("('breast' & 'cancer') | ('breast' & 'treatment')");
      expect(q.minMatchedTerms).toBe(2);
      expect(q.terms).toEqual(["breast", "cancer", "treatment"]);
    });

    it("one specific term alone → that term (no flood risk from a specific word)", () => {
      const q = buildKbFtsQuery("mammography")!;
      expect(q.tsquery).toBe("'mammography'");
      expect(q.minMatchedTerms).toBe(1);
    });

    it("only generic terms → at least two of them", () => {
      const q = buildKbFtsQuery("kya cancer ka treatment hota hai")!;
      expect(q.tsquery).toBe("('cancer' & 'treatment')");
      expect(q.minMatchedTerms).toBe(2);
    });

    it("a single generic term is the whole query (LIMIT + rank handle the flood)", () => {
      const q = buildKbFtsQuery("cancer")!;
      expect(q.tsquery).toBe("'cancer'");
      expect(q.minMatchedTerms).toBe(1);
    });

    it("INVARIANT: no conjunction is made of two generic terms when a specific term exists", () => {
      const q = buildKbFtsQuery("lung cancer treatment side effects")!;
      const generic = q.genericTerms.map((t) => t.toLowerCase());
      expect(generic.sort()).toEqual(["cancer", "treatment"]);
      expect(pairs(q.tsquery)).not.toContainEqual(["cancer", "treatment"]);
      expect(pairs(q.tsquery)).toContainEqual(["cancer", "lung"]);
      for (const pair of pairs(q.tsquery)) {
        expect(pair.some((t) => !generic.includes(t))).toBe(true);
      }
    });

    it("returns null when nothing but function words is left, so the caller skips the arm", () => {
      expect(buildKbFtsQuery("kya hai? batao please")).toBeNull();
      expect(buildKbFtsQuery("what is it")).toBeNull();
      expect(buildKbFtsQuery("")).toBeNull();
      expect(buildKbFtsQuery("   ?!  ")).toBeNull();
      expect(buildKbFtsQuery(undefined as unknown as string)).toBeNull();
    });

    it("drops words that produce no Postgres lexeme at all, so no operand is silently empty", () => {
      // to_tsvector('simple', '½') yields nothing; quoting it would blank the operand.
      const q = buildKbFtsQuery("½ mammography")!;
      expect(q.tsquery).toBe("'mammography'");
      expect(buildKbFtsQuery("½ ¾ —")).toBeNull();
    });

    it(`caps terms at ${KB_FTS_MAX_SPECIFIC_TERMS} specific + ${KB_FTS_MAX_GENERIC_TERMS} generic so the query stays small`, () => {
      const words = ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot", "golf", "hotel", "india", "juliet", "kilo"];
      const q = buildKbFtsQuery(words.join(" "))!;
      expect(q.terms).toEqual(words.slice(0, KB_FTS_MAX_SPECIFIC_TERMS));
      expect(q.droppedTerms).toEqual(words.slice(KB_FTS_MAX_SPECIFIC_TERMS));
      expect(pairs(q.tsquery)).toHaveLength((KB_FTS_MAX_SPECIFIC_TERMS * (KB_FTS_MAX_SPECIFIC_TERMS - 1)) / 2);

      const generics = buildKbFtsQuery("biopsy cancer tumor disease patient therapy")!;
      expect(generics.genericTerms).toHaveLength(KB_FTS_MAX_GENERIC_TERMS);
      expect(generics.droppedTerms).toEqual(["patient", "therapy"]);
    });
  });

  describe("phrases and escaping", () => {
    it("keeps a quoted phrase together with the FOLLOWED BY operator, as one specific term", () => {
      const q = buildKbFtsQuery('"HPV test" for cervical screening')!;
      expect(q.terms).toEqual(['"HPV test"', "cervical", "screening"]);
      expect(q.tsquery).toContain("(('HPV' <-> 'test') & 'cervical')");
      expect(q.tsquery).toContain("(('HPV' <-> 'test') & 'screening')");
      expect(q.tsquery).toContain("('cervical' & 'screening')");
    });

    it("accepts typographic quotes and ignores an unbalanced one", () => {
      expect(buildKbFtsQuery("“oral cancer” signs")!.tsquery).toContain("'oral' <-> 'cancer'");
      expect(buildKbFtsQuery('"lump in breast')!.terms).toEqual(["lump", "breast"]);
    });

    it("keeps every word of a phrase, even stopwords — the user asked for that sequence", () => {
      const q = buildKbFtsQuery('"signs and symptoms" of leukemia')!;
      expect(q.tsquery).toContain("'signs' <-> 'and' <-> 'symptoms'");
    });

    it("escapes single quotes and backslashes so user text can never reach the tsquery grammar", () => {
      expect(quoteTsqueryLexeme("it's")).toBe("'it''s'");
      expect(quoteTsqueryLexeme("a\\b")).toBe("'a\\\\b'");
      const q = buildKbFtsQuery("doctor's advice & (radiation | surgery) <-> !chemo")!;
      // Operators and parentheses are edge punctuation — stripped, never emitted bare.
      expect(q.terms).toEqual(["doctor's", "advice", "radiation", "surgery", "chemo"]);
      expect(q.tsquery).toContain("'doctor''s'");
      expect(q.tsquery).not.toContain("!");
      // Only quoted lexemes, ' & ', ' | ', ' <-> ' and parentheses appear.
      expect(q.tsquery.replace(/'[^']*(?:''[^']*)*'/g, "T")).toMatch(/^[T()&|<>\-\s]+$/);
    });
  });

  describe("Hindi (Devanagari) queries that reach the arm untranslated", () => {
    it("drops Devanagari function words and treats कैंसर as generic", () => {
      const q = buildKbFtsQuery("सर्वाइकल कैंसर की जांच कैसे होती है?")!;
      expect(q.terms).toEqual(["सर्वाइकल", "कैंसर", "जांच"]);
      expect(q.genericTerms).toEqual(["कैंसर"]);
      expect(pairs(q.tsquery)).toContainEqual(["जांच", "सर्वाइकल"]);
      expect(pairs(q.tsquery)).not.toContainEqual(["कैंसर", "कैंसर"]);
    });

    it("the breastfeeding probe (probe D) keeps chemotherapy, breastfeeding and safe", () => {
      const q = buildKbFtsQuery("kya chemotherapy ke dauraan breastfeeding karna safe hai?")!;
      expect(q.terms).toEqual(["chemotherapy", "breastfeeding", "safe"]);
      expect(pairs(q.tsquery)).toContainEqual(["breastfeeding", "chemotherapy"]);
    });
  });
});
