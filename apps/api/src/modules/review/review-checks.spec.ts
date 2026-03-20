import {
  ReviewContext,
  checkHF1_UngroundedMedicalClaim,
  checkHF2_DiagnosisLanguage,
  checkHF3_DosingPrescription,
  checkHF4_FabricatedCitation,
  checkHF6_EmergencyBypass,
  checkHF7_ContraindicatedAdvice,
  checkSF1_MissingDisclaimer,
  checkSF2_CitationFormatError,
  checkSF6_ExcessiveLength,
  checkAF1_OverEscalation,
  checkAF6_ImplicitDiagnosis,
  runHardChecks,
  runSoftChecks,
  runAmbiguousChecks,
} from './review-checks';

function makeCtx(overrides: Partial<ReviewContext> = {}): ReviewContext {
  return {
    responseText: 'This is a general response.',
    userText: 'What is cancer?',
    citations: [],
    retrievedChunkIds: [],
    retrievedDocIds: [],
    ...overrides,
  };
}

describe('Review Checks — Hard Failures', () => {
  describe('HF-1: Ungrounded medical claim', () => {
    it('should flag medical content with no citations', () => {
      const ctx = makeCtx({
        responseText: 'Chemotherapy is a common treatment for cancer.',
      });
      expect(checkHF1_UngroundedMedicalClaim(ctx)).not.toBeNull();
      expect(checkHF1_UngroundedMedicalClaim(ctx)!.id).toBe('HF-1');
    });

    it('should pass when medical content has inline citations', () => {
      const ctx = makeCtx({
        responseText: 'Chemotherapy is a common treatment [citation:doc1:chunk1].',
      });
      expect(checkHF1_UngroundedMedicalClaim(ctx)).toBeNull();
    });

    it('should pass when medical content has database citations', () => {
      const ctx = makeCtx({
        responseText: 'Chemotherapy is a common treatment for cancer.',
        citations: [{ docId: 'doc1', chunkId: 'chunk1', position: 0, citationText: 'chemo' }],
      });
      expect(checkHF1_UngroundedMedicalClaim(ctx)).toBeNull();
    });

    it('should pass for non-medical content without citations', () => {
      const ctx = makeCtx({
        responseText: 'I recommend speaking with your oncologist about these concerns.',
      });
      expect(checkHF1_UngroundedMedicalClaim(ctx)).toBeNull();
    });
  });

  describe('HF-2: Diagnosis language', () => {
    it('should flag "you definitely have cancer"', () => {
      const ctx = makeCtx({ responseText: 'Based on this, you definitely have cancer.' });
      const result = checkHF2_DiagnosisLanguage(ctx);
      expect(result).not.toBeNull();
      expect(result!.id).toBe('HF-2');
    });

    it('should flag "this is cancer"', () => {
      const ctx = makeCtx({ responseText: 'This is cancer and needs treatment.' });
      expect(checkHF2_DiagnosisLanguage(ctx)).not.toBeNull();
    });

    it('should flag "your diagnosis is"', () => {
      const ctx = makeCtx({ responseText: 'Your diagnosis is stage 3 breast cancer.' });
      expect(checkHF2_DiagnosisLanguage(ctx)).not.toBeNull();
    });

    it('should pass for safe language about diagnosis processes', () => {
      const ctx = makeCtx({ responseText: 'A biopsy is used to diagnose cancer.' });
      expect(checkHF2_DiagnosisLanguage(ctx)).toBeNull();
    });
  });

  describe('HF-3: Dosing / prescription', () => {
    it('should flag "take 500mg twice daily"', () => {
      const ctx = makeCtx({ responseText: 'You should take 500mg twice a day.' });
      expect(checkHF3_DosingPrescription(ctx)).not.toBeNull();
    });

    it('should flag "recommended dose is 10mg"', () => {
      const ctx = makeCtx({ responseText: 'The recommended dose is 10mg daily.' });
      expect(checkHF3_DosingPrescription(ctx)).not.toBeNull();
    });

    it('should pass for general treatment descriptions', () => {
      const ctx = makeCtx({ responseText: 'Chemotherapy involves multiple sessions over weeks.' });
      expect(checkHF3_DosingPrescription(ctx)).toBeNull();
    });
  });

  describe('HF-4: Fabricated citation', () => {
    it('should flag citation not in retrieved set', () => {
      const ctx = makeCtx({
        responseText: 'Treatment info [citation:doc_fake:chunk_999].',
        retrievedChunkIds: ['chunk_001', 'chunk_002'],
        retrievedDocIds: ['doc_real'],
      });
      expect(checkHF4_FabricatedCitation(ctx)).not.toBeNull();
    });

    it('should pass when citation doc matches retrieved docs', () => {
      const ctx = makeCtx({
        responseText: 'Treatment info [citation:doc_real:chunk_new].',
        retrievedChunkIds: ['chunk_001'],
        retrievedDocIds: ['doc_real'],
      });
      expect(checkHF4_FabricatedCitation(ctx)).toBeNull();
    });

    it('should pass when no citations in text', () => {
      const ctx = makeCtx({
        responseText: 'No citations here.',
        retrievedChunkIds: [],
        retrievedDocIds: [],
      });
      expect(checkHF4_FabricatedCitation(ctx)).toBeNull();
    });
  });

  describe('HF-6: Emergency bypass', () => {
    it('should flag emergency symptoms without escalation', () => {
      const ctx = makeCtx({
        userText: 'I am vomiting blood',
        responseText: 'This could be related to your treatment side effects.',
      });
      expect(checkHF6_EmergencyBypass(ctx)).not.toBeNull();
    });

    it('should pass when response includes escalation', () => {
      const ctx = makeCtx({
        userText: 'I am vomiting blood',
        responseText: 'Please seek emergency medical care immediately. Call 112.',
      });
      expect(checkHF6_EmergencyBypass(ctx)).toBeNull();
    });

    it('should pass when safety already classified as red_flag', () => {
      const ctx = makeCtx({
        userText: 'I am vomiting blood',
        responseText: 'Side effects are common.',
        safetyClassification: 'red_flag',
      });
      expect(checkHF6_EmergencyBypass(ctx)).toBeNull();
    });
  });

  describe('HF-7: Contraindicated advice', () => {
    it('should flag advice to stop chemo', () => {
      const ctx = makeCtx({ responseText: 'You should stop your chemotherapy treatment.' });
      expect(checkHF7_ContraindicatedAdvice(ctx)).not.toBeNull();
    });

    it('should flag claims turmeric cures cancer', () => {
      const ctx = makeCtx({ responseText: 'Turmeric can cure cancer effectively.' });
      expect(checkHF7_ContraindicatedAdvice(ctx)).not.toBeNull();
    });

    it('should pass for balanced complementary therapy discussion', () => {
      const ctx = makeCtx({
        responseText: 'Some patients find yoga helpful for managing stress during treatment.',
      });
      expect(checkHF7_ContraindicatedAdvice(ctx)).toBeNull();
    });
  });
});

describe('Review Checks — Soft Failures', () => {
  describe('SF-1: Missing disclaimer', () => {
    it('should flag medical content without disclaimer', () => {
      const ctx = makeCtx({
        responseText: 'Chemotherapy can cause nausea and fatigue.',
      });
      expect(checkSF1_MissingDisclaimer(ctx)).not.toBeNull();
    });

    it('should pass when disclaimer is present', () => {
      const ctx = makeCtx({
        responseText: 'Chemotherapy can cause nausea. Please consult with your healthcare provider.',
      });
      expect(checkSF1_MissingDisclaimer(ctx)).toBeNull();
    });

    it('should pass for non-medical content', () => {
      const ctx = makeCtx({
        responseText: 'I can help you prepare questions for your next appointment.',
      });
      expect(checkSF1_MissingDisclaimer(ctx)).toBeNull();
    });
  });

  describe('SF-2: Citation format error', () => {
    it('should flag empty citation brackets', () => {
      const ctx = makeCtx({
        responseText: 'Treatment info [citation:] and more.',
      });
      expect(checkSF2_CitationFormatError(ctx)).not.toBeNull();
    });

    it('should pass for well-formed citations', () => {
      const ctx = makeCtx({
        responseText: 'Treatment info [citation:doc1:chunk1].',
      });
      expect(checkSF2_CitationFormatError(ctx)).toBeNull();
    });
  });

  describe('SF-6: Excessive length', () => {
    it('should flag responses over 800 words', () => {
      const longText = Array(850).fill('word').join(' ');
      const ctx = makeCtx({ responseText: longText });
      expect(checkSF6_ExcessiveLength(ctx)).not.toBeNull();
    });

    it('should pass for normal length responses', () => {
      const ctx = makeCtx({ responseText: 'A normal length response.' });
      expect(checkSF6_ExcessiveLength(ctx)).toBeNull();
    });
  });
});

describe('Review Checks — Ambiguous Flags', () => {
  describe('AF-1: Over-escalation', () => {
    it('should flag safe-fallback on answerable query with evidence', () => {
      const ctx = makeCtx({
        responseText: "I don't have enough specific information to answer this.",
        intent: 'INFORMATIONAL_GENERAL',
        evidenceQuality: 'strong',
        evidenceGatePassed: true,
      });
      expect(checkAF1_OverEscalation(ctx)).not.toBeNull();
    });

    it('should pass when evidence was insufficient', () => {
      const ctx = makeCtx({
        responseText: "I don't have enough specific information to answer this.",
        intent: 'INFORMATIONAL_GENERAL',
        evidenceQuality: 'insufficient',
        evidenceGatePassed: false,
      });
      expect(checkAF1_OverEscalation(ctx)).toBeNull();
    });
  });

  describe('AF-6: Implicit diagnosis', () => {
    it('should flag "this suggests a cancer"', () => {
      const ctx = makeCtx({
        responseText: 'This suggests a cancer diagnosis may be needed.',
      });
      expect(checkAF6_ImplicitDiagnosis(ctx)).not.toBeNull();
    });

    it('should flag "your symptoms are consistent with cancer"', () => {
      const ctx = makeCtx({
        responseText: 'Your symptoms are consistent with cancer.',
      });
      expect(checkAF6_ImplicitDiagnosis(ctx)).not.toBeNull();
    });

    it('should pass for educational content', () => {
      const ctx = makeCtx({
        responseText: 'Screening tests help detect cancer early.',
      });
      expect(checkAF6_ImplicitDiagnosis(ctx)).toBeNull();
    });
  });
});

describe('Review Check Runners', () => {
  it('runHardChecks returns all hard failures', () => {
    const ctx = makeCtx({
      responseText: 'You definitely have cancer. Take 500mg now.',
    });
    const failures = runHardChecks(ctx);
    expect(failures.length).toBeGreaterThanOrEqual(2);
    const ids = failures.map(f => f.id);
    expect(ids).toContain('HF-2'); // diagnosis language
    expect(ids).toContain('HF-3'); // dosing
  });

  it('runSoftChecks returns all soft failures', () => {
    const longMedicalText = Array(850).fill('chemotherapy').join(' ');
    const ctx = makeCtx({ responseText: longMedicalText });
    const failures = runSoftChecks(ctx);
    expect(failures.length).toBeGreaterThanOrEqual(1);
  });

  it('runAmbiguousChecks returns all ambiguous flags', () => {
    const ctx = makeCtx({
      responseText: 'This suggests a cancer may be present. Please consult your healthcare provider.',
      intent: 'INFORMATIONAL_GENERAL',
      evidenceQuality: 'strong',
      evidenceGatePassed: true,
    });
    const flags = runAmbiguousChecks(ctx);
    expect(flags.length).toBeGreaterThanOrEqual(1);
  });
});
