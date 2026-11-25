/**
 * The allow-list for practical replies (review of PR #267).
 *
 * A message gets a practical reply only when EVERY content word in it is
 * known: a function word, a word about schemes, money, paperwork, hospitals,
 * travel or places, a place or scheme name, the bare words cancer, treatment,
 * ilaj or patient, a family word, or a plain number. Any other word left over
 * means the message may be about something else (a symptom, a feeling, harm),
 * and it takes the existing pipeline unchanged.
 *
 * Rules for adding words:
 *  - Never add a verb of bodily state, feeling or harm.
 *  - Never add a word that completes a harmful phrase from otherwise known
 *    words. "khatam", "gone", "here", "anymore", "jump", "roof", "end",
 *    "die", "live", "dena", "laga" and the like stay out.
 *  - Keep the function words tight. A word left over costs a practical
 *    reply. A word wrongly allowed can cost a person in distress a proper one.
 */

import { placeNameTokens } from "../utils/location-detector";

/** (a) Function words in English, romanised Hindi and Hindi. */
const FUNCTION_WORDS = `
a an the is are was were   am i we you he she they it my our your his her their its me us them
this that these those there what which who whom whose where when how why do does did can could will would
should may must to of in on at for from by with without about into near nearby and or but if so as than
then also any some all every each other another only just very  most much many no not yes please
tell know get getting got give  have has had need needs   there's i'm we're don't doesn't
can't cannot isn't won't what's how's whats hows dont doesnt cant isnt wont im
hai hain ho hota hoti hote hoga hogi hoge kya kaise kaisa kaisi kaun kaunsa kaunsi kon konsa sa si se
ki ka ke ko me mein mai main hum ham hamare hamara hamari humara humare mera meri mere aap ap apna apne
apni tum woh wo yeh ye is us iske uske inke unke liye lie par pe aur ya bhi nahi nahin na to toh
jo kab kahan kaha kahaan kidhar kitna kitne kitni milta milti milte milega milegi milenge mil sakta
sakte sakti ji chahiye chahie chaiye   sab kaun-sa paas pas log logon gives give gets get while under work     factory accept accepts accepted anywhere through via
है हैं हो होता होती होते होगा होगी क्या कैसे कैसा कैसी कौन कौनसा कौनसे कौनसी सा से सी की का के को
में मैं हम हमारे हमारा हमारी मेरा मेरी मेरे आप अपना अपने अपनी तुम वह वो यह ये इस उस लिए पर और या भी
नहीं ना तो जो कब कहाँ कहां किधर कितना कितने कितनी मिलता मिलती मिलेगा मिलेगी चाहिए   जी तक लोगों लोग
`;

/** (b) Schemes, money, cost, paperwork and applications. */
const MONEY_WORDS = `
ayushman bharat pm jay pmjay pm-jay pradhan mantri jan arogya yojana yojna card cards e-card ecard golden
scheme schemes government govt sarkari sarkaari free muft cost costs price prices charge charges fee fees
expense expenses expensive money paisa paise rupee rupees rs inr lakh lakhs crore fund funds relief prime
minister minister's ministers national health insurance policy mediclaim bima cover covers covered coverage
eligible eligibility qualify check apply applying application form forms document documents papers
paper kagaz kagzat kagaj certificate certificates ration aadhaar aadhar id photo photos income bpl poor
garib gareeb afford pay paying paid helpline number numbers toll toll-free concession concessions ticket
tickets train trains railway railways rail fare fares discount chhoot escort attendant senior citizen
citizens elderly age aged old vay vandana rashtriya nidhi grant discretionary central cghs esic esi
employee employees pensioner pensioners pmnrf beneficiary portal app register registration enrol enroll
empanelled empanelment financial help support assistance aid madad sahayata loan loans new
banega banegi banta banti bane banwana banwane banwayein banwaye banaye banana banvana kaise
cmchis kasp himcare abua sehat mhis cmhis gjay maa swasthya sathi
आयुष्मान भारत कार्ड योजना सरकारी मुफ्त मुफ़्त पैसे पैसा रुपये रुपए लाख खर्च खर्चा दस्तावेज़ दस्तावेज कागज़ कागज
कागज़ात कागजात आधार राशन प्रमाण पत्र गरीब मदद सहायता आर्थिक बनवाने बनवाना बनवाएं बनता बनेगा टिकट ट्रेन रेल
छूट बीमा फंड कोष हेल्पलाइन नंबर
`;

/** (c) Hospitals, travel, stay and place. */
const PLACE_WORDS = `
hospital hospitals aspatal aspataal haspatal centre centres center centers clinic clinics doctor doctors
oncologist oncologists best good  accha acha achha achchha nearest near nearby around city cities
district districts state states where list treat treats treated care stay lodging accommodation dharamshala
dharmshala hotel hotels hostel travel   visit cheap private public area town village gaon
india bharat region tata memorial aiims kidwai cmc
अस्पताल हॉस्पिटल केंद्र डॉक्टर अच्छा अच्छे नज़दीक नजदीक पास शहर जिला ज़िला राज्य गांव गाँव
`;

/** (e) The bare words cancer, treatment, ilaj, patient, and family words. */
const PEOPLE_WORDS = `
cancer cancers treatment treatments ilaj ilaaj elaj patient patients mareez marij
mother father papa mummy mom mum dad wife husband son daughter brother sister child children kid kids
parent parents family families grandmother grandfather maa mata pita pati patni beta beti bhai behen
bahan bachcha bachche  baccha nana nani dada dadi parivar
कैंसर इलाज मरीज़ मरीज माँ मां माता पिता पापा मम्मी पति पत्नी बेटा बेटी भाई बहन परिवार
`;

function words(block: string): string[] {
  return block
    .normalize("NFC")
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 0);
}

let allowed: Set<string> | null = null;

function allowedWords(): Set<string> {
  if (allowed) return allowed;
  allowed = new Set([
    ...words(FUNCTION_WORDS),
    ...words(MONEY_WORDS),
    ...words(PLACE_WORDS),
    ...words(PEOPLE_WORDS),
    ...placeNameTokens(),
  ]);
  return allowed;
}

/**
 * Phrases read as one known word before tokenising. "Blood cancer" is a
 * cancer type, so it reads as "cancer". Everything else about blood stays a
 * leftover word.
 */
const PHRASES: Array<[RegExp, string]> = [
  [/\bblood\s+cancers?\b/gi, "cancer"],
  [/ब्लड\s*कैंसर/g, "कैंसर"],
  [/खून\s*(का|के)\s*कैंसर/g, "कैंसर"],
];

/**
 * The words of a message, lower-cased. Latin words keep inner apostrophes and
 * hyphens. Devanagari words keep their vowel signs. Digits form their own
 * tokens. Punctuation, including the danda, separates words.
 */
export function tokenise(text: string): string[] {
  let t = text.normalize("NFC").toLowerCase();
  for (const [re, to] of PHRASES) t = t.replace(re, to);
  t = t.replace(/[’‘]/g, "'");
  // fail closed on any other script, symbol or emoji
  if (/[^\x00-\x7F\u0900-\u097F\u200C\u200D“”–—₹]/.test(t)) return ["\u0000other-script"];
  return t.match(/[a-z]+(?:['-][a-z]+)*|[ऀ-ॣ०-ॿ]+|[0-9]+/g) ?? [];
}

/** (f) Plain numbers, amounts and ages. */
function isNumber(token: string): boolean {
  return /^[0-9०-९]+$/.test(token);
}

/** The words of a message that the allow-list does not know. */
export function unknownWords(text: string): string[] {
  const known = allowedWords();
  return tokenise(text)
    .map((w) => (w.endsWith("'s") && !known.has(w) ? w.slice(0, -2) : w)) // "mother's" reads as "mother"
    .filter((w) => !isNumber(w) && !known.has(w));
}

/** True when every word of the message is on the allow-list. */
export function allWordsKnown(text: string): boolean {
  return unknownWords(text).length === 0;
}
