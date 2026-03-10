import { detectLocation } from './location-detector';

describe('detectLocation', () => {
  describe('exact match with context', () => {
    it('should detect "I am from Muzaffarpur"', () => {
      const result = detectLocation('I am from Muzaffarpur and I have breast cancer');
      expect(result).not.toBeNull();
      expect(result).toEqual(expect.objectContaining({
        city: 'Muzaffarpur',
        state: 'Bihar',
        confidence: 1.0,
      }));
    });

    it('should detect "living in Patna"', () => {
      const result = detectLocation('I am living in Patna');
      expect(result).not.toBeNull();
      expect(result).toEqual(expect.objectContaining({
        city: 'Patna',
        state: 'Bihar',
      }));
    });

    it('should detect "near Delhi"', () => {
      const result = detectLocation('I stay near Delhi');
      expect(result).not.toBeNull();
      expect(result).toEqual(expect.objectContaining({
        city: 'Delhi',
        state: 'Delhi',
      }));
    });

    it('should detect "based in Mumbai"', () => {
      const result = detectLocation('We are based in Mumbai');
      expect(result).not.toBeNull();
      expect(result).toEqual(expect.objectContaining({
        city: 'Mumbai',
      }));
    });
  });

  describe('fuzzy matching', () => {
    it('should match "Muzafarpur" (missing f) via alias', () => {
      const result = detectLocation('I am from Muzafarpur');
      expect(result).not.toBeNull();
      expect(result).toEqual(expect.objectContaining({
        city: 'Muzaffarpur',
        confidence: 1.0,
      }));
    });

    it('should match "Muzffapur" (transposed) via fuzzy', () => {
      const result = detectLocation('I am from Muzffapur');
      expect(result).not.toBeNull();
      expect(result).toEqual(expect.objectContaining({
        city: 'Muzaffarpur',
      }));
      expect(result.confidence).toBeLessThan(1.0);
    });

    it('should match "Bangaluru" as Bengaluru', () => {
      const result = detectLocation('I live in Bangaluru');
      expect(result).not.toBeNull();
      expect(result).toEqual(expect.objectContaining({
        city: 'Bengaluru',
      }));
    });

    it('should match "Calcutta" as Kolkata', () => {
      const result = detectLocation('I am from Calcutta');
      expect(result).not.toBeNull();
      expect(result).toEqual(expect.objectContaining({
        city: 'Kolkata',
        confidence: 1.0,
      }));
    });
  });

  describe('Hindi / Hinglish patterns', () => {
    it('should detect "main Patna se hoon"', () => {
      const result = detectLocation('main Patna se hoon');
      expect(result).not.toBeNull();
      expect(result).toEqual(expect.objectContaining({
        city: 'Patna',
      }));
    });

    it('should detect "Muzaffarpur se" pattern', () => {
      const result = detectLocation('Muzaffarpur se aaya hoon');
      expect(result).not.toBeNull();
      expect(result).toEqual(expect.objectContaining({
        city: 'Muzaffarpur',
      }));
    });

    it('should detect city with mein', () => {
      const result = detectLocation('Ranchi mein rehta hoon');
      expect(result).not.toBeNull();
      expect(result).toEqual(expect.objectContaining({
        city: 'Ranchi',
      }));
    });
  });

  describe('fallback word scan', () => {
    it('should detect city mentioned without context pattern', () => {
      const result = detectLocation('Muzaffarpur breast cancer treatment');
      expect(result).not.toBeNull();
      expect(result).toEqual(expect.objectContaining({
        city: 'Muzaffarpur',
      }));
      expect(result.confidence).toBeLessThanOrEqual(1.0);
    });
  });

  describe('no match cases', () => {
    it('should return null for text without city names', () => {
      expect(detectLocation('I have breast cancer symptoms')).toBeNull();
    });

    it('should return null for empty text', () => {
      expect(detectLocation('')).toBeNull();
    });

    it('should return null for very short words', () => {
      expect(detectLocation('I am ok')).toBeNull();
    });

    it('should not false-match common words', () => {
      expect(detectLocation('The treatment is available here')).toBeNull();
    });
  });

  describe('alternate names', () => {
    it('should detect "Bombay" as Mumbai', () => {
      const result = detectLocation('hospitals in Bombay');
      expect(result).not.toBeNull();
      expect(result).toEqual(expect.objectContaining({
        city: 'Mumbai',
      }));
    });

    it('should detect "Banaras" as Varanasi', () => {
      const result = detectLocation('I am from Banaras');
      expect(result).not.toBeNull();
      expect(result).toEqual(expect.objectContaining({
        city: 'Varanasi',
      }));
    });

    it('should detect "Allahabad" as Prayagraj', () => {
      const result = detectLocation('I live in Allahabad');
      expect(result).not.toBeNull();
      expect(result).toEqual(expect.objectContaining({
        city: 'Prayagraj',
      }));
    });
  });
});
