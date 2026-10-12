import { describe, it, expect } from 'vitest';
import { removeCitationMarkers } from '../citationParser';

describe('citationParser', () => {
  describe('removeCitationMarkers', () => {
    it('removes single citation marker', () => {
      const text = 'This is a fact [citation:doc1:chunk1].';
      const result = removeCitationMarkers(text);

      expect(result).toBe('This is a fact .');
    });

    it('removes multiple citation markers', () => {
      const text = 'Fact one [citation:doc1:chunk1]. Fact two [citation:doc2:chunk2].';
      const result = removeCitationMarkers(text);

      expect(result).toBe('Fact one . Fact two .');
    });

    it('removes adjacent markers', () => {
      expect(removeCitationMarkers('Claim.[citation:d1:c1][citation:d2:c2]')).toBe('Claim.');
    });

    it('returns original text when no citations', () => {
      const text = 'No citations here.';
      const result = removeCitationMarkers(text);

      expect(result).toBe('No citations here.');
    });

    it('handles empty string', () => {
      const result = removeCitationMarkers('');
      expect(result).toBe('');
    });

    // Issue #68 — the strip used to require a closing bracket, so a generation
    // that stopped mid-marker leaked a raw KB identifier to the reader.
    it('removes an unterminated marker at end of text', () => {
      const text =
        'Biomarker tests might be effective [citation:kb_en_nci_types_breast_diagnosis_breast_cancer_biomarker_tests_v1:kb_';
      const result = removeCitationMarkers(text);

      expect(result).not.toContain('citation');
      expect(result).not.toContain('kb_en_nci_types_breast_diagnosis');
      expect(result).toBe('Biomarker tests might be effective ');
    });

    it('removes a marker truncated inside the "[citation:" prefix', () => {
      expect(removeCitationMarkers('Some grounded fact [cita')).toBe('Some grounded fact ');
      expect(removeCitationMarkers('Some grounded fact [citation:')).toBe('Some grounded fact ');
    });

    it('does not swallow prose that follows an unterminated marker mid-text', () => {
      const text = 'First claim [citation:doc1 then the answer continues [citation:doc2:chunk2] to the end.';
      const result = removeCitationMarkers(text);

      expect(result).not.toContain('citation:');
      expect(result).toContain('then the answer continues');
      expect(result).toBe('First claim  then the answer continues  to the end.');
    });

    it('leaves legitimate bracketed prose alone', () => {
      const text = 'Call 112 (or 108 in some states) for an ambulance [1].';
      expect(removeCitationMarkers(text)).toBe(text);
    });

    it('leaves Devanagari text and its punctuation intact', () => {
      const text = 'अपने डॉक्टर, नर्स या अस्पताल के स्टाफ से बात करें।';
      expect(removeCitationMarkers(text)).toBe(text);
    });

    it('removes a marker truncated mid-id in a Hindi answer', () => {
      const text = 'संक्रमण का खतरा बढ़ सकता है [citation:kb_hi_chemo_v1:kb_';
      const result = removeCitationMarkers(text);

      expect(result).not.toContain('kb_hi_chemo_v1');
      expect(result).toBe('संक्रमण का खतरा बढ़ सकता है ');
    });
  });
});
