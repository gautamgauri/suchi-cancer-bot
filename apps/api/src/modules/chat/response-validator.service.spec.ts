import { ResponseValidatorService } from "./response-validator.service";
import { EvidenceChunk } from "../evidence/evidence-gate.service";

/**
 * Regression coverage for the validator entity gate (#167 / #166).
 *
 * The gate exists to stop the model asserting a medical entity that the
 * retrieved evidence never mentions. It must fire on invented entities
 * (#166) and must NOT fire merely because the model spelled a grounded
 * entity differently from the source text (#167).
 *
 * All text below is synthetic — this repo is public, so no real user
 * message or channel transcript may appear here.
 */
describe("ResponseValidatorService", () => {
  let service: ResponseValidatorService;

  beforeEach(() => {
    service = new ResponseValidatorService();
  });

  const chunk = (content: string, id = "c1"): EvidenceChunk => ({
    chunkId: id,
    docId: "doc1",
    content,
    document: {
      title: "Synthetic test document",
      sourceType: "nci",
      source: "NCI",
      citation: "NCI",
      isTrustedSource: true,
    },
  });

  const names = (result: { ungroundedEntities: { entity: string }[] }) =>
    result.ungroundedEntities.map(e => e.entity.toLowerCase());

  describe("#167 — grounded entities must not be reported as ungrounded", () => {
    it("grounds a qualified surface form against the bare concept in the evidence", () => {
      // Model writes "radiation therapy"; the source says "radiation".
      const result = service.validate(
        "Radiation therapy to the head and neck can make swallowing uncomfortable.",
        [chunk("Radiation to the head and neck area may cause a sore throat and dryness.")]
      );

      expect(result.ungroundedEntities).toEqual([]);
      expect(result.shouldAbstain).toBe(false);
      expect(result.isValid).toBe(true);
    });

    it("grounds an entity whose match spans a line break in the response", () => {
      // Markdown wrapping put a newline inside the matched entity.
      const result = service.validate(
        "Your care team may recommend radiation\ntherapy for this.",
        [chunk("Radiation therapy is one of the treatments used for this cancer.")]
      );

      expect(result.ungroundedEntities).toEqual([]);
      expect(result.shouldAbstain).toBe(false);
    });

    it("grounds a plural surface form against the singular in the evidence", () => {
      const result = service.validate(
        "Your doctor may follow tumor markers over time.",
        [chunk("A tumor marker level can be measured with a blood test.")]
      );

      expect(result.ungroundedEntities).toEqual([]);
    });

    it("grounds an abbreviation expanded differently in the evidence", () => {
      const result = service.validate("A CT scan may be ordered.", [
        chunk("A CT of the chest is often the first imaging step."),
      ]);

      expect(result.ungroundedEntities).toEqual([]);
    });

    it("grounds an entity via its declared synonym", () => {
      const result = service.validate("Radiation therapy is given in daily sessions.", [
        chunk("Radiotherapy is usually delivered as a course of daily sessions."),
      ]);

      expect(result.ungroundedEntities).toEqual([]);
    });

    it("does not abstain on a supportive-care answer drawn from an on-topic chunk", () => {
      const responseText = [
        "Eating can be harder during radiation treatment to the throat.",
        "Soft, moist foods are often easier to swallow, and your care team can refer",
        "you to a dietitian.",
      ].join("\n");

      const result = service.validate(responseText, [
        chunk(
          "Radiation to the throat can make eating painful. Soft, moist foods are " +
            "often easier to swallow. A dietitian can help plan meals."
        ),
      ]);

      expect(result.shouldAbstain).toBe(false);
    });
  });

  describe("#166 — genuinely ungrounded entities must still abstain", () => {
    it("flags an entity absent from the evidence in every form", () => {
      const result = service.validate("Immunotherapy is the standard option here.", [
        chunk("Soft, moist foods are often easier to swallow during treatment."),
      ]);

      expect(names(result)).toContain("immunotherapy");
      expect(result.shouldAbstain).toBe(true);
      expect(result.isValid).toBe(false);
    });

    it("flags every medical entity when retrieval returned no chunks at all", () => {
      const result = service.validate(
        "A biopsy and an MRI are usually needed before chemotherapy.",
        []
      );

      expect(result.shouldAbstain).toBe(true);
      expect(names(result)).toEqual(
        expect.arrayContaining(["biopsy", "mri", "chemotherapy"])
      );
    });

    it("does not let a near-miss concept ground a different entity", () => {
      // Evidence discusses surgery only; the model asserts chemotherapy.
      const result = service.validate("Chemotherapy is given after surgery.", [
        chunk("Surgery is used to remove the tumour."),
      ]);

      expect(names(result)).toContain("chemotherapy");
      expect(result.shouldAbstain).toBe(true);
    });

    it("keeps stage values exact — a different stage in the evidence does not ground one", () => {
      const result = service.validate("This is typically stage IV disease.", [
        chunk("Stage I disease is confined to the organ of origin."),
      ]);

      expect(result.shouldAbstain).toBe(true);
      expect(names(result)).toContain("stage iv");
    });
  });

  describe("validate() is stateless across calls", () => {
    it("returns the same verdict when the same input is validated twice", () => {
      const text = "An MRI and a biopsy may be needed.";
      const chunks = [chunk("An MRI and a biopsy may be needed to confirm the diagnosis.")];

      const first = service.validate(text, chunks);
      const second = service.validate(text, chunks);

      expect(first.ungroundedEntities).toEqual([]);
      expect(second.ungroundedEntities).toEqual(first.ungroundedEntities);
    });
  });
});
