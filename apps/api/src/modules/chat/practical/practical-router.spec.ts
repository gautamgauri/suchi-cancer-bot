import {
  hasMedicalContent,
  isPlaceSeekingQuestion,
  isPracticalNonMedical,
  routePracticalQuestion,
} from "./practical-router";

/**
 * The practical/medical boundary and the routing of practical questions
 * (issue #260). The questions are the gap assessment's own test questions or
 * synthetic. None is a user message.
 */
describe("practical-router", () => {
  describe("hasMedicalContent: one medical word makes the whole message medical", () => {
    it.each([
      // symptoms, in English, romanised Hindi and Devanagari
      "Mouth ulcer not healing for 2 months, I chew gutka. Is the test free in government hospital?",
      "I have a lump in my breast. Which hospital in Pune should I go to?",
      "papa ko bukhar hai, ayushman card se ilaj hoga?",
      "पेट में दर्द है, आयुष्मान कार्ड चलेगा?",
      "Ayushman card ke chakkar mein pareshan hain",
      // named treatments
      "What documents should I carry to the hospital to use the Ayushman card for chemo?",
      "We are from Rajasthan. Which state health scheme covers cancer surgery?",
      "Radiation therapy ka kharcha kitna aata hai?",
      // medicines and doses
      "Cancer medicines are very expensive. Where can I get them cheaper?",
      "is 500 mg too much",
      // tests, scans and reports
      "How much does a PET CT scan cost in India?",
      "Does Ayushman cover the biopsy?",
      // prognosis and staging
      "Will PM-JAY pay for stage 4 treatment?",
      "मुझे बहुत डर लग रहा है, क्या मैं ठीक हो जाऊँगी?",
    ])("medical: %s", (text) => {
      expect(hasMedicalContent(text)).toBe(true);
      expect(routePracticalQuestion(text)).toBeNull();
    });

    it.each([
      "Does Ayushman Bharat cover cancer treatment?",
      "What is the PM-JAY helpline number?",
      "Garib logon ke liye free cancer treatment kahan milta hai?",
      "आयुष्मान कार्ड से कैंसर का इलाज कितने रुपये तक मुफ्त होता है?",
      "Which hospitals in Kolkata treat blood cancer in children?",
      "Do cancer patients get a concession on train tickets?",
    ])("not medical: %s", (text) => {
      expect(hasMedicalContent(text)).toBe(false);
    });
  });

  // Review of PR #267, item 1. Distress, self-harm, death and urgency words
  // that a deterministic screen might miss must never get a canned practical
  // reply. These messages take the existing path, exactly as on main.
  describe("distress and urgency always take the existing path", () => {
    it.each([
      "no money left, I am a burden on my family",
      "can't pay for treatment, what is the point of living",
      "we cannot afford treatment, I feel like ending it all",
      "garib hain, ilaj nahi kara sakte, marne ke alawa koi raasta nahi",
      "गरीब हैं, मर जाना ही ठीक है",
      "Will my father die? we are poor, no money",
      "nearest hospital in Patna, she took too many pills",
      "which hospital in Patna, he is paralysed on one side",
      "which hospital in Delhi has ICU bed, need ventilator urgently",
      "nearest hospital, he is not waking up",
      "Ayushman card hai, par ab jeene ka mann nahi",
      "poor family, I want to give up, is there free treatment",
      "hospital in Patna, he drank poison",
      "free treatment chahiye, papa behosh hain",
      "आयुष्मान कार्ड है, ज़िंदगी बोझ लगती है",
      "emergency mein kaun sa hospital Patna mein",
    ])("not practical: %s", (text) => {
      expect(hasMedicalContent(text)).toBe(true);
      expect(routePracticalQuestion(text)).toBeNull();
      expect(isPlaceSeekingQuestion(text) && !hasMedicalContent(text)).toBe(false);
    });
  });

  // Review of PR #267, item 2: gaps in the medical lists.
  describe("medical boundary gaps found in review", () => {
    it.each([
      "muh se blood aa raha hai, ayushman card chalega?",
      "मुंह से ब्लड आ रहा है, आयुष्मान कार्ड चलेगा?",
      "मुंह से खून आ रहा है, सरकारी अस्पताल कौन सा है",
      "tumor is growing fast, which hospital in Patna",
      "ट्यूमर बढ़ रहा है, पटना में अस्पताल",
      "gale mein gilti hai, free ilaj kahan",
      "गले में गिल्टी है, मुफ्त इलाज कहाँ",
      "gaanth hai, ayushman card se hoga?",
      "गांठ है, आयुष्मान कार्ड से होगा?",
      "peeliya ho gaya, sarkari hospital Patna",
      "पीलिया है, सरकारी अस्पताल कहाँ",
      "dast ho rahe hain, free ilaj kahan milega",
      "black stools, which hospital in Patna",
      "platelets are very low, which hospital in Patna",
      "hemoglobin 5, which hospital in Patna",
      "neutropenia after treatment, hospital in Delhi",
      "does Ayushman cover mastectomy?",
      "does Ayushman cover hysterectomy?",
      "blood transfusion free in government hospital?",
      "is nivolumab covered under Ayushman card?",
      "pembrolizumab cost under PM-JAY",
      "BMT under Ayushman card",
      "bone marrow transplant scheme",
      "केमोथेरेपी के लिए आयुष्मान कार्ड",
      "विकिरण के लिए सरकारी योजना",
      "ओपरेशन के लिए पैसे नहीं",
      "kya woh bachega, ayushman card hai",
      "क्या पापा बचेगा, पैसे नहीं हैं",
      "cancer has come back, is there any government scheme",
      "relapse after two years, free hospital in Patna",
      "recurrence, ayushman card",
      "should we stop treatment, no money",
      "ayurvedic treatment instead, any scheme",
      "desi ilaj se free mein hoga?",
      "homeopathy for cancer free hospital",
      "alternative treatment under Ayushman",
      "kya desi ilaj se cancer theek hoga",
      "imatinib or trastuzumab covered by Ayushman?",
      "is oxaliplatin or docetaxel or doxorubicin free?",
      "colonoscopy and laparotomy cost under Ayushman",
      "gefitinib under PM-JAY",
    ])("medical: %s", (text) => {
      expect(hasMedicalContent(text)).toBe(true);
      expect(routePracticalQuestion(text)).toBeNull();
    });
  });

  // Re-review of PR #267: the rule is inverted. A practical reply needs every
  // word to be on the allow-list, so a symptom, feeling or harm the deny
  // lists do not name still takes the existing path.
  describe("allow-list: any unknown word takes the existing path", () => {
    it.each([
      "paisa nahi hai, phansi laga lunga",
      "can't afford, husband says he will jump from the roof",
      "no money, I don't want to be here anymore",
      "no money for treatment, better if I was gone",
      "पैसे नहीं हैं, सब खत्म कर देना चाहता हूँ",
      "which hospital in Patna, she drank phenyl",
      "nearest hospital in Ranchi, he cut his wrist",
      "which hospital in Delhi, baby is turning blue",
      "hospital in Patna, mummy bol nahi pa rahi, muh tedha ho gaya",
      "रांची में अस्पताल, बच्चा नीला पड़ रहा है",
      "munh mein safed daag, free ilaj kahan milega",
      "awaaz baith gayi, sarkari hospital Patna mein kaun sa hai",
      "vajan bahut gir gaya, Ayushman card se ilaj hoga?",
      "भूख नहीं लगती, आयुष्मान कार्ड से इलाज होगा?",
      "निगलने में दिक्कत, पटना में सरकारी अस्पताल",
      "nipple is leaking, which hospital in Patna",
      "doctor ne jawab de diya hai, ab paise nahi hain",
      "how many months does she have, can PM-JAY cover it",
      "sek lagega, Ayushman card chalega?",
      "linac in Patna government hospital",
      "mummy ko daura pad raha hai, hospital in Ranchi",
      "cancer fail gaya hai, free ilaj kahan",
      "He is not eating or drinking, which hospital in Patna",
      "mole is changing colour, is it free in government hospital",
      "sugar is 400, which hospital in Lucknow",
      // Third review: phrases built wholly from words that were then allowed.
      "no money, I can not go on",
      "no money, I do not want to go on",
      "paisa nahi hai, kuch nahi bacha",
      "garib hain, papa nahi bacha",
      "My father is no more, we have no money",
      "no money, I do not want treatment",
      "treatment is not working, which hospital in Patna",
      "papa is not getting better, Ayushman card",
      "koi ilaj nahi hai kya, paisa nahi hai",
      "kuch nahi ho sakta, paisa nahi hai",
      "mera koi nahi hai, paisa nahi hai",
      "पापा कब तक हैं, पैसे नहीं हैं",
      // Third review: other scripts and symbols fail closed.
      "Ayushman card আমি মরতে চাই",
      "Ayushman card 💊💊💊",
    ])("existing path: %s", (text) => {
      expect(routePracticalQuestion(text)).toBeNull();
      expect(isPracticalNonMedical(text)).toBe(false);
    });

    it.each([
      ["Ayushman card kaise banega", "pay"],
      ["cancer hospital in Lucknow", "where"],
      ["how to apply for PM-JAY", "pay"],
      ["आयुष्मान कार्ड बनवाने के लिए कौन से दस्तावेज़ चाहिए?", "pay"],
      ["What is Rashtriya Arogya Nidhi and how do I apply?", "pay"],
      ["Do cancer patients get a concession on train tickets?", "pay"],
      ["My father is 72. Is there a new Ayushman card for senior citizens?", "pay"],
      ["My husband is a central government employee. Does CGHS cover cancer treatment?", "pay"],
      ["I work in a factory and have ESIC. Can I get cancer treatment under ESI?", "pay"],
      ["Which hospitals in Kolkata treat blood cancer in children?", "where"],
      ["ब्लड कैंसर का इलाज कोलकाता में कहाँ होता है?", "where"],
    ])("still practical: %s", (text, kind) => {
      expect(routePracticalQuestion(text)).toEqual(expect.objectContaining({ kind }));
    });

    it("does not read दस्तावेज़ (documents) as दस्त (diarrhoea), or सांसद as सांस", () => {
      expect(hasMedicalContent("आयुष्मान कार्ड के दस्तावेज़")).toBe(false);
      expect(hasMedicalContent("सांसद की सिफारिश")).toBe(false);
      expect(hasMedicalContent("दस्त हो रहे हैं")).toBe(true);
    });
  });

  describe("routePracticalQuestion", () => {
    it.each([
      ["Does Ayushman Bharat cover cancer treatment?", ["pmjay"]],
      ["How do I check if my family is eligible for PM-JAY?", ["pmjay"]],
      ["Ayushman card kaise banwayein? Papa ko cancer hai", ["pmjay"]],
      ["My father is 72. Is there a new Ayushman card for senior citizens?", ["senior"]],
      ["Is there any central government fund that gives money to poor cancer patients?", ["central_funds"]],
      ["How to apply to the Prime Minister's relief fund for my mother's cancer treatment?", ["pmnrf"]],
      ["What is Rashtriya Arogya Nidhi and how do I apply?", ["central_funds"]],
      ["Train mein cancer patient ke liye ticket mein chhoot milti hai kya? Attendant ko bhi?", ["railways"]],
      ["My husband is a central government employee. Does CGHS cover cancer treatment?", ["cghs"]],
      ["I work in a factory and have ESIC. Can I get cancer treatment under ESI?", ["esic"]],
      ["What is the PM-JAY helpline number?", ["pmjay"]],
    ])("pay: %s", (text, topics) => {
      expect(routePracticalQuestion(text)).toEqual(expect.objectContaining({ kind: "pay", topics }));
    });

    it.each([
      ["Is there a government scheme in Tamil Nadu for cancer treatment?", "Tamil Nadu"],
      ["Is there a Kerala scheme for cancer patients' treatment costs?", "Kerala"],
      ["Is there a government scheme in Maharashtra for cancer?", "Maharashtra"],
    ])("pay with a state: %s", (text, state) => {
      expect(routePracticalQuestion(text)).toEqual(expect.objectContaining({ kind: "pay", state }));
    });

    it.each([
      ["Cancer hospitals in Bangalore that accept Ayushman card", "Bengaluru"],
      ["Where can I get cancer treatment in Lucknow?", "Lucknow"],
      ["Which cancer hospitals are there in Patna?", "Patna"],
      ["Patna mein cancer ka accha hospital kaun sa hai?", "Patna"],
      ["वाराणसी में कैंसर का इलाज कहाँ होता है?", "Varanasi"],
      ["Cancer hospital in Kochi or Thiruvananthapuram?", "Kochi"],
    ])("where, with the place: %s", (text, city) => {
      expect(routePracticalQuestion(text)).toEqual({ kind: "where", place: expect.objectContaining({ city }) });
    });

    it("where, with no place: asks for it", () => {
      expect(routePracticalQuestion("which hospital is best for my cancer")).toEqual({ kind: "where", place: null });
    });

    it("a question with a word off the allow-list takes the existing path: 'diagnosed'", () => {
      expect(
        routePracticalQuestion("Does health insurance cover cancer if it was diagnosed after I bought the policy?"),
      ).toBeNull();
    });

    it.each([
      "Does health insurance cover cancer?",
      "Where can we stay near Tata Memorial while my mother gets treatment? We can't afford hotels",
    ])("no verified answer: %s", (text) => {
      expect(routePracticalQuestion(text)).toEqual({ kind: "unverified" });
    });

    it.each([
      // not practical at all
      "Just don't worry, stay positive.",
      "What should I bring to the first oncology appointment?",
      "Biwi ki dekhbhal ke liye naukri chhod di, ab paise khatam ho rahe hain",
      "Can I get leave from my job to look after a parent with cancer?",
      "What is a National Cancer Grid hospital and why does it matter?",
      "Should I go to a government hospital or a private hospital for cancer?",
      // errands this change does not answer
      "How do I get an appointment at Tata Memorial Hospital Mumbai?",
      "Delhi AIIMS mein cancer ke liye appointment kaise milega?",
    ])("left to the ordinary pipeline: %s", (text) => {
      expect(routePracticalQuestion(text)).toBeNull();
    });
  });

  describe("isPlaceSeekingQuestion", () => {
    it.each([
      "doctor ne kaun sa test karne ko bola, biopsy kya hoti hai?",
      "What should I ask the oncologist at the first visit?",
      "Should I go to a government hospital or a private hospital for cancer?",
    ])("not a place question: %s", (text) => {
      expect(isPlaceSeekingQuestion(text)).toBe(false);
    });
  });

  describe("isPracticalNonMedical", () => {
    it("is true for a funding question and false for a hospital question or a medical one", () => {
      expect(isPracticalNonMedical("How to apply to the Prime Minister's relief fund for my mother's cancer treatment?")).toBe(true);
      expect(isPracticalNonMedical("Cancer hospital in Hyderabad")).toBe(false);
      expect(isPracticalNonMedical("Does Ayushman cover chemotherapy?")).toBe(false);
    });
  });
});
