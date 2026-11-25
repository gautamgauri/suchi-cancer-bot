import { detectLocation, detectPlace, detectState } from './location-detector';

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

    it('should match "Muzaffarpr" (one letter missing) via fuzzy', () => {
      const result = detectLocation('I am from Muzaffarpr');
      expect(result).not.toBeNull();
      expect(result).toEqual(expect.objectContaining({
        city: 'Muzaffarpur',
      }));
      expect(result.confidence).toBeLessThan(1.0);
    });

    // Issue #260: fuzzy matching is at distance one only. "Muzffapur" is two
    // edits from every alias, and a two-edit match is what read "Kochi" as
    // "kashi" (Varanasi).
    it('does not match a word two edits from every alias', () => {
      expect(detectLocation('I am from Muzffapur')).toBeNull();
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

  // Issue #260, assessment cause 4: the misreadings found on the live service.
  describe('misreadings from the practical support assessment', () => {
    it.each([
      ['Cancer hospital in Kochi or Thiruvananthapuram?', 'Kochi', 'Kerala'],
      ['How do I get an appointment at Tata Memorial Hospital Mumbai?', 'Mumbai', 'Maharashtra'],
      ['Any cancer centre in Odisha near Bhubaneswar?', 'Bhubaneswar', 'Odisha'],
      ['Good cancer hospital in Punjab? We live near Ludhiana', 'Ludhiana', 'Punjab'],
      ['Is there a cancer hospital in Shillong or anywhere in Meghalaya?', 'Shillong', 'Meghalaya'],
      ['वाराणसी में कैंसर का इलाज कहाँ होता है?', 'Varanasi', 'Uttar Pradesh'],
      ['पटना में कैंसर का अस्पताल', 'Patna', 'Bihar'],
    ])('reads "%s" as %s', (text, city, state) => {
      expect(detectLocation(text)).toEqual(expect.objectContaining({ city, state }));
    });

    it.each([
      ['Tata Memorial'],
      ['Any cancer centre?'],
      ['report aa gaya hai'],
      ['dard chala gaya'],
      ['मैं कल अस्पताल गया था'],
    ])('finds no city in "%s"', (text) => {
      expect(detectLocation(text)).toBeNull();
    });

    it('still reads Gaya after a place word', () => {
      expect(detectLocation('hospital in Gaya')).toEqual(expect.objectContaining({ city: 'Gaya' }));
      expect(detectLocation('Gaya mein cancer hospital')).toEqual(expect.objectContaining({ city: 'Gaya' }));
    });

    it('never matches a short word fuzzily', () => {
      // "kochi" is two edits from "kashi", "tata" two from "patna": both
      // matched before. Five-letter words are now exact matches only.
      expect(detectLocation('pune')).toEqual(expect.objectContaining({ city: 'Pune' }));
      expect(detectLocation('punee')).toBeNull();
    });
  });

  describe('detectState and detectPlace', () => {
    it.each([
      ['Is there a government scheme in Tamil Nadu?', 'Tamil Nadu'],
      ['We are from Rajasthan', 'Rajasthan'],
      ['Kerala scheme for cancer', 'Kerala'],
      ['पश्चिम बंगाल में योजना', 'West Bengal'],
      ['Is there a scheme in Maharashtra?', 'Maharashtra'],
    ])('reads the state in "%s"', (text, state) => {
      expect(detectState(text)).toBe(state);
    });

    it('prefers a city, with its state, over a state alone', () => {
      expect(detectPlace('Any cancer centre in Odisha near Bhubaneswar?')).toEqual(
        expect.objectContaining({ city: 'Bhubaneswar', state: 'Odisha' }),
      );
      expect(detectPlace('cancer hospital in Meghalaya')).toEqual(
        expect.objectContaining({ city: null, state: 'Meghalaya' }),
      );
      expect(detectPlace('which hospital is best for my cancer')).toBeNull();
    });
  });
});
