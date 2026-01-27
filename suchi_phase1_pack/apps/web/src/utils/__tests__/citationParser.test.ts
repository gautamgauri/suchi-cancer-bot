import { describe, it, expect } from 'vitest';
import {
  parseCitations,
  removeCitationMarkers,
  splitTextWithCitations,
  toCitationData,
  ParsedCitation,
} from '../citationParser';

describe('citationParser', () => {
  describe('parseCitations', () => {
    it('parses single citation', () => {
      const text = 'This is a fact [citation:doc1:chunk1].';
      const result = parseCitations(text);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        citationText: '[citation:doc1:chunk1]',
        docId: 'doc1',
        chunkId: 'chunk1',
        position: 15,
      });
    });

    it('parses multiple citations', () => {
      const text = 'Fact one [citation:doc1:chunk1]. Fact two [citation:doc2:chunk2].';
      const result = parseCitations(text);

      expect(result).toHaveLength(2);
      expect(result[0].docId).toBe('doc1');
      expect(result[1].docId).toBe('doc2');
    });

    it('returns empty array for text without citations', () => {
      const text = 'This is plain text without any citations.';
      const result = parseCitations(text);

      expect(result).toHaveLength(0);
    });

    it('handles citations with complex IDs', () => {
      const text = '[citation:nci-pdq-123-abc:chunk-456-def]';
      const result = parseCitations(text);

      expect(result).toHaveLength(1);
      expect(result[0].docId).toBe('nci-pdq-123-abc');
      expect(result[0].chunkId).toBe('chunk-456-def');
    });

    it('returns citations sorted by position', () => {
      const text = '[citation:first:a] middle [citation:second:b] end [citation:third:c]';
      const result = parseCitations(text);

      expect(result).toHaveLength(3);
      expect(result[0].docId).toBe('first');
      expect(result[1].docId).toBe('second');
      expect(result[2].docId).toBe('third');
      expect(result[0].position).toBeLessThan(result[1].position);
      expect(result[1].position).toBeLessThan(result[2].position);
    });
  });

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

    it('returns original text when no citations', () => {
      const text = 'No citations here.';
      const result = removeCitationMarkers(text);

      expect(result).toBe('No citations here.');
    });

    it('handles empty string', () => {
      const result = removeCitationMarkers('');
      expect(result).toBe('');
    });
  });

  describe('splitTextWithCitations', () => {
    it('splits text with single citation', () => {
      const text = 'Before [citation:doc1:chunk1] after.';
      const result = splitTextWithCitations(text);

      expect(result).toHaveLength(3);
      expect(result[0]).toEqual({ type: 'text', content: 'Before ' });
      expect(result[1].type).toBe('citation');
      expect(result[1].citation?.docId).toBe('doc1');
      expect(result[2]).toEqual({ type: 'text', content: ' after.' });
    });

    it('handles citation at start of text', () => {
      const text = '[citation:doc1:chunk1] starts here.';
      const result = splitTextWithCitations(text);

      expect(result).toHaveLength(2);
      expect(result[0].type).toBe('citation');
      expect(result[1]).toEqual({ type: 'text', content: ' starts here.' });
    });

    it('handles citation at end of text', () => {
      const text = 'Ends here [citation:doc1:chunk1]';
      const result = splitTextWithCitations(text);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ type: 'text', content: 'Ends here ' });
      expect(result[1].type).toBe('citation');
    });

    it('handles multiple citations', () => {
      const text = 'A [citation:d1:c1] B [citation:d2:c2] C';
      const result = splitTextWithCitations(text);

      expect(result).toHaveLength(5);
      expect(result[0]).toEqual({ type: 'text', content: 'A ' });
      expect(result[1].type).toBe('citation');
      expect(result[2]).toEqual({ type: 'text', content: ' B ' });
      expect(result[3].type).toBe('citation');
      expect(result[4]).toEqual({ type: 'text', content: ' C' });
    });

    it('returns single text part for text without citations', () => {
      const text = 'No citations here';
      const result = splitTextWithCitations(text);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({ type: 'text', content: 'No citations here' });
    });

    it('handles empty string', () => {
      const result = splitTextWithCitations('');

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({ type: 'text', content: '' });
    });

    it('handles adjacent citations', () => {
      const text = '[citation:d1:c1][citation:d2:c2]';
      const result = splitTextWithCitations(text);

      expect(result).toHaveLength(2);
      expect(result[0].type).toBe('citation');
      expect(result[1].type).toBe('citation');
    });
  });

  describe('toCitationData', () => {
    const mockParsedCitation: ParsedCitation = {
      citationText: '[citation:doc-123:chunk-456]',
      docId: 'doc-123',
      chunkId: 'chunk-456',
      position: 0,
    };

    it('converts parsed citation to CitationData', () => {
      const result = toCitationData(mockParsedCitation, 0);

      expect(result.docId).toBe('doc-123');
      expect(result.chunkId).toBe('chunk-456');
    });

    it('creates title based on index (1-based)', () => {
      expect(toCitationData(mockParsedCitation, 0).title).toBe('Source 1');
      expect(toCitationData(mockParsedCitation, 4).title).toBe('Source 5');
    });

    it('sets isTrusted to false by default', () => {
      const result = toCitationData(mockParsedCitation, 0);
      expect(result.isTrusted).toBe(false);
    });
  });
});
