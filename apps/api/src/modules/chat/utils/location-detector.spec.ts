import {
  detectLocation,
  detectLocationForGeography,
  LOCATION_CONFIDENCE_FOR_GEOGRAPHY,
} from './location-detector';

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

  // Each of these once produced a Bihar city the user never named, and since
  // #148 that city ordered the hospital list by distance from it.
  describe('false cities (regression)', () => {
    it.each([
      // "at are" matched an unanchored "at\s+(\w+)" → Arrah via alias "ara"
      ['What are the best hospitals for cancer treatment?'],
      // Hinglish past tense "aa gaya" → Gaya
      ['Report aa gaya hai, ab kaun sa hospital jaayein?'],
      // "bukhar" (fever) fuzzy-matched Buxar
      ['mujhe bukhar aur kamzori hai, kaunsa hospital'],
      // "papa" fuzzy-matched Patna
      ['Papa ko cancer hai, kya karein, hospital batao'],
      // verb "gaya" followed by the genitive "ki" is not a place
      ['pata chal gaya ki cancer hai, ab kya karein'],
      // "hunger" is one edit from Munger
      ['I have no hunger since chemo started'],
      // "kya" is two edits from "gaya"
      ['kya chemo ke baad baal wapas aate hain?'],
    ])('%s → null', (text) => {
      expect(detectLocation(text)).toBeNull();
    });

    it('prefers the city named exactly over a fuzzy guess elsewhere ("kya Patna me …")', () => {
      expect(detectLocation('kya Patna me koi accha cancer hospital hai?')).toEqual({
        city: 'Patna',
        state: 'Bihar',
        confidence: 1.0,
      });
    });

    it('does not fuzzy-match short words at all', () => {
      // "patan" is one edit from "patna" but only five letters long
      expect(detectLocation('from patan')).toBeNull();
    });
  });

  describe('real cities that must still be found', () => {
    it.each([
      ['main Gaya se hoon', 'Gaya'],
      ['main gaya se hoon', 'Gaya'],
      ['I live in Arrah', 'Arrah'],
      ['hum Ara me rehte hain', 'Arrah'],
      ['Patna me hospital batao', 'Patna'],
      ['from Muzaffarpur', 'Muzaffarpur'],
      ['Bhagalpur ke paas koi hospital hai?', 'Bhagalpur'],
      ['Gaya ke paas koi hospital hai?', 'Gaya'],
      ['We are near Bodh Gaya', 'Gaya'],
      ['I am from Muzzafarpur', 'Muzaffarpur'],
      ['Patna से हूँ', 'Patna'],
    ])('%s → %s (confident enough for geography)', (text, city) => {
      const result = detectLocation(text);
      expect(result?.city).toBe(city);
      expect(result!.confidence).toBeGreaterThanOrEqual(LOCATION_CONFIDENCE_FOR_GEOGRAPHY);
      expect(detectLocationForGeography(text)?.city).toBe(city);
    });

    it('still fuzzy-matches a long misspelling, but below the geography threshold', () => {
      const result = detectLocation('I live in Muzafferpur');
      expect(result?.city).toBe('Muzaffarpur');
      expect(result!.confidence).toBeLessThan(LOCATION_CONFIDENCE_FOR_GEOGRAPHY);
      expect(detectLocationForGeography('I live in Muzafferpur')).toBeNull();
    });

    it('treats a capitalised mid-sentence "Gaya" as weak evidence only', () => {
      const result = detectLocation('Report aa Gaya hai');
      expect(result?.city).toBe('Gaya');
      expect(result!.confidence).toBeLessThan(LOCATION_CONFIDENCE_FOR_GEOGRAPHY);
      expect(detectLocationForGeography('Report aa Gaya hai')).toBeNull();
    });
  });
});
