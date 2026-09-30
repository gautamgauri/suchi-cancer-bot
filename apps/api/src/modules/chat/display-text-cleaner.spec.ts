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

    /**
     * Issue #160. The sources block is appended by the composite/escalated path
     * and the Disclaimer Engine appends its footer AFTER it, so the persisted
     * text is `...answer \n\n**Sources:** [markers] \n\n---\n*footer*`. The
     * strip must take the block and nothing else: eating the paragraph break
     * glues the emergency footer to the last sentence and ships the raw `---`,
     * because markdown only renders a `---` that is alone on its line.
     */
    describe('the paragraph break before the appended disclaimer (issue #160)', () => {
      const EMERGENCY_FOOTER =
        '\n\n---\n*If this is a medical emergency, call 112 or 108 immediately. ' +
        'This information does not replace emergency medical care.*';
      const ANSWER = 'Have you noticed nipple discharge or changes in breast size/shape?';

      it('keeps the break when a Sources block sits between the answer and the footer', () => {
        const withSources =
          ANSWER +
          '\n\n**Sources:** [citation:doc1:chunk1] [citation:doc2:chunk2]' +
          EMERGENCY_FOOTER;

        const out = cleanResponseForDisplay(withSources);

        expect(out).toBe(ANSWER + EMERGENCY_FOOTER);
        expect(out).not.toContain('breast size/shape?---');
        expect(out).toContain('\n\n---\n');
      });

      it('matches the control: the same text with no Sources block is unchanged', () => {
        const out = cleanResponseForDisplay(ANSWER + EMERGENCY_FOOTER);

        expect(out).toBe(ANSWER + EMERGENCY_FOOTER);
      });

      it('keeps the break for the standard disclaimer too, not only the emergency one', () => {
        const standard =
          '\n\n---\n*This information is for general educational purposes only and is not a ' +
          'substitute for professional medical advice, diagnosis, or treatment.*';
        const withSources =
          'Therefore, I cannot answer your question based on the evidence given.' +
          '\n\n**Sources:** [citation:doc1:chunk1]' +
          standard;

        const out = cleanResponseForDisplay(withSources);

        expect(out).toBe(
          'Therefore, I cannot answer your question based on the evidence given.' + standard,
        );
        expect(out).not.toContain('given.---');
      });

      it('still strips a Sources block whose markers are on their own lines', () => {
        const withSources =
          ANSWER +
          '\n\n**Sources:**\n[citation:doc1:chunk1]\n[citation:doc2:chunk2]' +
          EMERGENCY_FOOTER;

        const out = cleanResponseForDisplay(withSources);

        expect(out).not.toContain('Sources:');
        expect(out).not.toContain('citation');
        expect(out).toContain('\n\n---\n');
      });

      /**
       * The shape `chat.service` actually persists on the escalated path, not a
       * one-line reconstruction of it: the S2 escalation block, the literal
       * `ESCALATION_RAG_SEPARATOR` (`chat.service.ts`), the grounded half with
       * its own inline markers, the appended Sources block, then the footer.
       * Pinned here because the bold escalation header runs through
       * `EMPTY_BOLD_PATTERN` in the same pass — that pattern is the one that ate
       * a line break in #135, and #160 is the same family one step later.
       */
      it('keeps every break in the composite escalated reply', () => {
        const escalation = '**This could be serious.**\n\n**Call for help NOW:**\n- Call 108';
        const separator = '\n\n**Information from trusted sources:**\n\n';
        const grounded =
          'Breast changes have many causes [citation:doc1:chunk1].\n' + ANSWER;
        const persisted =
          escalation +
          separator +
          grounded +
          '\n\n**Sources:** [citation:doc1:chunk1] [citation:doc2:chunk2]' +
          EMERGENCY_FOOTER;

        const out = cleanResponseForDisplay(persisted);

        expect(out).toBe(
          escalation +
            separator +
            'Breast changes have many causes.\n' +
            ANSWER +
            EMERGENCY_FOOTER,
        );
        // The escalation header keeps its own break (#135) and the footer keeps
        // the one before it (#160).
        expect(out).toContain('serious.**\n\n**Call for help NOW:**');
        expect(out).toContain('\n\n---\n');
        expect(out).not.toContain('breast size/shape?---');
      });

      /**
       * The WhatsApp report on #160 was a Hindi turn, and the disclaimer now
       * arrives in the language of the reply (#162/#163). Devanagari has broken
       * text cleaning in this repo before — `\b` is ASCII-only — so the break in
       * front of a Devanagari disclaimer gets its own guard.
       */
      it('keeps the break in front of a Devanagari disclaimer', () => {
        const hindiAnswer = 'स्तन कैंसर की जांच ४० वर्ष की आयु से शुरू होती है।';
        const hindiDisclaimer =
          '\n\n---\n*यह जानकारी केवल सामान्य शैक्षिक उद्देश्यों के लिए है और पेशेवर ' +
          'चिकित्सा सलाह, निदान या उपचार का विकल्प नहीं है।*';
        const persisted =
          hindiAnswer + '\n\n**Sources:** [citation:doc1:chunk1]' + hindiDisclaimer;

        const out = cleanResponseForDisplay(persisted);

        expect(out).toBe(hindiAnswer + hindiDisclaimer);
        expect(out).toContain('\n\n---\n');
        expect(out).not.toContain('है।---');
      });
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

  describe('escalated reply header keeps its line break (issue #135)', () => {
    // Exact `safety.bannerText` from live prod, 2026-09-13, seed 1789272008,
    // q02 messageId c8f0e493-…; the bubble's `responseText` in the same payload
    // was 6 characters shorter: `**\n\n**` between the two header lines was gone.
    const bannerTextFromRun =
      '⚠️ **This sounds like a medical emergency.**\n\n**Call for help NOW:**\n• **112** — National emergency number (police, fire, ambulance)\n• **108** — Free ambulance service (available in most states)\n• **102** — Medical emergency helpline\n\n**While waiting for help:**\n• Do not move the person unnecessarily\n• If breathing is difficult, keep them sitting upright\n• If there is severe bleeding, apply gentle pressure with a clean cloth\n• Keep the person calm and warm\n• Note the time symptoms started — doctors will need this\n\n**Bring to the hospital:**\n• Aadhaar card / ID\n• Current medications list\n• Ayushman Bharat (PMJAY) card if available\n• Any recent medical reports\n\n**Important:** I am an information assistant, not a doctor. This is not a diagnosis. Please get emergency medical help immediately.\n\n---\n*If this is a medical emergency, call 112 or 108 immediately. This information does not replace emergency medical care.*';

    it('leaves the critical escalation text byte-identical (no markers to strip)', () => {
      expect(cleanResponseForDisplay(bannerTextFromRun)).toBe(bannerTextFromRun);
    });

    it('keeps "medical emergency." and "Call for help NOW:" on separate lines', () => {
      const out = cleanResponseForDisplay(bannerTextFromRun);

      expect(out).toContain('medical emergency.**\n\n**Call for help NOW:**');
      expect(out).not.toContain('medical emergency.Call for help NOW:');
    });

    it('still strips a genuinely empty bold marker on a single line', () => {
      expect(cleanResponseForDisplay('Some text ** ** more text.')).toBe('Some text more text.');
    });
  });

  describe('knowledge-base image markup (issue #173)', () => {
    it('removes the source page image a chunk carried into the bullet', () => {
      const text =
        "- Emotions and Cancer![Sick woman lying in man's arms relaxing on couch.](/sites/g/files/xnrzdm211/files/cgov_image/2023-11/iStock-1301700665.jpg) When you have cancer, you may feel a wide range of emotions.";

      const cleaned = cleanResponseForDisplay(text);

      expect(cleaned).not.toContain('![');
      expect(cleaned).not.toContain('/sites/g/files/');
      expect(cleaned).not.toContain('Sick woman lying in mans arms');
      expect(cleaned).toContain('Emotions and Cancer');
      expect(cleaned).toContain('you may feel a wide range of emotions.');
    });

    it('removes an image whose URL was cut off, without eating the next line', () => {
      const text = [
        '**Coping Strategies**',
        "- Emotions and Cancer![Sick woman lying in man's arms relaxing on couch.](/sites/g/files/xnrzdm211/files/iStock-1...",
        '- Coping and support for young people: Cancer can create a sense of isolation.',
      ].join('\n');

      const cleaned = cleanResponseForDisplay(text);

      expect(cleaned).not.toContain('![');
      expect(cleaned).not.toContain('/sites/g/files/');
      expect(cleaned).toContain('**Coping Strategies**');
      expect(cleaned).toContain(
        '- Coping and support for young people: Cancer can create a sense of isolation.'
      );
    });

    it('leaves an ordinary markdown link alone — only images go', () => {
      const text =
        'See [the Indian Cancer Society](https://www.indiancancersociety.org) for support groups.';
      expect(cleanResponseForDisplay(text)).toBe(text);
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
