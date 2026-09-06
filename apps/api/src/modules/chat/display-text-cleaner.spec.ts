import { cleanResponseForDisplay } from './display-text-cleaner';

describe('cleanResponseForDisplay', () => {
  describe('complete citation markers', () => {
    it('strips a complete marker and keeps the sentence', () => {
      const out = cleanResponseForDisplay(
        'Screening can find cancer early [citation:kb_en_nci_screening_v1:kb_chunk_3]. Talk to your doctor.',
      );
      expect(out).not.toContain('citation:');
      expect(out).not.toContain('kb_en_nci_screening_v1');
      expect(out).toBe('Screening can find cancer early. Talk to your doctor.');
    });

    it('strips several markers in one response', () => {
      const out = cleanResponseForDisplay(
        'Fact one [citation:doc1:chunk1] and fact two [citation:doc2:chunk2] together.',
      );
      expect(out).not.toContain('[');
      expect(out).toBe('Fact one and fact two together.');
    });
  });

  describe('unterminated citation markers (issue #68)', () => {
    it('strips a marker whose closing bracket never arrived at end of text', () => {
      // Observed on the live service: generation stopped inside the marker.
      const out = cleanResponseForDisplay(
        'Biomarker tests might be effective [citation:kb_en_nci_types_breast_diagnosis_breast_cancer_biomarker_tests_v1:kb_',
      );
      expect(out).not.toContain('citation');
      expect(out).not.toContain('kb_en_nci_types_breast_diagnosis');
      expect(out).not.toContain('[');
      expect(out).toBe('Biomarker tests might be effective');
    });

    it('strips a bare unterminated opener', () => {
      expect(cleanResponseForDisplay('Some grounded fact [citation:')).toBe('Some grounded fact');
    });

    it('strips a marker truncated inside the "[citation:" prefix itself', () => {
      expect(cleanResponseForDisplay('Some grounded fact [cita')).toBe('Some grounded fact');
      expect(cleanResponseForDisplay('Some grounded fact [citation')).toBe('Some grounded fact');
    });

    it('does not swallow prose that follows an unterminated marker mid-text', () => {
      const out = cleanResponseForDisplay(
        'First claim [citation:doc1 then the answer continues [citation:doc2:chunk2] to the end.',
      );
      expect(out).not.toContain('citation:');
      expect(out).toContain('then the answer continues');
      expect(out).toBe('First claim then the answer continues to the end.');
    });
  });

  describe('numbered references', () => {
    it('strips numbered refs left over from LLM output', () => {
      const out = cleanResponseForDisplay('Chemotherapy is one option [1]. Radiation is another [23].');
      expect(out).toBe('Chemotherapy is one option. Radiation is another.');
    });

    it('strips a numbered ref truncated at end of text', () => {
      expect(cleanResponseForDisplay('Chemotherapy is one option [1')).toBe('Chemotherapy is one option');
    });

    it('leaves legitimate bracketed prose alone', () => {
      const text = 'Call 112 (or 108 in some states) for an ambulance.';
      expect(cleanResponseForDisplay(text)).toBe(text);
    });
  });

  describe('raw Sources section', () => {
    it('strips the appended sources section', () => {
      const out = cleanResponseForDisplay(
        'Body of the answer.\n\n**Sources:** [citation:doc1:chunk1] [citation:doc2:chunk2]',
      );
      expect(out).toBe('Body of the answer.');
    });

    it('strips a sources section that was truncated mid-marker', () => {
      const out = cleanResponseForDisplay(
        'Body of the answer.\n\n**Sources:** [citation:doc1:chunk1] [citation:doc2:ch',
      );
      expect(out).not.toContain('Sources:');
      expect(out).not.toContain('citation');
      expect(out).toBe('Body of the answer.');
    });

    it('strips a sources header left dangling with no complete marker at all', () => {
      const out = cleanResponseForDisplay('Body of the answer.\n\n**Sources:** [citation:doc1');
      expect(out).toBe('Body of the answer.');
    });

    it('keeps a "Sources:" header that still has body text under it', () => {
      const text = 'Body of the answer.\n\n**Sources:** National Cancer Institute';
      expect(cleanResponseForDisplay(text)).toBe(text);
    });
  });

  describe('Devanagari punctuation debris (issue #81, finding 3)', () => {
    it('removes the orphaned ", ।" left where markers were stripped', () => {
      const raw =
        'संक्रमण का खतरा बढ़ सकता है [citation:kb_hi_chemo_v1:kb_c1], [citation:kb_hi_chemo_v1:kb_c2]। डेक्सामेथासोन एक स्टेरॉयड है।';
      const out = cleanResponseForDisplay(raw);

      expect(out).not.toContain(', ।');
      expect(out).not.toContain(' ।');
      expect(out).not.toContain('citation');
      expect(out).toBe('संक्रमण का खतरा बढ़ सकता है। डेक्सामेथासोन एक स्टेरॉयड है।');
    });

    it('cleans the artifact even when it arrives already stripped', () => {
      const out = cleanResponseForDisplay('संक्रमण का खतरा बढ़ सकता है , । डेक्सामेथासोन एक स्टेरॉयड है।');
      expect(out).toBe('संक्रमण का खतरा बढ़ सकता है। डेक्सामेथासोन एक स्टेरॉयड है।');
    });

    it('preserves legitimate Devanagari commas, dandas and words', () => {
      const text =
        'अपने डॉक्टर, नर्स या अस्पताल के स्टाफ से बात करें। यह जानकारी केवल शिक्षा के लिए है॥';
      expect(cleanResponseForDisplay(text)).toBe(text);
    });

    it('preserves a Devanagari list where commas separate real items', () => {
      const text = 'लक्षणों में थकान, बुखार, और वजन कम होना शामिल हो सकते हैं।';
      expect(cleanResponseForDisplay(text)).toBe(text);
    });

    it('handles a Hindi answer truncated mid-marker', () => {
      const out = cleanResponseForDisplay(
        'कीमोथेरेपी के दौरान संक्रमण का खतरा बढ़ सकता है [citation:kb_hi_chemo_v1:kb_',
      );
      expect(out).toBe('कीमोथेरेपी के दौरान संक्रमण का खतरा बढ़ सकता है');
      expect(out).not.toContain('kb_hi_chemo_v1');
    });
  });

  describe('legitimate text is preserved', () => {
    it('leaves English punctuation and markdown untouched', () => {
      const text =
        '**Important:** If you have symptoms, see a doctor. Call 1800-22-1951 for guidance.\n\n1. Talk to a doctor\n2. Ask about screening';
      expect(cleanResponseForDisplay(text)).toBe(text);
    });

    it('preserves an ellipsis', () => {
      const text = 'I am still thinking ... please wait.';
      expect(cleanResponseForDisplay(text)).toBe(text);
    });

    it('handles empty and whitespace-only input', () => {
      expect(cleanResponseForDisplay('')).toBe('');
      expect(cleanResponseForDisplay('   ')).toBe('');
    });
  });
});
